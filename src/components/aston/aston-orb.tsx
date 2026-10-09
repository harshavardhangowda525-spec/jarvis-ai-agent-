"use client";

import { useEffect, useRef } from "react";

export type AstonState = "idle" | "listening" | "processing" | "speaking" | "attention";

/** Per state: core colours (inner, outer), ring colour, motion speed, wave strength. */
const LOOK: Record<AstonState, { inner: string; outer: string; ring: string; speed: number; wave: number; pulse: number }> = {
  idle: { inner: "120,240,255", outer: "40,90,230", ring: "90,220,255", speed: 0.35, wave: 0.05, pulse: 0.015 },
  listening: { inner: "140,255,230", outer: "20,150,200", ring: "110,255,220", speed: 0.6, wave: 0.07, pulse: 0.035 },
  processing: { inner: "150,220,255", outer: "70,70,240", ring: "140,170,255", speed: 1.6, wave: 0.09, pulse: 0.02 },
  speaking: { inner: "130,245,255", outer: "30,110,240", ring: "100,230,255", speed: 0.9, wave: 0.14, pulse: 0.06 },
  attention: { inner: "255,214,140", outer: "220,70,50", ring: "255,150,90", speed: 0.8, wave: 0.1, pulse: 0.07 },
};

const mix = (a: string, b: string, t: number) => {
  const x = a.split(",").map(Number), y = b.split(",").map(Number);
  return x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",");
};

/**
 * ASTON's holographic core: a luminous sphere inside translucent, breathing
 * wave rings (canvas, GPU-cheap). Colours and motion ease between states.
 */
export function AstonOrb({ state, size = 360 }: { state: AstonState; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let raf = 0, t = 0, last = performance.now();
    // eased "current look" so state changes glide instead of jump
    const cur = { ...LOOK[stateRef.current] };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = LOOK[stateRef.current];
      const k = Math.min(1, dt * 3);
      cur.inner = mix(cur.inner, target.inner, k);
      cur.outer = mix(cur.outer, target.outer, k);
      cur.ring = mix(cur.ring, target.ring, k);
      cur.speed += (target.speed - cur.speed) * k;
      cur.wave += (target.wave - cur.wave) * k;
      cur.pulse += (target.pulse - cur.pulse) * k;
      t += dt * (reduce ? 0.15 : cur.speed);

      const c = size / 2;
      const R = size * 0.27 * (1 + Math.sin(t * 2.2) * cur.pulse);
      ctx.clearRect(0, 0, size, size);

      // outer glow
      // (kept inside the canvas circle so no square edge ever shows)
      const glow = ctx.createRadialGradient(c, c, R * 0.6, c, c, c);
      glow.addColorStop(0, `rgba(${cur.ring},0.35)`);
      glow.addColorStop(1, `rgba(${cur.ring},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(c, c, c, 0, Math.PI * 2);
      ctx.fill();

      // translucent wave rings
      ctx.globalCompositeOperation = "lighter";
      for (let ring = 0; ring < 4; ring++) {
        const base = R * (1.12 + ring * 0.07);
        ctx.beginPath();
        for (let i = 0; i <= 160; i++) {
          const a = (i / 160) * Math.PI * 2;
          const w =
            Math.sin(a * (3 + ring) + t * (1.3 + ring * 0.4)) * cur.wave +
            Math.sin(a * (5 + ring * 2) - t * (0.9 + ring * 0.3)) * cur.wave * 0.5;
          const r = base * (1 + w);
          const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(${cur.ring},${0.55 - ring * 0.1})`;
        ctx.lineWidth = 1.6 - ring * 0.25;
        ctx.shadowColor = `rgba(${cur.ring},0.9)`;
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.fillStyle = `rgba(${cur.ring},${0.035})`;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";

      // the sphere
      const g = ctx.createRadialGradient(c - R * 0.25, c - R * 0.3, R * 0.05, c, c, R);
      g.addColorStop(0, `rgba(${cur.inner},1)`);
      g.addColorStop(0.45, `rgba(${mix(cur.inner, cur.outer, 0.5)},0.95)`);
      g.addColorStop(1, `rgba(${cur.outer},0.9)`);
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      // drifting inner currents
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalCompositeOperation = "lighter";
      for (let s = 0; s < 7; s++) {
        ctx.beginPath();
        const yo = (s - 3) * R * 0.22;
        for (let i = 0; i <= 60; i++) {
          const x = c - R + (i / 60) * R * 2;
          const y = c + yo + Math.sin(i / 7 + t * (1 + s * 0.15) + s) * R * 0.08;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${cur.inner},0.12)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();

      // rim light + specular highlight
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${cur.inner},0.6)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      const hl = ctx.createRadialGradient(c - R * 0.35, c - R * 0.4, 0, c - R * 0.35, c - R * 0.4, R * 0.45);
      hl.addColorStop(0, "rgba(255,255,255,0.45)");
      hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl;
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} style={{ width: size, height: size }} className="block max-w-full" aria-hidden />;
}
