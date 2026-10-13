import { fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { ndjson, nextStep } from "@/lib/aston/site/builder";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Run the next build step, streaming the code as Groq writes it (NDJSON events). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:site:step:${user.id}`, 40, 60_000).allowed) return fail("Too many requests.", 429);
    return ndjson((emit) => nextStep(user.id, params.id, emit));
  } catch (err) {
    return astonError(err);
  }
}
