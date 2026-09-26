import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { checkAllUsers } from "@/lib/nios/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled NIOS check for every user with the watch on (Vercel Cron, or the
 * local runner). Vercel sends `Authorization: Bearer <CRON_SECRET>`; without a
 * configured secret this endpoint refuses to run.
 */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok(await checkAllUsers());
  } catch (err) {
    return handleError(err);
  }
}
