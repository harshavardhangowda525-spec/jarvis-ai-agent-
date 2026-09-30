import type { Candle, Direction, RegimeId, TfAnalysis, Timeframe } from "./types";
import { TF_MS } from "./types";
import { prepare, analyzeAt, type Prepared } from "./timeframe";
import { decide, MIN_BARS } from "./decide";
import { round } from "./format";

/**
 * The backtesting engine. It walks the history ONE BAR AT A TIME: the decision
 * at bar i sees only bars 0…i (the same causal analysis MIKE runs live), the
 * entry is the NEXT bar's open, and when a bar touches both the stop and the
 * target the stop is assumed first (the conservative reading). Results are
 * BACKTEST RESULTS — never live performance and never a promise.
 */

export type StrategyId = "mike" | "ema_cross" | "breakout" | "rsi_reversion";
export const STRATEGIES: Record<StrategyId, string> = {
  mike: "MIKE validation rules (single-timeframe replay, EMA200 as the higher-timeframe proxy)",
  ema_cross: "EMA 20/50 crossover, 1.5 ATR stop",
  breakout: "20-bar breakout with volume confirmation, 1.5 ATR stop",
  rsi_reversion: "RSI 30/70 reversal in ranging markets, 1.5 ATR stop",
};

export interface BacktestOptions {
  strategy: StrategyId;
  timeframe: Timeframe;
  /** Exit target for MIKE setups (1–3). Baseline strategies use `targetR`. */
  target?: 1 | 2 | 3;
  targetR?: number;
  maxHoldBars?: number;
  feeBps?: number;
  minConfidence?: number;
  minRiskReward?: number;
  riskPctPerTrade?: number;
  hasVolume?: boolean;
}

export interface BtTrade {
  direction: Direction;
  entryAt: number; exitAt: number;
  entry: number; exit: number; stop: number; target: number;
  r: number; pct: number; bars: number;
  mfeR: number; maeR: number;
  exitReason: "target" | "stop" | "time";
  regime: RegimeId;
  confidence: number | null;
}

export interface BacktestResult {
  kind: "BACKTEST";
  strategy: StrategyId; strategyLabel: string; timeframe: Timeframe;
  from: number | null; to: number | null; bars: number;
  totalTrades: number; wins: number; losses: number; winRate: number;
  avgWinR: number; avgLossR: number; avgWinPct: number; avgLossPct: number;
  profitFactor: number | null; expectancyR: number;
  maxDrawdownR: number; maxDrawdownPct: number; netR: number; netPct: number;
  sharpePerTrade: number | null;
  avgHoldingBars: number; avgHoldingHours: number;
  maxConsecutiveLosses: number;
  byRegime: { regime: RegimeId; trades: number; winRate: number; expectancyR: number }[];
  equityR: number[];
  trades: BtTrade[];
  notes: string[];
}

interface Signal { direction: Direction; stop: number; target: number; confidence: number | null }

function signalAt(p: Prepared, i: number, a: TfAnalysis, o: Required<Pick<BacktestOptions, "strategy" | "target" | "targetR" | "minConfidence" | "minRiskReward">>): Signal | null {
  const s = a.snapshot, c = p.candles;
  const atr = s.atr;
  if (!Number.isFinite(atr) || atr <= 0) return null;
  const fixed = (direction: Direction): Signal => {
    const d = direction === "long" ? 1 : -1;
    const stop = s.price - d * 1.5 * atr;
    return { direction, stop, target: s.price + d * o.targetR * 1.5 * atr, confidence: null };
  };
  switch (o.strategy) {
    case "mike": {
      // higher-timeframe proxy: price vs EMA200 and the EMA50 slope, as known at bar i
      const e200 = s.ema200, e50prev = p.ind.ema50[i - 10];
      const proxy = !Number.isFinite(e200) || !Number.isFinite(e50prev) ? "neutral"
        : s.price > e200 && s.ema50 > e50prev ? "bullish" : s.price < e200 && s.ema50 < e50prev ? "bearish" : "neutral";
      const d = decide({
        primary: a, freshness: "live", hasVolume: p.hasVolume, external: null, mode: "mtf",
        settings: { minConfidence: o.minConfidence, minRiskReward: o.minRiskReward },
        alignment: [
          { timeframe: p.timeframe, bias: proxy, score: proxy === "neutral" ? 0 : proxy === "bullish" ? 60 : -60, role: "context" },
          { timeframe: p.timeframe, bias: a.bias, score: a.score, role: "setup" },
        ],
      });
      if (d.decision !== "setup" || !d.setup) return null;
      return { direction: d.setup.direction, stop: d.setup.stop, target: d.setup.targets[o.target - 1].price, confidence: d.confidence.score };
    }
    case "ema_cross": {
      const up = p.ind.ema20[i] > p.ind.ema50[i] && p.ind.ema20[i - 1] <= p.ind.ema50[i - 1];
      const dn = p.ind.ema20[i] < p.ind.ema50[i] && p.ind.ema20[i - 1] >= p.ind.ema50[i - 1];
      return up ? fixed("long") : dn ? fixed("short") : null;
    }
    case "breakout": {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - 20; j < i; j++) { hi = Math.max(hi, c[j].h); lo = Math.min(lo, c[j].l); }
      const volOk = !p.hasVolume || s.volumeRatio >= 1.2;
      return s.price > hi && volOk ? fixed("long") : s.price < lo && volOk ? fixed("short") : null;
    }
    case "rsi_reversion": {
      if (a.regime.id !== "ranging") return null;
      const r = p.ind.rsi[i], rp = p.ind.rsi[i - 1];
      return rp < 30 && r >= 30 ? fixed("long") : rp > 70 && r <= 70 ? fixed("short") : null;
    }
  }
}

export function backtest(candles: Candle[], opts: BacktestOptions): BacktestResult {
  const o = {
    strategy: opts.strategy, target: opts.target ?? 2, targetR: opts.targetR ?? 2, maxHold: opts.maxHoldBars ?? 100,
    fee: (opts.feeBps ?? 5) / 10_000, minConfidence: opts.minConfidence ?? 70, minRiskReward: opts.minRiskReward ?? 2,
    riskPct: opts.riskPctPerTrade ?? 1,
  };
  const p = prepare(candles, opts.timeframe, opts.hasVolume ?? candles.some((x) => x.v > 0));
  const trades: BtTrade[] = [];
  const warm = Math.max(MIN_BARS, 60);
  let pos: (Signal & { entry: number; entryIdx: number; risk: number; mfe: number; mae: number; regime: RegimeId }) | null = null;

  for (let i = warm; i < candles.length; i++) {
    const bar = candles[i];
    if (pos) {
      const d = pos.direction === "long" ? 1 : -1;
      // adverse / favourable excursion inside this bar
      pos.mfe = Math.max(pos.mfe, ((d === 1 ? bar.h : bar.l) - pos.entry) * d);
      pos.mae = Math.max(pos.mae, ((d === 1 ? pos.entry - bar.l : bar.h - pos.entry)));
      const hitStop = d === 1 ? bar.l <= pos.stop : bar.h >= pos.stop;
      const hitTarget = d === 1 ? bar.h >= pos.target : bar.l <= pos.target;
      let exit: number | null = null, reason: BtTrade["exitReason"] = "time";
      if (hitStop) { exit = d === 1 ? Math.min(pos.stop, bar.o) : Math.max(pos.stop, bar.o); reason = "stop"; } // gaps fill at the open
      else if (hitTarget) { exit = d === 1 ? Math.max(pos.target, bar.o) : Math.min(pos.target, bar.o); reason = "target"; }
      else if (i - pos.entryIdx + 1 >= o.maxHold) { exit = bar.c; reason = "time"; }
      if (exit != null) {
        const gross = (exit - pos.entry) * d;
        const fees = (pos.entry + exit) * o.fee;
        trades.push({
          direction: pos.direction, entryAt: candles[pos.entryIdx].t, exitAt: bar.t, entry: pos.entry, exit, stop: pos.stop, target: pos.target,
          r: round((gross - fees) / pos.risk, 3), pct: round(((gross - fees) / pos.entry) * 100, 3), bars: i - pos.entryIdx + 1,
          mfeR: round(pos.mfe / pos.risk, 2), maeR: round(pos.mae / pos.risk, 2), exitReason: reason, regime: pos.regime, confidence: pos.confidence,
        });
        pos = null;
      }
      continue; // one position at a time; no new entry on the exit bar
    }
    if (i >= candles.length - 1) break;
    const a = analyzeAt(p, i);
    const sig = signalAt(p, i, a, o);
    if (!sig) continue;
    const entry = candles[i + 1].o; // decided at the close of i, filled at the next open
    const d = sig.direction === "long" ? 1 : -1;
    const risk = (entry - sig.stop) * d;
    if (risk <= 0 || (sig.target - entry) * d <= 0) continue; // the gap already passed the stop or the target
    pos = { ...sig, entry, entryIdx: i + 1, risk, mfe: 0, mae: 0, regime: a.regime.id };
  }
  return stats(trades, candles, opts, o.riskPct);
}

function stats(trades: BtTrade[], candles: Candle[], opts: BacktestOptions, riskPct: number): BacktestResult {
  const wins = trades.filter((t) => t.r > 0), losses = trades.filter((t) => t.r <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const rs = trades.map((t) => t.r);
  let eq = 0, peak = 0, maxDd = 0, eqPct = 1, peakPct = 1, maxDdPct = 0, streak = 0, maxStreak = 0;
  const equityR: number[] = [];
  for (const r of rs) {
    eq += r; peak = Math.max(peak, eq); maxDd = Math.max(maxDd, peak - eq); equityR.push(round(eq, 2));
    eqPct *= 1 + (r * riskPct) / 100; peakPct = Math.max(peakPct, eqPct); maxDdPct = Math.max(maxDdPct, (peakPct - eqPct) / peakPct);
    streak = r <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak);
  }
  const sd = rs.length > 1 ? Math.sqrt(rs.reduce((a, r) => a + (r - mean(rs)) ** 2, 0) / (rs.length - 1)) : 0;
  const grossWin = wins.reduce((a, t) => a + t.r, 0), grossLoss = -losses.reduce((a, t) => a + t.r, 0);
  const regimes = [...new Set(trades.map((t) => t.regime))];
  const notes = [
    "BACKTEST RESULTS — simulated on historical data; not live performance and not a guarantee of future results.",
    "Decisions use only bars available at the time; entries fill at the next bar's open; a bar touching both stop and target counts as a stop.",
    `Fees/slippage: ${opts.feeBps ?? 5} bps per side. Position risk ${riskPct}% per trade for the % figures.`,
  ];
  if (opts.strategy === "mike") notes.push("MIKE replay: news context isn't replayed and the higher timeframe is approximated — live MIKE uses real higher-timeframe data.");
  if (trades.length < 30) notes.push(`Only ${trades.length} trades — too few to judge the strategy reliably.`);
  return {
    kind: "BACKTEST", strategy: opts.strategy, strategyLabel: STRATEGIES[opts.strategy], timeframe: opts.timeframe,
    from: candles[0]?.t ?? null, to: candles.at(-1)?.t ?? null, bars: candles.length,
    totalTrades: trades.length, wins: wins.length, losses: losses.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100, 1) : 0,
    avgWinR: round(mean(wins.map((t) => t.r)), 2), avgLossR: round(mean(losses.map((t) => t.r)), 2),
    avgWinPct: round(mean(wins.map((t) => t.pct)), 2), avgLossPct: round(mean(losses.map((t) => t.pct)), 2),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : wins.length ? null : 0,
    expectancyR: round(mean(rs), 3),
    maxDrawdownR: round(maxDd, 2), maxDrawdownPct: round(maxDdPct * 100, 2),
    netR: round(eq, 2), netPct: round((eqPct - 1) * 100, 2),
    sharpePerTrade: rs.length >= 10 && sd > 0 ? round(mean(rs) / sd, 2) : null,
    avgHoldingBars: round(mean(trades.map((t) => t.bars)), 1),
    avgHoldingHours: round((mean(trades.map((t) => t.bars)) * TF_MS[opts.timeframe]) / 3_600_000, 1),
    maxConsecutiveLosses: maxStreak,
    byRegime: regimes.map((g) => {
      const ts = trades.filter((t) => t.regime === g);
      return { regime: g, trades: ts.length, winRate: round((ts.filter((t) => t.r > 0).length / ts.length) * 100, 1), expectancyR: round(mean(ts.map((t) => t.r)), 3) };
    }).sort((a, b) => b.trades - a.trades),
    equityR, trades: trades.slice(-200), notes,
  };
}
