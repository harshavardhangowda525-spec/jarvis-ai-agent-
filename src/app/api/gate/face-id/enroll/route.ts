import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { gateContext, setDeviceHint, takeChallenge } from "@/lib/gate/server";
import { enrollmentProblem, livenessProblem, type FaceProbe, type FaceStep } from "@/lib/gate/face-match";
import { sealTemplate, templateKeyId } from "@/lib/gate/face-template";
import { isFresh } from "@/lib/gate/token";

export const runtime = "nodejs";

/**
 * Save a JARVIS Face ID enrolment: face descriptors captured from several
 * angles (numbers — never images), encrypted at rest. Replaces any previous
 * enrolment on this server. Needs a recent unlock.
 */
export async function POST(req: NextRequest) {
  try {
    const { user, gate } = await gateContext();
    if (!user) return fail("Authentication required.", 401);
    if (!isFresh(gate)) return fail("Unlock JARVIS again to change Face ID.", 403, { reverify: true });
    const body = (await req.json().catch(() => null)) as { challengeId?: string; samples?: FaceProbe[] } | null;
    if (!body?.challengeId || !Array.isArray(body.samples) || body.samples.length > 20) return fail("Invalid request.", 422);
    const ch = await takeChallenge(body.challengeId, "faceid-enroll");
    if (!ch || ch.userId !== user.id) return fail("That enrolment expired. Try again.", 400, { expired: true });

    const steps = ch.challenge.split(":")[1].split(",") as FaceStep[];
    const live = livenessProblem(steps, body.samples, { minMs: 1500, maxMs: Date.now() - ch.createdAt.getTime() + 1500 });
    if (live) return fail("The scan didn't complete properly — try again.", 422, { liveness: live });
    const problem = enrollmentProblem(body.samples);
    if (problem) return fail(problem, 422);

    const sealed = sealTemplate(body.samples.map((s) => s.descriptor));
    const keyId = templateKeyId();
    const row = await getDb().faceTemplate.upsert({
      where: { userId_keyId: { userId: user.id, keyId } },
      create: { userId: user.id, keyId, ...sealed, samples: body.samples.length },
      update: { ...sealed, samples: body.samples.length },
      select: { createdAt: true, updatedAt: true },
    });
    await setDeviceHint(user.id);
    return ok({ enrolled: true, enrolledAt: row.updatedAt });
  } catch (err) {
    return handleError(err);
  }
}
