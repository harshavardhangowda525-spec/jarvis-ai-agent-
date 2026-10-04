/**
 * Server side of the biometric gate. See lib/gate/token.ts for the cookie and
 * lib/gate/policy.ts for lockouts.
 *
 * Face unlock is WebAuthn with user verification REQUIRED, using the device's
 * platform authenticator — Windows Hello Face, Face ID, Touch ID, Android
 * biometrics. The device matches the face with its own secure hardware; JARVIS
 * receives only a signature from a key the device releases after a successful
 * match, and verifies it against the public key saved at enrolment. No face
 * images, templates or measurements are ever sent to or stored by JARVIS.
 */
import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { verifySession, SESSION_COOKIE, type SessionClaims } from "@/lib/auth/jwt";
import { getCurrentUser, type AuthUser } from "@/lib/auth/session";
import {
  GATE_COOKIE, GATE_DEVICE_COOKIE, deviceCookieOptions, gateCookieOptions, signGate, verifyGate,
  type GateClaims, type GateMethod,
} from "./token";
import { afterFailure, afterSuccess, lockedFor, type AttemptState } from "./policy";

export const CHALLENGE_TTL_MS = 3 * 60_000;

/** The signed-in session (validated against the Session table) and the gate state for it. */
export async function gateContext(): Promise<{ user: AuthUser | null; session: SessionClaims | null; gate: GateClaims | null }> {
  const user = await getCurrentUser();
  if (!user) return { user: null, session: null, gate: null };
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  const gate = await verifyGate(cookies().get(GATE_COOKIE)?.value, session ? { sub: session.sub, jti: session.jti } : null);
  return { user, session, gate };
}

/** Mark this browser session as unlocked. */
export async function setUnlocked(userId: string, sessionId: string, method: GateMethod) {
  cookies().set(GATE_COOKIE, await signGate({ sub: userId, sid: sessionId, method }), gateCookieOptions());
}
export function clearUnlocked() { cookies().delete(GATE_COOKIE); }
export function setDeviceHint(on: boolean) {
  if (on) cookies().set(GATE_DEVICE_COOKIE, "1", deviceCookieOptions());
  else cookies().delete(GATE_DEVICE_COOKIE);
}

/* ---------------- attempts & lockout ---------------- */

export async function attemptState(userId: string): Promise<AttemptState & { pinSet: boolean }> {
  const s = await getDb().gateSecurity.findUnique({ where: { userId } });
  return { failedCount: s?.failedCount ?? 0, lockouts: s?.lockouts ?? 0, lockedUntil: s?.lockedUntil ?? null, pinSet: !!s?.pinHash };
}

/** Milliseconds this user is still locked out for (0 = not locked). */
export async function lockRemaining(userId: string): Promise<number> {
  return lockedFor(await attemptState(userId));
}

export async function recordFailure(userId: string): Promise<{ lockedMs: number; attemptsLeft: number }> {
  const cur = await attemptState(userId);
  // a failure while already locked doesn't extend or count
  if (lockedFor(cur) > 0) return { lockedMs: lockedFor(cur), attemptsLeft: 0 };
  const next = afterFailure(cur);
  await getDb().gateSecurity.upsert({
    where: { userId },
    create: { userId, failedCount: next.failedCount, lockouts: next.lockouts, lockedUntil: next.lockedUntil },
    update: { failedCount: next.failedCount, lockouts: next.lockouts, lockedUntil: next.lockedUntil },
  });
  return { lockedMs: lockedFor(next), attemptsLeft: next.justLocked ? 0 : 5 - next.failedCount };
}

export async function recordSuccess(userId: string) {
  const s = afterSuccess();
  await getDb().gateSecurity.updateMany({ where: { userId }, data: { failedCount: s.failedCount, lockouts: s.lockouts, lockedUntil: null } });
}

/* ---------------- WebAuthn relying party ---------------- */

/** This site as WebAuthn sees it: the host the browser is on (works for localhost and the deployed domain). */
export function relyingParty(req: NextRequest): { rpID: string; origin: string; rpName: string } {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host).split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")).split(",")[0].trim();
  return { rpID: host.replace(/:\d+$/, ""), origin: `${proto}://${host}`, rpName: "JARVIS" };
}

/* ---------------- one-time challenges ---------------- */

/** Remember the challenge the WebAuthn options were built with; returns its id. */
export async function saveChallenge(kind: "register" | "unlock", userId: string | null, challenge: string): Promise<string> {
  const db = getDb();
  await db.gateChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  const row = await db.gateChallenge.create({ data: { challenge, kind, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) } });
  return row.id;
}

/** Take a challenge (single use). null if unknown, expired, of another kind or for another user. */
export async function consumeChallenge(id: string, kind: "register" | "unlock", userId: string | null): Promise<string | null> {
  const db = getDb();
  const row = await db.gateChallenge.findUnique({ where: { id } });
  if (!row) return null;
  const { count } = await db.gateChallenge.deleteMany({ where: { id } });
  if (!count) return null; // someone else used it first
  if (row.kind !== kind || row.expiresAt < new Date()) return null;
  if (userId !== null && row.userId !== userId) return null;
  return row.challenge;
}
