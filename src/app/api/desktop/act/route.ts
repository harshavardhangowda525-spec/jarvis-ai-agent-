import { z } from "zod";
import { callerUser } from "@/lib/calls/device-auth";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { DesktopError, nextStep } from "@/lib/desktop/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  id: z.string().max(40),
  image: z.string().startsWith("data:image/").max(8 * 1024 * 1024),
  elements: z.array(z.object({ id: z.number().int(), name: z.string().max(300), role: z.string().max(60), x: z.number(), y: z.number(), w: z.number(), h: z.number(), password: z.boolean().optional() })).max(300),
  history: z.array(z.string().max(300)).max(60),
  screen: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
});

/** The orb, mid-job: here's the screen — what's the next step? */
export async function POST(req: Request) {
  try {
    const user = await callerUser(req);
    if (!rateLimit(`desktop-act:${user.id}`, 60, 60_000).allowed) return fail("Too many steps — slow down.", 429);
    const b = Body.parse(await req.json());
    return ok(await nextStep(user.id, b.id, b));
  } catch (e) { return e instanceof DesktopError ? fail(e.message, 503) : handleError(e); }
}
