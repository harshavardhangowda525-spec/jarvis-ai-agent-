import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { runDuePlans } from "@/lib/plans/engine";
import { notifyPlan } from "@/lib/plans/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The daily marketing plan's cloud schedule (Vercel Cron, hourly 04:30–10:30
 * IST; also ticked by `npm run local`). Makes today's plan for everyone whose
 * delivery time is near, then sends the "plan ready" notification once.
 */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok({ plans: await runDuePlans({ notify: (p) => notifyPlan(p) }) });
  } catch (err) {
    return handleError(err);
  }
}
