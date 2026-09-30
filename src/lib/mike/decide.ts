import type {
  Bias, Check, CheckId, CheckState, Confidence, Direction, External, Freshness, MikeSettings, SentimentId,
  TfAnalysis, Target, Timeframe, TradeSetup,
} from "./types";
import { CHECK_LABEL, CHECK_WEIGHT, TF_LABEL, tierOf } from "./types";
import { fibExtension } from "./indicators";
import { fmtPrice, round } from "./format";

/**
 * The signal-validation engine. A setup exists only when several INDEPENDENT
 * confirmations agree; one indicator reading is never enough. Anything that
 * conflicts — or can't be verified — produces NO TRADE with the reasons.
 */

export const MIN_BARS = 210;

export interface AlignmentRow { timeframe: Timeframe; bias: Bias; score: number; role: "context" | "setup" | "entry" }

export interface DecideInput {
  primary: TfAnalysis;
  alignment: AlignmentRow[];
  hasVolume: boolean;
  freshness: Freshness;
  external: External | null;
  settings: Pick<MikeSettings, "minConfidence" | "minRiskReward">;
  mode: "mtf" | "single";
}

export interface Decision {
  direction: Direction | null;
  checks: Check[];
  confidence: Confidence;
  setup: TradeSetup | null;
  decision: "setup" | "no_trade";
  noTradeReasons: string[];
}

const W = { context: 1.5, setup: 2, entry: 1 } as const;
const sgn = (b: Bias) => (b === "bullish" ? 1 : b === "bearish" ? -1 : 0);
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);

/** Weighted direction across timeframes: −1 … 1. */
export function directionScore(rows: AlignmentRow[]): number {
  let s = 0, w = 0;
  for (const r of rows) { const k = r.role === "context" ? W.context : r.role === "setup" ? W.setup : W.entry; s += k * sgn(r.bias); w += k; }
  return w ? s / w : 0;
}

export function buildSetup(p: TfAnalysis, direction: Direction): TradeSetup {
  const s = p.snapshot;
  const d = direction === "long" ? 1 : -1;
  const a = fin(s.atr, s.price * 0.01);
  const price = s.price;
  const entryHigh = direction === "long" ? price : price + 0.35 * a;
  const entryLow = direction === "long" ? price - 0.35 * a : price;
  const mid = (entryHigh + entryLow) / 2;
  // structural stop: beyond the most recent swing on the other side
  const swing = [...p.swings].reverse().find((x) => (direction === "long" ? x.type === "low" && x.price < entryLow : x.type === "high" && x.price > entryHigh));
  let stop: number, stopBasis: string;
  const structural = swing ? swing.price - d * 0.2 * a : null;
  const dist = structural != null ? Math.abs(mid - structural) : Infinity;
  if (structural != null && dist <= 3 * a && dist >= 0.8 * a) { stop = structural; stopBasis = `beyond the swing ${direction === "long" ? "low" : "high"} at ${fmtPrice(swing!.price)} (+0.2 ATR buffer)`; }
  else if (structural != null && dist < 0.8 * a) { stop = mid - d * 0.8 * a; stopBasis = `0.8 ATR from entry (the swing ${direction === "long" ? "low" : "high"} at ${fmtPrice(swing!.price)} is too close for a structural stop)`; }
  else { stop = mid - d * 1.5 * a; stopBasis = "1.5 ATR from entry (no nearby swing point)"; }
  const risk = Math.abs(mid - stop);

  const cands: { price: number; basis: string }[] = [];
  for (const l of direction === "long" ? p.resistance : p.support) cands.push({ price: l.price, basis: `${direction === "long" ? "resistance" : "support"} (${l.touches} touch${l.touches === 1 ? "" : "es"})` });
  const lastHi = [...p.swings].reverse().find((x) => x.type === "high"), lastLo = [...p.swings].reverse().find((x) => x.type === "low");
  if (lastHi && lastLo) {
    const [from, to] = direction === "long" ? [lastLo.price, lastHi.price] : [lastHi.price, lastLo.price];
    if ((to - from) * d > 0) for (const f of fibExtension(from, to)) cands.push({ price: f.price, basis: `Fibonacci ${f.ratio} extension` });
  }
  const rrOf = (x: number) => ((x - mid) * d) / risk;
  const pool = cands.map((c) => ({ ...c, rr: rrOf(c.price) })).filter((c) => c.rr > 0).sort((x, y) => x.rr - y.rr);
  const pick = (minRr: number, fallbackRr: number): Target => {
    const c = pool.find((x) => x.rr >= minRr);
    if (c && c.rr <= minRr + 2.5) return { price: c.price, basis: c.basis, rr: round(c.rr, 2) };
    return { price: mid + d * fallbackRr * risk, basis: `${fallbackRr}R measured move`, rr: fallbackRr };
  };
  const t1 = pick(1.2, 1.5);
  const t2 = pick(Math.max(2, t1.rr + 0.6), Math.max(2.5, round(t1.rr + 1, 1)));
  const t3 = pick(t2.rr + 0.8, round(t2.rr + 1.2, 1));
  const invalidationLevel = swing ? swing.price : stop;
  return {
    direction, entryLow, entryHigh, stop, stopBasis,
    targets: [t1, t2, t3],
    riskReward: round(t2.rr, 2),
    invalidation: `A ${TF_LABEL[p.timeframe]} close ${direction === "long" ? "below" : "above"} ${fmtPrice(invalidationLevel)}${p.regime.reversal ? "" : `, or a ${direction === "long" ? "bearish" : "bullish"} change of character`}`,
  };
}

export function runChecks(inp: DecideInput, direction: Direction, setup: TradeSetup): Check[] {
  const p = inp.primary, s = p.snapshot;
  const d = direction === "long" ? 1 : -1;
  const want: Bias = direction === "long" ? "bullish" : "bearish";
  const out: Check[] = [];
  const add = (id: CheckId, state: CheckState, detail: string) => out.push({ id, state, detail });

  // 1. structure
  const lastEv = [...p.events].reverse().find((e) => e.i >= p.bars - 11);
  const trendDir = p.trend === "up" ? 1 : p.trend === "down" ? -1 : 0;
  if (trendDir === d || (lastEv && sgn(lastEv.dir) === d)) add("structure", "pass", lastEv && sgn(lastEv.dir) === d ? `${lastEv.kind} ${lastEv.dir} through ${fmtPrice(lastEv.price)}` : `${p.trend === "up" ? "Higher highs and higher lows" : "Lower highs and lower lows"}`);
  else if (trendDir === -d || (lastEv && sgn(lastEv.dir) === -d)) add("structure", "fail", `Structure points the other way (${lastEv ? `${lastEv.kind} ${lastEv.dir}` : p.trend === "up" ? "HH/HL" : "LH/LL"})`);
  else add("structure", "neutral", "Swing structure is mixed — no clean HH/HL or LH/LL sequence");

  // 2. trend
  const stackUp = s.price > s.ema20 && s.ema20 > s.ema50, stackDn = s.price < s.ema20 && s.ema20 < s.ema50;
  const adx = fin(s.adx);
  if ((d === 1 ? stackUp : stackDn) && adx >= 20) add("trend", "pass", `EMAs stacked ${want} and ADX ${adx.toFixed(1)}`);
  else if (d === 1 ? stackDn : stackUp) add("trend", "fail", `EMAs stacked against the ${direction} (price ${d === 1 ? "below" : "above"} EMA20 & EMA50)`);
  else add("trend", "neutral", `Trend not confirmed (ADX ${adx.toFixed(1)}, EMAs not fully stacked)`);

  // 3. momentum
  const rsi = fin(s.rsi, 50), mh = fin(s.macdHist);
  const over = d === 1 ? rsi > 75 : rsi < 25;
  if (mh * d > 0 && (d === 1 ? rsi > 50 : rsi < 50) && !over) add("momentum", "pass", `MACD histogram ${d === 1 ? "positive" : "negative"}, RSI ${rsi.toFixed(1)}`);
  else if (mh * d < 0 && (d === 1 ? rsi < 50 : rsi > 50)) add("momentum", "fail", `Momentum against the ${direction}: MACD histogram ${mh > 0 ? "positive" : "negative"}, RSI ${rsi.toFixed(1)}`);
  else add("momentum", "neutral", over ? `RSI ${rsi.toFixed(1)} is stretched (${d === 1 ? "overbought" : "oversold"})` : `Momentum mixed (RSI ${rsi.toFixed(1)})`);

  // 4. volume
  if (!inp.hasVolume) add("volume", "unavailable", "This feed has no traded volume for the asset");
  else if (s.obvSlope * d > 0.02 || (s.volumeRatio >= 1.2 && Math.sign(s.changePct) === d)) add("volume", "pass", `OBV ${s.obvSlope * d > 0.02 ? "confirms" : "flat"}; last bar ${fin(s.volumeRatio, 1).toFixed(1)}× average volume`);
  else if (s.obvSlope * d < -0.05) add("volume", "fail", "On-balance volume is moving against the direction (distribution)");
  else add("volume", "neutral", `No volume confirmation (${fin(s.volumeRatio, 1).toFixed(1)}× average)`);

  // 5. volatility
  if (s.atrPctile >= 97) add("volatility", "fail", `Abnormal volatility — ATR at the ${Math.round(s.atrPctile)}th percentile`);
  else if (s.atrPctile <= 3) add("volatility", "neutral", "Volatility unusually compressed — moves may not follow through");
  else add("volatility", "pass", `ATR ${fin(s.atrPct).toFixed(2)}% (${Math.round(s.atrPctile)}th percentile) — tradable`);

  // 6. support / resistance: room to the first opposing level
  const mid = (setup.entryLow + setup.entryHigh) / 2, risk = Math.abs(mid - setup.stop);
  const opp = (d === 1 ? p.resistance : p.support)[0];
  const room = opp ? (Math.abs(opp.price - mid)) / risk : Infinity;
  if (room >= 1.5) add("levels", "pass", opp ? `First ${d === 1 ? "resistance" : "support"} ${fmtPrice(opp.price)} is ${room.toFixed(1)}R away` : "No opposing level nearby (clear air)");
  else if (room < 1) add("levels", "fail", `${d === 1 ? "Resistance" : "Support"} at ${fmtPrice(opp!.price)} is only ${room.toFixed(1)}R away`);
  else add("levels", "neutral", `${d === 1 ? "Resistance" : "Support"} at ${fmtPrice(opp!.price)} is ${room.toFixed(1)}R away`);

  // 7. multi-timeframe
  if (inp.mode === "single" || inp.alignment.length < 2) add("mtf", "unavailable", "Single-timeframe analysis");
  else {
    let agree = 0, total = 0;
    const against: string[] = [];
    for (const r of inp.alignment) {
      const k = r.role === "context" ? W.context : r.role === "setup" ? W.setup : W.entry;
      total += k;
      if (sgn(r.bias) === d) agree += k;
      if (r.role === "context" && sgn(r.bias) === -d && Math.abs(r.score) >= 40) against.push(`${TF_LABEL[r.timeframe]} ${r.bias}`);
    }
    const share = agree / total;
    if (against.length || share < 0.5) add("mtf", "fail", against.length ? `Higher timeframe against: ${against.join(", ")}` : `Only ${Math.round(share * 100)}% of the timeframe weight agrees`);
    else if (share >= 0.7) add("mtf", "pass", `${Math.round(share * 100)}% of the timeframe weight agrees`);
    else add("mtf", "neutral", `${Math.round(share * 100)}% of the timeframe weight agrees`);
  }

  // 8. context (news / sentiment)
  const ex = inp.external;
  if (!ex || !ex.available) add("context", "unavailable", ex?.note ?? "No news source connected");
  else {
    const ns = ex.newsSentiment;
    const nsDir = ns === "bullish" || ns === "extremely_bullish" ? 1 : ns === "bearish" || ns === "extremely_bearish" ? -1 : 0;
    if (nsDir === -d) add("context", "fail", `Recent news tone is ${ns?.replace("_", " ")} — against the ${direction}`);
    else if (ex.eventRisk.length) add("context", "neutral", `Event risk: ${ex.eventRisk.slice(0, 2).join("; ")}`);
    else add("context", "pass", ns ? `News tone ${ns.replace("_", " ")}, no flagged event risk` : "No conflicting news found");
  }
  return out;
}

export function scoreChecks(checks: Check[], freshness: Freshness, reversalAgainst: boolean): Confidence {
  let earned = 0, avail = 0, missing = 0;
  const breakdown = checks.map((c) => {
    const w = CHECK_WEIGHT[c.id];
    const e = c.state === "pass" ? w : c.state === "neutral" ? w / 2 : 0;
    if (c.state === "unavailable") missing += w; else { avail += w; earned += e; }
    return { id: c.id, weight: w, earned: c.state === "unavailable" ? 0 : e, state: c.state };
  });
  let score = avail ? (earned / avail) * 100 : 0;
  const adjustments: string[] = [];
  if (missing) { score -= missing / 2; adjustments.push(`−${missing / 2}: evidence unavailable (${checks.filter((c) => c.state === "unavailable").map((c) => CHECK_LABEL[c.id].toLowerCase()).join(", ")})`); }
  if (freshness === "delayed") { score -= 5; adjustments.push("−5: price feed may be delayed"); }
  if (freshness === "closed") { score -= 10; adjustments.push("−10: market closed — levels apply from the next session"); }
  if (reversalAgainst) { score -= 5; adjustments.push("−5: recent change of character against the direction"); }
  const final = Math.max(0, Math.min(100, Math.round(score)));
  return { score: final, tier: tierOf(final), breakdown, adjustments };
}

export function decide(inp: DecideInput): Decision {
  const empty: Confidence = { score: 0, tier: "no_trade", breakdown: [], adjustments: [] };
  const p = inp.primary;
  if (inp.freshness === "unavailable") return { direction: null, checks: [], confidence: empty, setup: null, decision: "no_trade", noTradeReasons: ["LIVE DATA UNAVAILABLE — nothing to analyse"] };
  if (p.bars < MIN_BARS) return { direction: null, checks: [], confidence: empty, setup: null, decision: "no_trade", noTradeReasons: [`DATA INCOMPLETE — only ${p.bars} bars (MIKE needs ${MIN_BARS})`] };

  const ds = directionScore(inp.alignment.length ? inp.alignment : [{ timeframe: p.timeframe, bias: p.bias, score: p.score, role: "setup" }]);
  if (Math.abs(ds) < 0.3) {
    const conflict = inp.alignment.some((r) => r.bias === "bullish") && inp.alignment.some((r) => r.bias === "bearish");
    return {
      direction: null, checks: [], confidence: empty, setup: null, decision: "no_trade",
      noTradeReasons: [conflict ? "TIMEFRAME CONFLICT — timeframes point in different directions" : "MARKET STRUCTURE UNCLEAR — no directional edge", ...(inp.freshness === "stale" ? ["DATA NOT CURRENT — the newest bar is too old to verify"] : [])],
    };
  }
  const direction: Direction = ds > 0 ? "long" : "short";
  const setup = buildSetup(p, direction);
  const checks = runChecks(inp, direction, setup);
  const reversalAgainst = p.regime.reversal && p.events.length > 0 && sgn(p.events[p.events.length - 1].dir) === (direction === "long" ? -1 : 1);
  const confidence = scoreChecks(checks, inp.freshness, reversalAgainst);

  const reasons: string[] = [];
  const st = (id: CheckId) => checks.find((c) => c.id === id)!;
  if (inp.freshness === "stale") reasons.push("DATA NOT CURRENT — the newest bar is too old to verify");
  if (st("mtf").state === "fail") reasons.push(`TIMEFRAME CONFLICT — ${st("mtf").detail}`);
  if (st("volatility").state === "fail") reasons.push(`ABNORMAL VOLATILITY — ${st("volatility").detail}`);
  if (st("context").state === "fail") reasons.push(`NEWS RISK — ${st("context").detail}`);
  if (st("structure").state === "fail") reasons.push(`STRUCTURE AGAINST — ${st("structure").detail}`);
  if (st("momentum").state === "fail") reasons.push(`WEAK MOMENTUM — ${st("momentum").detail}`);
  if (st("volume").state === "fail") reasons.push(`LOW VOLUME — ${st("volume").detail}`);
  if (st("levels").state === "fail") reasons.push(`NO ROOM — ${st("levels").detail}`);
  const fails = checks.filter((c) => c.state === "fail");
  if (fails.length >= 2 && !reasons.some((r) => r.startsWith("CONFLICTING"))) reasons.push(`CONFLICTING CONFIRMATIONS — ${fails.length} checks failed`);
  if (setup.riskReward < inp.settings.minRiskReward) reasons.push(`POOR RISK/REWARD — 1:${setup.riskReward.toFixed(1)} is below your 1:${inp.settings.minRiskReward} minimum`);
  if (confidence.score < inp.settings.minConfidence) reasons.push(`INSUFFICIENT EVIDENCE — confidence ${confidence.score} is below ${inp.settings.minConfidence}`);

  return { direction, checks, confidence, setup, decision: reasons.length ? "no_trade" : "setup", noTradeReasons: reasons };
}

/** Price-based sentiment (from the charts themselves, not news). */
export function priceSentiment(rows: { timeframe: Timeframe; score: number; bias: Bias }[]): { price: SentimentId; evidence: string[] } {
  if (!rows.length) return { price: "neutral", evidence: ["No price data"] };
  const avg = rows.reduce((x, r) => x + r.score, 0) / rows.length;
  const price: SentimentId = avg >= 60 ? "extremely_bullish" : avg >= 25 ? "bullish" : avg <= -60 ? "extremely_bearish" : avg <= -25 ? "bearish" : "neutral";
  return { price, evidence: rows.map((r) => `${TF_LABEL[r.timeframe]} evidence score ${r.score > 0 ? "+" : ""}${r.score} (${r.bias})`) };
}
