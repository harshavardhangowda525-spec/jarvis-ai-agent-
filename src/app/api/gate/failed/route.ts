import { ok, fail, handleError } from "@/lib/api";
import { gateContext, recordFailure } from "@/lib/gate/server";

export const runtime = "nodejs";

/** The device's own biometric check failed or was refused (it never reached us) — it still counts toward the lockout. */
export async function POST() {
  try {
    const { user, gate } = await gateContext();
    if (!user) return fail("Authentication required.", 401);
    if (gate) return ok({ lockedMs: 0, attemptsLeft: 5 });
    return ok(await recordFailure(user.id));
  } catch (err) {
    return handleError(err);
  }
}
