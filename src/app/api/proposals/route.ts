import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, handleError, rateLimit, fail } from "@/lib/api";
import { propose } from "@/lib/approvals/center";
import { JOB_AGENTS } from "@/lib/jobs/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ refKind: z.enum(["intel_item", "intel_opportunity"]), refId: z.string().min(1), agent: z.enum(JOB_AGENTS), title: z.string().max(160).optional(), detail: z.string().max(4000).optional() });

/** EVIE → JARVIS: propose an action from an insight. It waits in the Approval Center; nothing runs until you approve. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`propose:${user.id}`, 20, 60_000).allowed) return fail("Too many requests — wait a moment.", 429);
    const p = await propose(user.id, schema.parse(await req.json()));
    return ok({ proposal: { id: p.id, title: p.title, agent: p.agent, status: p.status } });
  } catch (e) {
    return handleError(e);
  }
}
