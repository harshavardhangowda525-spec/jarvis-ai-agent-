import { z } from "zod";
import { ok, fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { decide, DECISIONS } from "@/lib/aston/decisions";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  action: z.enum(DECISIONS),
  note: z.string().max(1000).optional(),
  // Required (true) for "approve" — consequential actions are never one accidental click.
  confirm: z.boolean().optional(),
});

/** The owner's decision on an incident: acknowledge | resolve | dismiss | approve | reject | recheck. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:decide:${user.id}`, 30, 60_000).allowed) return fail("Too many requests.", 429);
    const body = schema.parse(await req.json());
    return ok(await decide(user.id, params.id, body.action, { note: body.note, confirm: body.confirm }));
  } catch (err) {
    return astonError(err);
  }
}
