"use client";

import { useEffect, useRef } from "react";

/**
 * JARVIS's neural core: layered translucent orbits, slow filaments and a field
 * of particles on a 2D canvas (light enough for any laptop). `energy` (0–1)
 * comes from real activity — how much work is actually running — and only
 * changes speed and brightness. Pauses when hidden; a still frame with
 * reduced motion.
 */
export function NeuralCore({ energy, pulseKey, className }: { energy: number; pulseKey: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const energyRef = useRef(energy);
  const pulseRef = useRef({ key: pulseKey, at: -1e9 });
  energyRef.current = energy;
  if (pulseRef.current.key !== pulseKey) pulseRef.current = { key: pulseKey, at: performance.now() };

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, w = 0, h = 0, dpr = 1;
    const parts = Array.from({ length: 140 }, (_, i) => ({ a: Math.random() * Math.PI * 2, r: 0.18 + Math.random() * 0.34, s: (0.0006 + Math.random() * 0.0016) * (i % 2 ? 1 : -1), z: Math.random(), tilt: Math.random() * Math.PI }));
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = c.getBoundingClientRect(); w = r.width; h = r.height;
      c.width = Math.max(1, w * dpr); c.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(c);
    let t0 = performance.now(), phase = 0;
    const draw = (now: number) => {
      const e = energyRef.current;
      const dt = Math.min(50, now - t0); t0 = now;
      phase += dt * (0.00012 + e * 0.0005);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.5;
      ctx.clearRect(0, 0, w, h);
      // atmosphere
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75);
      g.addColorStop(0, `rgba(95,225,255,${0.16 + e * 0.18})`); g.addColorStop(0.35, `rgba(80,120,255,${0.07 + e * 0.06})`); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // orbits (tilted ellipses)
      for (let k = 0; k < 5; k++) {
        const rr = R * (0.16 + k * 0.075), rot = phase * (k % 2 ? -1 : 1) * (1 + k * 0.25) + k;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
        ctx.strokeStyle = k % 2 ? `rgba(155,123,255,${0.14 + e * 0.12})` : `rgba(95,225,255,${0.16 + e * 0.16})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * (0.32 + 0.1 * k), 0, 0, Math.PI * 2); ctx.stroke();
        // a bright arc segment travelling on each orbit
        ctx.strokeStyle = `rgba(200,245,255,${0.35 + e * 0.4})`; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * (0.32 + 0.1 * k), 0, phase * 3 + k, phase * 3 + k + 0.5); ctx.stroke();
        ctx.restore();
      }
      // particles
      for (const p of parts) {
        p.a += p.s * dt * (0.6 + e * 2.2);
        const rr = R * p.r, x = cx + Math.cos(p.a) * rr, y = cy + Math.sin(p.a) * rr * (0.35 + 0.3 * Math.sin(p.tilt));
        ctx.fillStyle = `rgba(${p.z > 0.6 ? "190,170,255" : "150,230,255"},${0.25 + p.z * 0.5})`;
        ctx.fillRect(x, y, 1.2 + p.z, 1.2 + p.z);
      }
      // filaments from the core
      ctx.lineWidth = 0.8;
      for (let k = 0; k < 7; k++) {
        const a = phase * 0.7 + (k / 7) * Math.PI * 2, len = R * (0.2 + 0.08 * Math.sin(phase * 2 + k));
        ctx.strokeStyle = `rgba(150,230,255,${0.12 + e * 0.15})`;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + Math.cos(a + 0.6) * len * 0.6, cy + Math.sin(a + 0.6) * len * 0.6, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
      }
      // core
      const pulse = Math.max(0, 1 - (now - pulseRef.current.at) / 1200);
      const cr = R * (0.07 + pulse * 0.03);
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 2.4);
      cg.addColorStop(0, "rgba(240,252,255,.95)"); cg.addColorStop(0.3, `rgba(120,230,255,${0.55 + e * 0.3})`); cg.addColorStop(1, "rgba(60,120,255,0)");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr * 2.4, 0, Math.PI * 2); ctx.fill();
      if (pulse > 0) { ctx.strokeStyle = `rgba(160,240,255,${pulse * 0.6})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, cr * (2 + (1 - pulse) * 6), 0, Math.PI * 2); ctx.stroke(); }
      if (!reduce && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const onVis = () => { if (!document.hidden && !reduce) { cancelAnimationFrame(raf); t0 = performance.now(); raf = requestAnimationFrame(draw); } };
    raf = requestAnimationFrame(draw);
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}
