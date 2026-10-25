import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { jobView } from "@/lib/jobs/engine";
import { requestStudioAction, studioDetail } from "@/lib/aston/studio/service";
import { deployProject, prepareDeploy } from "@/lib/aston/studio/deploy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const d = await studioDetail(user.id, params.id);
    return d ? ok({ project: d }) : fail("Not found.", 404);
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change"), change: z.string().trim().min(3).max(3000) }),
  z.object({ action: z.literal("test") }),
  z.object({ action: z.literal("fix") }),
  z.object({ action: z.literal("prepare_deploy") }),
  z.object({ action: z.literal("deploy"), confirm: z.literal(true) }),
]);

/** change / test / fix (new versions, as tracked tasks) · prepare_deploy (checks only) · deploy (only when you confirm) */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    if (!rateLimit(`studio:${user.id}`, 20, 60_000).allowed) return fail("Too many requests — wait a moment.", 429);
    const b = schema.parse(await req.json());
    try {
      if (b.action === "prepare_deploy") return ok({ check: await prepareDeploy(user.id, params.id) });
      if (b.action === "deploy") return ok({ deploy: await deployProject(user.id, params.id) });
      const { job } = await requestStudioAction(user.id, params.id, b.action, b.action === "change" ? b.change : undefined);
      return ok({ job: jobView(job) });
    } catch (e) {
      return fail((e as Error).message, 409);
    }
  } catch (e) {
    return handleError(e);
  }
}
