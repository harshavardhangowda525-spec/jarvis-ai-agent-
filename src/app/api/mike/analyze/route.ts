import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { recordActivity } from "@/lib/activity/record";
import { findAsset } from "@/lib/mike/search";
import { analyzeAsset } from "@/lib/mike/analyze";
import { TIMEFRAMES, MARKETS } from "@/lib/mike/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({
  asset: z.string().min(1).max(40),
  timeframe: z.enum(TIMEFRAMES).default("1h"),
  market: z.enum(MARKETS.map((m) => m.id) as [string, ...string[]]).optional(),
  mode: z.enum(["mtf", "single"]).default("mtf"),
  journal: z.boolean().default(true),
});

/** Full MIKE analysis of one asset (real data only; journals the result). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`mike:analyze:${user.id}`, 20, 60_000).allowed) return fail("Too many analyses — wait a minute.", 429);
    const b = body.parse(await req.json());
    const asset = await findAsset(b.asset, b.market as never);
    if (!asset) return fail(`MIKE doesn't recognise "${b.asset}". Try a name like BTC, NIFTY, GOLD, EUR/USD or a ticker like AAPL.`, 422);
    const a = await analyzeAsset(user.id, asset, b.timeframe, { mode: b.mode, journal: b.journal });
    if (b.journal) {
      await recordActivity(user.id, {
        category: "decision", agent: "MIKE", source: "mike",
        action: `MIKE analysed ${a.asset.display} (${b.timeframe})`,
        result: a.decision === "setup" && a.setup ? `${a.setup.direction.toUpperCase()} setup · confidence ${a.confidence.score}` : `No trade — ${a.noTradeReasons[0] ?? ""}`,
        status: "info", importance: 2, metadata: { signalId: a.id ?? null, freshness: a.data.freshness },
      });
    }
    return ok(a);
  } catch (err) {
    return handleError(err);
  }
}
