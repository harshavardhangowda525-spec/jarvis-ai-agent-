import type { NextRequest } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { consumeChallenge, gateContext, relyingParty, setDeviceHint } from "@/lib/gate/server";
import { isFresh } from "@/lib/gate/token";

export const runtime = "nodejs";

/**
 * Finish enrolling this device's face unlock. Saves only the credential's id and
 * PUBLIC key — the face stays inside the device's biometric system. With
 * `replace`, other enrolled devices are removed (re-enrol).
 */
export async function POST(req: NextRequest) {
  try {
    const { user, gate } = await gateContext();
    if (!user) return fail("Authentication required.", 401);
    if (!isFresh(gate)) return fail("Unlock JARVIS again to change face unlock.", 403, { reverify: true });
    const body = (await req.json().catch(() => null)) as { challengeId?: string; response?: RegistrationResponseJSON; label?: string; replace?: boolean } | null;
    if (!body?.challengeId || !body.response?.id) return fail("Invalid request.", 422);
    const challenge = await consumeChallenge(body.challengeId, "register", user.id);
    if (!challenge) return fail("That enrolment expired. Try again.", 400);

    const rp = relyingParty(req);
    let info;
    try {
      const v = await verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true });
      if (!v.verified || !v.registrationInfo.userVerified) return fail("The device didn't confirm it was you.", 400);
      info = v.registrationInfo;
    } catch {
      return fail("Enrolment couldn't be verified.", 400);
    }
    const label = String(body.label ?? "").replace(/[^\p{L}\p{N} ._'()-]/gu, "").trim().slice(0, 60) || "This device";
    const db = getDb();
    const created = await db.$transaction(async (tx) => {
      if (body.replace) await tx.gateCredential.deleteMany({ where: { userId: user.id } });
      return tx.gateCredential.create({
        data: {
          userId: user.id,
          credentialId: info.credential.id,
          publicKey: Buffer.from(info.credential.publicKey),
          counter: BigInt(info.credential.counter),
          transports: (body.response!.response.transports ?? info.credential.transports ?? []) as string[],
          label,
        },
        select: { id: true, label: true, createdAt: true },
      });
    });
    setDeviceHint(true);
    return ok({ enrolled: created });
  } catch (err) {
    return handleError(err);
  }
}
