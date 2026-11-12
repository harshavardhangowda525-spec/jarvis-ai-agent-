import { z } from "zod";
import { callerUser } from "@/lib/calls/device-auth";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { lookAtScreen } from "@/lib/desktop/look";
import { DesktopError } from "@/lib/desktop/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const Body = z.object({
  image: z.string().startsWith("data:image/").max(8_000_000),
  screen: z.object({ w: z.number().int().min(100).max(10000), h: z.number().int().min(100).max(10000) }),
  find: z.string().max(400).nullable().optional(),
  question: z.string().max(400).nullable().optional(),
}).refine((b) => b.find || b.question, "Say what to find or ask.");

/** JARVIS's helper on the laptop: where is this on the screen / is this showing? (laptop key) */
export async function POST(req: Request) {
  try {
    const user = await callerUser(req);
    if (!rateLimit(`desktop-look:${user.id}`, 40, 60_000).allowed) return fail("Too many looks — slow down.", 429);
    return ok(await lookAtScreen(Body.parse(await req.json())));
  } catch (e) { return e instanceof DesktopError ? fail(e.message) : handleError(e); }
}
