import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { listProjects, requestFriday } from "@/lib/friday/service";
import { findBlender, installHint } from "@/lib/friday/blender";
import { VIEW_IDS, type ViewId } from "@/lib/friday/plan";
import { jobView } from "@/lib/jobs/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Friday's projects (newest first). */
export async function GET() {
  try {
    const user = await requireUser();
    return ok({ projects: (await listProjects(user.id)).map(({ folder: _f, ...p }) => { void _f; return p; }) });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({
  action: z.enum(["create", "edit", "render", "export"]),
  request: z.string().trim().max(3000).optional(),
  change: z.string().trim().max(1500).optional(),
  name: z.string().trim().max(80).optional(),
  projectId: z.string().max(60).optional(),
  version: z.number().int().positive().optional(),
  views: z.array(z.enum(VIEW_IDS as [ViewId, ...ViewId[]])).max(10).optional(),
  formats: z.array(z.enum(["stl", "gltf"])).max(2).optional(),
});

/** Start Friday's work (a tracked task with Blender's real progress). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`friday:${user.id}`, 20, 60_000);
    if (!rl.allowed) return fail("Too many requests — wait a moment.", 429);
    const b = schema.parse(await req.json());
    if (!findBlender()) return fail(`Blender isn't installed on the computer running JARVIS. ${installHint()}`, 503);
    try {
      return ok({ job: jobView(await requestFriday(user.id, b)) });
    } catch (e) {
      return fail((e as Error).message, 409);
    }
  } catch (e) {
    return handleError(e);
  }
}
