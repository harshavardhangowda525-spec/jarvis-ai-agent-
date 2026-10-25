import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { jobView } from "@/lib/jobs/engine";
import { listStudioProjects, requestStudio } from "@/lib/aston/studio/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ASTON's website projects (newest first). */
export async function GET() {
  try {
    const user = await requireUser();
    return ok({ projects: await listStudioProjects(user.id) });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({ request: z.string().trim().min(5).max(4000), name: z.string().trim().max(80).optional(), client: z.string().trim().max(120).optional() });

/** Build a new website: the project is created now, the build runs as a tracked ASTON task. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`studio:${user.id}`, 10, 60_000).allowed) return fail("Too many requests — wait a moment.", 429);
    const b = schema.parse(await req.json());
    const { project, job } = await requestStudio(user.id, b);
    return ok({ project: { id: project.id, name: project.name }, job: jobView(job), studio: `/dashboard/aston/studio?project=${project.id}` });
  } catch (e) {
    return handleError(e);
  }
}
