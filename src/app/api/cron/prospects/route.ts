import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { tick } from "@/lib/prospects/service";
import { callsTick } from "@/lib/calls/service";
import { portalWatchTick } from "@/lib/portal/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** JARVIS CRM: queue the daily Google Maps searches that are due (`npm run local` calls this every minute). Bearer CRON_SECRET. */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    const r = await tick();
    // the Client Portal watch rides on this minute tick (it runs every 5 minutes)
    const portal = await portalWatchTick().catch((e) => ({ error: (e as Error).message }));
    return ok({ ...r, staleCalls: await callsTick(), portal });
  } catch (e) { return handleError(e); }
}
