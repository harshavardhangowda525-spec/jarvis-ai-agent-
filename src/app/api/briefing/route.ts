import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { validTz } from "@/lib/activity/dates";
import { forgetTz } from "@/lib/activity/record";
import { loadBriefing, rangeFromParams } from "@/lib/briefing/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The intelligence briefing for a day (default: yesterday in the user's own
 * timezone) or a range (?from=YYYY-MM-DD&to=YYYY-MM-DD). Built only from the
 * recorded activity history.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = new URL(req.url).searchParams;
    const db = getDb();
    const profile = await db.profile.findUnique({ where: { userId: user.id }, select: { timezone: true } });
    const browserTz = sp.get("tz") ? validTz(sp.get("tz")) : null;
    // First visit with the default UTC profile: adopt the browser's timezone so
    // "yesterday" means the user's yesterday.
    if (browserTz && browserTz !== "UTC" && (!profile || profile.timezone === "UTC")) {
      await db.profile.upsert({ where: { userId: user.id }, create: { userId: user.id, timezone: browserTz }, update: { timezone: browserTz } }).catch(() => {});
      forgetTz(user.id);
    }
    const tz = browserTz ?? validTz(profile?.timezone);
    const range = rangeFromParams(sp, tz);
    return ok(await loadBriefing(user.id, range, tz));
  } catch (err) {
    return handleError(err);
  }
}
