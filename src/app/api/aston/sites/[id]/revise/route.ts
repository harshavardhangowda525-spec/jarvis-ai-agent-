import { z } from "zod";
import { fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { ndjson, reviseSite } from "@/lib/aston/site/builder";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({ instruction: z.string().trim().min(3).max(800) });

/** Change a finished website ("make the hero darker"), streamed live. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:site:revise:${user.id}`, 20, 60 * 60_000).allowed) return fail("Too many changes this hour — try again later.", 429);
    const { instruction } = schema.parse(await req.json());
    return ndjson((emit) => reviseSite(user.id, params.id, instruction, emit));
  } catch (err) {
    return astonError(err);
  }
}
