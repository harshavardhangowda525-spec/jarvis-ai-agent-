import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { callerUser } from "@/lib/calls/device-auth";
import { ok, fail, handleError } from "@/lib/api";
import { DesktopError, laptopOnline, nextTask, queueTask, recentTasks, reportTask, stopTask } from "@/lib/desktop/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent laptop jobs (?status=1: is the laptop's JARVIS helper online?). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (new URL(req.url).searchParams.get("status")) return ok({ online: await laptopOnline(user.id) });
    return ok(await recentTasks(user.id));
  }
  catch (e) { return handleError(e); }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("queue"), goal: z.string().min(1).max(1000) }),
  z.object({ action: z.literal("next") }),
  z.object({ action: z.literal("report"), id: z.string().max(40), step: z.object({ say: z.string().max(300), action: z.string().max(300) }).nullable().optional(), status: z.enum(["running", "done", "failed", "stopped"]).optional(), result: z.string().max(1000).nullable().optional() }),
  z.object({ action: z.literal("stop"), id: z.string().max(40) }),
]);

/** queue (you / JARVIS) · next (JARVIS's helper on the laptop picks a job up) · report (progress / result) · stop. */
export async function POST(req: Request) {
  try {
    const user = await callerUser(req);
    const b = Body.parse(await req.json());
    // the laptop's own key may only pick up and report jobs — queueing and stopping are yours
    if (req.headers.get("authorization") && (b.action === "queue" || b.action === "stop")) return fail("Not allowed with the laptop key.", 403);
    if (b.action === "queue") return ok(await queueTask(user.id, b.goal), { status: 201 });
    if (b.action === "next") return ok({ task: await nextTask(user.id) });
    if (b.action === "stop") { await stopTask(user.id, b.id); return ok({ stopped: true }); }
    return ok(await reportTask(user.id, b.id, b));
  } catch (e) { return e instanceof DesktopError ? fail(e.message) : handleError(e); }
}
