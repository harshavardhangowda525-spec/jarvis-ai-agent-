"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Bias, MikeAnalysis, RegimeId, SentimentId, VolState } from "@/lib/mike/types";
import { TF_LABEL } from "@/lib/mike/types";
import { fmtPct, fmtPrice } from "@/lib/mike/format";
import type { LevelKey, LevelPos } from "./mike-chart";

// ---- intelligence stream ------------------------------------------------------
export interface StreamItem { id: number; text: string; tone: "info" | "ok" | "warn" | "hot"; at: number }
const TONE = { info: "border-cyan-400/40 text-cyan-100", ok: "border-emerald-400/50 text-emerald-100", warn: "border-amber-400/50 text-amber-100", hot: "border-white/70 text-white" };
const DOT = { info: "bg-cyan-300", ok: "bg-emerald-300", warn: "bg-amber-300", hot: "bg-white" };

export function IntelStream({ items }: { items: StreamItem[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-hidden">
      {items.map((it, k) => { const idx = items.length - 1 - k; return (
        <div key={it.id} className={cn("mike-stream-in relative rounded-md border-l-2 bg-slate-900/40 px-2.5 py-1.5", TONE[it.tone])} style={{ opacity: Math.max(0.25, 1 - idx * 0.075) }}>
          <span className="absolute -left-[5px] top-2.5 h-2 w-2">
            <span className={cn("absolute inset-0 rounded-full", DOT[it.tone])} />
            {idx === 0 && <span className={cn("absolute inset-0 rounded-full mike-ping", DOT[it.tone])} />}
          </span>
          <div className="font-mono text-[10.5px] font-semibold uppercase tracking-wide">{it.text}</div>
          <div className="text-[9px] text-slate-500">{new Date(it.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
        </div>
      ); })}
      {!items.length && <div className="text-[11px] text-slate-500">Nothing yet — events appear here as MIKE works.</div>}
    </div>
  );
}

// ---- market regime orb (morphs between states) -------------------------------
type Look = { lobes: number; amp: number; tilt: number; hue: number; sat: number; spikes: number; r: number };
function lookFor(regime: RegimeId | null, vol: VolState | null): Look {
  const base: Look = regime === "strong_bullish" || regime === "weak_bullish" ? { lobes: 3, amp: 0.16, tilt: -0.9, hue: 165, sat: 80, spikes: 0, r: 1 }
    : regime === "strong_bearish" || regime === "weak_bearish" ? { lobes: 3, amp: 0.16, tilt: 0.9, hue: 350, sat: 80, spikes: 0, r: 1 }
      : regime === "ranging" ? { lobes: 2, amp: 0.22, tilt: 0, hue: 205, sat: 70, spikes: 0, r: 0.95 }
        : { lobes: 4, amp: 0.05, tilt: 0, hue: 195, sat: 30, spikes: 0, r: 0.85 };
  if (vol === "high") return { ...base, spikes: 0.12, hue: regime === "ranging" ? 38 : base.hue };
  if (vol === "low") return { ...base, amp: base.amp * 0.5, r: base.r * 0.9, sat: base.sat * 0.6 };
  return base;
}
const REGIME_WORD: Record<RegimeId, string> = { strong_bullish: "BULLISH", weak_bullish: "BULLISH", strong_bearish: "BEARISH", weak_bearish: "BEARISH", ranging: "RANGING" };

export function RegimeOrb({ regime, volatility, label }: { regime: RegimeId | null; volatility: VolState | null; label: string | null }) {
  const pathRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const cur = useRef<Look>(lookFor(null, null));
  const target = useRef<Look>(lookFor(regime, volatility));
  target.current = lookFor(regime, volatility);
  useEffect(() => {
    let raf = 0, t = 0, last = performance.now();
    const step = () => {
      const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      const c = cur.current, g = target.current, k = Math.min(1, dt * 1.8);
      (Object.keys(c) as (keyof Look)[]).forEach((key) => { c[key] = c[key] + (g[key] - c[key]) * k; });
      const pts: string[] = [];
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const r = 38 * c.r * (1 + c.amp * Math.sin(a * c.lobes + t * 0.9 + c.tilt) + c.spikes * Math.sin(a * 13 - t * 3) + 0.03 * Math.sin(a * 5 + t * 2));
        pts.push(`${(50 + Math.cos(a + c.tilt * 0.3) * r).toFixed(2)},${(50 + Math.sin(a + c.tilt * 0.3) * r).toFixed(2)}`);
      }
      const d = `M${pts.join("L")}Z`;
      const color = `hsl(${c.hue.toFixed(0)} ${c.sat.toFixed(0)}% 65%)`;
      pathRef.current?.setAttribute("d", d); pathRef.current?.setAttribute("stroke", color);
      glowRef.current?.setAttribute("d", d); glowRef.current?.setAttribute("fill", `hsla(${c.hue.toFixed(0)}, ${c.sat.toFixed(0)}%, 55%, 0.16)`);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  const word = regime ? REGIME_WORD[regime] : "—";
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 100" className="h-20 w-20 shrink-0" aria-hidden>
        <path ref={glowRef} style={{ filter: "blur(4px)" }} />
        <path ref={pathRef} fill="none" strokeWidth="1.6" />
        <circle cx="50" cy="50" r="3" fill="white" opacity="0.8" />
      </svg>
      <div className="min-w-0">
        <div className="hud-label text-[9px] text-slate-400">MARKET REGIME</div>
        <div key={word} className="mike-in text-xl font-bold tracking-wider text-white">{word}</div>
        <div className="truncate text-[10px] text-slate-400">{label ? label.split(" · ").slice(1).join(" · ") || label : "Analyse an asset"}</div>
      </div>
    </div>
  );
}

// ---- global ticker --------------------------------------------------------------
export interface TickerItem { label: string; price: number | null; change: number | null; bias: Bias | null; freshness: string; spark: number[] }
export function Ticker({ items }: { items: TickerItem[] }) {
  if (!items.length) return <div className="px-4 py-2 font-mono text-[11px] text-slate-500">Loading market data…</div>;
  const row = items.map((it, i) => (
    <div key={i} className="flex items-center gap-2 px-5">
      <span className="font-semibold tracking-wide text-slate-100">{it.label}</span>
      {it.freshness === "unavailable" ? <span className="text-rose-300/80">DATA UNAVAILABLE</span> : (
        <>
          <span className="font-mono text-slate-300">{fmtPrice(it.price)}</span>
          <span className={cn("font-mono", (it.change ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{fmtPct(it.change)}</span>
          <Spark values={it.spark} up={(it.change ?? 0) >= 0} />
          {it.freshness !== "live" && <span className="text-[9px] uppercase text-slate-500">{it.freshness}</span>}
        </>
      )}
    </div>
  ));
  return (
    <div className="relative overflow-hidden" style={{ maskImage: "linear-gradient(90deg, transparent, black 6%, black 94%, transparent)" }}>
      <div className="mike-ticker flex w-max whitespace-nowrap py-2 text-[12px]">{row}{row}</div>
    </div>
  );
}
export function Spark({ values, up, w = 54, h = 16 }: { values: number[]; up: boolean; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / (hi - lo || 1)) * h).toFixed(1)}`).join(" ");
  return <svg width={w} height={h} className="shrink-0"><polyline points={pts} fill="none" stroke={up ? "rgb(110,231,183)" : "rgb(253,164,175)"} strokeWidth="1.2" /></svg>;
}

// ---- live market panel ----------------------------------------------------------
export interface MarketSummary {
  status: string; trend: Bias; volatility: VolState; sentiment: SentimentId;
  topMovers: string[]; highVolume: string[]; noTradeConditions: string[]; withData: number; assets: number;
}
const SENT: Record<SentimentId, string> = { extremely_bearish: "EXTREMELY BEARISH", bearish: "BEARISH", neutral: "NEUTRAL", bullish: "BULLISH", extremely_bullish: "EXTREMELY BULLISH" };
export function MarketPanel({ s, regime, active, scannedAt }: { s: MarketSummary | null; regime: string | null; active: { id: string; asset: string; direction: string | null; confidence: number; status: string }[]; scannedAt: string | null }) {
  const cell = (k: string, v: string, tone = "text-slate-100") => (
    <div className="rounded-md bg-slate-900/40 px-2 py-1"><div className="hud-label text-[8px] text-slate-500">{k}</div><div key={v} className={cn("mike-in truncate font-mono text-[11px] font-semibold", tone)}>{v}</div></div>
  );
  const bt = (b: Bias) => (b === "bullish" ? "text-emerald-300" : b === "bearish" ? "text-rose-300" : "text-slate-200");
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        {cell("MARKET STATUS", s?.status ?? "—", s?.status === "LIVE" ? "text-emerald-300" : s?.status === "LIVE DATA UNAVAILABLE" ? "text-rose-300" : "text-amber-200")}
        {cell("TREND", s ? s.trend.toUpperCase() : "—", s ? bt(s.trend) : undefined)}
        {cell("VOLATILITY", s ? s.volatility.toUpperCase() : "—")}
        {cell("SENTIMENT (PRICE)", s ? SENT[s.sentiment] : "—")}
      </div>
      {cell("MARKET REGIME (SELECTED)", regime ?? "—")}
      <List title="TOP MOVERS (24H)" items={s?.topMovers ?? []} />
      <List title="HIGH-VOLUME ASSETS" items={s?.highVolume ?? []} empty="None above 1.5× average" />
      <List title="ACTIVE SETUPS" items={active.map((a) => `${a.asset} ${a.direction?.toUpperCase() ?? ""} · ${a.confidence} · ${a.status}`)} empty="No open setups" />
      <List title="NO-TRADE CONDITIONS" items={s?.noTradeConditions ?? []} empty="None flagged" tone="text-amber-200/90" />
      {scannedAt && <div className="text-[9px] text-slate-500">Scanned {new Date(scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {s?.withData ?? 0}/{s?.assets ?? 0} feeds with data</div>}
    </div>
  );
}
function List({ title, items, empty = "—", tone = "text-slate-200" }: { title: string; items: string[]; empty?: string; tone?: string }) {
  return (
    <div>
      <div className="hud-label text-[8px] text-slate-500">{title}</div>
      {items.length ? items.slice(0, 4).map((x) => <div key={x} className={cn("mike-in truncate font-mono text-[10.5px]", tone)}>{x}</div>) : <div className="text-[10.5px] text-slate-500">{empty}</div>}
    </div>
  );
}

// ---- multi-timeframe alignment ----------------------------------------------------
export function AlignmentTable({ a }: { a: MikeAnalysis | null }) {
  if (!a || !a.alignment.length) return null;
  return (
    <div className="mike-glass rounded-xl p-3">
      <div className="hud-label text-[9px] tracking-[0.2em] text-cyan-300/80">MULTI-TIMEFRAME ALIGNMENT</div>
      <div className="mt-1.5 space-y-1">
        {a.alignment.map((r, i) => (
          <div key={r.timeframe + r.role} className="mike-row flex items-center gap-2 text-[11px]" style={{ animationDelay: `${i * 0.08}s` }}>
            <span className="w-9 font-mono font-semibold text-slate-200">{TF_LABEL[r.timeframe]}</span>
            <span className={cn("w-16 font-semibold uppercase", r.bias === "bullish" ? "text-emerald-300" : r.bias === "bearish" ? "text-rose-300" : "text-slate-400")}>{r.bias}</span>
            <div className="relative h-1.5 flex-1 rounded bg-slate-800">
              <div className="absolute top-0 h-full w-px bg-slate-500" style={{ left: "50%" }} />
              <div className={cn("absolute top-0 h-full rounded", r.score >= 0 ? "bg-emerald-400/70" : "bg-rose-400/70")} style={r.score >= 0 ? { left: "50%", width: `${r.score / 2}%` } : { right: "50%", width: `${-r.score / 2}%` }} />
            </div>
            <span className="w-12 text-right text-[9px] uppercase text-slate-500">{r.role}</span>
          </div>
        ))}
      </div>
      {a.data.perTimeframe.some((p) => p.freshness === "unavailable") && (
        <div className="mt-1 text-[10px] text-amber-300/80">No data: {a.data.perTimeframe.filter((p) => p.freshness === "unavailable").map((p) => TF_LABEL[p.timeframe]).join(", ")} — not counted.</div>
      )}
    </div>
  );
}

// ---- chart ↔ trade sheet connectors ----------------------------------------------
export function Connectors({ levels, rows, visible }: { levels: LevelPos[]; rows: React.MutableRefObject<Partial<Record<LevelKey, HTMLElement | null>>>; visible: boolean }) {
  const [paths, setPaths] = useState<{ key: LevelKey; d: string; color: string }[]>([]);
  useEffect(() => {
    if (!visible) { setPaths([]); return; }
    let raf = 0, prev = "";
    const tick = () => {
      const out: { key: LevelKey; d: string; color: string }[] = [];
      for (const l of levels) {
        const el = rows.current[l.key];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.top > window.innerHeight || l.y < 0 || l.y > window.innerHeight) continue;
        const x1 = r.left, y1 = r.top + r.height / 2;
        const mx = (l.x + x1) / 2;
        out.push({ key: l.key, d: `M${l.x.toFixed(1)},${l.y.toFixed(1)} C${mx.toFixed(1)},${l.y.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`, color: l.key === "stop" ? "251,113,133" : l.key === "entry" ? "103,232,249" : "110,231,183" });
      }
      const sig = out.map((p) => p.d).join("|");
      if (sig !== prev) { prev = sig; setPaths(out); }
      raf = window.setTimeout(tick, 250) as unknown as number;
    };
    tick();
    return () => clearTimeout(raf);
  }, [levels, rows, visible]);
  if (!paths.length) return null;
  return (
    <svg className="pointer-events-none fixed inset-0 z-30 hidden h-screen w-screen xl:block" aria-hidden>
      {paths.map((p) => (
        <g key={p.key}>
          <path d={p.d} fill="none" stroke={`rgba(${p.color},0.18)`} strokeWidth="3" />
          <path d={p.d} fill="none" stroke={`rgba(${p.color},0.75)`} strokeWidth="1.1" strokeDasharray="4 8" className="mike-dash" />
        </g>
      ))}
    </svg>
  );
}
