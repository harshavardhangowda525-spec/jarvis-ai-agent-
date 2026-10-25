import { requireUser } from "@/lib/auth/session";
import { fail, handleError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { subscribeFriday } from "@/lib/friday/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?job=<id> — Friday's work on that task, live (Server-Sent Events): everything so far, then each step as it happens. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const jobId = new URL(req.url).searchParams.get("job") ?? "";
    const job = jobId ? await getDb().agentJob.findFirst({ where: { id: jobId, userId: user.id, agent: "friday" }, select: { id: true } }) : null;
    if (!job) return fail("Not found.", 404);
    const enc = new TextEncoder();
    let close = () => {};
    const stream = new ReadableStream({
      start(ctrl) {
        const send = (event: string, data: unknown) => { try { ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { close(); } };
        const sub = subscribeFriday(job.id, (e) => send("e", e));
        send("snapshot", sub.snapshot);
        const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(": ping\n\n")); } catch { close(); } }, 15_000);
        close = () => { clearInterval(ping); sub.close(); try { ctrl.close(); } catch { /* closed */ } };
        req.signal.addEventListener("abort", () => close());
      },
      cancel() { close(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
  } catch (e) {
    return handleError(e);
  }
}
