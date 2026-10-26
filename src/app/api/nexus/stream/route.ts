import { requireUser } from "@/lib/auth/session";
import { handleError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { diffJobs, type JobRow } from "@/lib/nexus/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server-Sent Events of real task transitions (planned, queued, dispatched,
 * a new step, waiting for approval, returned, failed, cancelled). The task
 * runner can be in another request or process, so this watches the task
 * records themselves. Nothing is replayed on connect.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const db = getDb();
    const enc = new TextEncoder();
    const prev = new Map<string, { status: string; steps: number }>();
    let cursor = new Date(Date.now() - 24 * 3600_000);
    const select = { id: true, agent: true, title: true, status: true, dependsOn: true, progress: true, updatedAt: true } as const;
    const toRow = (j: { id: string; agent: string; title: string; status: string; dependsOn: string[]; progress: unknown; updatedAt: Date }): JobRow => ({ ...j, updatedAt: j.updatedAt.toISOString() });
    // baseline: what already exists is not news
    const seed = await db.agentJob.findMany({ where: { userId: user.id, updatedAt: { gte: cursor } }, select });
    diffJobs(prev, seed.map(toRow));
    for (const j of seed) if (j.updatedAt > cursor) cursor = j.updatedAt;
    let close = () => {};
    const stream = new ReadableStream({
      start(ctrl) {
        let alive = true;
        const send = (event: string, data: unknown) => { try { ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { close(); } };
        send("ready", { at: new Date().toISOString() });
        const tick = async () => {
          if (!alive) return;
          try {
            const rows = await db.agentJob.findMany({ where: { userId: user.id, updatedAt: { gt: cursor } }, orderBy: { updatedAt: "asc" }, select, take: 100 });
            for (const r of rows) if (r.updatedAt > cursor) cursor = r.updatedAt;
            for (const s of diffJobs(prev, rows.map(toRow))) send("signal", s);
          } catch { /* the database blinked — next tick */ }
          if (alive) timer = setTimeout(tick, 2000);
        };
        let timer = setTimeout(tick, 2000);
        const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(": ping\n\n")); } catch { close(); } }, 15_000);
        close = () => { alive = false; clearTimeout(timer); clearInterval(ping); try { ctrl.close(); } catch { /* closed */ } };
        req.signal.addEventListener("abort", () => close());
      },
      cancel() { close(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
  } catch (e) {
    return handleError(e);
  }
}
