"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gateReducer, initialGate, PHASE_TITLE, type GateEvent, type GatePhase } from "@/lib/gate/machine";
import { biometricName, faceUnlock, gateStatus, passwordUnlock, pinUnlock, platformBiometricsAvailable, type GateStatus } from "@/lib/gate/client";
import type { FaceTracker } from "@/lib/gate/face-tracker";
import { GateScene, gateLayout } from "./gate-scene";

/**
 * The biometric gate in front of JARVIS.
 *
 * Who you are is decided by the DEVICE's biometric system (Windows Hello Face,
 * Face ID, Touch ID, Android) through WebAuthn, and checked by the server — the
 * same result that sets the unlock cookie the middleware enforces. The camera
 * here only finds your face so the scanner can follow it (on-device, never
 * shown, stored or sent); it can't unlock anything. Without device biometrics,
 * the PIN or password unlocks.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
type Cam = "prompt" | "denied" | "missing" | "busy" | "tracker" | null;

export function BiometricGate({ next }: { next: string }) {
  const router = useRouter();
  const [st, rawDispatch] = useReducer(gateReducer, undefined, initialGate);
  const dispatch = useCallback((e: GateEvent) => rawDispatch(e), []);
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [bootLine, setBootLine] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [camWhy, setCamWhy] = useState<Cam>(null);
  const [needTap, setNeedTap] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [fallback, setFallback] = useState<null | "pin" | "password">(null);
  const [outro, setOutro] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [now, setNow] = useState(() => Date.now());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scene = useRef<GateScene | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const tracker = useRef<FaceTracker | null>(null);
  const loop = useRef(0);
  const armed = useRef(true);       // may a detected face start a scan on its own?
  const verifying = useRef(false);
  const present = useRef(false);
  const signedIn = !!status?.signedIn;
  const phaseRef = useRef<GatePhase>(st.phase); phaseRef.current = st.phase;
  const bio = typeof navigator === "undefined" ? "device biometrics" : biometricName();

  /* ---------------- scene ---------------- */
  useEffect(() => {
    const c = canvasRef.current!;
    const s = new GateScene(c);
    scene.current = s;
    s.start();
    const measure = () => { s.resize(); setSize({ w: c.clientWidth, h: c.clientHeight }); };
    measure();
    const onMove = (e: PointerEvent) => s.setPointer(e.clientX, e.clientY);
    addEventListener("resize", measure);
    addEventListener("pointermove", onMove);
    return () => { s.stop(); removeEventListener("resize", measure); removeEventListener("pointermove", onMove); };
  }, []);
  useEffect(() => { scene.current?.setPhase(st.phase); }, [st.phase]);
  useEffect(() => { scene.current?.setCompact(!!fallback && !!status?.signedIn && st.phase !== "verified" && st.phase !== "unlocked"); }, [fallback, status?.signedIn, st.phase]);

  /* ---------------- camera + on-device face finding (presentation only) ---------------- */
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(loop.current); loop.current = 0;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const openCamera = useCallback(async () => {
    if (stream.current) return;
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
    } catch (e) {
      const n = (e as { name?: string })?.name;
      const why: Cam = n === "NotAllowedError" || n === "SecurityError" ? "denied" : n === "NotFoundError" || n === "OverconstrainedError" ? "missing" : "busy";
      setCamWhy(why); dispatch({ type: "CAMERA", status: why === "denied" ? "denied" : "error" });
      return;
    }
    if (phaseRef.current === "verified" || phaseRef.current === "unlocked" || phaseRef.current === "verifying") { s.getTracks().forEach((t) => t.stop()); return; }
    stream.current = s;
    const v = videoRef.current!;
    v.srcObject = s;
    try { await v.play(); } catch { /* muted autoplay is allowed */ }
    if (!tracker.current) {
      try {
        const { FaceTracker } = await import("@/lib/gate/face-tracker");
        tracker.current = await FaceTracker.create();
      } catch {
        stopCamera(); setCamWhy("tracker"); dispatch({ type: "CAMERA", status: "error" });
        return;
      }
    }
    if (!stream.current) return;
    setCamWhy(null);
    dispatch({ type: "CAMERA", status: "on" });
    let lastSeen = 0, seen = 0, lastRun = 0, everSeen = false;
    const step = (t: number) => {
      loop.current = requestAnimationFrame(step);
      if (t - lastRun < 66 || !tracker.current || v.readyState < 2) return; // ~15 fps is plenty
      lastRun = t;
      let f = null;
      try { f = tracker.current.detect(v, t); } catch { return; }
      scene.current?.setFace(f, (v.videoWidth || 4) / (v.videoHeight || 3), tracker.current.contours);
      if (f) {
        lastSeen = t; seen++; everSeen = true;
        if (seen >= 2 && !present.current) { present.current = true; dispatch({ type: "FACE", present: true }); }
      } else {
        seen = 0;
        if (present.current && t - lastSeen > 600) { present.current = false; dispatch({ type: "FACE", present: false }); }
        // after a failure: a face seen and then gone for a moment (you looked away) may scan again —
        // never just because the camera restarted, or the device would be asked again and again
        if (!armed.current && everSeen && t - lastSeen > 900) armed.current = true;
      }
    };
    loop.current = requestAnimationFrame(step);
  }, [dispatch, stopCamera]);

  const startCamera = useCallback(async (asked = false) => {
    if (!navigator.mediaDevices?.getUserMedia) { setCamWhy("missing"); dispatch({ type: "CAMERA", status: "error" }); return; }
    let state: string | null = null;
    try { state = (await navigator.permissions.query({ name: "camera" as PermissionName })).state; } catch { state = null; }
    if (state === "denied") { setCamWhy("denied"); dispatch({ type: "CAMERA", status: "denied" }); return; }
    if (state === "prompt" && !asked) { setCamWhy("prompt"); dispatch({ type: "CAMERA", status: "prompt" }); return; }
    await openCamera();
  }, [dispatch, openCamera]);

  useEffect(() => () => { stopCamera(); tracker.current?.close(); tracker.current = null; }, [stopCamera]);

  /* ---------------- opening sequence + what this device can do ---------------- */
  useEffect(() => {
    let alive = true;
    const rm = reduceMotion();
    const t1 = setTimeout(() => setBootLine(1), rm ? 50 : 1500);
    const t2 = setTimeout(() => setBootLine(2), rm ? 400 : 2900);
    (async () => {
      const [s, plat] = await Promise.all([gateStatus().catch(() => null), platformBiometricsAvailable(), sleep(rm ? 1100 : 4300)]);
      if (!alive) return;
      if (s?.signedIn && s.unlocked) { router.replace(next); return; }
      setStatus(s);
      const inn = !!s?.signedIn;
      const canFace = plat && (inn ? (s?.enrolled ?? 0) > 0 : true);
      // signed out with no face enrolled on this device: don't pop a sign-in prompt by itself
      armed.current = inn || !!s?.deviceHint;
      dispatch({ type: "READY", canFace, unavailable: !plat ? "no-biometrics" : inn ? "not-enrolled" : null, lockedMs: s?.lockedMs });
      if (!canFace && inn) setFallback(s?.pinSet ? "pin" : "password");
      if (canFace) void startCamera();
    })();
    return () => { alive = false; clearTimeout(t1); clearTimeout(t2); };
  }, [dispatch, next, router, startCamera]);

  /* ---------------- the scan ---------------- */
  useEffect(() => {
    if (st.phase !== "face-detected" || !armed.current) return;
    const t = setTimeout(() => dispatch({ type: "SCAN" }), 550);
    return () => clearTimeout(t);
  }, [st.phase, dispatch]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    if (st.phase === "scanning") {
      const t0 = performance.now();
      const id = setInterval(() => {
        const p = Math.min(1, (performance.now() - t0) / 1500);
        s.setProgress(p * 0.72);
        if (p >= 1) { clearInterval(id); dispatch({ type: "VERIFY" }); }
      }, 30);
      return () => clearInterval(id);
    }
    if (st.phase === "verifying") {
      const id = setInterval(() => s.setProgress(Math.min(0.93, s.getProgress() + 0.004)), 50);
      return () => clearInterval(id);
    }
    if (st.phase === "verified") { s.setProgress(1); return; }
    s.setProgress(0);
  }, [st.phase, dispatch]);

  // the real check: the device verifies the face, the server verifies the device
  useEffect(() => {
    if (st.phase !== "verifying" || verifying.current) return;
    verifying.current = true;
    setNote(null); setNeedTap(false);
    stopCamera(); // the device's own biometric camera may need it
    present.current = false;
    (async () => {
      const r = await faceUnlock(signedIn);
      verifying.current = false;
      if (r.ok) { dispatch({ type: "VERIFIED" }); return; }
      switch (r.kind) {
        case "aborted": dispatch({ type: "ABORTED" }); setNeedTap(true); break;
        case "expired": case "error": dispatch({ type: "ABORTED" }); setNeedTap(true); setNote(r.message ? "Something went wrong — try again." : "That scan expired — try again."); break;
        case "not-enrolled": dispatch({ type: "ABORTED" }); dispatch({ type: "READY", canFace: false, unavailable: "not-enrolled" }); setFallback(status?.pinSet ? "pin" : "password"); return;
        case "locked": dispatch({ type: "REJECTED", lockedMs: r.lockedMs }); armed.current = false; break;
        case "cancelled": dispatch({ type: "CANCELLED" }); armed.current = false; break;
        case "rejected": dispatch({ type: "REJECTED", attemptsLeft: r.attemptsLeft }); armed.current = false; break;
      }
      void startCamera();
    })();
  }, [st.phase, signedIn, dispatch, stopCamera, startCamera, status?.pinSet]);

  // back to scanning mode with a face still in view → show it as detected again
  useEffect(() => {
    if (st.phase === "camera-ready" && present.current) dispatch({ type: "FACE", present: true });
  }, [st.phase, dispatch]);

  // not recognized → back to scanning mode (a new scan needs a look away, or a tap)
  useEffect(() => {
    if (st.phase !== "not-recognized") return;
    const t = setTimeout(() => dispatch({ type: "RETRY" }), 2600);
    return () => clearTimeout(t);
  }, [st.phase, dispatch]);

  // locked out → count down
  useEffect(() => {
    if (st.phase !== "locked-out") return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= st.lockedUntil) { dispatch({ type: "LOCK_OVER" }); armed.current = true; }
    }, 250);
    return () => clearInterval(id);
  }, [st.phase, st.lockedUntil, dispatch]);

  // unlocked → the cinematic hand-over into JARVIS
  useEffect(() => {
    if (st.phase !== "verified") return;
    stopCamera(); tracker.current?.close(); tracker.current = null;
    try { sessionStorage.setItem("jarvis.voice.on", "1"); } catch { /* storage blocked */ }
    router.prefetch(next);
    const rm = reduceMotion();
    const ts = [
      setTimeout(() => setOutro(1), rm ? 300 : 1750),   // WELCOME
      setTimeout(() => setOutro(2), rm ? 600 : 2650),   // JARVIS ONLINE
      setTimeout(() => setOutro(3), rm ? 900 : 3700),   // fade
      setTimeout(() => { dispatch({ type: "DONE" }); setOutro(4); router.replace(next); router.refresh(); }, rm ? 1100 : 4250),
    ];
    return () => ts.forEach(clearTimeout);
  }, [st.phase, next, router, dispatch, stopCamera]);

  /* ---------------- actions ---------------- */
  const verifyNow = () => {
    if (!st.canFace || st.lockedUntil > Date.now()) return;
    armed.current = true; setNeedTap(false);
    dispatch({ type: "VERIFY" });
  };
  const allowCamera = () => { void startCamera(true); };
  const signOut = async () => { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); router.replace("/login"); router.refresh(); };

  const locked = st.phase === "locked-out";
  const secsLeft = Math.max(0, Math.ceil((st.lockedUntil - now) / 1000));
  const p = st.phase;
  const tone = p === "verified" || p === "unlocked" ? "good" : p === "not-recognized" || p === "locked-out" || p === "camera-error" ? "bad" : "cyan";
  const boot = p === "initializing";

  const subtitle = (() => {
    switch (p) {
      case "camera-permission": return "Allow the camera so the scanner can find your face. Your face is matched on this device — never uploaded.";
      case "camera-ready": return needTap ? `Tap the scanner to verify with ${bio}.` : signedIn || status?.deviceHint ? "Look at the camera." : `Tap the scanner to sign in with ${bio}.`;
      case "face-detected": return armed.current ? "Hold still." : "Tap the scanner to scan again.";
      case "scanning": return "Mapping facial landmarks…";
      case "verifying": return `${bio} is confirming it's you — look at your camera.`;
      case "verified": return "ACCESS GRANTED";
      case "not-recognized": return st.attemptsLeft != null && st.attemptsLeft < 5 ? `${st.attemptsLeft} attempt${st.attemptsLeft === 1 ? "" : "s"} left before a temporary lock.` : "Try again, or use your PIN or password.";
      case "locked-out": return `Too many failed attempts. Try again in ${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}.`;
      case "camera-error": return camWhy === "denied" ? `Camera blocked — you can still verify with ${bio}.` : camWhy === "missing" ? `No camera found — verify with ${bio}.` : camWhy === "tracker" ? `Face tracking unavailable — verify with ${bio}.` : `The camera is busy — verify with ${bio}.`;
      case "unavailable":
        if (st.unavailable === "not-enrolled") return "Face unlock isn't set up yet. Unlock with your PIN or password, then enrol in Settings → Security.";
        if (signedIn) return "This device has no secure biometric sensor JARVIS can use. Unlock with your PIN or password.";
        return "This device has no secure biometric sensor JARVIS can use. Sign in with your password.";
      default: return "";
    }
  })();

  const title = boot ? (bootLine >= 2 ? "BIOMETRIC AUTHENTICATION REQUIRED" : bootLine === 1 ? "JARVIS SYSTEM INITIALIZING" : "")
    : p === "verified" || p === "unlocked" ? (outro >= 2 ? "JARVIS ONLINE" : outro === 1 ? "WELCOME" : "IDENTITY VERIFIED")
      : p === "camera-ready" && !signedIn && !status?.deviceHint ? "FACE SIGN-IN" : PHASE_TITLE[p];

  const showFallback = signedIn && !!fallback && outro < 1 && p !== "verified" && p !== "unlocked";
  const layout = gateLayout(size.w, size.h, showFallback ? 1 : 0);
  const textTop = layout.cy + layout.R * 1.42;
  const done = p === "verified" || p === "unlocked";
  const scannerTappable = st.canFace && !locked && ["camera-ready", "face-detected", "camera-error", "camera-permission", "not-recognized"].includes(p);

  return (
    <div className={`gate-root fixed inset-0 z-[200] overflow-hidden bg-[#010309] text-white transition-opacity duration-500 ${outro >= 3 ? "opacity-0" : "opacity-100"}`} data-gate-phase={p}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      {/* the camera feed is never shown — it only feeds the on-device face finder */}
      <video ref={videoRef} muted playsInline aria-hidden className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0" />

      {/* status line */}
      {!boot && p !== "verified" && p !== "unlocked" && (
        <div key={`chip-${p}`} className="gate-in absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-2 text-[11px] tracking-[0.32em] text-cyan-100/70 sm:top-8">
          <span className={`h-2 w-2 rounded-full ${p === "camera-ready" || p === "face-detected" ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : p === "camera-permission" ? "animate-pulse bg-amber-300" : tone === "bad" ? "bg-rose-400 shadow-[0_0_10px_#fb7185]" : "animate-pulse bg-cyan-300 shadow-[0_0_10px_#67e8f9]"}`} />
          {p === "camera-ready" || p === "face-detected" || p === "scanning" ? "CAMERA READY" : p === "verifying" ? bio.toUpperCase() : p === "camera-permission" ? "CAMERA OFF" : p === "unavailable" ? "SECURE FALLBACK" : "BIOMETRIC GATE"}
        </div>
      )}

      {/* tap target over the scanner */}
      <button
        type="button"
        onClick={p === "camera-permission" ? allowCamera : verifyNow}
        disabled={!scannerTappable}
        aria-label={p === "camera-permission" ? "Allow the camera" : `Verify identity with ${bio}`}
        className="absolute rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-default"
        style={{ left: layout.cx - layout.R, top: layout.cy - layout.R, width: layout.R * 2, height: layout.R * 2, cursor: scannerTappable ? "pointer" : "default" }}
      >
        {p === "camera-permission" && (
          <span className="gate-in flex h-full w-full flex-col items-center justify-center gap-3 text-cyan-100">
            <svg width="64" height="64" viewBox="0 0 64 64" className="gate-float drop-shadow-[0_0_14px_rgba(70,205,255,0.7)]" aria-hidden>
              <rect x="8" y="18" width="38" height="28" rx="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M46 28 L58 21 V43 L46 36 Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="27" cy="32" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="27" cy="32" r="2" fill="currentColor" className="animate-pulse" />
            </svg>
            <span className="text-[10px] tracking-[0.35em] text-cyan-100/70">TAP TO ALLOW</span>
          </span>
        )}
      </button>

      {/* headline + detail */}
      <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center px-4 text-center transition-[top] duration-500 ease-[cubic-bezier(.22,1,.36,1)]" style={{ top: boot ? layout.cy + layout.R * 0.95 : textTop }} aria-live="polite">
        {title && (
          <h1 key={title} className={`gate-in font-heading text-[clamp(20px,4.2vw,34px)] font-semibold tracking-[0.28em] ${p === "not-recognized" ? "gate-glitch" : ""} ${tone === "good" ? "text-emerald-200 [text-shadow:0_0_18px_rgba(90,255,200,0.6)]" : tone === "bad" ? "text-rose-300 [text-shadow:0_0_18px_rgba(255,96,64,0.55)]" : "text-cyan-100 [text-shadow:0_0_18px_rgba(70,205,255,0.55)]"}`}>
            {title}
          </h1>
        )}
        {!boot && subtitle && outro < 1 && (
          <p key={`${p}-${subtitle}`} className="gate-in mt-2 max-w-md text-[13px] tracking-wide text-cyan-50/60" style={{ animationDelay: "120ms" }}>{subtitle}</p>
        )}
        {p === "verifying" && (
          <div className="gate-in mt-4 flex h-6 items-end gap-[3px]" aria-hidden>
            {Array.from({ length: 28 }, (_, i) => <span key={i} className="gate-bar w-[3px] rounded-full bg-cyan-300/70" style={{ animationDelay: `${(i % 7) * 90 + (i % 3) * 40}ms` }} />)}
          </div>
        )}
        {note && <p className="gate-in mt-2 text-[12px] text-amber-200/80">{note}</p>}

        {/* actions */}
        {!boot && !done && (
          <div className="pointer-events-auto mt-5 flex flex-wrap items-center justify-center gap-3">
            {p === "camera-permission" && <GateButton onClick={allowCamera}>ENABLE CAMERA</GateButton>}
            {p === "camera-permission" && <GateButton ghost onClick={verifyNow}>VERIFY WITHOUT CAMERA</GateButton>}
            {(p === "camera-error" || (needTap && (p === "camera-ready" || p === "face-detected"))) && <GateButton onClick={verifyNow}>VERIFY WITH {bio.toUpperCase()}</GateButton>}
            {p === "camera-ready" && !signedIn && !status?.deviceHint && !needTap && <GateButton onClick={verifyNow}>SIGN IN WITH {bio.toUpperCase()}</GateButton>}
            {(p === "not-recognized" || (p === "face-detected" && !armed.current)) && <GateButton onClick={verifyNow}>SCAN AGAIN</GateButton>}
            {signedIn && p !== "verifying" && p !== "scanning" && !fallback && (
              <GateButton ghost onClick={() => setFallback(status?.pinSet ? "pin" : "password")}>USE {status?.pinSet ? "PIN" : "PASSWORD"}</GateButton>
            )}
            {!signedIn && status && p !== "verifying" && p !== "scanning" && (
              <GateButton ghost onClick={() => router.push(`/login?next=${encodeURIComponent(next)}`)}>SIGN IN WITH PASSWORD</GateButton>
            )}
          </div>
        )}
        {/* PIN / password fallback */}
        {showFallback && (
          <Fallback
            mode={fallback!}
            pinSet={!!status?.pinSet}
            locked={locked}
            secsLeft={secsLeft}
            onMode={setFallback}
            onClose={st.canFace ? () => setFallback(null) : undefined}
            onResult={(r, via) => {
              if (r.ok) dispatch({ type: "FALLBACK_OK", via });
              else dispatch({ type: "FALLBACK_REJECTED", lockedMs: r.lockedMs, attemptsLeft: r.attemptsLeft });
            }}
          />
        )}
      </div>

      {/* footer */}
      {!boot && !done && (
        <div className="gate-in absolute inset-x-0 bottom-3 flex flex-col items-center gap-1 px-4 text-center text-[10.5px] tracking-wide text-cyan-50/35 sm:bottom-5">
          <p>Your face is matched by {bio} on this device. JARVIS never receives, stores or uploads your face or camera images.</p>
          {signedIn && (
            <p>
              {status?.email ? <span>Authorized user · {maskEmail(status.email)} · </span> : null}
              <button type="button" onClick={signOut} className="underline-offset-2 hover:text-cyan-100/80 hover:underline">Not you? Sign out</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function maskEmail(e: string) {
  const [u, d] = e.split("@");
  return d ? `${u.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}` : "•••";
}

function GateButton({ children, onClick, ghost, type = "button", disabled }: { children: React.ReactNode; onClick?: () => void; ghost?: boolean; type?: "button" | "submit"; disabled?: boolean }) {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const id = Date.now() + Math.random();
        setRipples((rs) => [...rs, { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
        setTimeout(() => setRipples((rs) => rs.filter((q) => q.id !== id)), 650);
        onClick?.();
      }}
      className={`gate-btn relative overflow-hidden rounded-full border px-5 py-2.5 text-[11px] font-semibold tracking-[0.26em] backdrop-blur-md transition duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-40 ${ghost ? "border-cyan-200/15 bg-white/[0.03] text-cyan-100/70 hover:border-cyan-200/40 hover:text-cyan-50" : "border-cyan-300/40 bg-cyan-400/10 text-cyan-50 shadow-[0_0_24px_-8px_rgba(70,205,255,0.8)] hover:border-cyan-200/70 hover:shadow-[0_0_32px_-6px_rgba(70,205,255,0.95)]"}`}
    >
      {ripples.map((r) => <span key={r.id} className="gate-ripple pointer-events-none absolute rounded-full bg-cyan-200/40" style={{ left: r.x, top: r.y }} />)}
      <span className="relative">{children}</span>
    </button>
  );
}

function Fallback({ mode, pinSet, locked, secsLeft, onMode, onClose, onResult }: {
  mode: "pin" | "password"; pinSet: boolean; locked: boolean; secsLeft: number;
  onMode: (m: "pin" | "password") => void; onClose?: () => void;
  onResult: (r: { ok: true } | { ok: false; lockedMs?: number; attemptsLeft?: number }, via: "pin" | "password") => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setValue(""); setErr(null); inputRef.current?.focus(); }, [mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || locked || !value) return;
    setBusy(true); setErr(null);
    const r = mode === "pin" ? await pinUnlock(value) : await passwordUnlock(value);
    setBusy(false); setValue("");
    if (!r.ok) setErr(r.lockedMs ? "Too many failed attempts." : `${r.message}${r.attemptsLeft != null && r.attemptsLeft < 5 ? ` ${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? "" : "s"} left.` : ""}`);
    onResult(r, mode);
  };

  return (
    <form onSubmit={submit} className="gate-sheet pointer-events-auto mt-5 w-full max-w-sm rounded-2xl text-left border border-cyan-200/15 bg-slate-950/60 p-4 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9),0_0_40px_-20px_rgba(70,205,255,0.6)] backdrop-blur-xl sm:bottom-20">
      <div className="mb-3 flex items-center justify-between text-[10.5px] tracking-[0.28em] text-cyan-100/60">
        <div className="flex gap-3">
          {pinSet && <button type="button" onClick={() => onMode("pin")} className={mode === "pin" ? "text-cyan-50" : "hover:text-cyan-100"}>PIN</button>}
          <button type="button" onClick={() => onMode("password")} className={mode === "password" ? "text-cyan-50" : "hover:text-cyan-100"}>PASSWORD</button>
        </div>
        {onClose && <button type="button" onClick={onClose} className="hover:text-cyan-50" aria-label="Back to face unlock">✕</button>}
      </div>
      {mode === "pin" && (
        <div className="mb-2 flex justify-center gap-2" aria-hidden>
          {Array.from({ length: Math.max(6, value.length) }, (_, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-full border transition-all duration-200 ${i < value.length ? "scale-110 border-cyan-200 bg-cyan-200 shadow-[0_0_10px_rgba(70,205,255,0.9)]" : "border-cyan-200/30"}`} />
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="password"
          inputMode={mode === "pin" ? "numeric" : undefined}
          autoComplete={mode === "pin" ? "off" : "current-password"}
          maxLength={mode === "pin" ? 12 : 200}
          value={value}
          disabled={locked || busy}
          onChange={(e) => setValue(mode === "pin" ? e.target.value.replace(/\D/g, "") : e.target.value)}
          placeholder={locked ? `Locked · ${secsLeft}s` : mode === "pin" ? "Enter PIN" : "Account password"}
          aria-label={mode === "pin" ? "PIN" : "Password"}
          className={`min-w-0 flex-1 rounded-full border border-cyan-200/15 bg-black/40 px-4 py-2.5 text-sm text-cyan-50 outline-none placeholder:text-cyan-50/30 focus:border-cyan-300/50 ${mode === "pin" ? "text-center tracking-[0.5em] text-transparent caret-cyan-200" : ""}`}
        />
        <GateButton type="submit" disabled={locked || busy || !value}>{busy ? "…" : "UNLOCK"}</GateButton>
      </div>
      {err && <p className="mt-2 text-center text-[12px] text-rose-300/90">{err}</p>}
    </form>
  );
}
