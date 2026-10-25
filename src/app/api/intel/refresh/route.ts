import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { refreshNow } from "@/lib/intel/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const user = await requireUser();
    if (!rateLimit(`intel-refresh:${user.id}`, 4, 60_000).allowed) return fail("Too many refreshes — wait a moment.", 429);
    return ok(await refreshNow(user.id));
  } catch (e) {
    return handleError(e);
  }
}
