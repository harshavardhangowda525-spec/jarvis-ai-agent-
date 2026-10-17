import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { listSites, requestBuild } from "@/lib/aston/service";
import { jobView } from "@/lib/jobs/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ASTON's demos (newest first). */
export async function GET() {
  try {
    const user = await requireUser();
    return ok({ sites: await listSites(user.id) });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({ request: z.string().trim().min(5).max(2000), kind: z.enum(["website", "app"]).optional(), leadId: z.string().max(60).optional(), business: z.string().trim().max(120).optional() });

/** Ask ASTON for a new demo — a tracked task (it runs like any delegated task). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`aston:${user.id}`, 20, 60_000);
    if (!rl.allowed) return fail("Too many requests — wait a moment.", 429);
    const b = schema.parse(await req.json());
    try {
      return ok({ job: jobView(await requestBuild(user.id, b)) });
    } catch (e) {
      return fail((e as Error).message, 409);
    }
  } catch (e) {
    return handleError(e);
  }
}
