import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { approveVersion, requestChanges, rotateLink, siteDetail } from "@/lib/aston/service";
import { jobView } from "@/lib/jobs/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One demo: versions (with their check results), the walkthrough script, the preview link. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const s = await siteDetail(user.id, params.id);
    return s ? ok({ site: s }) : fail("No such demo.", 404);
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("changes"), feedback: z.string().trim().min(3).max(1500) }),
  z.object({ action: z.literal("approve"), version: z.number().int().positive() }),
  z.object({ action: z.literal("rotate") }),
]);

/** changes (a revision task → a new version) · approve (a record only — nothing is deployed) · rotate (new preview link) */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`aston:${user.id}`, 30, 60_000);
    if (!rl.allowed) return fail("Too many requests — wait a moment.", 429);
    const b = schema.parse(await req.json());
    try {
      if (b.action === "changes") return ok({ job: jobView(await requestChanges(user.id, params.id, b.feedback)) });
      if (b.action === "approve") { await approveVersion(user.id, params.id, b.version); return ok({ approved: b.version }); }
      return ok({ url: await rotateLink(user.id, params.id) });
    } catch (e) {
      return fail((e as Error).message, 409);
    }
  } catch (e) {
    return handleError(e);
  }
}
