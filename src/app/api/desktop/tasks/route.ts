import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { DesktopError, nextTask, queueTask, recentTasks, reportTask, stopTask } from "@/lib/desktop/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent laptop jobs. */
export async function GET() {
  try { const user = await requireUser(); return ok(await recentTasks(user.id)); }
  catch (e) { return handleError(e); }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("queue"), goal: z.string().min(1).max(1000) }),
  z.object({ action: z.literal("next") }),
  z.object({ action: z.literal("report"), id: z.string().max(40), step: z.object({ say: z.string().max(300), action: z.string().max(300) }).nullable().optional(), status: z.enum(["running", "done", "failed", "stopped"]).optional(), result: z.string().max(1000).nullable().optional() }),
  z.object({ action: z.literal("stop"), id: z.string().max(40) }),
]);

/** queue (you / JARVIS) · next (the orb picks a job up) · report (progress / result) · stop. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const b = Body.parse(await req.json());
    if (b.action === "queue") return ok(await queueTask(user.id, b.goal), { status: 201 });
    if (b.action === "next") return ok({ task: await nextTask(user.id) });
    if (b.action === "stop") { await stopTask(user.id, b.id); return ok({ stopped: true }); }
    return ok(await reportTask(user.id, b.id, b));
  } catch (e) { return e instanceof DesktopError ? fail(e.message) : handleError(e); }
}
