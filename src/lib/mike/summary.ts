import type { MikeAnalysis } from "./types";
import { CHECK_LABEL, CONFIDENCE_NOTE, RISK_WARNING, TF_LABEL, TIER_LABEL } from "./types";
import { fmtPrice } from "./format";
import { marketRead } from "./market-read";

/**
 * Compact, structured views of an analysis: one for the AI brain (every number
 * it may quote, nothing it could mistake for more), one short line for voice.
 */

const FRESH_TEXT = {
  live: "LIVE (real-time exchange data)",
  delayed: "DELAYED — free feed, may lag the exchange; not verified real-time",
  closed: "MARKET CLOSED — last session's data",
  stale: "STALE — newest bar is too old to be treated as current",
  unavailable: "LIVE DATA UNAVAILABLE",
} as const;

export function compactAnalysis(a: MikeAnalysis) {
  const s = a.setup;
  return {
    signalId: a.id ?? null,
    asset: a.asset.display, exchange: a.asset.exchange, timeframe: TF_LABEL[a.timeframe], generatedAt: a.generatedAt,
    data: { source: a.data.source, status: FRESH_TEXT[a.data.freshness], note: a.data.note },
    PRICE_DATA: a.primary ? {
      lastClose: fmtPrice(a.primary.snapshot.price),
      marketRegime: a.regime.label,
      regimeEvidence: a.regime.evidence,
      multiTimeframeAlignment: a.alignment.map((r) => `${TF_LABEL[r.timeframe]} (${r.role}): ${r.bias} ${r.score > 0 ? "+" : ""}${r.score}`),
      indicators: {
        rsi14: round1(a.primary.snapshot.rsi), macdHist: sig(a.primary.snapshot.macdHist), adx14: round1(a.primary.snapshot.adx),
        ema20: fmtPrice(a.primary.snapshot.ema20), ema50: fmtPrice(a.primary.snapshot.ema50), ema200: fmtPrice(a.primary.snapshot.ema200),
        atr14: fmtPrice(a.primary.snapshot.atr), bollinger: `${fmtPrice(a.primary.snapshot.bbLower)} – ${fmtPrice(a.primary.snapshot.bbUpper)}`,
        vwap: fmtPrice(a.primary.snapshot.vwap), stochastic: `${round1(a.primary.snapshot.stochK)}/${round1(a.primary.snapshot.stochD)}`,
        volumeVsAverage: Number.isFinite(a.primary.snapshot.volumeRatio) ? `${a.primary.snapshot.volumeRatio.toFixed(2)}×` : "no volume data",
      },
      support: a.primary.support.map((l) => fmtPrice(l.price)),
      resistance: a.primary.resistance.map((l) => fmtPrice(l.price)),
      structure: a.primary.trend,
      recentStructureEvents: a.primary.events.slice(-3).map((e) => `${e.kind} ${e.dir} through ${fmtPrice(e.price)}`),
      priceSentiment: a.sentiment.price,
    } : null,
    EXTERNAL_INFORMATION: a.external.available
      ? { newsSentiment: a.external.newsSentiment, eventRisk: a.external.eventRisk, note: a.external.note, headlines: a.external.headlines.slice(0, 5).map((h) => ({ title: h.title, source: h.source, tone: h.tone, url: h.url })) }
      : { status: a.external.note },
    confirmations: a.checks.map((c) => `${c.state.toUpperCase()} · ${CHECK_LABEL[c.id]}: ${c.detail}`),
    confidence: { score: a.confidence.score, tier: TIER_LABEL[a.confidence.tier], adjustments: a.confidence.adjustments, meaning: CONFIDENCE_NOTE },
    decision: a.decision === "setup" ? "VALIDATED SETUP" : "NO TRADE",
    noTradeReasons: a.noTradeReasons,
    setup: a.decision === "setup" && s ? {
      direction: s.direction.toUpperCase(),
      entryZone: `${fmtPrice(s.entryLow)} – ${fmtPrice(s.entryHigh)}`,
      stopLoss: `${fmtPrice(s.stop)} (${s.stopBasis})`,
      targets: s.targets.map((t, i) => `T${i + 1} ${fmtPrice(t.price)} (${t.basis}, ${t.rr}R)`),
      riskReward: `1:${s.riskReward}`,
      invalidation: s.invalidation,
    } : null,
    risk: a.risk ? {
      riskPerTrade: `${a.risk.riskPct}% = ${a.risk.riskAmount} ${a.risk.currency}`,
      positionSize: a.risk.units ? `${a.risk.units} units (≈${a.risk.notional} ${a.risk.currency})` : "set account size to size the position",
      stopDistance: `${fmtPrice(a.risk.stopDistance)} (${a.risk.stopDistancePct}%)`,
      openRiskToday: `${a.risk.openRiskPct}% of ${a.risk.maxDailyRiskPct}% max`,
      warnings: a.risk.warnings,
    } : null,
    warning: RISK_WARNING,
  };
}

const round1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const sig = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(4)) : null);

/** One or two sentences MIKE says out loud. */
export function spokenSummary(a: MikeAnalysis): string {
  const name = a.asset.display.replace("/USDT", "").replace("/", " ");
  if (a.data.freshness === "unavailable") return `Live data for ${name} is unavailable, so there's no analysis. No trade.`;
  if (a.decision === "setup" && a.setup) {
    return `${name}, ${TF_LABEL[a.timeframe]}: validated ${a.setup.direction} setup. Entry ${fmtPrice(a.setup.entryLow)} to ${fmtPrice(a.setup.entryHigh)}, stop ${fmtPrice(a.setup.stop)}, risk to reward one to ${a.setup.riskReward}. Analysis confidence ${a.confidence.score} out of 100 — that's evidence quality, not a win probability.`;
  }
  const why = (a.noTradeReasons[0] ?? "insufficient evidence").split(" — ")[0].toLowerCase();
  const r = marketRead(a);
  const read = r ? ` ${r.lean.text.replace(" — ", ", ")}, at ${r.price}.${r.resistance[0] ? ` Resistance ${r.resistance[0].price}` : ""}${r.resistance[0] && r.support[0] ? "," : r.resistance[0] ? "." : ""}${r.support[0] ? ` support ${r.support[0].price}.` : ""}` : "";
  return `${name}, ${TF_LABEL[a.timeframe]}:${read} No high-conviction setup — main reason: ${why}. No trade for now.`;
}
