import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { ok, fail, handleError, rateLimit, clientIp } from "@/lib/api";
import { gateContext, lockRemaining, recordFailure, recordSuccess, setUnlocked } from "@/lib/gate/server";

export const runtime = "nodejs";

/** Unlock with the account password (always-available fallback). */
export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`gate-pw:${clientIp(req)}`, 10, 60_000);
    if (!rl.allowed) return fail("Too many attempts. Try again in a minute.", 429);
    const { user, session } = await gateContext();
    if (!user || !session) return fail("Authentication required.", 401);
    const locked = await lockRemaining(user.id);
    if (locked > 0) return fail("Too many failed attempts.", 423, { lockedMs: locked });
    const { password } = (await req.json().catch(() => ({}))) as { password?: string };
    const row = await getDb().user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    const good = !!row && typeof password === "string" && password.length > 0 && password.length <= 200 && (await verifyPassword(password, row.passwordHash));
    if (!good) {
      const r = await recordFailure(user.id);
      return fail("Incorrect password.", r.lockedMs > 0 ? 423 : 401, r);
    }
    await recordSuccess(user.id);
    await setUnlocked(user.id, session.jti, "password");
    return ok({ unlocked: true });
  } catch (err) {
    return handleError(err);
  }
}
