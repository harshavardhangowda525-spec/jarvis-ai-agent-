import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { runPending } from "@/lib/jobs/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Background runner (npm run local ticks it every minute): recover interrupted tasks and run what's waiting, for everyone. */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok({ ran: await runPending(undefined, 240_000) });
  } catch (err) {
    return handleError(err);
  }
}
