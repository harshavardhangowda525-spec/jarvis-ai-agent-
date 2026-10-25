import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { internalSnapshot } from "@/lib/intel/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Internal business metrics (CRM, leads, projects) — shown on its own tab, not in the command center. */
export async function GET() {
  try {
    const user = await requireUser();
    return ok(await internalSnapshot(user.id));
  } catch (e) {
    return handleError(e);
  }
}
