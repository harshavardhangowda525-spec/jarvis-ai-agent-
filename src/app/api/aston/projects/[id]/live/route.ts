import { requireUser } from "@/lib/auth/session";
import { fail, handleError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { subscribe } from "@/lib/aston/studio/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The build, live (Server-Sent Events): everything so far, then each piece of code as it's written. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const p = await getDb().astonProject.findFirst({ where: { id: params.id, userId: user.id }, select: { id: true } });
    if (!p) return fail("Not found.", 404);
    const enc = new TextEncoder();
    let close = () => {};
    const stream = new ReadableStream({
      start(ctrl) {
        const send = (event: string, data: unknown) => { try { ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { close(); } };
        const sub = subscribe(p.id, (e) => send("e", e));
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
