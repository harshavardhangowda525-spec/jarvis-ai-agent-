"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Candle, ChartData, Timeframe } from "@/lib/mike/types";
import { TIMEFRAMES, TF_LABEL } from "@/lib/mike/types";
import { fmtPrice } from "@/lib/mike/format";
import { MikeChart, DEFAULT_TOGGLES, type ChartToggles } from "./mike-chart";
import { useBinanceStream } from "./use-live-stream";

/**
 * MIKE's live chart of any market, inside his window. Candles and overlays
 * come from /api/mike/chart (refreshed every few seconds); crypto also streams
 * tick-by-tick from Binance's public feed. The badge always says how fresh the
 * data really is, and nothing is drawn when there's no data.
 */
type Meta = { asset: { symbol: string; display: string; name?: string | null; exchange: string }; source: string; freshness: string; note: string; stream: { provider: "binance"; symbol: string } | null };
const TOGGLE_LABEL: Record<keyof ChartToggles, string> = { ema: "EMA", bb: "Bollinger", vwap: "VWAP", levels: "Levels", structure: "Structure", volume: "Volume", rsi: "RSI" };
const SHOWN_TF: Timeframe[] = ["5m", "15m", "1h", "4h", "1d", "1w"];

export function ChartPanel({ asset, timeframe, onTimeframe, onClose }: { asset: string; timeframe: Timeframe; onTimeframe: (tf: Timeframe) => void; onClose: () => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState<number | null>(null);
  const [toggles, setToggles] = useState<ChartToggles>(DEFAULT_TOGGLES);
  const [live, setLive] = useState<number | null>(null);

  const load = useCallback(async (first: boolean) => {
    if (first) { setLoading(true); setErr(null); }
    const j = await fetch(`/api/mike/chart?asset=${encodeURIComponent(asset)}&tf=${timeframe}&bars=160`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    setLoading(false);
    if (!j?.ok) { if (first) { setErr(j?.error ?? "MIKE couldn't load that chart."); setMeta(null); setChart(null); } return; }
    setErr(null); setMeta(j.data); setChart(j.data.chart); setUpdated(Date.now());
  }, [asset, timeframe]);

  // crypto: tick-by-tick from the public stream; the last candle follows it
  const streamSymbol = meta?.stream?.provider === "binance" ? meta.stream.symbol : null;
  const stream = useBinanceStream(streamSymbol, timeframe, useCallback((c: Candle) => {
    setLive(c.c);
    setChart((ch) => {
      if (!ch?.candles.length) return ch;
      const last = ch.candles[ch.candles.length - 1];
      if (c.t === last.t) return { ...ch, candles: [...ch.candles.slice(0, -1), c] };
      if (c.t > last.t) return { ...ch, candles: [...ch.candles.slice(1), c] };
      return ch;
    });
  }, []));

  useEffect(() => { setLive(null); void load(true); }, [load]);
  // everything else is polled (crypto too, for the overlays), a little slower when streaming
  useEffect(() => { const iv = setInterval(() => void load(false), stream === "live" ? 30_000 : 6_000); return () => clearInterval(iv); }, [load, stream]);

  const last = chart?.candles.at(-1) ?? null;
  const price = live ?? last?.c ?? null;
  const change = useMemo(() => {
    const cs = chart?.candles ?? [];
    if (cs.length < 2 || price === null) return null;
    const prev = cs[cs.length - 2].c;
    return ((price - prev) / prev) * 100;
  }, [chart, price]);
  const badge = !meta ? null
    : meta.freshness === "unavailable" ? ["LIVE DATA UNAVAILABLE", "#ff6b7a"]
    : stream === "live" ? ["LIVE STREAM", "#4ce0a6"]
    : meta.freshness === "live" ? ["LIVE", "#4ce0a6"]
    : meta.freshness === "closed" ? ["MARKET CLOSED", "#9fb7d0"]
    : meta.freshness === "stale" ? ["STALE", "#ff6b7a"] : [meta.freshness.toUpperCase(), "#f4c35a"];

  return (
    <div className="mc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="mc-h">
        <div className="mc-id">
          <b>{meta?.asset.name ?? meta?.asset.display ?? asset}</b>
          <small>{meta ? `${meta.asset.display} · ${meta.asset.exchange} · ${meta.source}` : loading ? "Loading…" : ""}</small>
        </div>
        <div className="mc-px">
          {price !== null && <b>{fmtPrice(price)}</b>}
          {change !== null && <small style={{ color: change >= 0 ? "#4ce0a6" : "#ff6b7a" }}>{change >= 0 ? "+" : ""}{change.toFixed(2)}% bar</small>}
        </div>
        {badge && <span className="mc-badge" style={{ color: badge[1], borderColor: badge[1] }} title={meta?.note}>{(badge[0] === "LIVE" || badge[0] === "LIVE STREAM") && <i />}{badge[0]}</span>}
        <button className="mc-x" onClick={onClose} aria-label="Close chart" title="Close chart"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="mc-tf">
        {SHOWN_TF.filter((t) => (TIMEFRAMES as readonly string[]).includes(t)).map((t) => <button key={t} className={t === timeframe ? "on" : ""} onClick={() => onTimeframe(t)}>{TF_LABEL[t]}</button>)}
        <span className="mc-sep" />
        {(Object.keys(TOGGLE_LABEL) as (keyof ChartToggles)[]).filter((k) => k !== "structure").map((k) => <button key={k} className={toggles[k] ? "on soft" : "soft"} onClick={() => setToggles({ ...toggles, [k]: !toggles[k] })}>{TOGGLE_LABEL[k]}</button>)}
      </div>
      <div className="mc-plot">
        {chart ? <MikeChart chart={chart} setup={null} toggles={toggles} timeframe={timeframe} replayKey={`${asset}-${timeframe}`} />
          : <div className="mc-empty">{err ?? (loading ? "Loading the chart…" : meta?.freshness === "unavailable" ? `Live data unavailable — ${meta.note}` : "Not enough price history for this timeframe.")}</div>}
      </div>
      <div className="mc-f">{updated ? `Updated ${new Date(updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}{stream === "connecting" ? " · connecting the live stream…" : stream === "down" ? " · stream blocked — refreshing every few seconds" : ""}{meta?.note && meta.freshness !== "live" ? ` · ${meta.note}` : ""}</div>
    </div>
  );
}

const CSS = `
.mc{display:flex;flex-direction:column;gap:5px;border:1px solid rgba(140,200,255,.18);border-radius:12px;background:rgba(2,8,18,.55);padding:7px}
.mc-h{display:flex;align-items:center;gap:8px}
.mc-id{display:flex;flex-direction:column;min-width:0;flex:1}
.mc-id b{font:600 13px Barlow,sans-serif;color:#eef6ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mc-id small{font-size:10px;color:#7f97b2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mc-px{display:flex;flex-direction:column;align-items:flex-end}
.mc-px b{font:600 14px ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff}.mc-px small{font-size:10px}
.mc-badge{display:flex;align-items:center;gap:4px;font:600 9px ui-monospace,monospace;letter-spacing:.08em;border:1px solid;border-radius:5px;padding:1px 5px;white-space:nowrap}
.mc-badge i{width:5px;height:5px;border-radius:50%;background:currentColor;animation:mc-p 1.2s infinite}
@keyframes mc-p{50%{opacity:.3}}
.mc-x{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;color:#8fa9c4}.mc-x:hover{background:rgba(255,255,255,.07);color:#fff}
.mc-tf{display:flex;flex-wrap:wrap;gap:3px;align-items:center}
.mc-tf button{font:500 10px Barlow,sans-serif;padding:1px 7px;border-radius:6px;border:1px solid rgba(140,200,255,.18);color:#9fb7d0}
.mc-tf button.on{color:#06121f;background:#46d483;border-color:#46d483}
.mc-tf button.soft.on{background:rgba(70,212,131,.15);color:#bff3d6;border-color:rgba(70,212,131,.5)}
.mc-sep{width:1px;height:12px;background:rgba(140,200,255,.18);margin:0 2px}
.mc-plot{position:relative;height:clamp(200px,34dvh,340px);border-radius:8px;overflow:hidden;background:#030a14}
.mc-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;font-size:12px;color:#9fb7d0}
.mc-f{font-size:9.5px;color:#5d7590}
@media (prefers-reduced-motion:reduce){.mc-badge i{animation:none}}
`;
