"use client";

import { useEffect, useRef, useState } from "react";
import { Hand, Loader2, Minus, Power, RefreshCw, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GESTURES, GESTURE_BY_ID, params } from "@/lib/gesture/engine";
import { POSE_LABEL } from "@/lib/gesture/classify";
import type { useGesture } from "./gesture-provider";
import { elementLabel, targetAt } from "./gesture-provider";

type Ctx = NonNullable<ReturnType<typeof useGesture>>;

// MediaPipe hand skeleton
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const STATUS_TEXT: Record<string, string> = {
  starting: "Opening the camera…",
  loading: "Loading on-device hand tracking…",
  sleeping: "Camera released while JARVIS was in the background — it resumes when you come back.",
};

/** The small liquid-glass tracking panel (bottom-right). */
export function GestureHud({ ctx, onRetry }: { ctx: Ctx; onRetry: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const poseEl = useRef<HTMLDivElement>(null);
  const confEl = useRef<HTMLDivElement>(null);
  const hintEl = useRef<HTMLDivElement>(null);
  const ringEl = useRef<SVGCircleElement>(null);
  const [mini, setMini] = useState(false);
  const [open, setOpen] = useState(false);
  const on = ctx.status === "on";

  useEffect(() => {
    if (!on || mini) return;
    let raf = 0;
    const W = 176, H = 132, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = canvas.current;
    if (!c) return;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext("2d")!;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const f = ctx.live.current;
      const v = ctx.video.current;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // mirrored preview (selfie view) — only drawn locally, never stored
      if (ctx.settings.preview && v && v.readyState >= 2) {
        g.save(); g.globalAlpha = 0.32; g.translate(W, 0); g.scale(-1, 1); g.drawImage(v, 0, 0, W, H); g.restore();
      }
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, "rgba(10,20,40,0.35)"); grad.addColorStop(1, "rgba(5,8,20,0.55)");
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      const lm = f?.landmarks;
      const out = f?.out;
      if (lm) {
        const P = (i: number) => [(1 - lm[i].x) * W, lm[i].y * H] as const;
        g.lineWidth = 1.6; g.lineCap = "round";
        g.shadowColor = "rgba(96,228,255,0.9)"; g.shadowBlur = 8;
        g.strokeStyle = "rgba(150,235,255,0.9)";
        g.beginPath();
        for (const [a, b] of BONES) { const [x1, y1] = P(a), [x2, y2] = P(b); g.moveTo(x1, y1); g.lineTo(x2, y2); }
        g.stroke();
        g.shadowBlur = 0;
        for (let i = 0; i < 21; i++) {
          const [x, y] = P(i);
          const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
          g.fillStyle = tip ? "#ffffff" : "rgba(160,220,255,0.85)";
          g.beginPath(); g.arc(x, y, tip ? 2.4 : 1.5, 0, Math.PI * 2); g.fill();
        }
        if (out?.pinching || (out?.reading && out.reading.pinch < 0.6)) {
          const [x1, y1] = P(4), [x2, y2] = P(8);
          g.strokeStyle = out?.pinching ? "rgba(255,92,214,0.95)" : "rgba(255,255,255,0.35)"; g.lineWidth = out?.pinching ? 2.4 : 1;
          g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        }
      } else {
        g.fillStyle = "rgba(255,255,255,0.35)"; g.font = "10px system-ui"; g.textAlign = "center";
        g.fillText(out?.calibrating != null ? "SHOW YOUR HAND" : "RAISE YOUR HAND", W / 2, H / 2 + 3);
      }
      // text + hold ring without re-rendering React
      const pose = out?.hand ? out.pose : null;
      if (poseEl.current) poseEl.current.textContent = out?.calibrating != null ? `CALIBRATING ${Math.round(out.calibrating * 100)}%` : pose && pose !== "none" ? POSE_LABEL[pose] : out?.hand ? "TRACKING" : "NO HAND";
      if (confEl.current) confEl.current.style.width = `${Math.round((out?.hand ? out.confidence : 0) * 100)}%`;
      if (hintEl.current) {
        const hold = ctx.hudHint.current ? null : out?.hold;
        hintEl.current.textContent = ctx.hudHint.current ? ctx.hudHint.current : hold ? `${GESTURE_BY_ID[hold.id].actionLabel} · hold` : out?.pointer ? (out.pinching ? "CLICK" : "AIM · PINCH TO CLICK") : out?.hand ? `${Math.round(out.confidence * 100)}% CONFIDENCE` : "";
      }
      if (ringEl.current) {
        const p = ctx.hudHint.current ? 0 : out?.hold?.progress ?? 0;
        ringEl.current.style.strokeDashoffset = String(62.8 * (1 - p));
        ringEl.current.style.opacity = p > 0.05 ? "1" : "0";
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [on, mini, ctx.live, ctx.video, ctx.settings.preview, ctx.hudHint]);

  if (mini && on) {
    return (
      <button data-gesture-ui onClick={() => setMini(false)} title="Gesture mode is on — show the tracker"
        className="jv-gesture-glass fixed bottom-24 right-4 z-[70] flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] tracking-[0.26em] text-cyan-50 md:bottom-6">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_#67e8f9]" /> GESTURES
      </button>
    );
  }

  return (
    <div data-gesture-ui className="fixed bottom-24 right-3 z-[70] w-[200px] md:bottom-6 md:right-5" style={{ animation: "jv-gesture-in .5s cubic-bezier(.2,.9,.25,1.1) both" }} aria-live="polite" data-gesture-hud={ctx.status}>
      <div className="jv-gesture-glass overflow-hidden rounded-2xl">
        <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-2">
          <Hand className={cn("h-3.5 w-3.5", on ? "text-cyan-200" : "text-white/50")} />
          <span className="text-[9px] tracking-[0.3em] text-white/70">GESTURES</span>
          <span className={cn("ml-0.5 h-1.5 w-1.5 rounded-full", on ? "bg-cyan-300 shadow-[0_0_8px_#67e8f9]" : ctx.status === "error" ? "bg-rose-400" : "bg-amber-300")} />
          <div className="ml-auto flex items-center">
            <IconBtn title="Gesture settings" onClick={() => setOpen((o) => !o)} active={open}><Settings2 className="h-3 w-3" /></IconBtn>
            {on && <IconBtn title="Minimise" onClick={() => setMini(true)}><Minus className="h-3 w-3" /></IconBtn>}
            <IconBtn title="Turn gesture mode off (releases the camera)" onClick={ctx.disable}><Power className="h-3 w-3" /></IconBtn>
          </div>
        </div>

        {on ? (
          <>
            <div className="relative mx-3 overflow-hidden rounded-xl border border-white/10">
              <canvas ref={canvas} style={{ width: 176, height: 132, display: "block" }} aria-label="Hand-tracking view" />
              <span className="absolute left-1.5 top-1 text-[8px] tracking-[0.2em] text-white/40">ON-DEVICE</span>
            </div>
            <div className="flex items-center gap-2 px-3 pb-2.5 pt-2">
              <svg width="22" height="22" viewBox="0 0 24 24" className="shrink-0 -rotate-90">
                <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
                <circle ref={ringEl} cx="12" cy="12" r="10" fill="none" stroke="url(#jvg)" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="62.8" strokeDashoffset="62.8" style={{ transition: "opacity .2s" }} />
                <defs><linearGradient id="jvg" x1="0" x2="1"><stop offset="0" stopColor="#67e8f9" /><stop offset="1" stopColor="#f0abfc" /></linearGradient></defs>
              </svg>
              <div className="min-w-0 flex-1">
                <div ref={poseEl} className="truncate text-[11px] font-semibold tracking-[0.18em] text-white" data-gesture-pose>NO HAND</div>
                <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-white/10"><div ref={confEl} className="h-full bg-gradient-to-r from-cyan-300 to-fuchsia-300 transition-[width] duration-150" style={{ width: 0 }} /></div>
                <div ref={hintEl} className="mt-1 truncate text-[9px] tracking-[0.14em] text-white/50" />
              </div>
            </div>
          </>
        ) : ctx.status === "error" ? (
          <div className="px-3 pb-3">
            <p className="text-[11px] leading-snug text-rose-100/90" data-gesture-error>{ctx.error}</p>
            <p className="mt-1.5 text-[10px] leading-snug text-white/45">Voice and every other control keep working.</p>
            <button onClick={onRetry} className="mt-2 flex items-center gap-1 rounded-full border border-white/20 px-2.5 py-1 text-[10px] tracking-[0.14em] text-white/85 hover:bg-white/10">
              <RefreshCw className="h-3 w-3" /> TRY AGAIN
            </button>
          </div>
        ) : (
          <div className="flex items-start gap-2 px-3 pb-3 text-[11px] leading-snug text-white/70">
            {ctx.status !== "sleeping" && <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-cyan-200" />}
            <span>{STATUS_TEXT[ctx.status] ?? ""}</span>
          </div>
        )}
      </div>
      {open && <GestureSettingsPanel ctx={ctx} onClose={() => setOpen(false)} />}
    </div>
  );
}

function IconBtn({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className={cn("flex h-6 w-6 items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white", active && "bg-white/10 text-white")}>
      {children}
    </button>
  );
}

/** Settings: on/off, per-gesture switches, sensitivity, preview, recalibrate. */
export function GestureSettingsPanel({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const s = ctx.settings;
  const p = params(s);
  return (
    <div data-gesture-ui data-gesture-settings className="jv-gesture-glass absolute bottom-full right-0 mb-2 max-h-[70vh] w-[300px] overflow-y-auto rounded-2xl p-3.5" style={{ animation: "jv-gesture-in .35s ease both" }}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] tracking-[0.32em] text-white/60">GESTURE SETTINGS</span>
        <IconBtn title="Close settings" onClick={onClose}><X className="h-3 w-3" /></IconBtn>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
        <span className="text-[12px] text-white/85">Gesture mode</span>
        <Switch on={ctx.status !== "off"} onChange={(v) => (v ? void ctx.enable() : ctx.disable())} label="Gesture mode" />
      </div>
      <label className="mt-3 block text-[10px] tracking-[0.2em] text-white/55">SENSITIVITY</label>
      <input type="range" min={0} max={1} step={0.05} value={s.sensitivity} onChange={(e) => ctx.setSettings({ ...s, sensitivity: Number(e.target.value) })}
        className="mt-1 w-full accent-cyan-300" aria-label="Gesture sensitivity" />
      <div className="flex justify-between text-[9px] text-white/40"><span>Deliberate</span><span>hold {p.holdMs} ms · {Math.round(p.minConf * 100)}% sure</span><span>Responsive</span></div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[12px] text-white/80">Camera preview in the tracker</span>
        <Switch on={s.preview} onChange={(v) => ctx.setSettings({ ...s, preview: v })} label="Camera preview" />
      </div>
      <button onClick={ctx.recalibrate} disabled={ctx.status !== "on"}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[10px] tracking-[0.2em] text-white/85 transition hover:bg-white/10 disabled:opacity-40">
        <RefreshCw className="h-3 w-3" /> RECALIBRATE
      </button>
      <div className="mt-3 text-[9px] tracking-[0.3em] text-white/45">GESTURES</div>
      <ul className="mt-1.5 space-y-1">
        {GESTURES.map((g) => (
          <li key={g.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.03]">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium tracking-[0.08em] text-white/90">{g.label} <span className="text-cyan-200/80">→ {g.actionLabel}</span></div>
              <div className="truncate text-[10px] text-white/45">{g.how}</div>
            </div>
            <Switch on={s.enabled[g.id]} onChange={(v) => ctx.setSettings({ ...s, enabled: { ...s.enabled, [g.id]: v } })} label={g.label} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10px] leading-snug text-white/40">Tracking runs on this device. No camera frames are uploaded or recorded. Turning gesture mode off releases the camera.</p>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn("relative h-4 w-7 shrink-0 rounded-full transition", on ? "bg-cyan-300/70" : "bg-white/15")}>
      <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all", on ? "left-3.5" : "left-0.5")} />
    </button>
  );
}

/** The holographic pointer that follows your index finger, and the target it's on. */
export function GestureCursor({ ctx }: { ctx: Ctx }) {
  const ring = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0, lastPick = 0, lastTarget: HTMLElement | null = null;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const out = ctx.live.current?.out;
      const p = out?.pointer;
      const r = ring.current, b = box.current;
      if (!r || !b) return;
      if (!p) { r.style.opacity = "0"; b.style.opacity = "0"; lastTarget = null; return; }
      const x = p.x * innerWidth, y = p.y * innerHeight;
      r.style.opacity = "1";
      r.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${out?.pinching ? 0.55 : 1})`;
      r.dataset.pinch = out?.pinching ? "1" : "0";
      const now = performance.now();
      if (now - lastPick > 70) {
        lastPick = now;
        lastTarget = targetAt(x, y);
        if (tag.current) tag.current.textContent = lastTarget ? `SELECT · ${elementLabel(lastTarget) || lastTarget.tagName.toLowerCase()}` : "";
      }
      if (lastTarget) {
        const rc = lastTarget.getBoundingClientRect();
        b.style.opacity = "1";
        b.style.transform = `translate(${rc.left - 4}px, ${rc.top - 4}px)`;
        b.style.width = `${rc.width + 8}px`; b.style.height = `${rc.height + 8}px`;
      } else b.style.opacity = "0";
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [ctx.live]);
  return (
    <div data-gesture-ui className="pointer-events-none fixed inset-0 z-[90]" aria-hidden>
      <div ref={box} className="jv-gesture-target absolute left-0 top-0 rounded-xl opacity-0 transition-[opacity,width,height] duration-150">
        <span ref={tag} className="absolute -top-5 left-0 whitespace-nowrap text-[9px] tracking-[0.2em] text-cyan-100" />
      </div>
      <div ref={ring} className="jv-gesture-cursor absolute left-0 top-0 opacity-0" data-gesture-cursor />
    </div>
  );
}

export interface ToastData {
  key: number;
  kind: string;
  title: string;
  label: string;
  detail: string | null;
  confidence: number | null;
  pointer?: { x: number; y: number } | null;
}

const TONE: Record<string, string> = {
  approve: "#5eead4", reject: "#fb7185", pause: "#fbbf24", wake: "#67e8f9", click: "#f0abfc",
  prev: "#a5b4fc", next: "#a5b4fc", back: "#a5b4fc", forward: "#a5b4fc", info: "#e2e8f0",
};

/** "GESTURE DETECTED · THUMBS UP · APPROVED" with a holographic pulse, then it fades. */
export function GestureToast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, toast.kind === "info" ? 3200 : 1900);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  const color = TONE[toast.kind] ?? TONE.info;
  const at = toast.pointer ? { left: toast.pointer.x * 100 + "%", top: toast.pointer.y * 100 + "%" } : { left: "50%", top: "46%" };
  return (
    <div data-gesture-ui className="pointer-events-none fixed inset-0 z-[95]" key={toast.key} aria-live="assertive">
      {/* holographic pulse + particles where it happened */}
      <div className="absolute" style={{ ...at, ["--jvg-c" as string]: color }}>
        <span className="jv-gesture-pulse" />
        <span className="jv-gesture-pulse jv-gesture-pulse-2" />
        {Array.from({ length: 12 }, (_, i) => <span key={i} className="jv-gesture-spark" style={{ ["--a" as string]: `${i * 30}deg` }} />)}
      </div>
      <div className="absolute left-1/2 top-[76px] -translate-x-1/2" style={{ animation: "jv-gesture-toast 1.9s cubic-bezier(.2,.9,.25,1) both" }} data-gesture-toast>
        <div className="jv-gesture-glass rounded-2xl px-5 py-2.5 text-center" style={{ boxShadow: `0 18px 60px -24px ${color}, inset 0 1px 0 rgba(255,255,255,.18)` }}>
          <div className="text-[8.5px] tracking-[0.36em] text-white/55">{toast.title}</div>
          <div className="mt-0.5 text-[15px] font-semibold tracking-[0.24em] text-white">{toast.label}</div>
          {toast.detail && <div className="mt-0.5 text-[11px] font-medium tracking-[0.2em]" style={{ color }}>{toast.detail}</div>}
          {toast.confidence != null && <div className="mt-1 text-[9px] tabular-nums tracking-[0.2em] text-white/40">{Math.round(toast.confidence * 100)}% CONFIDENCE</div>}
        </div>
      </div>
    </div>
  );
}
