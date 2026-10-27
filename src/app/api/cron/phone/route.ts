import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { iphoneTick } from "@/lib/phone/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Phone calls, iPhone mode: email each spare iPhone what's due, so its Shortcuts
 * automation calls you (`npm run local` calls this every minute; any scheduler can).
 * Needs `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    return ok(await iphoneTick());
  } catch (err) {
    return handleError(err);
  }
}
