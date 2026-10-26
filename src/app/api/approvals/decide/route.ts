import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { decide } from "@/lib/approvals/center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  kind: z.enum(["job", "darwin_message", "ev_daily", "proposal", "failed_job", "review"]),
  id: z.string().min(1).max(60),
  decision: z.enum(["approve", "reject", "revise", "retry", "reviewed"]),
  note: z.string().max(6000).optional(),
});

/** One explicit decision from you (a button press) — carried out and recorded. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`decide:${user.id}`, 30, 60_000).allowed) return fail("Too many requests — wait a moment.", 429);
    const r = await decide(user.id, schema.parse(await req.json()));
    return r.ok ? ok(r) : fail(r.detail, 409);
  } catch (e) {
    return handleError(e);
  }
}
