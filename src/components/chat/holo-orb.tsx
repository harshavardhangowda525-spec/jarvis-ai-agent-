"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";

/**
 * The holographic core of voice mode: a glowing glass sphere with ribbons of
 * light swirling inside it. One <canvas>, no libraries.
 *
 * It reacts to the conversation:
 * - idle: slow drift;
 * - listening: breathes with your voice;
 * - thinking: orbiting sparks;
 * - speaking: ripples with the reply's audio;
 * - error: dims to red.
 *
 * It pauses when off screen, and holds still with prefers-reduced-motion.
 */
export function HoloOrb({ state, level, color = "#3b82f6", size = 300 }: { state: OrbState; level: () => number; color?: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const levelRef = useRef(level); levelRef.current = level;
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = size * 1.6; // room for the glow
    cv.width = S * dpr; cv.height = S * dpr;
    ctx.scale(dpr, dpr);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    let raf = 0, t = 0, last = performance.now(), smooth = 0, visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(draw); });
    io.observe(cv);

    function ribbon(cx: number, cy: number, R: number, rot: number, tilt: number, phase: number, alpha: number, width: number, hue: [number, number, number]) {
      ctx!.save();
      ctx!.translate(cx, cy);
      ctx!.rotate(rot);
      ctx!.scale(1, tilt);
      const g = ctx!.createLinearGradient(-R, 0, R, 0);
      g.addColorStop(0, `rgba(${hue[0]},${hue[1]},${hue[2]},0)`);
      g.addColorStop(0.45, `rgba(${hue[0]},${hue[1]},${hue[2]},${alpha})`);
      g.addColorStop(0.7, `rgba(255,255,255,${alpha * 0.9})`);
      g.addColorStop(1, `rgba(${hue[0]},${hue[1]},${hue[2]},0)`);
      ctx!.strokeStyle = g;
      ctx!.lineWidth = width;
      ctx!.lineCap = "round";
      ctx!.beginPath();
      ctx!.arc(0, 0, R, phase, phase + Math.PI * 1.25);
      ctx!.stroke();
      ctx!.restore();
    }

    function draw(now: number) {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const st = stateRef.current;
      const lv = Math.max(0, Math.min(1, levelRef.current() || 0));
      smooth += (lv - smooth) * 0.25;
      const speed = reduced ? 0 : st === "thinking" ? 1.8 : st === "speaking" ? 1.2 : st === "listening" ? 0.8 : st === "error" ? 0.15 : 0.35;
      t += dt * speed;
      const cx = S / 2, cy = S / 2;
      const pulse = st === "listening" || st === "speaking" ? smooth * 0.09 : 0;
      const R = (size / 2) * (1 + pulse + (reduced ? 0 : Math.sin(t * 1.3) * 0.012));
      const base: [number, number, number] = st === "error" ? [239, 68, 68] : [cr, cg, cb];
      ctx!.clearRect(0, 0, S, S);

      // the halo around it
      const halo = ctx!.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.55);
      halo.addColorStop(0, `rgba(${base[0]},${base[1]},${base[2]},${0.28 + smooth * 0.25})`);
      halo.addColorStop(1, `rgba(${base[0]},${base[1]},${base[2]},0)`);
      ctx!.fillStyle = halo;
      ctx!.fillRect(0, 0, S, S);

      // the glass sphere: dark core, light rim
      const body = ctx!.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
      body.addColorStop(0, "rgba(10,20,45,0.95)");
      body.addColorStop(0.75, "rgba(5,12,30,0.92)");
      body.addColorStop(0.97, `rgba(${base[0]},${base[1]},${base[2]},0.55)`);
      body.addColorStop(1, `rgba(${base[0]},${base[1]},${base[2]},0)`);
      ctx!.fillStyle = body;
      ctx!.beginPath(); ctx!.arc(cx, cy, R, 0, Math.PI * 2); ctx!.fill();

      // light inside it
      ctx!.save();
      ctx!.beginPath(); ctx!.arc(cx, cy, R * 0.99, 0, Math.PI * 2); ctx!.clip();
      ctx!.globalCompositeOperation = "lighter";
      ctx!.shadowColor = `rgba(${base[0]},${base[1]},${base[2]},0.9)`;
      ctx!.shadowBlur = 18;
      const wob = st === "speaking" ? smooth * 0.35 : 0;
      ribbon(cx, cy + R * 0.12, R * 0.82, t * 0.7, 0.42 + wob * 0.3, t * 1.1, 0.75, R * 0.07, base);
      ribbon(cx, cy - R * 0.05, R * 0.7, -t * 0.55 + 1.2, 0.3 + wob * 0.2, -t * 0.9 + 2, 0.6, R * 0.05, [Math.min(255, base[0] + 60), Math.min(255, base[1] + 80), 255]);
      ribbon(cx, cy, R * 0.92, t * 0.4 + 2.4, 0.55, t * 0.6 + 4, 0.45, R * 0.035, [167, 139, 250]);
      ribbon(cx, cy + R * 0.2, R * 0.6, -t * 0.8 + 0.6, 0.25 + wob * 0.4, t * 1.4, 0.5, R * 0.04, [125, 211, 252]);
      ctx!.restore();

      // thinking: sparks orbiting the sphere
      if (st === "thinking" && !reduced) {
        ctx!.save();
        ctx!.globalCompositeOperation = "lighter";
        for (let i = 0; i < 14; i++) {
          const a = t * (1.2 + (i % 3) * 0.3) + (i * Math.PI * 2) / 14;
          const rr = R * (1.08 + 0.06 * Math.sin(t * 2 + i));
          ctx!.fillStyle = `rgba(${base[0] + 60 > 255 ? 255 : base[0] + 60},${Math.min(255, base[1] + 90)},255,${0.35 + 0.4 * Math.sin(t * 3 + i) ** 2})`;
          ctx!.beginPath(); ctx!.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92, 1.6 + (i % 3), 0, Math.PI * 2); ctx!.fill();
        }
        ctx!.restore();
      }

      // the rim highlight
      ctx!.strokeStyle = `rgba(255,255,255,${0.12 + smooth * 0.2})`;
      ctx!.lineWidth = 1.2;
      ctx!.beginPath(); ctx!.arc(cx, cy, R * 0.995, Math.PI * 1.1, Math.PI * 1.75); ctx!.stroke();

      if (!reduced) raf = requestAnimationFrame(draw);
    }
    kick.current = () => { if (!raf) raf = requestAnimationFrame(draw); };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, [color, size]);

  // with reduced motion the loop rests — draw one frame when the state changes
  useEffect(() => { kick.current(); }, [state]);

  return <canvas ref={ref} aria-hidden style={{ width: size * 1.6, height: size * 1.6, maxWidth: "100%", display: "block" }} />;
}
