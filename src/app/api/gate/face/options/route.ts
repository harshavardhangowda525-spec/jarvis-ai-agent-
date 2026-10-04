import type { NextRequest } from "next/server";
import { generateAuthenticationOptions, generateRegistrationOptions } from "@simplewebauthn/server";
import { getDb } from "@/lib/db";
import { ok, fail, handleError, rateLimit, clientIp } from "@/lib/api";
import { gateContext, lockRemaining, relyingParty, saveChallenge } from "@/lib/gate/server";
import { isFresh } from "@/lib/gate/token";

export const runtime = "nodejs";

/**
 * Start a face check. purpose "unlock": ask the device to verify the user
 * (signed in → only this user's enrolled devices; signed out → any face enrolled
 * on this device, i.e. face sign-in). purpose "enroll": register this device's
 * biometrics (needs a recent unlock).
 */
export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`gate-opt:${clientIp(req)}`, 30, 60_000);
    if (!rl.allowed) return fail("Too many attempts. Try again in a minute.", 429);
    const { purpose } = (await req.json().catch(() => ({}))) as { purpose?: string };
    const rp = relyingParty(req);
    const { user, gate } = await gateContext();
    const db = getDb();

    if (purpose === "enroll") {
      if (!user) return fail("Authentication required.", 401);
      if (!isFresh(gate)) return fail("Unlock JARVIS again to change face unlock.", 403, { reverify: true });
      const existing = await db.gateCredential.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } });
      const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpID,
        userName: user.email,
        userDisplayName: user.email,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        // this device's own biometrics (Windows Hello / Face ID / Touch ID), never a phone or key
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
        excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports as never })),
        timeout: 120_000,
      });
      return ok({ challengeId: await saveChallenge("register", user.id, options.challenge), options });
    }

    // unlock
    if (user) {
      const locked = await lockRemaining(user.id);
      if (locked > 0) return fail("Too many failed attempts.", 423, { lockedMs: locked });
      const creds = await db.gateCredential.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } });
      if (!creds.length) return fail("No face is enrolled yet.", 404, { notEnrolled: true });
      const options = await generateAuthenticationOptions({
        rpID: rp.rpID, userVerification: "required", timeout: 60_000,
        allowCredentials: creds.map((c) => ({ id: c.credentialId, transports: c.transports as never })),
      });
      return ok({ challengeId: await saveChallenge("unlock", user.id, options.challenge), options });
    }
    // signed out: face sign-in with a credential stored on this device
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required", timeout: 60_000 });
    return ok({ challengeId: await saveChallenge("unlock", null, options.challenge), options });
  } catch (err) {
    return handleError(err);
  }
}
