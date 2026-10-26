"use client";

import { useEffect, useRef } from "react";

/**
 * The holographic core: a glass sphere with rotating rings, orbital particles,
 * scan lines and energy waves, drawn on one canvas. Each state looks different
 * and is driven by real signals (the microphone level while listening, the
 * voice output level while speaking, real step progress while executing).
 * It draws at ~24 fps when idle and pauses entirely when the page is hidden.
 */
export type OrbState = "idle" | "listening" | "processing" | "executing" | "speaking" | "success" | "error";

const TINT: Record<OrbState, [number, number, number]> = {
  idle: [95, 225, 255], listening: [80, 240, 255], processing: [140, 150, 255], executing: [95, 225, 255],
  speaking: [120, 200, 255], success: [76, 224, 166], error: [255, 120, 110],
};
const SPEED: Record<OrbState, number> = { idle: 0.25, listening: 0.6, processing: 1.8, executing: 1.1, speaking: 0.7, success: 0.5, error: 0.4 };

export function Hologram({ state, size = 136, micLevel, outLevel, progress }: {
  state: OrbState; size?: number;
  micLevel?: () => number; outLevel?: () => number; progress?: number | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef({ state, micLevel, outLevel, progress });
  props.current = { state, micLevel, outLevel, progress };

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const parts = Array.from({ length: 22 }, (_, i) => ({ r: 0.34 + (i % 5) * 0.035, a: (i / 22) * Math.PI * 2, s: 0.4 + ((i * 37) % 10) / 12, tilt: ((i * 53) % 7) / 7 }));
    let raf = 0, last = 0, t = 0, mix: [number, number, number] = [...TINT.idle], stateAt = performance.now(), prevState: OrbState = "idle", wave = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const p = props.current;
      const active = p.state !== "idle";
      if (!active && now - last < 1000 / 24) return; // idle: 24 fps is plenty
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      if (document.hidden) return;
      if (p.state !== prevState) { prevState = p.state; stateAt = now; }
      t += dt * (reduce ? 0.2 : SPEED[p.state]);
      const target = TINT[p.state];
      mix = mix.map((c, i) => c + (target[i] - c) * Math.min(1, dt * 6)) as [number, number, number];
      const [R, G, B] = mix.map(Math.round);
      const col = (a: number) => `rgba(${R},${G},${B},${a})`;
      const mic = Math.min(1, (p.micLevel?.() ?? 0) * 3);
      const out = Math.min(1, (p.outLevel?.() ?? 0) * 3);
      wave += dt * (p.state === "listening" ? 1.2 + mic * 3 : p.state === "speaking" ? 1 + out * 3 : 0.6);

      const S = size, c = S / 2, core = S * 0.2;
      ctx.clearRect(0, 0, S, S);

      // dark glass backdrop, so the rings stay readable over light windows
      const bd = ctx.createRadialGradient(c, c, S * 0.1, c, c, S * 0.5);
      bd.addColorStop(0, "rgba(3,9,22,0.72)"); bd.addColorStop(0.72, "rgba(3,9,22,0.5)"); bd.addColorStop(1, "rgba(3,9,22,0)");
      ctx.fillStyle = bd; ctx.beginPath(); ctx.arc(c, c, S * 0.5, 0, Math.PI * 2); ctx.fill();
      // ambient glow
      const g = ctx.createRadialGradient(c, c, core * 0.4, c, c, S * 0.5);
      const glow = 0.16 + (p.state === "listening" ? mic * 0.3 : p.state === "speaking" ? out * 0.3 : p.state === "processing" ? 0.12 : 0);
      g.addColorStop(0, col(glow)); g.addColorStop(1, col(0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);

      // energy waves: listening = expanding rings from your voice; speaking = JARVIS's voice
      if (p.state === "listening" || p.state === "speaking") {
        const lvl = p.state === "listening" ? mic : out;
        for (let k = 0; k < 3; k++) {
          const ph = (wave * 0.5 + k / 3) % 1;
          ctx.beginPath(); ctx.arc(c, c, core * (1.1 + ph * 1.2), 0, Math.PI * 2);
          ctx.strokeStyle = col((1 - ph) * (0.25 + lvl * 0.6)); ctx.lineWidth = 1.2 + lvl * 2; ctx.stroke();
        }
        // radial waveform around the core
        ctx.beginPath();
        for (let i = 0; i <= 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          const amp = (0.06 + lvl * 0.32) * Math.sin(a * 6 + wave * 4) * Math.sin(a * 3 - wave * 2.3);
          const r = core * (1.18 + amp);
          const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.strokeStyle = col(0.75); ctx.lineWidth = 1.4; ctx.shadowColor = col(0.9); ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
      }

      // rotating rings (thin ellipses at different tilts)
      const rings = [{ rx: 0.43, ry: 0.15, rot: -0.45, sp: 1, dash: [S * 0.18, S * 0.05] }, { rx: 0.4, ry: 0.4, rot: 0, sp: -0.6, dash: [S * 0.04, S * 0.03] }, { rx: 0.46, ry: 0.11, rot: 0.75, sp: 1.4, dash: [S * 0.3, S * 0.08] }];
      for (const [i, rg] of rings.entries()) {
        ctx.save(); ctx.translate(c, c); ctx.rotate(rg.rot + Math.sin(t * 0.3 + i) * 0.08);
        ctx.setLineDash(rg.dash); ctx.lineDashOffset = -t * 40 * rg.sp;
        ctx.beginPath(); ctx.ellipse(0, 0, S * rg.rx, S * rg.ry, 0, 0, Math.PI * 2);
        ctx.strokeStyle = i === 2 ? `rgba(155,123,255,${0.35 + (p.state === "processing" ? 0.3 : 0)})` : col(0.45); ctx.lineWidth = i === 1 ? 0.8 : 1.2; ctx.stroke();
        ctx.restore();
      }
      ctx.setLineDash([]);

      // orbital particles with light trails
      for (const pt of parts) {
        const a = pt.a + t * pt.s * (p.state === "processing" ? 2.2 : 1);
        const x = c + Math.cos(a) * S * pt.r, y = c + Math.sin(a) * S * pt.r * (0.35 + pt.tilt * 0.6);
        const front = Math.sin(a) > 0;
        const tx = c + Math.cos(a - 0.25) * S * pt.r, ty = c + Math.sin(a - 0.25) * S * pt.r * (0.35 + pt.tilt * 0.6);
        const lg = ctx.createLinearGradient(tx, ty, x, y); lg.addColorStop(0, col(0)); lg.addColorStop(1, col(front ? 0.7 : 0.25));
        ctx.strokeStyle = lg; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = front ? "rgba(235,252,255,0.95)" : col(0.4);
        ctx.beginPath(); ctx.arc(x, y, front ? 1.3 : 0.9, 0, Math.PI * 2); ctx.fill();
      }

      // the glass core: depth, refraction highlight, scan lines
      const pulse = 1 + (p.state === "speaking" ? out * 0.12 : p.state === "listening" ? mic * 0.1 : Math.sin(t * 2) * 0.02);
      const cr = core * pulse;
      const body = ctx.createRadialGradient(c - cr * 0.3, c - cr * 0.35, cr * 0.1, c, c, cr);
      body.addColorStop(0, "rgba(240,253,255,0.95)"); body.addColorStop(0.25, col(0.85)); body.addColorStop(0.7, "rgba(30,70,200,0.75)"); body.addColorStop(1, "rgba(6,13,36,0.6)");
      ctx.beginPath(); ctx.arc(c, c, cr, 0, Math.PI * 2); ctx.fillStyle = body; ctx.shadowColor = col(0.9); ctx.shadowBlur = 18; ctx.fill(); ctx.shadowBlur = 0;
      ctx.save(); ctx.beginPath(); ctx.arc(c, c, cr, 0, Math.PI * 2); ctx.clip();
      for (let y = c - cr + ((t * 30) % 4); y < c + cr; y += 4) { ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(c - cr, y, cr * 2, 1); }
      ctx.beginPath(); ctx.ellipse(c - cr * 0.28, c - cr * 0.42, cr * 0.45, cr * 0.18, -0.5, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(c, c, cr, 0, Math.PI * 2); ctx.strokeStyle = "rgba(220,250,255,0.5)"; ctx.lineWidth = 0.8; ctx.stroke();

      // processing: thinking arcs; executing: real progress around the orb
      if (p.state === "processing") {
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(c, c, core * (1.45 + k * 0.18), t * (2 + k) + k, t * (2 + k) + k + 0.9); ctx.strokeStyle = col(0.7 - k * 0.18); ctx.lineWidth = 2 - k * 0.5; ctx.stroke(); }
      }
      if (p.state === "executing") {
        const pr = p.progress ?? ((t * 0.25) % 1);
        ctx.beginPath(); ctx.arc(c, c, S * 0.47, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.04, pr)); ctx.strokeStyle = col(0.9); ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); ctx.lineCap = "butt";
        ctx.beginPath(); ctx.arc(c, c, S * 0.47, 0, Math.PI * 2); ctx.strokeStyle = col(0.12); ctx.lineWidth = 2.5; ctx.stroke();
      }
      // success: a brief confirmation burst; error: a soft warning pulse
      if (p.state === "success" || p.state === "error") {
        const k = Math.min(1, (now - stateAt) / 900);
        ctx.beginPath(); ctx.arc(c, c, core * (1.2 + k * 1.1), 0, Math.PI * 2); ctx.strokeStyle = col(1 - k); ctx.lineWidth = 2.5; ctx.stroke();
        if (p.state === "success") { ctx.beginPath(); ctx.moveTo(c - cr * 0.35, c); ctx.lineTo(c - cr * 0.08, c + cr * 0.28); ctx.lineTo(c + cr * 0.4, c - cr * 0.3); ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 2.2; ctx.stroke(); }
        else { ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.fillRect(c - 1.1, c - cr * 0.42, 2.2, cr * 0.5); ctx.beginPath(); ctx.arc(c, c + cr * 0.3, 1.5, 0, Math.PI * 2); ctx.fill(); }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} style={{ width: size, height: size, display: "block" }} aria-hidden />;
}
