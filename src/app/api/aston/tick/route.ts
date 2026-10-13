import { ok, fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { tick } from "@/lib/aston/tick";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Run one ASTON cycle now (throttled to once every 2 minutes unless forced). */
export async function POST(req: Request) {
  try {
    const user = await requireOwner();
    const force = new URL(req.url).searchParams.get("force") === "1";
    if (force && !rateLimit(`aston:tick:${user.id}`, 6, 60_000).allowed) return fail("Too many requests.", 429);
    return ok(await tick(user.id, { force }));
  } catch (err) {
    return astonError(err);
  }
}
