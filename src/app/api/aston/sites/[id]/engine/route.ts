import { z } from "zod";
import { ok, fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { setEngine } from "@/lib/aston/site/builder";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ engine: z.enum(["groq", "claude-code"]), model: z.enum(["opus", "sonnet", "haiku"]).optional() });

/** Switch a website to another engine — only ever on the owner's request. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:site:engine:${user.id}`, 20, 60_000).allowed) return fail("Too many requests.", 429);
    const { engine, model } = schema.parse(await req.json());
    return ok(await setEngine(user.id, params.id, engine, model));
  } catch (err) {
    return astonError(err);
  }
}
