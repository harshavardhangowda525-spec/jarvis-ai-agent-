"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Search, Loader2, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartData, Timeframe, TradeSetup } from "@/lib/mike/types";
import { TIMEFRAMES, TF_LABEL, TF_MS } from "@/lib/mike/types";
import { fmtPct, fmtPrice } from "@/lib/mike/format";
import { MikeChart, type ChartToggles } from "./mike-chart";
import type { StreamState } from "./use-live-stream";

export interface ChartMeta {
  symbol: string; display: string; name?: string | null; exchange: string; tf: Timeframe;
  freshness: string; note: string; source: string; fetchedAt: number;
}
interface SearchHit { symbol: string; display: string; name?: string; exchange: string; kind: string }

const TOGGLE_LABEL: Record<keyof ChartToggles, string> = { ema: "EMA", bb: "Bollinger", vwap: "VWAP", levels: "Levels", structure: "Structure", volume: "Volume", rsi: "RSI" };

/**
 * Full-screen live chart of any market. The header price follows the stream
 * (crypto) or the latest poll (everything else), and the badge always says
 * which it is — LIVE STREAM, LIVE, DELAYED, MARKET CLOSED or UNAVAILABLE.
 */
export function LiveChartView({ meta, chart, livePrice, stream, toggles, setToggles, setup, loading, onTimeframe, onPick, onClose, onAnalyze }: {
  meta: ChartMeta | null; chart: ChartData | null; livePrice: { price: number; at: number } | null; stream: StreamState;
  toggles: ChartToggles; setToggles: (t: ChartToggles) => void; setup: TradeSetup | null; loading: boolean;
  onTimeframe: (tf: Timeframe) => void; onPick: (query: string) => void; onClose: () => void; onAnalyze: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevPrice = useRef<number | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  // search any market as you type
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const j = await fetch(`/api/mike/search?q=${encodeURIComponent(term)}`).then((r) => r.json()).catch(() => null);
      setHits(j?.data?.results ?? []); setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const candles = useMemo(() => chart?.candles ?? [], [chart]);
  const last = candles.at(-1) ?? null;
  const price = livePrice?.price ?? last?.c ?? null;
  // 24-hour change from real bars (daily/weekly: versus the previous bar)
  const ref = useMemo(() => {
    if (!candles.length || !meta) return null;
    if (TF_MS[meta.tf] >= 86_400_000) return candles.at(-2)?.c ?? null;
    const cut = (candles.at(-1)!.t) - 86_400_000;
    const c = [...candles].reverse().find((x) => x.t <= cut);
    return c?.c ?? null;
  }, [candles, meta]);
  const change = price != null && ref ? ((price - ref) / ref) * 100 : null;
  useEffect(() => {
    if (price == null) return;
    if (prevPrice.current != null && price !== prevPrice.current) {
      setFlash(price > prevPrice.current ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 450);
      prevPrice.current = price;
      return () => clearTimeout(t);
    }
    prevPrice.current = price;
  }, [price]);

  const updatedAt = livePrice?.at ?? meta?.fetchedAt ?? null;
  const badge = !meta ? null
    : meta.freshness === "unavailable" ? ["LIVE DATA UNAVAILABLE", "text-rose-300 border-rose-400/50"]
      : stream === "live" ? ["LIVE STREAM", "text-emerald-300 border-emerald-400/50"]
        : meta.freshness === "live" ? ["LIVE", "text-emerald-300 border-emerald-400/40"]
          : meta.freshness === "closed" ? ["MARKET CLOSED", "text-slate-300 border-slate-400/40"]
            : meta.freshness === "stale" ? ["STALE", "text-rose-300 border-rose-400/40"]
              : ["DELAYED", "text-amber-300 border-amber-400/40"];

  return (
    <div className="fixed inset-x-2 bottom-2 top-[4.5rem] z-40 sm:inset-x-4" role="dialog" aria-label="Live chart">
      <div className="mike-glass-strong mike-glass-in flex h-full flex-col overflow-hidden rounded-2xl">
        {/* header */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cyan-400/10 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tracking-wide text-white">{meta?.display ?? "—"}</span>
              {badge && (
                <span title={meta?.note} className={cn("flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] tracking-wider", badge[1])}>
                  {(stream === "live" || meta?.freshness === "live") && badge[0] !== "LIVE DATA UNAVAILABLE" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
                  {badge[0]}
                </span>
              )}
            </div>
            <div className="truncate text-[11px] text-slate-400">{meta?.name ? `${meta.name} · ` : ""}{meta?.exchange ?? ""}</div>
          </div>
          <div className="flex items-baseline gap-3">
            <span className={cn("font-mono text-3xl font-bold tabular-nums transition-colors duration-300", flash === "up" ? "text-emerald-300" : flash === "down" ? "text-rose-300" : "text-white")}>{fmtPrice(price)}</span>
            <span className={cn("font-mono text-sm", (change ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{fmtPct(change)} <span className="text-[10px] text-slate-500">24h</span></span>
          </div>
          <div className="text-[10px] text-slate-500">{updatedAt ? `updated ${Math.max(0, Math.round((now - updatedAt) / 1000))}s ago` : ""}{stream === "connecting" ? " · connecting stream…" : stream === "down" ? " · stream blocked — polling" : ""}</div>

          <div className="relative ml-auto">
            <div className="mike-glass flex items-center gap-1.5 rounded-lg px-2 py-1">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { onPick(hits[0]?.symbol ?? q.trim()); setQ(""); setHits([]); } }}
                placeholder="Any market — Tesla, Reliance, gold, PEPE…" aria-label="Search any market" className="w-52 bg-transparent text-xs text-white outline-none placeholder:text-slate-500" />
              {searching && <Loader2 className="h-3 w-3 animate-spin text-cyan-300" />}
            </div>
            {hits.length > 0 && q.trim() && (
              <div className="mike-glass-strong absolute right-0 top-9 z-10 max-h-72 w-80 overflow-y-auto rounded-lg p-1">
                {hits.map((h) => (
                  <button key={h.symbol} onClick={() => { onPick(h.symbol); setQ(""); setHits([]); }} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-cyan-400/10">
                    <span className="min-w-0"><span className="font-mono font-semibold text-white">{h.display}</span> <span className="truncate text-slate-400">{h.name ?? ""}</span></span>
                    <span className="shrink-0 text-[10px] uppercase text-slate-500">{h.kind} · {h.exchange}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={onAnalyze} className="mike-btn flex items-center gap-1 rounded-lg border border-cyan-300/50 bg-cyan-400/15 px-3 py-1.5 text-xs font-semibold tracking-wider text-cyan-50"><Crosshair className="h-3.5 w-3.5" /> ANALYZE</button>
          <button onClick={onClose} aria-label="Close chart" className="mike-btn rounded-lg border border-white/10 p-1.5 text-slate-300"><X className="h-4 w-4" /></button>
        </div>

        {/* timeframe + indicators */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          <div className="mike-glass flex overflow-hidden rounded-lg">
            {TIMEFRAMES.map((t) => (
              <button key={t} onClick={() => onTimeframe(t)} className={cn("px-2.5 py-1 font-mono text-[11px] transition", t === meta?.tf ? "bg-cyan-400/20 text-cyan-100" : "text-slate-400 hover:text-slate-100")}>{TF_LABEL[t]}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(toggles) as (keyof ChartToggles)[]).map((k) => (
              <button key={k} onClick={() => setToggles({ ...toggles, [k]: !toggles[k] })} className={cn("rounded-full border px-2 py-0.5 text-[10px] tracking-wide transition", toggles[k] ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100" : "border-white/10 text-slate-500 hover:text-slate-300")}>{TOGGLE_LABEL[k]}</button>
            ))}
          </div>
          {setup && <span className="text-[10px] text-cyan-300/80">showing MIKE&apos;s validated levels for this chart</span>}
          <span className="ml-auto text-[10px] text-slate-500">scroll to zoom · hover for OHLC · Esc to close</span>
        </div>

        {/* chart */}
        <div className="relative min-h-0 flex-1 px-2 pb-2">
          {chart && meta ? (
            <MikeChart chart={chart} setup={setup} toggles={toggles} timeframe={meta.tf} replayKey={`live-${meta.symbol}-${meta.tf}`} />
          ) : (
            <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">
              {loading ? <Loader2 className="h-6 w-6 animate-spin text-cyan-300" />
                : meta?.freshness === "unavailable" ? <span className="font-mono font-bold tracking-widest text-rose-300">LIVE DATA UNAVAILABLE<span className="mt-1 block font-sans text-xs font-normal tracking-normal text-slate-400">{meta.note}</span></span>
                  : "No chart data."}
            </div>
          )}
          {loading && chart && <div className="absolute right-4 top-2"><Loader2 className="h-4 w-4 animate-spin text-cyan-300" /></div>}
        </div>
        <div className="border-t border-white/5 px-4 py-1.5 text-[10px] text-slate-500">{meta ? `${meta.source} · ${meta.note}` : ""} · Charts only — no trade call. Trading involves substantial risk.</div>
      </div>
    </div>
  );
}
