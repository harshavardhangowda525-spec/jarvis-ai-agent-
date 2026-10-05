import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit, clientIp } from "@/lib/api";
import {
  deviceHintUser, faceTemplateFor, gateContext, lockRemaining, recordFailure, recordSuccess, setDeviceHint, setUnlocked, takeChallenge,
} from "@/lib/gate/server";
import { livenessProblem, matchProbes, type FaceProbe, type FaceStep } from "@/lib/gate/face-match";

export const runtime = "nodejs";

const NOT_RECOGNIZED = "Identity not recognized.";

/**
 * Finish a JARVIS Face ID scan: the browser sends the face descriptors it
 * captured during the liveness steps (numbers — never images). The server
 * checks the steps were performed, compares every descriptor with the
 * encrypted enrolment, and only then unlocks (or, signed out, signs in).
 */
export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`faceid-v:${clientIp(req)}`, 20, 60_000);
    if (!rl.allowed) return fail("Too many attempts. Try again in a minute.", 429);
    const body = (await req.json().catch(() => null)) as { challengeId?: string; probes?: FaceProbe[] } | null;
    if (!body?.challengeId || !Array.isArray(body.probes) || body.probes.length > 12) return fail("Invalid request.", 422);

    const [{ user, session }, ch] = await Promise.all([gateContext(), takeChallenge(body.challengeId, "faceid-unlock")]);
    if (!ch?.userId) return fail("That scan expired. Try again.", 400, { expired: true });
    const target = ch.userId;
    // signed in: it must be your own challenge; signed out: this device's face sign-in user
    if (user ? user.id !== target : (await deviceHintUser()) !== target) return fail("That scan expired. Try again.", 400, { expired: true });

    // independent lookups at once: the lockout and the (encrypted) enrolment
    const [locked, tpl] = await Promise.all([lockRemaining(target), faceTemplateFor(target)]);
    if (locked > 0) return fail("Too many failed attempts.", 423, { lockedMs: locked });

    const steps = ch.challenge.split(":")[1].split(",") as FaceStep[];
    const elapsed = Date.now() - ch.createdAt.getTime();
    // the probes can't claim more time than really passed since the challenge was issued
    const live = livenessProblem(steps, body.probes, { minMs: 250, maxMs: elapsed + 1500 });
    if (live) {
      const r = await recordFailure(target);
      return fail(NOT_RECOGNIZED, r.lockedMs > 0 ? 423 : 401, { ...r, liveness: true });
    }

    if (!tpl) return fail("No face is enrolled yet.", 404, { notEnrolled: true });
    const m = matchProbes(tpl.descriptors, body.probes.map((p) => p.descriptor));
    if (!m.ok) {
      const r = await recordFailure(target);
      return fail(NOT_RECOGNIZED, r.lockedMs > 0 ? 423 : 401, r);
    }

    const cleared = recordSuccess(target);
    if (user && session) await setUnlocked(user.id, session.jti, "face");
    else {
      const u = await getDb().user.findUnique({ where: { id: target }, select: { id: true, email: true } });
      if (!u) return fail(NOT_RECOGNIZED, 401);
      await createSession(u, { userAgent: req.headers.get("user-agent") ?? undefined, ipAddress: clientIp(req), gateMethod: "face" });
    }
    await Promise.all([setDeviceHint(target), cleared]);
    return ok({ unlocked: true, signedIn: !user });
  } catch (err) {
    return handleError(err);
  }
}
