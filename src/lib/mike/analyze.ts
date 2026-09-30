import "server-only";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import type { AssetRef, ChartData, Freshness, MikeAnalysis, MikeSettings, Series, TfAnalysis, Timeframe } from "./types";
import { DEFAULT_SETTINGS, TIMEFRAMES } from "./types";
import { closedBars, fetchSeries, type DataOpts } from "./data";
import { analyzeAt, prepare } from "./timeframe";
import { decide, priceSentiment, type AlignmentRow } from "./decide";
import { externalContext } from "./news";
import { riskPlan, type OpenRisk } from "./risk";

/**
 * MIKE's full analysis of one asset: fetch every timeframe in the ladder (real
 * data only), analyse each, check alignment, run the validation engine, size
 * the risk, and record the result in the signal journal.
 */

/** Context ladder: the setup timeframe, up to three above it and one below. */
const LADDER: Timeframe[] = ["1w", "1d", "4h", "1h", "15m", "5m", "1m"];
export function timeframePlan(tf: Timeframe): { timeframe: Timeframe; role: AlignmentRow["role"] }[] {
  const rank = (t: Timeframe) => TIMEFRAMES.indexOf(t);
  const higher = LADDER.filter((t) => rank(t) > rank(tf)).reverse().slice(0, 3).reverse();
  const lower = LADDER.find((t) => rank(t) < rank(tf));
  return [
    ...higher.map((t) => ({ timeframe: t, role: "context" as const })),
    { timeframe: tf, role: "setup" as const },
    ...(lower ? [{ timeframe: lower, role: "entry" as const }] : []),
  ];
}

// ---- settings ------------------------------------------------------------
const SETTINGS = "mike_settings";
export async function loadSettings(userId: string): Promise<MikeSettings> {
  const row = await getDb().integration.findUnique({ where: { userId_provider: { userId, provider: SETTINGS } }, select: { metadata: true } }).catch(() => null);
  return { ...DEFAULT_SETTINGS, ...((row?.metadata ?? {}) as Partial<MikeSettings>) };
}
export async function saveSettings(userId: string, patch: Partial<MikeSettings>): Promise<MikeSettings> {
  const next = { ...(await loadSettings(userId)), ...patch };
  await getDb().integration.upsert({
    where: { userId_provider: { userId, provider: SETTINGS } },
    create: { userId, provider: SETTINGS, status: "connected", metadata: next as unknown as Prisma.InputJsonValue },
    update: { metadata: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

/** Risk already open in the journal (setups not yet finished), for daily and correlation limits. */
export async function openRisk(userId: string): Promise<OpenRisk[]> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const rows = await getDb().mikeSignal.findMany({
    where: { userId, decision: "setup", status: { in: ["open", "triggered"] }, createdAt: { gte: since } },
    select: { asset: true, assetGroup: true, riskPct: true },
  });
  return rows.map((r) => ({ asset: r.asset, group: r.assetGroup, riskPct: r.riskPct ?? 0 }));
}

export interface AnalyzeOptions extends DataOpts {
  mode?: "mtf" | "single";
  settings?: MikeSettings;
  /** Include news context (default true). */
  news?: boolean;
  /** Record in the journal (default true). */
  journal?: boolean;
  /** Candles returned for the chart (default 180). */
  chartBars?: number;
}

const WORST: Freshness[] = ["unavailable", "stale", "closed", "delayed", "live"];
const worst = (a: Freshness, b: Freshness) => (WORST.indexOf(a) <= WORST.indexOf(b) ? a : b);

export async function analyzeAsset(userId: string, asset: AssetRef, timeframe: Timeframe, opts: AnalyzeOptions = {}): Promise<MikeAnalysis> {
  const mode = opts.mode ?? "mtf";
  const settings = opts.settings ?? await loadSettings(userId);
  const now = opts.now ?? Date.now();
  const plan = mode === "mtf" ? timeframePlan(timeframe) : [{ timeframe, role: "setup" as const }];

  const [seriesList, external] = await Promise.all([
    Promise.all(plan.map((p) => fetchSeries(asset, p.timeframe, opts))),
    opts.news === false ? Promise.resolve(null) : externalContext(asset, opts.fetchImpl ?? fetch),
  ]);
  const setupSeries = seriesList[plan.findIndex((p) => p.role === "setup")];

  const analyses: { plan: (typeof plan)[number]; series: Series; a: TfAnalysis | null }[] = plan.map((p, k) => {
    const s = seriesList[k];
    const bars = closedBars(s, now);
    if (bars.length < 30) return { plan: p, series: s, a: null };
    const prep = prepare(bars, p.timeframe, s.hasVolume);
    return { plan: p, series: s, a: analyzeAt(prep, bars.length - 1, s.freshness) };
  });
  const primaryEntry = analyses.find((x) => x.plan.role === "setup")!;
  const primary = primaryEntry.a;
  const alignment: AlignmentRow[] = analyses.filter((x) => x.a).map((x) => ({ timeframe: x.plan.timeframe, bias: x.a!.bias, score: x.a!.score, role: x.plan.role }));
  // Context timeframes that failed to load are a gap in the evidence, not a vote.
  const freshness = setupSeries.freshness;

  const base = {
    asset: setupSeries.asset, timeframe, generatedAt: new Date(now).toISOString(), mode,
    data: {
      source: setupSeries.source, freshness, note: setupSeries.note, lastBarAt: setupSeries.lastBarAt,
      perTimeframe: analyses.map((x) => ({ timeframe: x.plan.timeframe, freshness: x.series.freshness, bars: x.series.candles.length })),
    },
    external: external ?? { available: false, note: "News not requested.", headlines: [], newsSentiment: null, eventRisk: [] },
  };

  if (!primary) {
    const reason = setupSeries.freshness === "unavailable" ? `LIVE DATA UNAVAILABLE — ${setupSeries.note}` : `DATA INCOMPLETE — only ${setupSeries.candles.length} bars returned`;
    return {
      ...base, regime: { id: "ranging", volatility: "normal", breakout: false, reversal: false, label: "UNKNOWN — NO DATA", evidence: [] },
      alignment, primary: null, checks: [], direction: null,
      confidence: { score: 0, tier: "no_trade", breakdown: [], adjustments: [] },
      decision: "no_trade", setup: null, noTradeReasons: [reason], sentiment: { price: "neutral", evidence: [] }, risk: null, chart: null,
    };
  }

  const d = decide({
    primary, alignment, hasVolume: setupSeries.hasVolume, freshness,
    external: base.external, settings, mode,
  });
  const missingCtx = analyses.filter((x) => !x.a).map((x) => x.plan.timeframe);
  if (missingCtx.length) d.confidence.adjustments.push(`Timeframes without data (not counted): ${missingCtx.join(", ")}`);

  let risk = null;
  if (d.setup) risk = riskPlan(settings, d.setup, asset.group, await openRisk(userId).catch(() => []), setupSeries.asset.display);

  const analysis: MikeAnalysis = {
    ...base,
    regime: primary.regime,
    alignment, primary, checks: d.checks, direction: d.direction, confidence: d.confidence,
    decision: d.decision, setup: d.setup, noTradeReasons: d.noTradeReasons,
    sentiment: priceSentiment(alignment),
    risk: d.decision === "setup" ? risk : null,
    chart: chartData(setupSeries, primary, opts.chartBars ?? 180, now),
  };
  const weakest = analyses.reduce<Freshness>((w, x) => (x.a ? worst(w, x.series.freshness) : w), freshness);
  if (weakest !== freshness) d.confidence.adjustments.push(`Some timeframes are ${weakest} data`);

  if (opts.journal !== false) analysis.id = await journal(userId, analysis).catch((e) => { console.error("[mike] journal:", e); return undefined; });
  return analysis;
}

function chartData(series: Series, p: TfAnalysis, n: number, now: number): ChartData {
  const all = series.candles; // includes the forming bar (drawn, never analysed)
  const closed = closedBars(series, now);
  const prep = prepare(closed, series.timeframe, series.hasVolume);
  const start = Math.max(0, all.length - n);
  const cut = (arr: number[]): (number | null)[] => all.slice(start).map((_, k) => {
    const v = arr[start + k];
    return Number.isFinite(v) ? v : null;
  });
  return {
    candles: all.slice(start),
    ema20: cut(prep.ind.ema20), ema50: cut(prep.ind.ema50), ema200: cut(prep.ind.ema200),
    bbUpper: cut(prep.ind.bb.upper), bbLower: cut(prep.ind.bb.lower), vwap: cut(prep.ind.vwap), rsi: cut(prep.ind.rsi),
    swings: p.swings.map((s) => ({ ...s, i: s.i - start })).filter((s) => s.i >= 0),
    events: p.events.map((e) => ({ ...e, i: e.i - start })).filter((e) => e.i >= 0),
    support: p.support, resistance: p.resistance,
  };
}

async function journal(userId: string, a: MikeAnalysis): Promise<string> {
  const s = a.setup;
  const row = await getDb().mikeSignal.create({
    data: {
      userId, asset: a.asset.display, symbol: a.asset.symbol, provider: a.asset.provider, assetGroup: a.asset.group,
      timeframe: a.timeframe, mode: a.mode, decision: a.decision, direction: a.direction,
      status: a.decision === "setup" ? "open" : "no_trade",
      entryLow: a.decision === "setup" ? s?.entryLow : null, entryHigh: a.decision === "setup" ? s?.entryHigh : null,
      stop: a.decision === "setup" ? s?.stop : null,
      targets: a.decision === "setup" && s ? (s.targets as unknown as Prisma.InputJsonValue) : undefined,
      riskReward: s?.riskReward ?? null, riskPct: a.risk?.riskPct ?? null,
      confidence: a.confidence.score, regime: a.regime.label, freshness: a.data.freshness, source: a.data.source,
      priceAtSignal: a.primary?.snapshot.price ?? null,
      reasoning: {
        checks: a.checks, noTradeReasons: a.noTradeReasons, alignment: a.alignment, confidence: a.confidence,
        proposed: s ? { entryLow: s.entryLow, entryHigh: s.entryHigh, stop: s.stop, targets: s.targets, invalidation: s.invalidation, stopBasis: s.stopBasis } : null,
        regimeEvidence: a.regime.evidence, news: a.external.available ? { sentiment: a.external.newsSentiment, eventRisk: a.external.eventRisk } : null,
      } as unknown as Prisma.InputJsonValue,
      indicators: a.primary ? (sanitize(a.primary.snapshot) as Prisma.InputJsonValue) : undefined,
    },
    select: { id: true },
  });
  return row.id;
}

/** JSON can't hold NaN — store null. */
function sanitize(o: object): Record<string, number | null> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" && Number.isFinite(v) ? v : null]));
}
