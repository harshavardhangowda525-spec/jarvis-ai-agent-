import { z } from "zod";
import { callerUser } from "@/lib/calls/device-auth";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { CallError, callerEvent, callerFinish, callerNext, callerTurn } from "@/lib/calls/service";
import { setLive } from "@/lib/calls/live";
import { isPersonalCall, personalEvent, personalFinish, personalTurn, PersonalCallError } from "@/lib/calls/personal";
import { isOwnerCall, ownerEvent, ownerFinish, ownerTurn } from "@/lib/calls/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("next") }),
  z.object({ action: z.literal("status"), running: z.boolean(), via: z.string().max(20).nullable().optional(), wait: z.string().max(300).nullable().optional(), error: z.string().max(400).nullable().optional(),
    checks: z.array(z.object({ label: z.string().max(120), ok: z.boolean().nullable(), detail: z.string().max(400).optional() })).max(20),
    lines: z.array(z.object({ who: z.enum(["jarvis", "them", "info"]), text: z.string().max(2000), at: z.number() })).max(60) }),
  z.object({ action: z.literal("event"), id: z.string().min(1).max(40), state: z.enum(["answered", "heartbeat"]) }),
  z.object({ action: z.literal("turn"), id: z.string().min(1).max(40), heard: z.string().max(2000), opener: z.boolean().optional(), lang: z.enum(["en", "hi", "kn"]).nullable().optional(), interrupted: z.boolean().optional() }),
  z.object({ action: z.literal("finish"), id: z.string().min(1).max(40), reason: z.enum(["ended", "hung_up", "no_answer", "failed", "stopped", "timeout"]), error: z.string().max(2000).nullable().optional() }),
]);

/** The caller in the JARVIS desktop orb (signed in as you): next call · answered/heartbeat · one exchange · call over. */
export async function POST(req: Request) {
  try {
    const user = await callerUser(req);
    if (!rateLimit(`caller:${user.id}`, 240, 60_000).allowed) return fail("Too many requests.", 429);
    const b = Body.parse(await req.json());
    if (b.action === "next") return ok(await callerNext(user.id));
    if (b.action === "status") { setLive(user.id, { running: b.running, via: b.via ?? null, wait: b.wait ?? null, error: b.error ?? null, checks: b.checks, lines: b.lines }); return ok({ saved: true }); }
    // calls to you (laptop mode) and calls to leads share the caller, told apart by id
    const own = isOwnerCall(b.id), per = isPersonalCall(b.id);
    if (b.action === "event") return ok(own ? await ownerEvent(user.id, b.id, b.state) : per ? await personalEvent(user.id, b.id, b.state) : await callerEvent(user.id, b.id, b.state));
    if (b.action === "turn") { const o = { opener: b.opener, lang: b.lang ?? null, interrupted: b.interrupted }; return ok(own ? await ownerTurn(user.id, b.id, b.heard, o) : per ? await personalTurn(user.id, b.id, b.heard, o) : await callerTurn(user.id, b.id, b.heard, o)); }
    const fin = { reason: b.reason, error: b.error };
    return ok(own ? await ownerFinish(user.id, b.id, fin) : per ? await personalFinish(user.id, b.id, fin) : await callerFinish(user.id, b.id, fin));
  } catch (e) { return e instanceof CallError || e instanceof PersonalCallError ? fail(e.message) : handleError(e); }
}
