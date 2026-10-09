import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { tickAll } from "@/lib/aston/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled ASTON cycle (Vercel Cron, the local runner, or the free GitHub
 * Actions schedule in .github/workflows/aston-tick.yml). Requires
 * `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok(await tickAll());
  } catch (err) {
    return handleError(err);
  }
}
