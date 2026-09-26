import { requireUser } from "@/lib/auth/session";
import { ok, handleError, rateLimit } from "@/lib/api";
import { checkForUser, unseenNotices } from "@/lib/nios/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Check the NIOS pages now (at most every few minutes per user — calls in
 * between return what's stored) and return the new notices not yet shown.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`nios-check:${user.id}`, 6, 60_000);
    const body = await req.json().catch(() => ({}));
    const force = !!body?.force && rl.allowed;
    const result = await checkForUser(user.id, { force });
    const unseen = await unseenNotices(user.id);
    return ok({ ...result, unseen });
  } catch (err) {
    return handleError(err);
  }
}
