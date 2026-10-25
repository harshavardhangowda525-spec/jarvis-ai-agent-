import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { projectView } from "@/lib/friday/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One project: versions, verified renders, parts, specs and history. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const p = await projectView(user.id, params.id);
    return p ? ok({ project: p }) : fail("Not found.", 404);
  } catch (e) {
    return handleError(e);
  }
}

const patch = z.object({ activeVersion: z.number().int().positive().optional(), label: z.object({ n: z.number().int().positive(), label: z.string().trim().max(60) }).optional() });

/** Switch the active version, or label one ("save as"). Files are never touched. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const b = patch.parse(await req.json());
    const p = await getDb().fridayProject.findFirst({ where: { id: params.id, userId: user.id } });
    if (!p) return fail("Not found.", 404);
    if (b.activeVersion) {
      const v = await getDb().fridayVersion.findUnique({ where: { projectId_n: { projectId: p.id, n: b.activeVersion } } });
      if (!v || v.status !== "ready") return fail("Only a finished version can be made active.", 409);
      await getDb().fridayProject.update({ where: { id: p.id }, data: { activeVersion: v.n } });
    }
    if (b.label) await getDb().fridayVersion.update({ where: { projectId_n: { projectId: p.id, n: b.label.n } }, data: { label: b.label.label || null } });
    return ok({ project: await projectView(user.id, p.id) });
  } catch (e) {
    return handleError(e);
  }
}
