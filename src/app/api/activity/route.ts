import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { recordActivity } from "@/lib/activity/record";
import { isDate, rangeBounds, validTz } from "@/lib/activity/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recorded activity between two local dates (for "expand" and history questions). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") ?? "", to = sp.get("to") ?? from;
    if (!isDate(from) || !isDate(to)) return fail("from/to must be YYYY-MM-DD.", 400);
    const tz = validTz(sp.get("tz"));
    const { start, end } = rangeBounds(from, to, tz);
    const events = await getDb().activityEvent.findMany({
      where: { userId: user.id, timestamp: { gte: start, lt: end } },
      orderBy: { timestamp: "asc" }, take: 1000,
      select: { id: true, timestamp: true, date: true, category: true, agent: true, action: true, result: true, status: true, importance: true, project: true },
    });
    return ok({ events });
  } catch (err) {
    return handleError(err);
  }
}

const clientEvent = z.object({
  category: z.enum(["agent", "development", "error", "solution", "business", "communication", "decision", "file", "marketing"]),
  agent: z.string().trim().regex(/^[A-Za-z][A-Za-z ]{1,19}$/),
  action: z.string().trim().min(2).max(300),
  result: z.string().max(400).nullable().optional(),
  status: z.enum(["success", "failed", "info"]).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  project: z.string().max(80).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** Events that happen in the browser (ULTRON's work, agent views). Importance is capped at 3. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`activity:${user.id}`, 60, 60_000);
    if (!rl.allowed) return fail("Too many events.", 429);
    const e = clientEvent.parse(await req.json());
    const id = await recordActivity(user.id, { ...e, importance: Math.min(3, e.importance ?? 2), source: "client" });
    return ok({ id });
  } catch (err) {
    return handleError(err);
  }
}
