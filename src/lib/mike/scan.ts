import "server-only";
import type { AssetRef, Bias, Freshness, RegimeId, ScanEvent, SentimentId, Timeframe } from "./types";
import { SCAN_EVENT_LABEL } from "./types";
import { resolveAsset } from "./assets";
import { closedBars, fetchSeries, type DataOpts } from "./data";
import { analyzeAt, prepare } from "./timeframe";

/**
 * The market scanner: one pass over a watchlist on one timeframe. Every row is
 * built from that asset's real candles; an asset whose feed fails is listed as
 * unavailable, never filled in.
 */

export interface ScanRow {
  asset: AssetRef;
  price: number | null;
  changePct: number | null;
  /** Change over the last 24 hours of bars (or the last bar on 1D/1W). */
  change24hPct: number | null;
  bias: Bias | null;
  score: number | null;
  regime: RegimeId | null;
  regimeLabel: string | null;
  volatility: "high" | "normal" | "low" | null;
  volumeRatio: number | null;
  events: ScanEvent[];
  eventLabels: string[];
  freshness: Freshness;
  note: string;
  /** How interesting the row is for a deeper look (0–100). */
  interest: number;
  spark: number[];
}

export interface ScanResult {
  timeframe: Timeframe;
  scannedAt: string;
  rows: ScanRow[];
  summary: {
    assets: number; withData: number;
    status: string;
    trend: Bias; volatility: "high" | "normal" | "low"; sentiment: SentimentId;
    topMovers: string[]; highVolume: string[]; noTradeConditions: string[];
  };
}

const EVENT_WEIGHT: Partial<Record<ScanEvent, number>> = {
  breakout: 25, breakdown: 25, trend_reversal: 20, strong_trend: 15, volume_spike: 15, volatility_expansion: 10,
  momentum_shift: 10, unusual_activity: 15, liquidity_zone: 5, near_support: 5, near_resistance: 5, consolidation: 3,
};

const DAY_BARS: Record<Timeframe, number> = { "1m": 1440, "5m": 288, "15m": 96, "30m": 48, "1h": 24, "4h": 6, "1d": 1, "1w": 1 };

export async function scanRow(asset: AssetRef, timeframe: Timeframe, opts: DataOpts = {}): Promise<ScanRow> {
  const s = await fetchSeries(asset, timeframe, opts);
  const blank: ScanRow = {
    asset: s.asset, price: null, changePct: null, change24hPct: null, bias: null, score: null, regime: null, regimeLabel: null,
    volatility: null, volumeRatio: null, events: [], eventLabels: [], freshness: s.freshness, note: s.note, interest: 0, spark: [],
  };
  const bars = closedBars(s, opts.now ?? Date.now());
  if (bars.length < 60) return { ...blank, price: s.candles.at(-1)?.c ?? null, note: s.freshness === "unavailable" ? s.note : `Only ${bars.length} bars — too few to analyse.` };
  const a = analyzeAt(prepare(bars, timeframe, s.hasVolume), bars.length - 1, s.freshness);
  const last = s.candles[s.candles.length - 1];
  const back = s.candles[Math.max(0, s.candles.length - 1 - DAY_BARS[timeframe])];
  const interest = Math.min(100, a.scanEvents.reduce((x, e) => x + (EVENT_WEIGHT[e] ?? 0), 0) + Math.abs(a.score) * 0.3);
  return {
    asset: s.asset, price: last.c,
    changePct: a.snapshot.changePct,
    change24hPct: back ? ((last.c - back.c) / back.c) * 100 : null,
    bias: a.bias, score: a.score, regime: a.regime.id, regimeLabel: a.regime.label, volatility: a.regime.volatility,
    volumeRatio: Number.isFinite(a.snapshot.volumeRatio) ? a.snapshot.volumeRatio : null,
    events: a.scanEvents, eventLabels: a.scanEvents.map((e) => SCAN_EVENT_LABEL[e]),
    freshness: s.freshness, note: s.note, interest: Math.round(interest),
    spark: s.candles.slice(-40).map((c) => c.c),
  };
}

export async function scanMarket(symbols: string[], timeframe: Timeframe, opts: DataOpts = {}): Promise<ScanResult> {
  const assets = symbols.map((q) => resolveAsset(q)).filter((a): a is AssetRef => !!a);
  const rows: ScanRow[] = [];
  // a few at a time — polite to the free feeds
  for (let k = 0; k < assets.length; k += 4) {
    rows.push(...await Promise.all(assets.slice(k, k + 4).map((a) => scanRow(a, timeframe, opts))));
  }
  return { timeframe, scannedAt: new Date(opts.now ?? Date.now()).toISOString(), rows, summary: summarize(rows) };
}

export function summarize(rows: ScanRow[]): ScanResult["summary"] {
  const live = rows.filter((r) => r.bias);
  const noTradeConditions: string[] = [];
  const unavailable = rows.filter((r) => r.freshness === "unavailable").map((r) => r.asset.display);
  if (unavailable.length) noTradeConditions.push(`No data: ${unavailable.join(", ")}`);
  const closed = rows.filter((r) => r.freshness === "closed").map((r) => r.asset.display);
  if (closed.length) noTradeConditions.push(`Market closed: ${closed.join(", ")}`);
  const wild = live.filter((r) => r.events.includes("unusual_activity") || (r.volatility === "high" && r.events.includes("volatility_expansion"))).map((r) => r.asset.display);
  if (wild.length) noTradeConditions.push(`Abnormal volatility: ${wild.join(", ")}`);
  const ranging = live.filter((r) => r.regime === "ranging").map((r) => r.asset.display);
  if (ranging.length) noTradeConditions.push(`No trend (ranging): ${ranging.join(", ")}`);

  const avg = live.length ? live.reduce((s, r) => s + (r.score ?? 0), 0) / live.length : 0;
  const trend: Bias = avg >= 20 ? "bullish" : avg <= -20 ? "bearish" : "neutral";
  const sentiment: SentimentId = avg >= 55 ? "extremely_bullish" : avg >= 20 ? "bullish" : avg <= -55 ? "extremely_bearish" : avg <= -20 ? "bearish" : "neutral";
  const highs = live.filter((r) => r.volatility === "high").length, lows = live.filter((r) => r.volatility === "low").length;
  const volatility = highs > live.length / 2 ? "high" : lows > live.length / 2 ? "low" : "normal";
  const movers = [...live].filter((r) => r.change24hPct != null).sort((a, b) => Math.abs(b.change24hPct!) - Math.abs(a.change24hPct!)).slice(0, 4);
  const vols = [...live].filter((r) => (r.volumeRatio ?? 0) >= 1.5).sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0)).slice(0, 4);
  return {
    assets: rows.length, withData: live.length,
    status: live.length === 0 ? "LIVE DATA UNAVAILABLE" : live.every((r) => r.freshness === "live") ? "LIVE" : live.some((r) => r.freshness === "live") ? "LIVE + DELAYED FEEDS" : "DELAYED / CLOSED FEEDS",
    trend, volatility, sentiment,
    topMovers: movers.map((r) => `${r.asset.display} ${r.change24hPct! > 0 ? "+" : ""}${r.change24hPct!.toFixed(2)}%`),
    highVolume: vols.map((r) => `${r.asset.display} ${r.volumeRatio!.toFixed(1)}× avg`),
    noTradeConditions,
  };
}
