/**
 * Server-side session helpers: read the current user from the request cookie,
 * create + revoke sessions (persisted in the Session table so they can be
 * listed and revoked from Settings → Security).
 */
import "server-only";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import {
  signSession,
  verifySession,
  SESSION_MAX_AGE_SECONDS,
  SESSION_COOKIE,
} from "./jwt";

export { SESSION_COOKIE };

export interface AuthUser {
  id: string;
  email: string;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/** Issue a new session: persist a row, sign a JWT, set the cookie. */
export async function createSession(
  user: AuthUser,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<string> {
  const db = getDb();
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.session.create({
    data: {
      userId: user.id,
      tokenId,
      userAgent: meta.userAgent?.slice(0, 500),
      ipAddress: meta.ipAddress,
      expiresAt,
    },
  });
  const token = await signSession({ sub: user.id, email: user.email, jti: tokenId });
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions());
  return token;
}

/** Resolve the authenticated user from the cookie, validating the session row. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySession(token);
  if (!claims) return null;

  try {
    const db = getDb();
    const session = await db.session.findUnique({
      where: { tokenId: claims.jti },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return null;
    }
    return { id: claims.sub, email: claims.email };
  } catch {
    return null;
  }
}

/** Revoke the current session and clear the cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    const claims = await verifySession(token);
    if (claims) {
      try {
        await getDb().session.updateMany({
          where: { tokenId: claims.jti, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } catch {
        // ignore — cookie clear below is the important part
      }
    }
  }
  cookies().delete(SESSION_COOKIE);
}

/** Throw-if-unauthenticated helper for route handlers. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}
