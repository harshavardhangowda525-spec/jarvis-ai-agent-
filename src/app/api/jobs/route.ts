import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { listJobs, runnableJobs, unannounced } from "@/lib/jobs/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Your delegated tasks (?status=active|finished|all), which ones can start now,
 * and the finished ones JARVIS hasn't announced yet. Reading also recovers
 * tasks whose runner stopped (a restart).
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const st = new URL(req.url).searchParams.get("status");
    const status = st === "active" || st === "finished" ? st : "all";
    const [jobs, runnable, announce] = await Promise.all([listJobs(user.id, { status, take: 100 }), runnableJobs(user.id), unannounced(user.id)]);
    return ok({ jobs, runnable, announce });
  } catch (e) {
    return handleError(e);
  }
}
