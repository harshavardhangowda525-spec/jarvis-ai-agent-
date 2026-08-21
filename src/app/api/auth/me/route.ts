import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return fail("Not authenticated.", 401);

    const profile = await getDb().profile.findUnique({
      where: { userId: user.id },
    });

    return ok({
      id: user.id,
      email: user.email,
      displayName: profile?.displayName ?? null,
      assistantName: profile?.assistantName ?? "JARVIS",
      timezone: profile?.timezone ?? "UTC",
    });
  } catch (err) {
    return handleError(err);
  }
}
