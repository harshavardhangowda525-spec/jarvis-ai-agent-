import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { runDueWeekly } from "@/lib/trading/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * MIKE's weekly trading review — due Sunday 18:00 IST. Vercel Cron runs it
 * on Sunday evening and once a day after (catch-up); `npm run local` ticks it
 * hourly. Idempotent: a week that already has a report is left alone.
 */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok({ trading: await runDueWeekly() });
  } catch (e) {
    return handleError(e);
  }
}
