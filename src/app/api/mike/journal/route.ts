import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { getDb } from "@/lib/db";
import { journalInsights, resolveOpenSignals } from "@/lib/mike/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The signal journal (newest first) + what the finished setups say so far. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 40, 1), 200);
    const only = url.searchParams.get("decision");
    const id = url.searchParams.get("id");
    const where = { userId: user.id, ...(id ? { id } : {}), ...(only === "setup" || only === "no_trade" ? { decision: only } : {}) };
    const [signals, insights] = await Promise.all([
      getDb().mikeSignal.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
      url.searchParams.get("insights") === "0" ? null : journalInsights(user.id),
    ]);
    return ok({ signals, insights });
  } catch (err) {
    return handleError(err);
  }
}

/** Resolve open setups from the candles that formed since (outcome + self-audit). */
export async function POST() {
  try {
    const user = await requireUser();
    if (!rateLimit(`mike:resolve:${user.id}`, 10, 60_000).allowed) return fail("Too many requests.", 429);
    return ok(await resolveOpenSignals(user.id));
  } catch (err) {
    return handleError(err);
  }
}
