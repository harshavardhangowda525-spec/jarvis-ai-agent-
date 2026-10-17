import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { getDb } from "@/lib/db";
import { cancelJob, jobView, markAnnounced, resumeJob, retryJob, runJob } from "@/lib/jobs/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a task runs inside this request (the agent's own brain and tools)
export const maxDuration = 300;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const j = await getDb().agentJob.findFirst({ where: { id: params.id, userId: user.id } });
    return j ? ok({ job: jobView(j) }) : fail("No such task.", 404);
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({ action: z.enum(["run", "cancel", "retry", "approve", "announced"]), note: z.string().max(300).optional() });

/** run (start it now, if it can run) · cancel · retry · approve (it was waiting for your OK) · announced */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`jobs:${user.id}`, 60, 60_000);
    if (!rl.allowed) return fail("Too many requests — wait a moment.", 429);
    const b = schema.parse(await req.json());
    const own = await getDb().agentJob.findFirst({ where: { id: params.id, userId: user.id }, select: { id: true } });
    if (!own) return fail("No such task.", 404);
    try {
      if (b.action === "run") {
        const r = await runJob(params.id);
        const j = r ?? (await getDb().agentJob.findUnique({ where: { id: params.id } }))!;
        return ok({ ran: !!r, job: jobView(j) });
      }
      if (b.action === "cancel") return ok({ job: jobView((await cancelJob(user.id, params.id)).job) });
      if (b.action === "retry") return ok({ job: jobView(await retryJob(user.id, params.id)) });
      if (b.action === "approve") return ok({ job: jobView(await resumeJob(user.id, params.id, b.note?.trim() || "go ahead")) });
      await markAnnounced(user.id, [params.id]);
      return ok({ announced: true });
    } catch (e) {
      return fail((e as Error).message, 409);
    }
  } catch (e) {
    return handleError(e);
  }
}
