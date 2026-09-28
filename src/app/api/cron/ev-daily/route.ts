import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { runSchedule } from "@/lib/ev/daily/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Morning run of EV's daily content (Vercel Cron from 04:00 Asia/Kolkata, and
 * every few minutes from `npm run local`): creates today's package once it's
 * past EV_DAILY_START and advances every unfinished one.
 */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok(await runSchedule({ budgetMs: 250_000 }));
  } catch (err) {
    return handleError(err);
  }
}
