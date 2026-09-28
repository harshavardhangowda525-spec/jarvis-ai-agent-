import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { runDarwinDaily } from "@/lib/darwin/daily/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** DARWIN's autonomous daily lead search (Vercel Cron + `npm run local`). */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok(await runDarwinDaily({ budgetMs: 250_000 }));
  } catch (err) {
    return handleError(err);
  }
}
