import { z } from "zod";
import { ok, fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { chat } from "@/lib/aston/chat";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) })).min(1).max(30),
});

export async function POST(req: Request) {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:chat:${user.id}`, 20, 60_000).allowed) return fail("Slow down a little — too many messages.", 429);
    const { messages } = schema.parse(await req.json());
    return ok(await chat(user.id, messages));
  } catch (err) {
    return astonError(err);
  }
}
