"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeView, Overview } from "@/lib/robin/overview";
import { money } from "@/lib/robin/types";
import { Count } from "./anim";

/**
 * FUNNEL (how far leads got) and REVENUE (potential value by stage, actual
 * revenue at WON) — opened from the command center as a floating glass view.
 */
export type InsightMode = "funnel" | "revenue";

export function InsightsOverlay({ ov, mode, onMode, onClose }: { ov: Overview; mode: InsightMode; onMode: (m: InsightMode) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const h = 380;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-3 backdrop-blur-[2px]" onClick={onClose}>
      <div className="robin-glass robin-expand w-full max-w-[920px] rounded-2xl p-3" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={mode === "funnel" ? "Sales funnel" : "Revenue pipeline"}>
        <div className="flex items-center justify-between px-1">
          <div className="flex rounded-full border border-white/10 p-0.5 text-[9.5px] tracking-[0.18em]" role="tablist">
            {(["funnel", "revenue"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => onMode(m)} className={cn("rounded-full px-3 py-1 transition-colors", mode === m ? "bg-cyan-300/15 text-cyan-100" : "text-slate-400 hover:text-slate-200")}>{m.toUpperCase()}</button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div ref={box} className="robin-scroll relative mt-2 overflow-x-auto" style={{ height: h }}>
          <div className="relative" style={{ width: Math.max(w, 640), height: h }}>
            {mode === "funnel" ? <FunnelView funnel={ov.funnel} height={h} /> : <RevenueView nodes={ov.nodes} revenueWon={ov.counts.revenueWon} currency={ov.currency} width={Math.max(w, 640)} height={h} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function FunnelView({ funnel, height }: { funnel: Overview["funnel"]; height: number }) {
  const rows = funnel.filter((f) => f.id !== "lost");
  const lost = funnel.find((f) => f.id === "lost");
  const max = Math.max(1, ...rows.map((r) => r.count));
  const rowH = Math.min(30, (height - 40) / (rows.length + 1));
  const [built, setBuilt] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setBuilt(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <div className="absolute inset-0 flex flex-col justify-center px-10 robin-morph">
      {rows.map((r, i) => {
        const prev = i ? rows[i - 1].count : null;
        const pct = prev ? Math.round((r.count / prev) * 100) : null;
        const w = r.count ? Math.max(1.5, (r.count / max) * 100) : 0;
        return (
          <div key={r.id} className="grid items-center gap-3" style={{ gridTemplateColumns: "110px 1fr 150px", height: rowH }}>
            <span className="text-right text-[10px] tracking-[0.22em] text-slate-300">{i === 0 ? "ALL LEADS" : r.label}</span>
            <div className="flex h-[70%] justify-center">
              <div className="robin-bar h-full rounded-md" style={{ width: built ? `${w}%` : "0%", transitionDelay: `${i * 90}ms` }} />
            </div>
            <span className="text-[11px] text-slate-200"><Count value={r.count} /> <span className="text-[10px] text-slate-500">{pct != null ? `· ${pct}% of previous` : ""}</span></span>
          </div>
        );
      })}
      {lost && <p className="mt-2 text-center text-[10px] tracking-[0.18em] text-slate-500">REJECTED (LOST / NOT INTERESTED): {lost.count}</p>}
      {max <= 1 && rows.every((r) => !r.count) && <p className="mt-2 text-center text-xs text-slate-400">The funnel builds itself as leads move through the pipeline.</p>}
    </div>
  );
}

function RevenueView({ nodes, revenueWon, currency, width, height }: { nodes: NodeView[]; revenueWon: number; currency: string; width: number; height: number }) {
  const rows = nodes.filter((n) => n.id !== "lost" && n.id !== "new");
  const vals = rows.map((n) => (n.id === "won" ? revenueWon : n.value));
  const max = Math.max(1, ...vals);
  const padX = 70, top = 34, base = height - 46;
  const step = (width - padX * 2) / Math.max(1, rows.length - 1);
  const pts = rows.map((_, i) => ({ x: padX + i * step, y: base - (vals[i] / max) * (base - top) }));
  const curve = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : (() => { const q = pts[i - 1]; const mx = (q.x + p.x) / 2; return `C${mx},${q.y} ${mx},${p.y} ${p.x},${p.y}`; })())).join(" ");
  const [built, setBuilt] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setBuilt(true)); return () => cancelAnimationFrame(t); }, []);
  const anyValue = vals.some((v) => v > 0);
  return (
    <div className="absolute inset-0 robin-morph">
      <svg width={width} height={height} className="absolute inset-0" aria-hidden>
        <defs>
          <linearGradient id="rb-bar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="rgba(103,232,249,0.65)" /><stop offset="1" stopColor="rgba(59,130,246,0.08)" /></linearGradient>
          <linearGradient id="rb-won" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="rgba(52,211,153,0.8)" /><stop offset="1" stopColor="rgba(16,185,129,0.08)" /></linearGradient>
        </defs>
        <line x1={padX - 30} x2={width - padX + 30} y1={base} y2={base} stroke="rgba(148,163,184,0.25)" />
        {rows.map((n, i) => {
          const h = built ? (vals[i] / max) * (base - top) : 0;
          return (
            <g key={n.id}>
              <rect x={pts[i].x - 16} y={base - h} width={32} height={h} rx={4} fill={n.id === "won" ? "url(#rb-won)" : "url(#rb-bar)"} style={{ transition: `all .9s cubic-bezier(.2,.8,.2,1) ${i * 80}ms` }} />
              <text x={pts[i].x} y={base + 16} textAnchor="middle" fontSize="9.5" letterSpacing="2" fill="rgba(203,213,225,0.85)">{n.label}</text>
              <text x={pts[i].x} y={base + 29} textAnchor="middle" fontSize="8" letterSpacing="1.5" fill={n.id === "won" ? "rgba(110,231,183,0.8)" : "rgba(148,163,184,0.7)"}>{n.id === "won" ? "ACTUAL" : "POTENTIAL"}</text>
              {vals[i] > 0 && <text x={pts[i].x} y={base - h - 8} textAnchor="middle" fontSize="11" fontWeight="600" fill={n.id === "won" ? "#6ee7b7" : "#e2e8f0"} style={{ opacity: built ? 1 : 0, transition: `opacity .4s ${300 + i * 80}ms` }}>{money(vals[i], currency, true)}</text>}
            </g>
          );
        })}
        {anyValue && <path d={curve} fill="none" stroke="rgba(165,243,252,0.7)" strokeWidth={1.4} pathLength={1} className="robin-curve" />}
        {anyValue && pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.6} fill="#a5f3fc" className="robin-pop" style={{ animationDelay: `${600 + i * 90}ms` }} />)}
      </svg>
      {!anyValue && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-slate-400">No values yet — add a potential value to a lead or prepare a quotation, and the revenue pipeline fills in.</p>}
    </div>
  );
}
