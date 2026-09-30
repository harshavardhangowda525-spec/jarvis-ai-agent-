import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { findAsset } from "@/lib/mike/search";
import { closedBars, fetchSeries } from "@/lib/mike/data";
import { analyzeAt, prepare } from "@/lib/mike/timeframe";
import { TIMEFRAMES, type ChartData, type Timeframe } from "@/lib/mike/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Candles + overlays for the live chart (polled while MIKE is open). No
 * decision is made here — this only keeps the chart current between analyses.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`mike:chart:${user.id}`, 90, 60_000).allowed) return fail("Too many chart refreshes.", 429);
    const url = new URL(req.url);
    const asset = await findAsset(url.searchParams.get("asset") ?? "");
    const tfp = url.searchParams.get("tf") ?? "1h";
    if (!asset) return fail(`MIKE couldn't find a market called "${url.searchParams.get("asset") ?? ""}".`, 422);
    const tf: Timeframe = (TIMEFRAMES as readonly string[]).includes(tfp) ? (tfp as Timeframe) : "1h";
    const n = Math.min(Math.max(Number(url.searchParams.get("bars")) || 180, 40), 400);
    // the live chart wants fresh bars — at most a few seconds old
    const s = await fetchSeries(asset, tf, { maxAgeMs: 5000 });
    const base = {
      asset: s.asset, timeframe: tf, source: s.source, freshness: s.freshness, note: s.note, lastBarAt: s.lastBarAt, fetchedAt: s.fetchedAt,
      // crypto served by Binance can stream tick-by-tick in the browser (public market data, no key)
      stream: s.source.startsWith("Binance") && s.freshness === "live" ? { provider: "binance" as const, symbol: s.asset.symbol } : null,
    };
    const bars = closedBars(s);
    if (bars.length < 30) return ok({ ...base, chart: null, price: s.candles.at(-1)?.c ?? null });
    const prep = prepare(bars, tf, s.hasVolume);
    const a = analyzeAt(prep, bars.length - 1, s.freshness);
    const all = s.candles;
    const start = Math.max(0, all.length - n);
    const cut = (arr: number[]) => all.slice(start).map((_, k) => (Number.isFinite(arr[start + k]) ? arr[start + k] : null));
    const chart: ChartData = {
      candles: all.slice(start),
      ema20: cut(prep.ind.ema20), ema50: cut(prep.ind.ema50), ema200: cut(prep.ind.ema200),
      bbUpper: cut(prep.ind.bb.upper), bbLower: cut(prep.ind.bb.lower), vwap: cut(prep.ind.vwap), rsi: cut(prep.ind.rsi),
      swings: a.swings.map((x) => ({ ...x, i: x.i - start })).filter((x) => x.i >= 0),
      events: a.events.map((x) => ({ ...x, i: x.i - start })).filter((x) => x.i >= 0),
      support: a.support, resistance: a.resistance,
    };
    return ok({ ...base, chart, price: all.at(-1)!.c, regime: a.regime, bias: a.bias });
  } catch (err) {
    return handleError(err);
  }
}
