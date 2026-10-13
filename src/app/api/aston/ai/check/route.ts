import { ok, fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { verifyGroq } from "@/lib/aston/groq";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A real Groq check: the model is listed, can call a tool, and can return JSON. */
export async function POST() {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:aicheck:${user.id}`, 3, 10 * 60_000).allowed) return fail("Checked recently — try again in a few minutes.", 429);
    return ok(await verifyGroq());
  } catch (err) {
    return astonError(err);
  }
}
