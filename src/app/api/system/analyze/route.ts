import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { fail, handleError, rateLimit } from "@/lib/api";
import { runDiagnostics } from "@/lib/system/diagnostics";
import { recordActivity } from "@/lib/activity/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  ultron: z.object({ known: z.boolean(), reachable: z.boolean(), brain: z.string().max(80).nullable().optional(), ms: z.number().int().min(0).max(60_000).optional() }).nullable().optional(),
});

/**
 * "Analyze the system": JARVIS's read-only self-diagnostic, streamed as NDJSON
 * events while it runs (stage → node → each check's real result → done), so
 * the holographic view shows exactly what is being checked. Changes nothing.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`system-analyze:${user.id}`, 3, 60_000);
    if (!rl.allowed) return fail("A system analysis just ran — try again in a minute.", 429);
    const body = schema.parse(await req.json().catch(() => ({})));
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: unknown) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        try {
          for await (const ev of runDiagnostics(user.id, { ultron: body.ultron ?? null })) {
            send(ev);
            if (ev.type === "done") {
              const s = ev.summary;
              await recordActivity(user.id, {
                category: "agent", agent: "JARVIS", source: "client", importance: s.fail ? 4 : 2, status: s.fail ? "failed" : "success",
                action: "System analysis", result: `${s.ok} passed · ${s.warn} warnings · ${s.fail} failed · ${s.info} notes`,
              }).catch(() => {});
            }
          }
        } catch (e) {
          send({ type: "error", message: "The analysis stopped unexpectedly." });
          console.error("[system/analyze]", e);
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (err) {
    return handleError(err);
  }
}
