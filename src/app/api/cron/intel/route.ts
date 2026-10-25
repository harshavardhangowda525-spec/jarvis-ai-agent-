import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { runDueIntel } from "@/lib/intel/briefing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Business briefings: daily 08:00 IST, weekly Sunday 19:00 IST (Vercel Cron,
 * plus `npm run local` ticks). Idempotent; a missed run is caught up next time.
 */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok({ intel: await runDueIntel() });
  } catch (e) {
    return handleError(e);
  }
}
