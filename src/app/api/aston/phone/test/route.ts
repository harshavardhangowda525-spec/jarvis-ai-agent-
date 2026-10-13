import { ok, fail, rateLimit } from "@/lib/api";
import { env } from "@/lib/env";
import { requireOwner } from "@/lib/aston/auth";
import { phoneGuard, TestCallProvider } from "@/lib/aston/phone";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phone test mode: runs the full guard and builds the exact message, then
 * hands it to the TEST provider. This endpoint can never place a real call.
 */
export async function POST() {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:phonetest:${user.id}`, 5, 60_000).allowed) return fail("Too many requests.", 429);
    const guard = await phoneGuard(user.id);
    const message = "This is a test of ASTON phone alerts. No action is needed.";
    const test = new TestCallProvider();
    const r = await test.place(env.astonOwnerPhone || "+00000000000", message);
    return ok({
      realCallPlaced: false,
      ref: r.ref,
      wouldSay: message,
      liveCallsWouldBeAllowed: guard.allowed && env.astonPhoneMode === "live",
      reason: guard.reason ?? null,
      status: guard.status,
    });
  } catch (err) {
    return astonError(err);
  }
}
