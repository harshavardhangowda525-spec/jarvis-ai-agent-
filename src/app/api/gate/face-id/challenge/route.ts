import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { ok, fail, handleError, rateLimit, clientIp } from "@/lib/api";
import { deviceHintUser, faceIdSummary, gateContext, lockRemaining, saveChallenge } from "@/lib/gate/server";
import { ENROLL_STEPS, unlockSteps } from "@/lib/gate/face-match";
import { isFresh } from "@/lib/gate/token";

export const runtime = "nodejs";

/**
 * Start a JARVIS Face ID scan. purpose "unlock" → a short random liveness
 * challenge for the signed-in user (or, signed out, the user this device's face
 * sign-in belongs to). purpose "enroll" → the enrolment plan (needs a recent unlock).
 */
export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`faceid-ch:${clientIp(req)}`, 30, 60_000);
    if (!rl.allowed) return fail("Too many attempts. Try again in a minute.", 429);
    const { purpose } = (await req.json().catch(() => ({}))) as { purpose?: string };
    const { user, gate } = await gateContext();
    const nonce = randomBytes(16).toString("base64url");

    if (purpose === "enroll") {
      if (!user) return fail("Authentication required.", 401);
      if (!isFresh(gate)) return fail("Unlock JARVIS again to change Face ID.", 403, { reverify: true });
      const id = await saveChallenge("faceid-enroll", user.id, `${nonce}:${ENROLL_STEPS.join(",")}`);
      return ok({ challengeId: id, steps: ENROLL_STEPS });
    }

    const target = user?.id ?? (await deviceHintUser());
    if (!target) return fail("Face sign-in isn't set up on this device.", 404, { notEnrolled: true });
    const locked = await lockRemaining(target);
    if (locked > 0) return fail("Too many failed attempts.", 423, { lockedMs: locked });
    if (!(await faceIdSummary(target)).enrolled) return fail("No face is enrolled yet.", 404, { notEnrolled: true });
    const steps = unlockSteps();
    const id = await saveChallenge("faceid-unlock", target, `${nonce}:${steps.join(",")}`);
    return ok({ challengeId: id, steps });
  } catch (err) {
    return handleError(err);
  }
}
