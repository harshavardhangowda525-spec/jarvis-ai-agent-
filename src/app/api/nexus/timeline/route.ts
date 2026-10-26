import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { jobView } from "@/lib/jobs/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tasks for the orchestration timeline: ?days=1..30&agent=&status=&q= — with their real timestamps, steps, dependencies and results. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const u = new URL(req.url);
    const days = Math.min(30, Math.max(1, Number(u.searchParams.get("days")) || 3));
    const agent = u.searchParams.get("agent");
    const status = u.searchParams.get("status");
    const q = u.searchParams.get("q")?.trim();
    const jobs = await getDb().agentJob.findMany({
      where: {
        userId: user.id,
        OR: [{ createdAt: { gte: new Date(Date.now() - days * 86_400_000) } }, { status: { in: ["planning", "assigned", "running", "waiting_approval"] } }],
        ...(agent ? { agent } : {}), ...(status ? { status } : {}),
        ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { request: { contains: q, mode: "insensitive" as const } }] } : {}),
      },
      orderBy: { createdAt: "asc" }, take: 200,
    });
    return ok({ jobs: jobs.map((j) => ({ ...jobView(j), request: j.request, createdAt: j.createdAt.toISOString(), startedAt: j.startedAt?.toISOString() ?? null, finishedAt: j.finishedAt?.toISOString() ?? null, dependsOn: j.dependsOn, attempts: j.attempts, cancelRequested: j.cancelRequested })) });
  } catch (e) {
    return handleError(e);
  }
}
