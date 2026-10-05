import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { attemptState, deviceHintUser, faceIdSummary, gateContext } from "@/lib/gate/server";
import { lockedFor } from "@/lib/gate/policy";
import { GATE_DEVICE_COOKIE, isFresh } from "@/lib/gate/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the gate screen needs to know. Never includes key material or anything biometric. */
export async function GET() {
  try {
    const { user, gate } = await gateContext();
    const deviceHint = !!cookies().get(GATE_DEVICE_COOKIE)?.value;
    if (!user) {
      const hinted = deviceHint ? await deviceHintUser() : null;
      const faceSignIn = hinted ? (await faceIdSummary(hinted)).enrolled : false;
      return ok({ signedIn: false, unlocked: false, deviceHint, faceSignIn });
    }
    const [enrolled, att, faceId] = await Promise.all([getDb().gateCredential.count({ where: { userId: user.id } }), attemptState(user.id), faceIdSummary(user.id)]);
    return ok({
      signedIn: true,
      email: user.email,
      unlocked: !!gate,
      method: gate?.method ?? null,
      fresh: isFresh(gate),
      enrolled,
      pinSet: att.pinSet,
      lockedMs: lockedFor(att),
      attemptsLeft: 5 - att.failedCount,
      deviceHint,
      faceId,
    });
  } catch (err) {
    return handleError(err);
  }
}
