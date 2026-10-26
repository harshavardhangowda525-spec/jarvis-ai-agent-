import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { agentStatuses } from "@/lib/nexus/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every agent's real state, queue, recent work, integrations and capabilities. */
export async function GET() {
  try {
    const user = await requireUser();
    return ok(await agentStatuses(user.id));
  } catch (e) {
    return handleError(e);
  }
}
