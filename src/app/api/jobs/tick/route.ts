import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { runPending } from "@/lib/jobs/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Run your tasks that can start now (oldest first, dependencies in order), within one request. */
export async function POST() {
  try {
    const user = await requireUser();
    return ok({ ran: await runPending(user.id, 240_000) });
  } catch (e) {
    return handleError(e);
  }
}
