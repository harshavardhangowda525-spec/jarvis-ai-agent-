import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { ok, fail, handleError } from "@/lib/api";
import { attemptState, gateContext, recordFailure, recordSuccess, setUnlocked } from "@/lib/gate/server";
import { lockedFor, pinProblem } from "@/lib/gate/policy";
import { isFresh } from "@/lib/gate/token";

export const runtime = "nodejs";

/** Unlock with the PIN (fallback when face unlock isn't possible). */
export async function POST(req: NextRequest) {
  try {
    const { user, session } = await gateContext();
    if (!user || !session) return fail("Authentication required.", 401);
    const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
    const att = await attemptState(user.id);
    if (lockedFor(att) > 0) return fail("Too many failed attempts.", 423, { lockedMs: lockedFor(att) });
    const row = await getDb().gateSecurity.findUnique({ where: { userId: user.id }, select: { pinHash: true } });
    if (!row?.pinHash) return fail("No PIN is set.", 404, { noPin: true });
    const good = typeof pin === "string" && /^\d{1,12}$/.test(pin) && (await verifyPassword(pin, row.pinHash));
    if (!good) {
      const r = await recordFailure(user.id);
      return fail("Incorrect PIN.", r.lockedMs > 0 ? 423 : 401, r);
    }
    await recordSuccess(user.id);
    await setUnlocked(user.id, session.jti, "pin");
    return ok({ unlocked: true });
  } catch (err) {
    return handleError(err);
  }
}

/** Set or change the PIN (needs a recent unlock). */
export async function PUT(req: NextRequest) {
  try {
    const { user, gate } = await gateContext();
    if (!user) return fail("Authentication required.", 401);
    if (!isFresh(gate)) return fail("Unlock JARVIS again to change the PIN.", 403, { reverify: true });
    const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
    const problem = typeof pin === "string" ? pinProblem(pin) : "Use 6 to 12 digits.";
    if (problem) return fail(problem, 422);
    const pinHash = await hashPassword(pin!);
    await getDb().gateSecurity.upsert({ where: { userId: user.id }, create: { userId: user.id, pinHash }, update: { pinHash } });
    return ok({ pinSet: true });
  } catch (err) {
    return handleError(err);
  }
}

/** Remove the PIN (needs a recent unlock). */
export async function DELETE() {
  try {
    const { user, gate } = await gateContext();
    if (!user) return fail("Authentication required.", 401);
    if (!isFresh(gate)) return fail("Unlock JARVIS again to change the PIN.", 403, { reverify: true });
    await getDb().gateSecurity.updateMany({ where: { userId: user.id }, data: { pinHash: null } });
    return ok({ pinSet: false });
  } catch (err) {
    return handleError(err);
  }
}
