import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";

/** Disconnect an integration: revoke locally and clear stored tokens. */
export async function POST(_req: NextRequest, { params }: { params: { provider: string } }) {
  try {
    const user = await requireUser();
    await getDb().integration.updateMany({
      where: { userId: user.id, provider: params.provider },
      data: { status: "disconnected", accessToken: null, refreshToken: null, expiresAt: null },
    });
    return ok({ disconnected: true });
  } catch (err) {
    return handleError(err);
  }
}
