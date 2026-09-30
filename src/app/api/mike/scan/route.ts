import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { getDb } from "@/lib/db";
import { scanMarket } from "@/lib/mike/scan";
import { loadSettings } from "@/lib/mike/analyze";
import { TIMEFRAMES, type Timeframe } from "@/lib/mike/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Market scanner over the user's watchlist (or ?symbols=a,b,c) + the live
 * market panel: status, trend, volatility, sentiment, movers, active setups.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`mike:scan:${user.id}`, 30, 60_000).allowed) return fail("Scanning too often — wait a minute.", 429);
    const url = new URL(req.url);
    const tfParam = url.searchParams.get("tf") ?? "";
    const settings = await loadSettings(user.id);
    const tf: Timeframe = (TIMEFRAMES as readonly string[]).includes(tfParam) ? (tfParam as Timeframe) : settings.defaultTimeframe;
    const symbols = (url.searchParams.get("symbols") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const [scan, active] = await Promise.all([
      scanMarket(symbols.length ? symbols : settings.watchlist, tf),
      getDb().mikeSignal.findMany({
        where: { userId: user.id, decision: "setup", status: { in: ["open", "triggered"] } },
        orderBy: { createdAt: "desc" }, take: 8,
        select: { id: true, asset: true, timeframe: true, direction: true, confidence: true, status: true, entryLow: true, entryHigh: true, stop: true, riskReward: true, createdAt: true },
      }),
    ]);
    return ok({ ...scan, activeSetups: active });
  } catch (err) {
    return handleError(err);
  }
}
