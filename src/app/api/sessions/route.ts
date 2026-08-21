import { NextRequest } from "next/server";
import { requireUser, SESSION_COOKIE } from "@/lib/auth/session";
import { verifySession } from "@/lib/auth/jwt";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List active sessions for Settings → Security. */
export async function GET() {
  try {
    const user = await requireUser();
    const token = cookies().get(SESSION_COOKIE)?.value;
    const claims = token ? await verifySession(token) : null;

    const sessions = await getDb().session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, tokenId: true, userAgent: true, ipAddress: true, createdAt: true },
      take: 50,
    });
    return ok({
      sessions: sessions.map((s) => ({
        id: s.id,
        current: s.tokenId === claims?.jti,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

/** Revoke all other sessions (sign out everywhere else). */
export async function DELETE() {
  try {
    const user = await requireUser();
    const token = cookies().get(SESSION_COOKIE)?.value;
    const claims = token ? await verifySession(token) : null;
    await getDb().session.updateMany({
      where: { userId: user.id, revokedAt: null, NOT: { tokenId: claims?.jti ?? "" } },
      data: { revokedAt: new Date() },
    });
    return ok({ revoked: true });
  } catch (err) {
    return handleError(err);
  }
}
