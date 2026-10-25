import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { getDb } from "@/lib/db";
import { briefingView, generateBriefing } from "@/lib/intel/briefing";
import { istDate, weekOf } from "@/lib/trading/week";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** ?kind=daily|weekly&period=… → one briefing (default: the latest of that kind). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const u = new URL(req.url);
    const kind = u.searchParams.get("kind") === "weekly" ? "weekly" : "daily";
    const period = u.searchParams.get("period");
    const b = period
      ? await getDb().intelBriefing.findUnique({ where: { userId_kind_period: { userId: user.id, kind, period } } })
      : await getDb().intelBriefing.findFirst({ where: { userId: user.id, kind }, orderBy: { period: "desc" } });
    return ok({ briefing: b ? briefingView(b) : null });
  } catch (e) {
    return handleError(e);
  }
}

const body = z.object({ kind: z.enum(["daily", "weekly"]) });

/** Generate now: today's daily briefing, or this week's review so far (Monday to now). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`intel-brief:${user.id}`, 4, 60_000).allowed) return fail("Too many requests — wait a moment.", 429);
    const { kind } = body.parse(await req.json());
    const now = Date.now();
    const period = kind === "daily" ? istDate(now) : weekOf(istDate(now)).start;
    const b = await generateBriefing(user.id, kind, period, { trigger: "manual", force: true });
    return ok({ briefing: briefingView(b) });
  } catch (e) {
    return handleError(e);
  }
}
