import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { summarizeYesterdayForAll } from "@/lib/briefing/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** End of day: store yesterday's structured summary for every active user (Vercel Cron). */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok(await summarizeYesterdayForAll());
  } catch (err) {
    return handleError(err);
  }
}
