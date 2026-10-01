"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp, reducedMotion } from "./anim";
import { ago } from "./api";

/**
 * The command center's small floating glass: the stat panels either side of
 * the core, and the live activity stream along the bottom. Every value comes
 * from the CRM; "—" means there isn't enough data yet (never a made-up number).
 */

export interface Stat {
  key: string;
  label: string;
  value: number | null;
  suffix?: string;
  decimals?: number;
  sub?: string;
  trend?: "up";
  tone?: "accent" | "warn" | "won";
  title: string;
  onClick: () => void;
}

export const StatPanel = forwardRef<HTMLButtonElement, { stat: Stat; delay?: number; className?: string; style?: React.CSSProperties }>(function StatPanel({ stat, delay = 0, className, style }, ref) {
  const v = useCountUp(stat.value ?? 0, 900);
  const inner = useRef<HTMLSpanElement>(null);
  // magnetic hover + a light that follows the pointer across the glass
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - b.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - b.top}px`);
    if (reducedMotion() || !inner.current) return;
    const dx = ((e.clientX - b.left) / b.width - 0.5) * 6, dy = ((e.clientY - b.top) / b.height - 0.5) * 4;
    inner.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const leave = () => { if (inner.current) inner.current.style.transform = ""; };
  const shown = stat.value == null ? "—" : `${v.toFixed(stat.decimals ?? 0)}${stat.suffix ?? ""}`;
  return (
    <button
      ref={ref} type="button" onClick={stat.onClick} onPointerMove={move} onPointerLeave={leave} title={stat.title}
      className={cn("robin-stat group relative block w-full overflow-hidden rounded-xl px-3.5 py-2.5 text-left", stat.tone === "accent" && "robin-stat-accent", className)}
      style={{ animationDelay: `${delay}ms`, ...style }}
      aria-label={`${stat.label}: ${shown}${stat.sub ? `, ${stat.sub}` : ""}. ${stat.title}`}
    >
      <span ref={inner} className="relative block transition-transform duration-300 ease-out">
        <span className="block text-[9.5px] tracking-[0.2em] text-slate-300/90">{stat.label}</span>
        <span className="mt-0.5 flex items-baseline gap-1.5">
          <span className={cn("text-[24px] font-light leading-none tracking-tight tabular-nums", stat.tone === "won" ? "text-emerald-100" : "text-white")}>{shown}</span>
          {stat.trend === "up" && <ArrowUp className="h-3.5 w-3.5 self-center text-cyan-200" aria-hidden />}
        </span>
        {stat.sub && <span className={cn("mt-1 block truncate text-[9.5px]", stat.tone === "warn" ? "text-amber-300/90" : "text-slate-400")}>{stat.sub}</span>}
      </span>
    </button>
  );
});

export interface FeedItem { id: string; at: string; text: string; fresh?: boolean }

/** The live activity stream: newest on the right, sliding in as it happens. */
export function ActivityStream({ items, className }: { items: FeedItem[]; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const iv = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(iv); }, []);
  return (
    <div className={cn("robin-stream relative flex min-w-0 items-center justify-end gap-2 overflow-hidden", className)} aria-label="Live activity" aria-live="polite">
      {items.length ? items.map((f) => (
        <span key={f.id} className={cn("robin-chip flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[10.5px]", f.fresh && "robin-chip-in")}>
          <span className="max-w-[260px] truncate text-slate-200">{f.text}</span>
          <span className="whitespace-nowrap text-slate-500">{ago(f.at)}</span>
        </span>
      )) : <span className="text-[10.5px] text-slate-600">Live activity appears here as it happens.</span>}
    </div>
  );
}
