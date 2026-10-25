import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { currentWeekPreview } from "@/lib/trading/reports";
import { NoPlaybookSource } from "@/lib/trading/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** This week so far (live from the playbook, not stored). */
export async function GET() {
  try {
    const user = await requireUser();
    try {
      return ok(await currentWeekPreview(user.id));
    } catch (e) {
      if (e instanceof NoPlaybookSource) return fail(e.detail, 409);
      throw e;
    }
  } catch (e) {
    return handleError(e);
  }
}
