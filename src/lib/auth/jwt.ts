/**
 * Stateless session JWTs signed with AUTH_SECRET (HS256, via `jose`).
 * Edge-runtime compatible so middleware can verify without Node crypto.
 */
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

const ISSUER = "jarvis";
const AUDIENCE = "jarvis-web";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** Cookie name for the session JWT. Defined here so edge middleware can import
 *  it without pulling in Node-only modules. */
export const SESSION_COOKIE = "jarvis_session";

export interface SessionClaims {
  sub: string; // user id
  email: string;
  jti: string; // session id / token id
}

function secretKey(): Uint8Array {
  if (!env.authSecret) throw new Error("AUTH_SECRET is not configured");
  return new TextEncoder().encode(env.authSecret);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySession(
  token: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload.sub || !payload.jti) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      jti: String(payload.jti),
    };
  } catch {
    return null;
  }
}
