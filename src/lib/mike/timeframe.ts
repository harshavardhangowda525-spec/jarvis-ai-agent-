import type { Bias, Candle, Level, Regime, RegimeId, ScanEvent, Snapshot, StructureEvent, StructurePoint, TfAnalysis, Timeframe, VolState, Freshness } from "./types";
import { TF_MS } from "./types";
import { computeIndicators, percentile, slope, trueRange, type Indicators } from "./indicators";
import { fmtPrice } from "./format";

/**
 * One timeframe, analysed "as of" a bar. `prepare` computes the indicator
 * series and structure once; `analyzeAt(prep, i)` only looks at bars 0…i and
 * at swing points already CONFIRMED by bar i — so the live analysis and the
 * backtest share exactly the same logic with no look-ahead.
 */

const PIVOT = 3; // bars each side of a swing point
const LEVEL_LOOKBACK = 180;

export interface Prepared {
  timeframe: Timeframe;
  candles: Candle[];
  ind: Indicators;
  tr: number[];
  swings: (StructurePoint & { confirmedAt: number })[];
  events: StructureEvent[];
  hasVolume: boolean;
}

export function prepare(candles: Candle[], timeframe: Timeframe, hasVolume = true): Prepared {
  const ind = computeIndicators(candles, TF_MS[timeframe] < 86_400_000);
  const swings = findSwings(candles);
  return { timeframe, candles, ind, tr: trueRange(candles), swings, events: structureEvents(candles, swings), hasVolume };
}

function findSwings(c: Candle[]) {
  const out: (StructurePoint & { confirmedAt: number })[] = [];
  for (let i = PIVOT; i < c.length - PIVOT; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - PIVOT; j <= i + PIVOT; j++) {
      if (j === i) continue;
      if (c[j].h >= c[i].h) isHigh = false;
      if (c[j].l <= c[i].l) isLow = false;
    }
    if (isHigh) out.push({ i, t: c[i].t, price: c[i].h, type: "high", confirmedAt: i + PIVOT });
    if (isLow) out.push({ i, t: c[i].t, price: c[i].l, type: "low", confirmedAt: i + PIVOT });
  }
  // HH/LH and HL/LL relative to the previous swing of the same type
  let lastH: number | null = null, lastL: number | null = null;
  for (const s of out) {
    if (s.type === "high") { if (lastH != null) s.label = s.price > lastH ? "HH" : "LH"; lastH = s.price; }
    else { if (lastL != null) s.label = s.price > lastL ? "HL" : "LL"; lastL = s.price; }
  }
  return out;
}

/** Break of structure / change of character, each dated at the bar that closed through the level. */
function structureEvents(c: Candle[], swings: (StructurePoint & { confirmedAt: number })[]): StructureEvent[] {
  const out: StructureEvent[] = [];
  let k = 0;
  let hi: { price: number; broken: boolean } | null = null, lo: { price: number; broken: boolean } | null = null;
  let state: "up" | "down" | null = null;
  for (let j = 0; j < c.length; j++) {
    while (k < swings.length && swings[k].confirmedAt <= j) {
      const s = swings[k++];
      if (s.type === "high") hi = { price: s.price, broken: false }; else lo = { price: s.price, broken: false };
    }
    if (hi && !hi.broken && c[j].c > hi.price) {
      out.push({ i: j, t: c[j].t, price: hi.price, kind: state === "down" ? "CHoCH" : "BOS", dir: "bullish" });
      hi.broken = true; state = "up";
    } else if (lo && !lo.broken && c[j].c < lo.price) {
      out.push({ i: j, t: c[j].t, price: lo.price, kind: state === "up" ? "CHoCH" : "BOS", dir: "bearish" });
      lo.broken = true; state = "down";
    }
  }
  return out;
}

const num = (v: number, d = 0) => (Number.isFinite(v) ? v : d);

export function snapshotAt(p: Prepared, i: number): Snapshot {
  const { ind, candles: c } = p;
  const price = c[i].c;
  const prevClose = i > 0 ? c[i - 1].c : price;
  return {
    price,
    ema20: ind.ema20[i], ema50: ind.ema50[i], ema200: ind.ema200[i], sma50: ind.sma50[i],
    rsi: ind.rsi[i], macd: ind.macd.line[i], macdSignal: ind.macd.signal[i], macdHist: ind.macd.hist[i], macdHistPrev: i > 0 ? ind.macd.hist[i - 1] : NaN,
    atr: ind.atr[i], atrPct: ind.atrPct[i], atrPctile: percentile(ind.atrPct, i, 120),
    adx: ind.adx.adx[i], plusDI: ind.adx.plusDI[i], minusDI: ind.adx.minusDI[i],
    bbUpper: ind.bb.upper[i], bbMid: ind.bb.mid[i], bbLower: ind.bb.lower[i], bbWidthPctile: percentile(ind.bb.width, i, 120),
    vwap: ind.vwap[i], obvSlope: p.hasVolume ? slope(ind.obv, i, 10) : 0,
    stochK: ind.stoch.k[i], stochD: ind.stoch.d[i],
    volumeRatio: p.hasVolume && ind.volSma[i] > 0 ? c[i].v / ind.volSma[i] : NaN,
    changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
  };
}

/** Support / resistance: swing prices clustered within ~0.6 ATR, as of bar i. */
export function levelsAt(p: Prepared, i: number): { support: Level[]; resistance: Level[] } {
  const price = p.candles[i].c;
  const a = num(p.ind.atr[i], price * 0.01);
  const pts = p.swings.filter((s) => s.confirmedAt <= i && s.i >= i - LEVEL_LOOKBACK).map((s) => s.price).sort((x, y) => x - y);
  const clusters: { sum: number; n: number }[] = [];
  for (const x of pts) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(x - last.sum / last.n) <= a * 0.6) { last.sum += x; last.n++; }
    else clusters.push({ sum: x, n: 1 });
  }
  const levels = clusters.map((cl) => ({ price: cl.sum / cl.n, touches: cl.n }));
  const support = levels.filter((l) => l.price < price).sort((x, y) => y.price - x.price).slice(0, 4).map((l) => ({ ...l, kind: "support" as const }));
  const resistance = levels.filter((l) => l.price > price).sort((x, y) => x.price - y.price).slice(0, 4).map((l) => ({ ...l, kind: "resistance" as const }));
  return { support, resistance };
}

export function trendAt(p: Prepared, i: number): "up" | "down" | "range" {
  const conf = p.swings.filter((s) => s.confirmedAt <= i);
  const lastH = [...conf].reverse().find((s) => s.type === "high" && s.label);
  const lastL = [...conf].reverse().find((s) => s.type === "low" && s.label);
  if (!lastH || !lastL) return "range";
  if (lastH.label === "HH" && lastL.label === "HL") return "up";
  if (lastH.label === "LH" && lastL.label === "LL") return "down";
  return "range";
}

const REGIME_TEXT: Record<RegimeId, string> = {
  strong_bullish: "STRONG BULLISH TREND", weak_bullish: "WEAK BULLISH TREND",
  strong_bearish: "STRONG BEARISH TREND", weak_bearish: "WEAK BEARISH TREND", ranging: "SIDEWAYS / RANGING",
};

export function regimeAt(p: Prepared, i: number, s = snapshotAt(p, i), trend = trendAt(p, i)): Regime {
  const evidence: string[] = [];
  const adx = num(s.adx);
  const bull = s.price > s.ema50 && s.ema20 > s.ema50;
  const bear = s.price < s.ema50 && s.ema20 < s.ema50;
  const e50slope = slope(p.ind.ema50, i, 10);
  let id: RegimeId = "ranging";
  if (bull && adx >= 25 && (trend === "up" || e50slope > 0)) id = "strong_bullish";
  else if (bull && (adx >= 18 || trend === "up")) id = "weak_bullish";
  else if (bear && adx >= 25 && (trend === "down" || e50slope < 0)) id = "strong_bearish";
  else if (bear && (adx >= 18 || trend === "down")) id = "weak_bearish";
  evidence.push(`ADX ${adx.toFixed(1)} (${adx >= 25 ? "trending" : adx >= 18 ? "developing trend" : "no clear trend"})`);
  evidence.push(`Price ${s.price > s.ema50 ? "above" : "below"} EMA50, EMA20 ${s.ema20 > s.ema50 ? "above" : "below"} EMA50`);
  evidence.push(`Swing structure: ${trend === "up" ? "higher highs & higher lows" : trend === "down" ? "lower highs & lower lows" : "mixed"}`);
  const volatility: VolState = s.atrPctile >= 80 ? "high" : s.atrPctile <= 20 ? "low" : "normal";
  evidence.push(`ATR ${num(s.atrPct).toFixed(2)}% of price — ${Math.round(s.atrPctile)}th percentile of the last 120 bars`);
  // squeeze in the last 10 bars, then a close outside the prior 20-bar range
  let squeezed = false;
  for (let j = Math.max(0, i - 10); j <= i; j++) if (percentile(p.ind.bb.width, j, 120) <= 20) squeezed = true;
  const { hi, lo } = rangeBefore(p.candles, i, 20);
  const breakout = squeezed && (s.price > hi || s.price < lo);
  if (breakout) evidence.push("Volatility squeeze followed by a close outside the 20-bar range");
  const reversal = p.events.some((e) => e.kind === "CHoCH" && e.i <= i && e.i >= i - 8);
  if (reversal) evidence.push("Change of character within the last 8 bars");
  const label = [REGIME_TEXT[id], volatility === "high" ? "HIGH VOLATILITY" : volatility === "low" ? "LOW VOLATILITY" : null, breakout ? "BREAKOUT" : null, reversal ? "REVERSAL RISK" : null]
    .filter(Boolean).join(" · ");
  return { id, volatility, breakout, reversal, label, evidence };
}

function rangeBefore(c: Candle[], i: number, n: number) {
  let hi = -Infinity, lo = Infinity;
  for (let j = Math.max(0, i - n); j < i; j++) { hi = Math.max(hi, c[j].h); lo = Math.min(lo, c[j].l); }
  return { hi, lo };
}

/** Everything MIKE knows about one timeframe as of bar i. */
export function analyzeAt(p: Prepared, i: number, freshness: Freshness = "live"): TfAnalysis {
  const s = snapshotAt(p, i);
  const trend = trendAt(p, i);
  const regime = regimeAt(p, i, s, trend);
  const { support, resistance } = levelsAt(p, i);
  const evidence: string[] = [];
  let score = 0, max = 0;
  const vote = (w: number, v: number, why: string) => { max += w; score += w * v; if (v !== 0) evidence.push(why); };

  vote(2, trend === "up" ? 1 : trend === "down" ? -1 : 0, `Structure: ${trend === "up" ? "HH/HL (bullish)" : "LH/LL (bearish)"}`);
  const emaUp = s.price > s.ema20 && s.ema20 > s.ema50, emaDn = s.price < s.ema20 && s.ema20 < s.ema50;
  vote(2, emaUp ? 1 : emaDn ? -1 : 0, `EMAs stacked ${emaUp ? "bullish (price > EMA20 > EMA50)" : "bearish (price < EMA20 < EMA50)"}`);
  if (Number.isFinite(s.ema200)) vote(1, s.price > s.ema200 ? 1 : -1, `Price ${s.price > s.ema200 ? "above" : "below"} EMA200 (${fmtPrice(s.ema200)})`);
  const mh = num(s.macdHist), mp = num(s.macdHistPrev);
  vote(1, mh > 0 && mh >= mp ? 1 : mh < 0 && mh <= mp ? -1 : 0, `MACD histogram ${mh > 0 ? "positive and rising" : "negative and falling"}`);
  const r = num(s.rsi, 50);
  vote(1, r >= 55 ? 1 : r <= 45 ? -1 : 0, `RSI ${r.toFixed(1)} (${r >= 55 ? "bullish momentum" : "bearish momentum"})`);
  if (num(s.adx) >= 20) vote(1, s.plusDI > s.minusDI ? 1 : -1, `+DI ${num(s.plusDI).toFixed(1)} vs −DI ${num(s.minusDI).toFixed(1)} with ADX ${num(s.adx).toFixed(1)}`);
  if (p.hasVolume) vote(1, s.obvSlope > 0.02 ? 1 : s.obvSlope < -0.02 ? -1 : 0, `On-balance volume ${s.obvSlope > 0 ? "rising" : "falling"}`);
  if (Number.isFinite(s.vwap)) vote(1, s.price > s.vwap ? 1 : -1, `Price ${s.price > s.vwap ? "above" : "below"} VWAP (${fmtPrice(s.vwap)})`);

  const norm = max ? Math.round((score / max) * 100) : 0;
  const bias: Bias = norm >= 25 ? "bullish" : norm <= -25 ? "bearish" : "neutral";
  return {
    timeframe: p.timeframe, bias, score: norm, trend, regime, snapshot: s, support, resistance,
    swings: p.swings.filter((x) => x.confirmedAt <= i).slice(-12).map(({ confirmedAt: _c, ...x }) => x),
    events: p.events.filter((e) => e.i <= i).slice(-6),
    scanEvents: scanEventsAt(p, i, s, regime, support, resistance),
    evidence, freshness, bars: i + 1,
  };
}

function scanEventsAt(p: Prepared, i: number, s: Snapshot, regime: Regime, support: Level[], resistance: Level[]): ScanEvent[] {
  const out: ScanEvent[] = [];
  const c = p.candles;
  const a = num(s.atr, s.price * 0.01);
  if (regime.id === "strong_bullish" || regime.id === "strong_bearish") out.push("strong_trend");
  if (p.events.some((e) => e.kind === "CHoCH" && e.i >= i - 5 && e.i <= i)) out.push("trend_reversal");
  const { hi, lo } = rangeBefore(c, i, 20);
  if (s.price > hi) out.push("breakout");
  if (s.price < lo) out.push("breakdown");
  if (Number.isFinite(hi) && (hi - lo) / a < 4 && s.bbWidthPctile < 25) out.push("consolidation");
  const ns = support[0], nr = resistance[0];
  if (ns && s.price - ns.price < a * 0.5) out.push("near_support");
  if (nr && nr.price - s.price < a * 0.5) out.push("near_resistance");
  if ([ns, nr].some((l) => l && l.touches >= 2 && Math.abs(l.price - s.price) < a)) out.push("liquidity_zone");
  if (s.volumeRatio >= 2) out.push("volume_spike");
  if (i > 0 && p.tr[i] > 2 * num(p.ind.atr[i - 1], Infinity)) out.push("volatility_expansion");
  const h = p.ind.macd.hist;
  if (i > 2 && Math.sign(h[i]) !== Math.sign(h[i - 2]) && Number.isFinite(h[i - 2])) out.push("momentum_shift");
  // return z-score over the last 50 bars
  if (i > 51) {
    const rets: number[] = [];
    for (let j = i - 50; j < i; j++) rets.push((c[j].c - c[j - 1].c) / c[j - 1].c);
    const mean = rets.reduce((x, y) => x + y, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((x, y) => x + (y - mean) ** 2, 0) / rets.length);
    const now = (c[i].c - c[i - 1].c) / c[i - 1].c;
    if (sd > 0 && Math.abs((now - mean) / sd) >= 3) out.push("unusual_activity");
  }
  return out;
}
