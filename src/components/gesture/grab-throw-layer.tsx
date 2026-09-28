"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGesture } from "./gesture-provider";
import { TrashBin } from "./trash-bin";
import { OneEuro, toScreen } from "@/lib/gesture/engine";
import {
  GrabThrowController, handPose, springStep,
  type BinState, type GrabConfig, type GrabSnapshot, type GrabTarget, type Rect, type SpringState,
} from "@/lib/gesture/grab-throw";

/**
 * The "throw to trash" overlay for a page view (JARVIS's browser).
 *
 *  - hand: reuses the app's gesture camera (no second camera) — open hand aims,
 *    closing a fist on something grabs it, carrying it to the bin and opening
 *    the hand there throws it away;
 *  - mouse: hold Alt and drag; touch: long-press and drag (for testing).
 *
 * The overlay never edits the page itself. It asks a `GrabSurface` what's under
 * the hand, flies a snapshot of it, and only at the very end asks the surface
 * to remove it (which the surface does safely, with undo).
 */

export interface GrabSurface {
  /** Changes when the page changes — any grab in progress is put back. */
  key: string;
  /** Is this screen point over the page? */
  contains: (x: number, y: number) => boolean;
  /** For the hover outline: what would be grabbed here (screen rect)? */
  inspect?: (x: number, y: number) => Promise<Rect | null>;
  pick: (x: number, y: number) => Promise<GrabTarget | null>;
  /** A visual of the target to fly (natural size in px). */
  snapshot: (t: GrabTarget) => { el: HTMLElement; w: number; h: number } | null;
  /** Remove it for real. Resolves an undo when there is one; null if it couldn't. */
  remove: (t: GrabTarget) => Promise<{ undo?: () => Promise<boolean> } | null>;
  /** A touch long-press became a grab — drop the page's pending touch. */
  cancelPointer?: () => void;
}

const DEV = process.env.NODE_ENV !== "production";
const MAX_LIFT_PX = 340;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; g: number }
interface Flying {
  el: HTMLElement; w: number; h: number; target: GrabTarget;
  cx: SpringState; cy: SpringState; s: SpringState; rot: number; blur: number;
  off: { x: number; y: number }; lift: number; origin: { cx: number; cy: number; s: number };
}

export function GrabThrowLayer({ surface, containerRef, config }: { surface: GrabSurface | null; containerRef: React.RefObject<HTMLElement>; config?: Partial<GrabConfig> }) {
  const g = useGesture();
  const [bin, setBin] = useState<BinState>("idle");
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<boolean> } | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const [portal, setPortal] = useState<HTMLElement | null>(null);

  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const ctrlRef = useRef<GrabThrowController | null>(null);
  const binRef = useRef<HTMLDivElement | null>(null);
  const handRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const outlineRef = useRef<HTMLDivElement | null>(null);
  const holeRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugRef = useRef<HTMLDivElement | null>(null);
  const kick = useRef<() => void>(() => {});

  useEffect(() => { setPortal(document.body); }, []);

  useEffect(() => {
    const A = {
      hand: null as { x: number; y: number } | null,
      handAt: -Infinity,
      overPage: false,
      cur: { x: { x: 0, v: 0 } as SpringState, y: { x: 0, v: 0 } as SpringState, shown: false },
      obj: null as Flying | null,
      mode: "none" as "none" | "carry" | "throw" | "return",
      thr: null as null | { t0: number; dur: number; from: { x: number; y: number; s: number; rot: number }; to: { x: number; y: number }; c: { x: number; y: number } },
      retT0: 0,
      parts: [] as Particle[],
      raf: 0, last: 0,
      quietUntil: 0,
      inspectAt: 0, inspectSeq: 0, outlineOn: false,
      missAt: -Infinity,
      lastBin: "idle" as BinState,
      pointerId: null as number | null,
      longPress: null as null | { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> },
    };
    const fx = new OneEuro(1.2, 0.03), fy = new OneEuro(1.2, 0.03);
    const now = () => performance.now();
    const container = () => containerRef.current;
    const cRect = () => container()?.getBoundingClientRect() ?? null;
    const binRect = (): Rect | null => { const r = binRef.current?.getBoundingClientRect(); return r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };

    /* ---------- particles ---------- */
    const emit = (x: number, y: number, n: number, speed: number, opts: { spread?: number; dir?: number; g?: number; life?: number; size?: number } = {}) => {
      for (let i = 0; i < n; i++) {
        const a = opts.dir != null ? opts.dir + (Math.random() - 0.5) * (opts.spread ?? 1.2) : Math.random() * Math.PI * 2;
        const v = speed * (0.35 + Math.random() * 0.65);
        const life = (opts.life ?? 0.55) * (0.6 + Math.random() * 0.6);
        A.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: (opts.size ?? 2.2) * (0.6 + Math.random() * 0.8), g: opts.g ?? 0 });
      }
      if (A.parts.length > 400) A.parts.splice(0, A.parts.length - 400);
    };
    const drawParticles = (dt: number) => {
      const cv = canvasRef.current;
      if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (!A.parts.length) return;
      ctx.globalCompositeOperation = "lighter";
      A.parts = A.parts.filter((p) => (p.life -= dt) > 0);
      for (const p of A.parts) {
        p.vy += p.g * dt; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const k = p.life / p.max;
        ctx.fillStyle = `rgba(103,232,249,${0.18 * k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(236,254,255,${0.85 * k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    /* ---------- the lifted object ---------- */
    const showHole = (r: Rect | null) => {
      const h = holeRef.current, c = cRect();
      if (!h) return;
      if (!r || !c) { h.style.opacity = "0"; return; }
      Object.assign(h.style, { left: `${r.x - c.left}px`, top: `${r.y - c.top}px`, width: `${r.w}px`, height: `${r.h}px`, opacity: "1" });
    };
    const lift = (s: GrabSnapshot) => {
      const t = s.target!, at = s.grabAt ?? { x: t.rect.x + t.rect.w / 2, y: t.rect.y + t.rect.h / 2 };
      const snap = surfaceRef.current?.snapshot(t) ?? cardFor(t);
      const el = document.createElement("div");
      el.className = "jv-grab-obj";
      el.dataset.testid = "grab-object";
      el.dataset.gestureUi = "";
      el.style.width = `${snap.w}px`; el.style.height = `${snap.h}px`;
      snap.el.style.width = "100%"; snap.el.style.height = "100%"; snap.el.style.display = "block";
      el.appendChild(snap.el);
      document.body.appendChild(el);
      const cx0 = t.rect.x + t.rect.w / 2, cy0 = t.rect.y + t.rect.h / 2;
      const s0 = t.rect.w / snap.w;
      const liftTo = Math.min(s0 * 1.06, MAX_LIFT_PX / Math.max(snap.w, snap.h));
      A.obj = {
        el, w: snap.w, h: snap.h, target: t,
        cx: { x: cx0, v: 0 }, cy: { x: cy0, v: 0 }, s: { x: s0, v: 0 }, rot: 0, blur: 0,
        off: { x: (at.x - cx0) / s0, y: (at.y - cy0) / s0 }, lift: liftTo, origin: { cx: cx0, cy: cy0, s: s0 },
      };
      A.mode = "carry";
      showHole(t.rect);
      emit(at.x, at.y, 14, 160, { life: 0.45, size: 1.8 });
      paint(A.obj);
    };
    const paint = (o: Flying, opacity = 1) => {
      o.el.style.transform = `translate3d(${o.cx.x - o.w / 2}px, ${o.cy.x - o.h / 2}px, 0) scale(${o.s.x}) rotate(${o.rot}deg)`;
      o.el.style.filter = o.blur > 0.05 ? `blur(${o.blur.toFixed(2)}px) saturate(1.15)` : "saturate(1.15)";
      o.el.style.opacity = String(opacity);
    };
    const drop = () => { A.obj?.el.remove(); A.obj = null; A.mode = "none"; A.thr = null; };

    /* ---------- the controller ---------- */
    const ctrl = new GrabThrowController({
      pick: async (x, y) => {
        const s = surfaceRef.current;
        if (!s || !s.contains(x, y)) return null;
        try { return await s.pick(x, y); } catch { return null; }
      },
      onThrow: () => {
        const o = A.obj, b = binRect();
        if (!o || !b) { ctrl.done(); return; }
        const mouth = { x: b.x + b.w / 2, y: b.y + b.h * 0.34 };
        const from = { x: o.cx.x, y: o.cy.x, s: o.s.x, rot: o.rot };
        A.thr = { t0: now(), dur: 520, from, to: mouth, c: { x: (from.x + mouth.x) / 2, y: Math.min(from.y, mouth.y) - 110 } };
        A.mode = "throw";
        kick.current();
      },
      onCancel: () => {
        if (!A.obj) { showHole(null); ctrl.done(); A.quietUntil = now() + 600; return; }
        A.mode = "return"; A.retT0 = now();
        kick.current();
      },
      onMiss: () => { A.missAt = now(); },
      onChange: (s) => {
        if (s.bin !== A.lastBin) { A.lastBin = s.bin; setBin(s.bin); }
        if (s.phase === "carrying" && s.target && !A.obj) lift(s);
        hint(s);
        kick.current();
      },
      debug: DEV ? (m, d) => console.debug("[grab]", m, d ?? "") : undefined,
    }, config);
    ctrlRef.current = ctrl;

    const hint = (s: GrabSnapshot) => {
      if (!g) return;
      g.hudHint.current =
        s.phase === "carrying" ? (s.bin === "ready" ? "OPEN YOUR HAND TO THROW IT AWAY" : "CARRY IT TO THE BIN · OPEN ELSEWHERE TO PUT IT BACK")
        : s.phase === "closing" || s.phase === "picking" ? "GRABBING…"
        : s.phase === "throwing" ? "THROWN AWAY"
        : A.overPage && s.source === "hand" ? "CLOSE YOUR FIST ON SOMETHING TO GRAB IT"
        : null;
    };

    /* ---------- the frame loop (only runs while something's happening) ---------- */
    const step = (t: number) => {
      A.raf = 0;
      const dt = Math.min(0.05, A.last ? (t - A.last) / 1000 : 1 / 60);
      A.last = t;
      const s = ctrl.state;
      const b = binRect();
      ctrl.setBin(b);
      ctrl.tick(t);

      // hand cursor
      const hand = A.hand, h = handRef.current;
      const handFresh = !!hand && t - A.handAt < 450;
      const showCursor = handFresh && (A.overPage || ctrl.engaged) && s.source === "hand";
      if (h) {
        if (showCursor && hand) {
          if (!A.cur.shown) { A.cur.x = { x: hand.x, v: 0 }; A.cur.y = { x: hand.y, v: 0 }; }
          A.cur.x = springStep(A.cur.x, hand.x, dt, 520, 40); A.cur.y = springStep(A.cur.y, hand.y, dt, 520, 40);
          h.style.transform = `translate3d(${A.cur.x.x}px, ${A.cur.y.x}px, 0)`;
          h.style.opacity = "1";
          h.dataset.phase = s.phase; h.dataset.bin = s.bin; h.dataset.miss = t - A.missAt < 350 ? "1" : "0";
          if (ringRef.current) ringRef.current.style.background = s.closing > 0 && s.phase !== "carrying" ? `conic-gradient(rgba(236,254,255,.95) ${Math.round(s.closing * 360)}deg, transparent 0)` : "transparent";
        } else h.style.opacity = "0";
        A.cur.shown = showCursor;
      }

      // hover outline (what a fist would grab)
      const sf = surfaceRef.current;
      const wantOutline = !!sf && !!hand && handFresh && A.overPage && s.phase === "hover";
      if (wantOutline && sf?.inspect && t - A.inspectAt > 130) {
        A.inspectAt = t;
        const my = ++A.inspectSeq, at = { ...hand! };
        void sf.inspect(at.x, at.y).then((r) => {
          if (my !== A.inspectSeq || !outlineRef.current) return;
          const c = cRect();
          if (!r || !c) { outlineRef.current.style.opacity = "0"; return; }
          Object.assign(outlineRef.current.style, { transform: `translate(${r.x - c.left - 4}px, ${r.y - c.top - 4}px)`, width: `${r.w + 8}px`, height: `${r.h + 8}px`, opacity: "1" });
        }).catch(() => {});
      }
      if (!wantOutline && outlineRef.current && outlineRef.current.style.opacity !== "0") { A.inspectSeq++; outlineRef.current.style.opacity = "0"; }

      // the object
      const o = A.obj;
      if (o && A.mode === "carry" && hand) {
        // closer to the bin → smaller, centred on the hand, hovering just above the open lid
        const approach = ctrl.config().approachRadiusPx;
        const near = b ? Math.max(0, Math.min(1, 1 - (Math.hypot(hand.x - (b.x + b.w / 2), hand.y - (b.y + b.h / 2)) - 30) / (approach - 30))) : 0;
        const keep = 1 - near;
        const tx = hand.x - o.off.x * o.s.x * keep;
        const ty = hand.y - o.off.y * o.s.x * keep - near * (b ? b.h * 0.95 : 0);
        o.cx = springStep(o.cx, tx, dt, 420, 34); o.cy = springStep(o.cy, ty, dt, 420, 34);
        o.s = springStep(o.s, o.lift * (1 - 0.66 * near), dt, 240, 22);
        const speed = Math.hypot(o.cx.v, o.cy.v);
        o.rot += (Math.max(-12, Math.min(12, o.cx.v * 0.012)) - o.rot) * Math.min(1, dt * 10);
        o.blur += (Math.max(0, Math.min(1.6, (speed - 500) / 1500)) - o.blur) * Math.min(1, dt * 12);
        if (speed > 260) emit(o.cx.x, o.cy.x, speed > 900 ? 2 : 1, 40, { dir: Math.atan2(-o.cy.v, -o.cx.v), spread: 1.4, life: 0.5, size: 1.8 });
        paint(o, 1 - 0.1 * near);
      } else if (o && A.mode === "throw" && A.thr) {
        const p = Math.min(1, (t - A.thr.t0) / A.thr.dur);
        const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        const { from, to, c } = A.thr, u = 1 - e;
        const px = u * u * from.x + 2 * u * e * c.x + e * e * to.x, py = u * u * from.y + 2 * u * e * c.y + e * e * to.y;
        const vx = (px - o.cx.x) / Math.max(dt, 1e-3), vy = (py - o.cy.x) / Math.max(dt, 1e-3);
        o.cx.x = px; o.cy.x = py;
        o.s.x = from.s * (1 - 0.93 * e);
        o.rot = from.rot + 200 * e;
        o.blur = Math.min(1.8, Math.hypot(vx, vy) / 1400);
        emit(px, py, 2, 30, { life: 0.4, size: 1.5 });
        paint(o, 1 - 0.8 * e * e);
        if (p >= 1) {
          const target = o.target;
          drop();
          emit(to.x, to.y, 34, 150, { g: 260, life: 0.75, size: 2 });
          emit(to.x, to.y - 4, 12, 70, { dir: -Math.PI / 2, spread: 1.6, life: 0.6, size: 1.4 });
          ctrl.setBinOverride("success");
          setTimeout(() => ctrl.setBinOverride(null), 720);
          A.quietUntil = t + 900;
          const sfc = surfaceRef.current;
          void (sfc ? sfc.remove(target) : Promise.resolve(null)).then((res) => {
            setTimeout(() => showHole(null), 260);
            if (res?.undo) {
              const run = res.undo;
              setUndo({ label: target.label || "that", run });
            }
          }).catch(() => showHole(null));
          ctrl.done();
        }
      } else if (o && A.mode === "return") {
        o.cx = springStep(o.cx, o.origin.cx, dt, 190, 19); o.cy = springStep(o.cy, o.origin.cy, dt, 190, 19);
        o.s = springStep(o.s, o.origin.s, dt, 220, 20);
        o.rot += -o.rot * Math.min(1, dt * 10); o.blur *= 0.8;
        paint(o);
        const settled = Math.abs(o.cx.x - o.origin.cx) + Math.abs(o.cy.x - o.origin.cy) < 0.8 && Math.abs(o.s.x - o.origin.s) < 0.004 && Math.hypot(o.cx.v, o.cy.v) < 12;
        if (settled || t - A.retT0 > 1100) {
          drop(); showHole(null);
          A.quietUntil = t + 700;
          ctrl.done();
        }
      }

      drawParticles(dt);
      if (debugRef.current) debugRef.current.textContent = `grab: ${s.phase} · bin ${s.bin} · ${s.source}${hand ? ` · ${Math.round(hand.x)},${Math.round(hand.y)}` : ""}`;

      const busy = ctrl.engaged || A.mode !== "none" || A.parts.length > 0 || showCursor || (outlineRef.current?.style.opacity ?? "0") !== "0";
      if (busy) A.raf = requestAnimationFrame(step);
      else { A.last = 0; drawParticles(0); }
    };
    kick.current = () => { if (!A.raf) A.raf = requestAnimationFrame(step); };

    /* ---------- hand input: the app's gesture camera ---------- */
    const unsub = g?.subscribe((f) => {
      const sf = surfaceRef.current;
      if (!sf) return;
      if (!ctrl.state.pos) ctrl.setBin(binRect());
      const pose0 = handPose(f.out, ctrl.config());
      let x = 0, y = 0;
      if (f.out.reading) {
        const p = toScreen(f.out.reading.center);
        x = fx.filter(p.x, f.t) * innerWidth; y = fy.filter(p.y, f.t) * innerHeight;
        A.hand = { x, y }; A.handAt = f.t;
      } else { fx.reset(); fy.reset(); }
      A.overPage = pose0 !== "none" && sf.contains(x, y);
      // outside the page a fist is some other gesture (e.g. pause) — unless we're mid-grab
      const pose = pose0 === "fist" && !A.overPage && !ctrl.engaged ? "other" : pose0;
      ctrl.input({ t: f.t, pose, x, y, source: "hand" });
      hint(ctrl.state);
      kick.current();
    });
    // while grabbing, the hand belongs to us: no "pause", "wake" or swipes on the side
    const unclaim = g?.claim((ev) => {
      if (!surfaceRef.current) return false;
      if (ctrl.engaged || now() < A.quietUntil) return true;
      return A.overPage && (ev.action === "wake" || ev.action === "pause");
    });

    /* ---------- mouse (Alt+drag) and touch (long-press) fallback ---------- */
    const el = container();
    const pin = (e: PointerEvent, pose: "fist" | "open") => {
      A.hand = { x: e.clientX, y: e.clientY }; A.handAt = now();
      ctrl.input({ t: now(), pose, x: e.clientX, y: e.clientY, source: "pointer" });
      kick.current();
    };
    const onDown = (e: PointerEvent) => {
      if (!surfaceRef.current) return;
      if (e.pointerType === "mouse" && e.altKey && e.button === 0) {
        e.preventDefault(); e.stopPropagation();
        A.pointerId = e.pointerId;
        try { el?.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        pin(e, "open"); pin(e, "fist");
      } else if (e.pointerType !== "mouse" && e.isPrimary) {
        const id = e.pointerId, x = e.clientX, y = e.clientY;
        if (A.longPress) clearTimeout(A.longPress.timer);
        A.longPress = {
          id, x, y, timer: setTimeout(() => {
            A.longPress = null;
            surfaceRef.current?.cancelPointer?.();
            A.pointerId = id;
            try { el?.setPointerCapture(id); } catch { /* ignore */ }
            try { navigator.vibrate?.(12); } catch { /* unsupported */ }
            ctrl.input({ t: now(), pose: "open", x, y, source: "pointer" });
            ctrl.input({ t: now(), pose: "fist", x, y, source: "pointer" });
            kick.current();
          }, 450),
        };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (A.longPress && e.pointerId === A.longPress.id && Math.hypot(e.clientX - A.longPress.x, e.clientY - A.longPress.y) > 10) { clearTimeout(A.longPress.timer); A.longPress = null; }
      if (A.pointerId === e.pointerId) { e.preventDefault(); e.stopPropagation(); pin(e, "fist"); return; }
      // Alt held: aim like an open hand (outline what would be grabbed)
      if (e.pointerType === "mouse" && e.altKey && A.pointerId == null && !ctrl.engaged) {
        A.overPage = !!surfaceRef.current?.contains(e.clientX, e.clientY);
        pin(e, "open");
      }
    };
    const onUp = (e: PointerEvent) => {
      if (A.longPress && e.pointerId === A.longPress.id) { clearTimeout(A.longPress.timer); A.longPress = null; }
      if (A.pointerId === e.pointerId) { e.preventDefault(); e.stopPropagation(); A.pointerId = null; pin(e, "open"); }
    };
    el?.addEventListener("pointerdown", onDown, true);
    el?.addEventListener("pointermove", onMove, true);
    el?.addEventListener("pointerup", onUp, true);
    el?.addEventListener("pointercancel", onUp, true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Alt") setAltHeld(e.type === "keydown"); };
    const onBlur = () => setAltHeld(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);

    return () => {
      unsub?.(); unclaim?.();
      if (g) g.hudHint.current = null;
      if (A.raf) cancelAnimationFrame(A.raf);
      if (A.longPress) clearTimeout(A.longPress.timer);
      drop();
      el?.removeEventListener("pointerdown", onDown, true);
      el?.removeEventListener("pointermove", onMove, true);
      el?.removeEventListener("pointerup", onUp, true);
      el?.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
      ctrlRef.current = null;
    };
    // the controller lives as long as the layer; config/surface are read through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g]);

  // the page changed under a grab → put it back
  useEffect(() => { ctrlRef.current?.cancel("external"); setUndo(null); }, [surface?.key]);
  useEffect(() => { if (config) ctrlRef.current?.setConfig(config); }, [config]);
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 6500); return () => clearTimeout(t); }, [undo]);

  if (!surface) return null;
  return (
    <>
      <div ref={outlineRef} className="jv-grab-outline" data-gesture-ui />
      <div ref={holeRef} className="jv-grab-hole" data-gesture-ui />
      {/* Alt held: a catcher so Alt-drag works over embedded pages too */}
      {altHeld && <div className="absolute inset-0 z-[5] cursor-grab" data-gesture-ui data-testid="grab-catcher" />}
      <TrashBin ref={binRef} state={bin} className="absolute bottom-4 right-4 z-[6] sm:bottom-6 sm:right-6"
        title="Throw things away: close your fist on something, carry it here and open your hand (or Alt-drag it here)" />
      {altHeld && (
        <div className="pointer-events-none absolute bottom-5 right-24 z-[6] sm:bottom-7 sm:right-28 rounded-full border border-cyan-100/20 bg-black/55 px-3 py-1 text-[11px] text-cyan-50/85 backdrop-blur" data-gesture-ui>
          Drag something into the bin
        </div>
      )}
      {undo && (
        <div className="jv-grab-undo absolute bottom-4 left-1/2 z-[7] flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-[#0b1220]/80 px-4 py-1.5 text-[12px] text-white/85 shadow-lg backdrop-blur-xl" data-gesture-ui>
          <span className="max-w-[40vw] truncate">Threw away {undo.label.length > 36 ? `${undo.label.slice(0, 36)}…` : undo.label}</span>
          <button type="button" className="rounded-full border border-cyan-100/30 bg-cyan-100/15 px-3 py-0.5 text-cyan-50 hover:bg-cyan-100/25"
            onClick={() => { const u = undo; setUndo(null); void u.run(); }}>Undo</button>
        </div>
      )}
      {DEV && <div ref={debugRef} className="pointer-events-none absolute left-2 top-2 z-[7] rounded bg-black/60 px-2 py-0.5 font-mono text-[10px] text-cyan-100/80" />}
      {portal && createPortal(
        <>
          <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[93] h-screen w-screen" data-gesture-ui aria-hidden />
          <div ref={handRef} className="jv-grab-hand" style={{ opacity: 0 }} data-gesture-ui aria-hidden><div ref={ringRef} className="jv-grab-progress" style={{ WebkitMask: "radial-gradient(circle, transparent 62%, #000 64%)", mask: "radial-gradient(circle, transparent 62%, #000 64%)" }} /></div>
        </>,
        portal,
      )}
    </>
  );
}

/** A stand-in visual when the surface can't snapshot the target. */
function cardFor(t: GrabTarget) {
  const el = document.createElement("div");
  el.className = "jv-grab-card";
  const small = document.createElement("small"); small.textContent = t.whole ? "Page" : "Element";
  const b = document.createElement("div"); b.textContent = t.label || "Page content";
  el.append(small, b);
  return { el, w: 320, h: 200 };
}
