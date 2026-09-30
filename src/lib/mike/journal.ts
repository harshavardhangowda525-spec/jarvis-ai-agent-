import "server-only";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { recordActivity } from "@/lib/activity/record";
import type { AssetRef, Target, Timeframe } from "./types";
import { tierOf, TIER_LABEL } from "./types";
import { closedBars, fetchSeries, type DataOpts } from "./data";
import { resolveOutcome, selfAudit } from "./outcome";
import { analyzeAt, prepare } from "./timeframe";
import { loadSettings } from "./analyze";

/**
 * The signal journal: open setups are resolved from real candles as they
 * form, then audited. A resolved row is final — the update only matches rows
 * still open, so history is never silently rewritten.
 */

export async function resolveOpenSignals(userId: string, opts: DataOpts = {}): Promise<{ checked: number; resolved: { id: string; asset: string; status: string; r: number | null }[] }> {
  const db = getDb();
  const open = await db.mikeSignal.findMany({
    where: { userId, decision: "setup", status: { in: ["open", "triggered"] } },
    orderBy: { createdAt: "asc" }, take: 30,
  });
  const settings = await loadSettings(userId);
  const resolved: { id: string; asset: string; status: string; r: number | null }[] = [];
  for (const s of open) {
    if (s.entryLow == null || s.entryHigh == null || s.stop == null || !s.direction) continue;
    const asset: AssetRef = { display: s.asset, symbol: s.symbol, provider: s.provider as AssetRef["provider"], kind: s.provider === "binance" ? "crypto" : "stock", exchange: "", group: s.assetGroup };
    const series = await fetchSeries(asset, s.timeframe as Timeframe, opts);
    if (!series.candles.length) continue;
    const bars = closedBars(series, opts.now ?? Date.now());
    const o = resolveOutcome({
      direction: s.direction as "long" | "short", entryLow: s.entryLow, entryHigh: s.entryHigh, stop: s.stop,
      targets: (s.targets ?? []) as unknown as Target[], createdAt: s.createdAt.getTime(),
    }, bars);
    if (o.status === "open") continue;
    if (o.status === "triggered") {
      if (s.status === "open") await db.mikeSignal.updateMany({ where: { id: s.id, status: "open" }, data: { status: "triggered", triggeredAt: new Date(o.triggeredAt!) } });
      continue;
    }
    let regimeAfter: string | null = null;
    if (bars.length >= 60) regimeAfter = analyzeAt(prepare(bars, s.timeframe as Timeframe, series.hasVolume), bars.length - 1).regime.label;
    const reasoning = (s.reasoning ?? {}) as { checks?: { id: string; state: string; detail: string }[] };
    const audit = selfAudit({
      direction: s.direction as "long" | "short", confidence: s.confidence, riskReward: s.riskReward, regime: s.regime,
      checks: reasoning.checks ?? [], outcome: o, regimeAfter, minConfidence: settings.minConfidence, minRiskReward: settings.minRiskReward,
    });
    const upd = await db.mikeSignal.updateMany({
      where: { id: s.id, status: { in: ["open", "triggered"] } },
      data: {
        status: o.status, triggeredAt: o.triggeredAt ? new Date(o.triggeredAt) : null, resolvedAt: new Date(),
        outcome: { result: o.status, entry: o.entry, exitPrice: o.exitPrice, exitAt: o.exitAt, targetsHit: o.targetsHit, rMultiple: o.rMultiple, mfe: o.mfe, mae: o.mae, mfeR: o.mfeR, maeR: o.maeR, bars: o.bars } as Prisma.InputJsonValue,
        audit: audit as unknown as Prisma.InputJsonValue,
      },
    });
    if (upd.count) {
      resolved.push({ id: s.id, asset: s.asset, status: o.status, r: o.rMultiple });
      await recordActivity(userId, {
        category: "decision", agent: "MIKE", source: "mike",
        action: `MIKE setup finished: ${s.asset} ${s.direction} (${s.timeframe})`,
        result: o.status === "not_triggered" ? "Entry never reached" : `${o.status.toUpperCase()} ${o.rMultiple ?? ""}R`,
        status: o.status === "won" ? "success" : o.status === "lost" ? "failed" : "info", importance: 2,
      });
    }
  }
  return { checked: open.length, resolved };
}

export interface JournalInsights {
  resolved: number;
  needed: number;
  ready: boolean;
  overall: { trades: number; winRate: number; expectancyR: number } | null;
  byConfidence: { tier: string; trades: number; winRate: number; expectancyR: number }[];
  byRegime: { regime: string; trades: number; winRate: number; expectancyR: number }[];
  byTimeframe: { timeframe: string; trades: number; winRate: number; expectancyR: number }[];
  byCheck: { check: string; passedWinRate: number | null; notPassedWinRate: number | null; samples: number }[];
  notes: string[];
}

const MIN_SAMPLES = 20;

/** Which conditions have produced the most reliable signals (LIVE journal, not backtest). */
export async function journalInsights(userId: string): Promise<JournalInsights> {
  const rows = await getDb().mikeSignal.findMany({
    where: { userId, decision: "setup", status: { in: ["won", "lost", "expired"] } },
    select: { status: true, confidence: true, regime: true, timeframe: true, outcome: true, reasoning: true },
    orderBy: { createdAt: "desc" }, take: 1000,
  });
  const r = (x: (typeof rows)[number]) => Number((x.outcome as { rMultiple?: number } | null)?.rMultiple ?? 0);
  const group = <K extends string>(key: (x: (typeof rows)[number]) => K) => {
    const m = new Map<K, typeof rows>();
    for (const x of rows) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x]); }
    return [...m.entries()].map(([k, xs]) => ({ k, trades: xs.length, winRate: Math.round((xs.filter((x) => x.status === "won").length / xs.length) * 1000) / 10, expectancyR: Math.round((xs.reduce((s, x) => s + r(x), 0) / xs.length) * 100) / 100 }))
      .sort((a, b) => b.trades - a.trades);
  };
  const checks = ["structure", "trend", "momentum", "volume", "volatility", "levels", "mtf", "context"];
  const byCheck = checks.map((id) => {
    const withState = rows.map((x) => ({ won: x.status === "won", pass: ((x.reasoning as { checks?: { id: string; state: string }[] })?.checks ?? []).some((c) => c.id === id && c.state === "pass") }));
    const p = withState.filter((x) => x.pass), n = withState.filter((x) => !x.pass);
    const wr = (xs: typeof p) => (xs.length ? Math.round((xs.filter((x) => x.won).length / xs.length) * 1000) / 10 : null);
    return { check: id, passedWinRate: wr(p), notPassedWinRate: wr(n), samples: rows.length };
  });
  const ready = rows.length >= MIN_SAMPLES;
  const all = group(() => "all")[0];
  return {
    resolved: rows.length, needed: MIN_SAMPLES, ready,
    overall: all ? { trades: all.trades, winRate: all.winRate, expectancyR: all.expectancyR } : null,
    byConfidence: group((x) => TIER_LABEL[tierOf(x.confidence)]).map(({ k, ...v }) => ({ tier: k, ...v })),
    byRegime: group((x) => x.regime ?? "unknown").map(({ k, ...v }) => ({ regime: k, ...v })),
    byTimeframe: group((x) => x.timeframe).map(({ k, ...v }) => ({ timeframe: k, ...v })),
    byCheck,
    notes: ready
      ? ["LIVE journal results from MIKE's own past setups — a record, not a forecast."]
      : [`Not enough finished setups yet (${rows.length}/${MIN_SAMPLES}) — patterns from fewer samples would be noise.`],
  };
}
