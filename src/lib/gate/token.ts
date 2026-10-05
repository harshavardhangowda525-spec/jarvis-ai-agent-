/**
 * The gate cookie: proof that THIS browser session passed the biometric gate
 * (face via the device's biometric system, or the PIN / password fallback).
 *
 * - A browser-session cookie (no Max-Age): closing the browser locks JARVIS.
 * - Signed (HS256, AUTH_SECRET) and bound to the sign-in session it was issued
 *   for (user id + session id): signing out, or a different account, locks it.
 * - Expires on the server side after GATE_TTL_SECONDS regardless.
 * Edge-runtime compatible, so middleware can enforce it.
 */
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

export const GATE_COOKIE = "jarvis_gate";
/** "Face unlock was set up on this device for <user>" (signed): the gate can offer face sign-in before login. */
export const GATE_DEVICE_COOKIE = "jarvis_gate_device";
export const GATE_TTL_SECONDS = 60 * 60 * 12; // 12 h
/** Security settings (enrol/remove a face, change the PIN) need an unlock this recent. */
export const GATE_FRESH_SECONDS = 60 * 10;

export type GateMethod = "face" | "pin" | "password" | "signin";
export interface GateClaims { sub: string; sid: string; method: GateMethod; iat: number; exp: number }

const AUD = "jarvis-gate";
const key = () => {
  if (!env.authSecret) throw new Error("AUTH_SECRET is not configured");
  return new TextEncoder().encode(env.authSecret);
};

export async function signGate(c: { sub: string; sid: string; method: GateMethod }): Promise<string> {
  return new SignJWT({ sid: c.sid, method: c.method })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.sub)
    .setIssuer("jarvis")
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(`${GATE_TTL_SECONDS}s`)
    .sign(key());
}

/** Valid only for the given sign-in session (user id + session id). */
export async function verifyGate(token: string | undefined, session: { sub: string; jti: string } | null): Promise<GateClaims | null> {
  if (!token || !session) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "jarvis", audience: AUD });
    if (payload.sub !== session.sub || payload.sid !== session.jti) return null;
    const method = String(payload.method) as GateMethod;
    return { sub: session.sub, sid: session.jti, method, iat: Number(payload.iat), exp: Number(payload.exp) };
  } catch {
    return null;
  }
}

export function gateCookieOptions() {
  // no maxAge/expires → a browser-session cookie
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
}
export async function signDeviceHint(userId: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuer("jarvis").setAudience("jarvis-gate-device")
    .setIssuedAt().setExpirationTime("365d").sign(key());
}
/** The user this device's face sign-in is for (null if absent, old-style or forged). */
export async function verifyDeviceHint(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "jarvis", audience: "jarvis-gate-device" });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export function deviceCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 365 };
}

export const isFresh = (g: GateClaims | null, nowSec = Math.floor(Date.now() / 1000)) => !!g && nowSec - g.iat <= GATE_FRESH_SECONDS;

/** API paths that work while JARVIS is locked (signing in, unlocking, health checks, secret-protected crons). */
export function apiOpenWhileLocked(pathname: string): boolean {
  return /^\/api\/(auth|gate|health|version|cron)(\/|$)/.test(pathname);
}
