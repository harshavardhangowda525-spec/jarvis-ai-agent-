import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { sendAllDueReminders } from "@/lib/robin/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled RUBIN check: email every user their follow-ups and demos coming up
 * soon (`npm run local` calls this every minute; any scheduler can).
 * Needs `Authorization: Bearer <CRON_SECRET>`. Emails only go to the user.
 */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok(await sendAllDueReminders());
  } catch (err) {
    return handleError(err);
  }
}
