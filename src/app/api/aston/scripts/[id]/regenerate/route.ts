import { z } from "zod";
import { ok, fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { generateScript, getScript } from "@/lib/aston/scripts/service";
import { detailsSchema, SCRIPT_KINDS } from "@/lib/aston/scripts/format";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ request: z.string().trim().min(3).max(1500).optional(), kind: z.enum(SCRIPT_KINDS).optional(), details: detailsSchema.optional() });

/** Rewrite a script's content (optionally with new business details / type). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:script:gen:${user.id}`, 30, 60 * 60_000).allowed) return fail("That's a lot of scripts this hour — try again a bit later.", 429);
    const body = schema.parse(await req.json().catch(() => ({})));
    const cur = await getScript(user.id, params.id);
    return ok(await generateScript(user.id, { id: cur.id, request: body.request ?? cur.request, kind: body.kind ?? cur.kind, details: body.details ?? cur.details }));
  } catch (err) {
    return astonError(err);
  }
}
