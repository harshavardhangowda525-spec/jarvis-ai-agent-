import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { CallError, callerEvent, callerFinish, callerNext, callerTurn } from "@/lib/calls/service";
import { isOwnerCall, ownerEvent, ownerFinish, ownerTurn } from "@/lib/calls/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("next") }),
  z.object({ action: z.literal("event"), id: z.string().min(1).max(40), state: z.enum(["answered", "heartbeat"]) }),
  z.object({ action: z.literal("turn"), id: z.string().min(1).max(40), heard: z.string().max(2000), opener: z.boolean().optional(), lang: z.enum(["en", "hi", "kn"]).nullable().optional(), interrupted: z.boolean().optional() }),
  z.object({ action: z.literal("finish"), id: z.string().min(1).max(40), reason: z.enum(["ended", "hung_up", "no_answer", "failed", "stopped", "timeout"]), error: z.string().max(400).nullable().optional() }),
]);

/** The caller in the JARVIS desktop orb (signed in as you): next call · answered/heartbeat · one exchange · call over. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`caller:${user.id}`, 240, 60_000).allowed) return fail("Too many requests.", 429);
    const b = Body.parse(await req.json());
    if (b.action === "next") return ok(await callerNext(user.id));
    // calls to you (laptop mode) and calls to leads share the caller, told apart by id
    const own = isOwnerCall(b.id);
    if (b.action === "event") return ok(own ? await ownerEvent(user.id, b.id, b.state) : await callerEvent(user.id, b.id, b.state));
    if (b.action === "turn") { const o = { opener: b.opener, lang: b.lang ?? null, interrupted: b.interrupted }; return ok(own ? await ownerTurn(user.id, b.id, b.heard, o) : await callerTurn(user.id, b.id, b.heard, o)); }
    return ok(own ? await ownerFinish(user.id, b.id, { reason: b.reason, error: b.error }) : await callerFinish(user.id, b.id, { reason: b.reason, error: b.error }));
  } catch (e) { return e instanceof CallError ? fail(e.message) : handleError(e); }
}
