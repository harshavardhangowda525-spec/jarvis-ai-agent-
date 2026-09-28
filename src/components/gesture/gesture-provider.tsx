"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { GestureEngine, DEFAULT_SETTINGS, GESTURE_BY_ID, type EngineOutput, type GestureEvent, type GestureSettings } from "@/lib/gesture/engine";
import type { Pt } from "@/lib/gesture/classify";
import { HandTracker, cameraErrorMessage } from "@/lib/gesture/tracker";
import { GestureHud, GestureCursor, GestureToast, type ToastData } from "./gesture-hud";

/**
 * Gesture control for the whole JARVIS app. Mounted once in the app shell so it
 * keeps working across JARVIS, EV, Humanoid View, DARWIN and ULTRON.
 *
 * - The camera opens ONLY when gesture mode is switched on, and is released when
 *   it's switched off (or the tab stays hidden for 2 minutes).
 * - Frames go straight from the <video> into the on-device hand tracker; nothing
 *   is uploaded or recorded.
 * - Recognised gestures are sent to whichever screen registered a handler (the
 *   JARVIS console routes them through the same command router as your voice);
 *   anything unhandled falls back to sensible defaults (pinch = click the thing
 *   you're pointing at, swipes = move between items, palm-left = back).
 */

export type GestureStatus = "off" | "starting" | "loading" | "on" | "sleeping" | "error";
export interface LiveFrame { t: number; out: EngineOutput; landmarks: Pt[] | null }
/** A handler returns a short result ("APPROVED"), true (handled), or false/undefined (not mine). */
export type GestureResult = string | boolean | void | undefined;
export type GestureHandler = (ev: GestureEvent) => GestureResult | Promise<GestureResult>;

interface GestureCtx {
  status: GestureStatus;
  error: string | null;
  active: boolean;
  enable: () => Promise<boolean>;
  disable: () => void;
  settings: GestureSettings;
  setSettings: (s: GestureSettings) => void;
  recalibrate: () => void;
  register: (h: GestureHandler) => () => void;
  /** Latest frame (read it in rAF — it changes ~30×/s without re-rendering). */
  live: React.MutableRefObject<LiveFrame | null>;
  subscribe: (fn: (f: LiveFrame) => void) => () => void;
  video: React.MutableRefObject<HTMLVideoElement | null>;
}

const Ctx = createContext<GestureCtx | null>(null);
export const useGesture = () => useContext(Ctx);

/** Register a gesture handler for as long as the calling component is mounted. */
export function useGestureHandler(handler: GestureHandler) {
  const g = useGesture();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => g?.register((ev) => ref.current(ev)), [g]);
}

const SETTINGS_KEY = "jarvis.gesture.settings.v1";
function loadSettings(): GestureSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<GestureSettings>;
    return { ...DEFAULT_SETTINGS, ...s, enabled: { ...DEFAULT_SETTINGS.enabled, ...(s.enabled ?? {}) } };
  } catch { return DEFAULT_SETTINGS; }
}

const CLICKABLE = 'button, a[href], [role="button"], [role="tab"], [role="option"], [role="switch"], [role="menuitem"], input, select, textarea, summary, label, [data-gesture-target]';
const FOCUSABLE = 'button:not([disabled]), a[href], [role="button"], [tabindex]:not([tabindex="-1"]), [data-gesture-item]';

export function elementLabel(el: Element): string {
  const a = el.getAttribute("aria-label") || el.getAttribute("title") || (el as HTMLElement).innerText || el.getAttribute("placeholder") || "";
  return a.replace(/\s+/g, " ").trim().slice(0, 40);
}

/** The clickable element under a screen point (ignoring our own overlay). */
export function targetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  const t = el?.closest(CLICKABLE) as HTMLElement | null;
  if (!t || t.closest("[data-gesture-ui]")) return null;
  return t;
}

const SLEEP_AFTER_HIDDEN_MS = 120_000;

export function GestureProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<GestureStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<GestureSettings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<ToastData | null>(null);
  const settingsRef = useRef(settings);

  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const tracker = useRef<HandTracker | null>(null);
  const engine = useRef(new GestureEngine(DEFAULT_SETTINGS));
  const live = useRef<LiveFrame | null>(null);
  const listeners = useRef(new Set<(f: LiveFrame) => void>());
  const handlers = useRef<GestureHandler[]>([]);
  const running = useRef(false);
  const want = useRef(false); // the user wants gesture mode on
  const gen = useRef(0);      // bumps on every start/stop so stale async work bails out
  const hiddenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusIdx = useRef(-1);

  useEffect(() => {
    const s = loadSettings();
    setSettingsState(s); settingsRef.current = s; engine.current.setSettings(s);
    engine.current.onCalibrated = (pinchOn) => {
      const next = { ...settingsRef.current, pinchOn };
      settingsRef.current = next; setSettingsState(next);
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      setToast({ key: Date.now(), kind: "info", title: "CALIBRATED", label: "PINCH TUNED TO YOUR HAND", detail: null, confidence: null });
    };
  }, []);

  const setSettings = useCallback((s: GestureSettings) => {
    settingsRef.current = s; setSettingsState(s); engine.current.setSettings(s);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  }, []);

  /** Release the camera and stop all processing. */
  const stopCamera = useCallback(() => {
    running.current = false;
    gen.current++;
    for (const t of stream.current?.getTracks() ?? []) { t.onended = null; t.stop(); }
    stream.current = null;
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
    engine.current.reset();
    live.current = null;
  }, []);

  const disable = useCallback(() => {
    want.current = false;
    stopCamera();
    tracker.current?.close(); tracker.current = null;
    if (hiddenTimer.current) clearTimeout(hiddenTimer.current);
    setStatus("off"); setError(null);
  }, [stopCamera]);

  /* ---------------- dispatch ---------------- */

  const defaultAction = useCallback((ev: GestureEvent): string => {
    switch (ev.action) {
      case "click": {
        if (!ev.pointer) return "NOTHING TO CLICK";
        const t = targetAt(ev.pointer.x * innerWidth, ev.pointer.y * innerHeight);
        if (!t) return "NOTHING TO CLICK THERE";
        if ((t as HTMLButtonElement).disabled || t.getAttribute("aria-disabled") === "true") return "THAT'S DISABLED";
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) { t.focus(); return "FOCUSED"; }
        t.click();
        return elementLabel(t).toUpperCase() || "CLICKED";
      }
      case "prev": case "next": {
        const els = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => {
          if (e.closest("[data-gesture-ui]")) return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        });
        if (!els.length) return "NOTHING TO MOVE TO";
        const cur = els.indexOf(document.activeElement as HTMLElement);
        const base = cur >= 0 ? cur : focusIdx.current;
        const i = (base + (ev.action === "next" ? 1 : -1) + els.length) % els.length;
        focusIdx.current = i;
        els[i].focus({ preventScroll: false });
        return elementLabel(els[i]).toUpperCase() || (ev.action === "next" ? "NEXT" : "PREVIOUS");
      }
      case "back":
        if (history.length > 1) { router.back(); return "BACK"; }
        return "NOTHING TO GO BACK TO";
      case "forward": {
        const ring = ["/dashboard", "/dashboard/darwin", "/dashboard/ultron"];
        const i = ring.findIndex((p, k) => (k === 0 ? pathname === p : pathname.startsWith(p)));
        const next = ring[(i + 1) % ring.length];
        router.push(next);
        return next === "/dashboard" ? "JARVIS" : next.includes("darwin") ? "DARWIN" : "ULTRON";
      }
      case "pause":
        document.querySelectorAll("video, audio").forEach((m) => { if (!(m as HTMLMediaElement).paused && !m.closest("[data-gesture-ui]")) (m as HTMLMediaElement).pause(); });
        try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ }
        return "PAUSED";
      case "wake": return "JARVIS ACTIVE";
      case "approve": case "reject": return "NOTHING WAITING FOR APPROVAL";
      default: return "";
    }
  }, [pathname, router]);

  const dispatch = useCallback(async (ev: GestureEvent) => {
    let result: GestureResult;
    for (const h of [...handlers.current].reverse()) {
      try { result = await h(ev); } catch { result = "SOMETHING WENT WRONG"; }
      if (result !== undefined && result !== false) break;
    }
    if (result === undefined || result === false) result = defaultAction(ev);
    const def = GESTURE_BY_ID[ev.id];
    window.dispatchEvent(new CustomEvent("jarvis-gesture", { detail: ev }));
    setToast({ key: Date.now(), kind: ev.action, title: "GESTURE DETECTED", label: def.label, detail: typeof result === "string" && result ? result : def.actionLabel, confidence: ev.confidence, pointer: ev.pointer ?? null });
  }, [defaultAction]);

  /* ---------------- the frame loop ---------------- */

  const startLoop = useCallback((myGen: number) => {
    let lastProc = 0, lastHand = -1e9, errors = 0;
    const step = () => {
      if (!running.current || gen.current !== myGen) return;
      const v = video.current;
      if (!v) return;
      if ("requestVideoFrameCallback" in v) (v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
      if (document.hidden || v.readyState < 2 || !tracker.current) return;
      const now = performance.now();
      // full rate while a hand is in view, a trickle while nobody's there
      if (now - lastProc < (now - lastHand < 1500 ? 1000 / 30 : 1000 / 10)) return;
      lastProc = now;
      let hand;
      try { hand = tracker.current.detect(v, now); errors = 0; }
      catch (e) {
        if (++errors >= 12) {
          // the tracker is stuck — rebuild it once rather than spinning
          errors = 0;
          tracker.current?.close(); tracker.current = null;
          HandTracker.create().then((t) => { if (gen.current === myGen) tracker.current = t; else t.close(); })
            .catch((err) => { setError((err as Error).message); setStatus("error"); stopCamera(); });
        }
        void e;
        return;
      }
      if (hand) lastHand = now;
      const out = engine.current.update(hand?.landmarks ?? null, now);
      const frame = { t: now, out, landmarks: hand?.landmarks ?? null };
      live.current = frame;
      listeners.current.forEach((fn) => fn(frame));
      for (const ev of out.events) void dispatch(ev);
    };
    step();
  }, [dispatch, stopCamera]);

  const startCamera = useCallback(async (): Promise<boolean> => {
    const myGen = ++gen.current;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera (it needs a secure https page)."); setStatus("error"); return false;
    }
    setStatus("starting");
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
    } catch (e) {
      if (gen.current !== myGen) return false;
      setError(cameraErrorMessage(e).message); setStatus("error"); want.current = false; return false;
    }
    if (gen.current !== myGen || !want.current) { s.getTracks().forEach((t) => t.stop()); return false; }
    stream.current = s;
    const track = s.getVideoTracks()[0];
    track.onended = () => {
      if (gen.current !== myGen) return;
      stopCamera(); setError("The camera was disconnected. Plug it back in and turn gesture mode on again."); setStatus("error");
    };
    if (!video.current) {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.autoplay = true;
      video.current = v;
    }
    video.current.srcObject = s;
    try { await video.current.play(); } catch { /* autoplay of a muted stream is allowed; ignore */ }
    if (!tracker.current) {
      setStatus("loading");
      try { tracker.current = await HandTracker.create(); }
      catch (e) {
        if (gen.current === myGen) { stopCamera(); setError((e as Error).message); setStatus("error"); }
        return false;
      }
      if (gen.current !== myGen || !want.current) return false;
    }
    running.current = true;
    setStatus("on");
    startLoop(myGen);
    return true;
  }, [startLoop, stopCamera]);

  const enable = useCallback(async () => {
    want.current = true;
    if (running.current) return true;
    return startCamera();
  }, [startCamera]);

  const recalibrate = useCallback(() => {
    engine.current.startCalibration(performance.now());
    setToast({ key: Date.now(), kind: "info", title: "RECALIBRATING", label: "SHOW YOUR HAND", detail: "Hold your hand up, then pinch thumb and index a few times", confidence: null });
  }, []);

  // hidden tab: stop processing at once, release the camera after a while, resume on return
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (running.current) {
          hiddenTimer.current = setTimeout(() => { if (document.hidden && running.current) { stopCamera(); setStatus("sleeping"); } }, SLEEP_AFTER_HIDDEN_MS);
        }
      } else {
        if (hiddenTimer.current) clearTimeout(hiddenTimer.current);
        if (want.current && !running.current) void startCamera();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [startCamera, stopCamera]);

  // leave the app → camera off
  useEffect(() => () => { want.current = false; stopCamera(); tracker.current?.close(); tracker.current = null; }, [stopCamera]);

  const register = useCallback((h: GestureHandler) => {
    handlers.current.push(h);
    return () => { handlers.current = handlers.current.filter((x) => x !== h); };
  }, []);
  const subscribe = useCallback((fn: (f: LiveFrame) => void) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);

  const ctx = useMemo<GestureCtx>(() => ({
    status, error, active: status === "on", enable, disable, settings, setSettings, recalibrate, register, live, subscribe, video,
  }), [status, error, enable, disable, settings, setSettings, recalibrate, register, subscribe]);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {status !== "off" && <GestureHud ctx={ctx} onRetry={() => { want.current = true; void startCamera(); }} />}
      {status === "on" && <GestureCursor ctx={ctx} />}
      <GestureToast toast={toast} onDone={() => setToast(null)} />
    </Ctx.Provider>
  );
}
