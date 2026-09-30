import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { recordActivity } from "@/lib/activity/record";
import { findAsset } from "@/lib/mike/search";
import { closedBars, fetchSeries } from "@/lib/mike/data";
import { backtest, STRATEGIES, type StrategyId } from "@/lib/mike/backtest";
import { loadSettings } from "@/lib/mike/analyze";
import { TIMEFRAMES } from "@/lib/mike/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({
  asset: z.string().min(1).max(40),
  timeframe: z.enum(TIMEFRAMES).default("1h"),
  strategy: z.enum(Object.keys(STRATEGIES) as [StrategyId, ...StrategyId[]]).default("mike"),
  target: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  feeBps: z.number().min(0).max(100).default(5),
});

/** Backtest a strategy on real historical candles. Results are labelled BACKTEST — never live performance. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`mike:bt:${user.id}`, 6, 60_000).allowed) return fail("Too many backtests — wait a minute.", 429);
    const b = body.parse(await req.json());
    const asset = await findAsset(b.asset);
    if (!asset) return fail(`MIKE doesn't recognise "${b.asset}".`, 422);
    const s = await fetchSeries(asset, b.timeframe, { historyBars: 2000 });
    if (!s.candles.length) return fail(`LIVE DATA UNAVAILABLE — ${s.note}`, 503);
    const bars = closedBars(s);
    if (bars.length < 300) return fail(`Only ${bars.length} historical bars available for ${asset.display} on ${b.timeframe} — too few for a meaningful backtest.`, 422);
    const settings = await loadSettings(user.id);
    const r = backtest(bars, {
      strategy: b.strategy, timeframe: b.timeframe, target: b.target, feeBps: b.feeBps, hasVolume: s.hasVolume,
      minConfidence: settings.minConfidence, minRiskReward: settings.minRiskReward, riskPctPerTrade: settings.riskPct,
    });
    await recordActivity(user.id, {
      category: "decision", agent: "MIKE", source: "mike",
      action: `MIKE backtested ${STRATEGIES[b.strategy].split(" (")[0]} on ${asset.display} ${b.timeframe}`,
      result: `${r.totalTrades} trades · win rate ${r.winRate}% · expectancy ${r.expectancyR}R (backtest)`,
      status: "info", importance: 2,
    });
    return ok({ ...r, asset, source: s.source, freshness: s.freshness });
  } catch (err) {
    return handleError(err);
  }
}
