import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { jobView, listJobs, runnableJobs, unannounced } from "@/lib/jobs/engine";
import { JOB_AGENTS } from "@/lib/jobs/brief";
import { dispatchTask, quickBrief, titleOf } from "@/lib/jobs/dispatch";

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

const createSchema = z.object({
  agent: z.enum(JOB_AGENTS),
  text: z.string().trim().min(3).max(2000),
  dependsOn: z.array(z.string().max(40)).max(5).optional(),
});

/**
 * An instruction typed (or spoken) straight into an agent's pop-up: it becomes
 * the same tracked task JARVIS's delegation creates, run on the server by that
 * agent's own brain and tools.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`jobs-create:${user.id}`, 20, 60_000).allowed) return fail("Too many requests — wait a moment.", 429);
    const b = createSchema.parse(await req.json());
    const kind = b.agent === "aston" ? (/\b(app|application|mobile)\b/i.test(b.text) && !/web ?app|website/i.test(b.text) ? "app" : "website") : undefined;
    const { job, studio } = await dispatchTask(user.id, { agent: b.agent, title: titleOf(b.text), request: b.text, brief: quickBrief(b.text), dependsOn: b.dependsOn, kind });
    return ok({ job: jobView(job), studio });
  } catch (e) {
    return e instanceof Error && /depends on doesn't exist/.test(e.message) ? fail(e.message) : handleError(e);
  }
}
