import type { NextRequest } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getDb } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit, clientIp } from "@/lib/api";
import { consumeChallenge, gateContext, lockRemaining, recordFailure, recordSuccess, relyingParty, setDeviceHint, setUnlocked } from "@/lib/gate/server";

export const runtime = "nodejs";

const NOT_RECOGNIZED = "Identity not recognized.";

/**
 * Finish a face check: verify the device's signature. The device only signs
 * after ITS biometric check passed (user verification is required and checked
 * here), so a valid signature from an enrolled credential = the enrolled person.
 * Unlocks this browser session — or, signed out, signs in.
 */
export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`gate-face:${clientIp(req)}`, 20, 60_000);
    if (!rl.allowed) return fail("Too many attempts. Try again in a minute.", 429);
    const body = (await req.json().catch(() => null)) as { challengeId?: string; response?: AuthenticationResponseJSON } | null;
    if (!body?.challengeId || !body.response?.id) return fail("Invalid request.", 422);

    const { user, session } = await gateContext();
    const challenge = await consumeChallenge(body.challengeId, "unlock", user ? user.id : null);
    if (!challenge) return fail("That scan expired. Try again.", 400, { expired: true });

    const db = getDb();
    const cred = await db.gateCredential.findUnique({ where: { credentialId: body.response.id }, include: { user: { select: { id: true, email: true } } } });
    if (!cred || (user && cred.userId !== user.id)) {
      if (user) await recordFailure(user.id);
      return fail(NOT_RECOGNIZED, 401);
    }
    const locked = await lockRemaining(cred.userId);
    if (locked > 0) return fail("Too many failed attempts.", 423, { lockedMs: locked });

    const rp = relyingParty(req);
    let verified = false, newCounter = Number(cred.counter);
    try {
      const v = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
        credential: { id: cred.credentialId, publicKey: new Uint8Array(cred.publicKey), counter: Number(cred.counter), transports: cred.transports as never },
      });
      verified = v.verified && v.authenticationInfo.userVerified;
      newCounter = v.authenticationInfo.newCounter;
    } catch {
      verified = false;
    }
    if (!verified) {
      const r = await recordFailure(cred.userId);
      return fail(NOT_RECOGNIZED, r.lockedMs > 0 ? 423 : 401, r);
    }

    await db.gateCredential.update({ where: { id: cred.id }, data: { counter: BigInt(newCounter), lastUsedAt: new Date() } });
    await recordSuccess(cred.userId);
    if (user && session) await setUnlocked(user.id, session.jti, "face");
    else await createSession({ id: cred.user.id, email: cred.user.email }, { userAgent: req.headers.get("user-agent") ?? undefined, ipAddress: clientIp(req), gateMethod: "face" });
    setDeviceHint(true);
    return ok({ unlocked: true, signedIn: !user });
  } catch (err) {
    return handleError(err);
  }
}
