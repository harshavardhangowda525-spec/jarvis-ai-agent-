"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * MIKE's power-up titles, drawn over the core's own boot animation (the core,
 * scanline and converging data live on the canvas underneath). The feed line
 * reports what really happened with the first market fetch — nothing else
 * here claims a result. Click or press any key to skip.
 */
export type FeedStatus = { state: "pending" } | { state: "ok"; withData: number; total: number } | { state: "down" };

const STEPS = ["IGNITING CORE", "CALIBRATING INDICATOR ENGINE", "ARMING VALIDATION ENGINE", "LOADING RISK PROTOCOLS"];

export function BootOverlay({ durationMs, feeds, onExit, onGone, top }: { durationMs: number; feeds: FeedStatus; onExit: () => void; onGone: () => void; /** where the titles start (just below the core) */ top?: number | null }) {
  const [t, setT] = useState(0);
  const [exiting, setExiting] = useState(false);
  const done = useRef(false);
  const cb = useRef({ onExit, onGone }); cb.current = { onExit, onGone };

  const finish = () => {
    if (done.current) return;
    done.current = true;
    setExiting(true);
    cb.current.onExit();
    setTimeout(() => cb.current.onGone(), 750);
  };

  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / durationMs);
      setT(k);
      if (k < 1) raf = requestAnimationFrame(tick); else setTimeout(finish, 350);
    };
    raf = requestAnimationFrame(tick);
    const skip = () => finish();
    window.addEventListener("keydown", skip);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", skip); };
  }, [durationMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // log lines appear one after another; the feed line sits second and shows the real outcome
  const lines: { text: string; tone: "ok" | "wait" | "warn"; at: number }[] = [
    { text: STEPS[0], tone: "ok", at: 0.22 },
    feeds.state === "pending" ? { text: "CONNECTING MARKET FEEDS…", tone: "wait", at: 0.36 }
      : feeds.state === "ok" ? { text: `MARKET FEEDS LINKED · ${feeds.withData}/${feeds.total}`, tone: "ok", at: 0.36 }
        : { text: "MARKET FEEDS UNAVAILABLE", tone: "warn", at: 0.36 },
    { text: STEPS[1], tone: "ok", at: 0.5 },
    { text: STEPS[2], tone: "ok", at: 0.62 },
    { text: STEPS[3], tone: "ok", at: 0.74 },
  ];
  const online = t >= 0.86;

  return (
    <div
      onClick={finish}
      className={cn("fixed inset-0 z-40 cursor-pointer select-none transition-all duration-700 ease-out", exiting && "pointer-events-none -translate-y-6 opacity-0")}
      aria-label="MIKE is starting — click to skip"
    >
      <div className={cn("absolute inset-x-0 flex flex-col items-center px-4 text-center", top == null && "bottom-[10%]")} style={top != null ? { top } : undefined}>
        {/* wordmark: each letter resolves out of a blur, with a brief chromatic glitch */}
        <div className="flex gap-[0.35em] text-5xl font-bold text-white sm:text-7xl [@media(max-height:820px)]:text-5xl" style={{ textShadow: "0 0 30px rgba(34,211,238,.7)" }}>
          {"MIKE".split("").map((ch, i) => (
            <span key={i} className="mike-letter inline-block" style={{ animationDelay: `${0.3 + i * 0.12}s` }}>{ch}</span>
          ))}
        </div>
        <div className="mike-typein mt-2 overflow-hidden whitespace-nowrap font-mono text-[10px] tracking-[0.35em] text-cyan-300/80 sm:text-xs" style={{ animationDelay: "0.9s" }}>
          MARKET INTELLIGENCE &amp; KNOWLEDGE ENGINE
        </div>

        <div className="mt-6 w-[min(420px,90vw)] space-y-1 text-left font-mono text-[11px] [@media(max-height:820px)]:mt-3">
          {lines.map((l) => t >= l.at && (
            <div key={l.text} className="mike-row flex items-center justify-between gap-3">
              <span className={cn(l.tone === "warn" ? "text-amber-300" : "text-cyan-100/90")}>▸ {l.text}</span>
              <span className={cn("shrink-0", l.tone === "ok" ? "text-emerald-300" : l.tone === "warn" ? "text-amber-300" : "animate-pulse text-cyan-300")}>
                {l.tone === "ok" ? "✓" : l.tone === "warn" ? "!" : "···"}
              </span>
            </div>
          ))}
        </div>

        {/* progress bar with a glowing head */}
        <div className="relative mt-4 h-[2px] w-[min(420px,90vw)] overflow-visible rounded bg-cyan-900/40">
          <div className="h-full rounded bg-gradient-to-r from-cyan-600 via-cyan-300 to-white" style={{ width: `${t * 100}%` }} />
          <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_16px_4px_rgba(103,232,249,0.8)]" style={{ left: `${t * 100}%`, opacity: t < 1 ? 1 : 0 }} />
        </div>
        <div className="mt-2 flex w-[min(420px,90vw)] justify-between font-mono text-[10px] text-slate-500">
          <span>{online ? "" : "SYSTEM BOOT"}</span><span className="tabular-nums">{Math.round(t * 100)}%</span>
        </div>

        {online && (
          <div className="mike-reason mt-3 font-mono text-sm font-bold tracking-[0.4em] text-white" style={{ textShadow: "0 0 18px rgba(34,211,238,.9)" }}>MIKE ONLINE</div>
        )}
        <div className="mt-4 text-[10px] text-slate-600">click or press any key to skip</div>
      </div>
    </div>
  );
}
