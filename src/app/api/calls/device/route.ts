import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { finderUserId } from "@/lib/prospects/service";
import { callsWanted } from "@/lib/calls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** JARVIS's helper on your laptop asks: should the calling window be open? (calls to you, or calling leads, switched on) */
export async function GET(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!rateLimit(`calls-device:${ip}`, 30, 60_000).allowed) return fail("Too many requests.", 429);
    const userId = await finderUserId(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim());
    if (!userId) return fail("This laptop isn't connected to JARVIS.", 401);
    return ok(await callsWanted(userId));
  } catch (e) { return handleError(e); }
}
