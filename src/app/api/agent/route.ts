import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { capabilities, env } from "@/lib/env";
import { runAgent, type AgentEvent } from "@/lib/ai/agent";
import { agentRequestSchema } from "@/lib/validation";
import { fail, handleError, rateLimit } from "@/lib/api";
import { truncate } from "@/lib/utils";

export const runtime = "nodejs";
// A local Ollama brain on a CPU is slower than cloud APIs — allow up to 5 min
// (Vercel's Fluid Compute limit on every plan).
export const maxDuration = 300;

/**
 * The JARVIS agent endpoint. Streams NDJSON events (activity / text / tool /
 * navigate / done / error) so the UI and voice layer react in real time. Voice
 * and text share this exact conversation context.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`agent:${user.id}`, 40, 60_000);
    if (!rl.allowed) return fail("You're sending messages too quickly.", 429);

    // A PC brain (OLLAMA_API_KEY set) can be the only brain — no cloud key needed.
    if (!capabilities.ai && !env.ollamaApiKey) {
      return fail("The AI model is not configured. Set AI_API_KEY.", 503);
    }

    const { conversationId, message, agent } = agentRequestSchema.parse(await req.json());
    const db = getDb();

    // Independent lookups run in parallel — every round trip here is time
    // before the first word. Ownership of the conversation is enforced.
    const [found, profile] = await Promise.all([
      conversationId ? db.conversation.findFirst({ where: { id: conversationId, userId: user.id } }) : null,
      db.profile.findUnique({ where: { userId: user.id } }),
    ]);
    const convo = found ?? await db.conversation.create({
      data: { userId: user.id, title: truncate(message, 60) },
    });

    // Load recent history (last 20 turns) for context. Newest first + reverse:
    // "asc + take" would return the OLDEST 40 messages of a long conversation.
    const where = { conversationId: convo.id, role: { in: ["user", "assistant"] } };
    const [recentRows, historyTotal] = found
      ? await Promise.all([
          db.message.findMany({ where, orderBy: { createdAt: "desc" }, take: 40 }),
          db.message.count({ where }),
        ])
      : [[], 0];
    const priorRows = recentRows.reverse();
    const history = priorRows.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Persist the incoming user message without holding up the reply (it's
    // awaited before the assistant message is saved, so the order is kept).
    const savedUserMessage = db.message.create({
      data: {
        conversationId: convo.id,
        userId: user.id,
        role: "user",
        content: message,
      },
    }).catch((e) => console.error("[agent route] persist user message:", e));

    const encoder = new TextEncoder();
    const convoId = convo.id;
    const isNewConvo = !conversationId;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: AgentEvent | { type: "meta"; conversationId: string }) => {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };

        send({ type: "meta", conversationId: convoId });

        let finalText = "";
        const toolSummaries: { name: string; status: string; summary: string }[] = [];

        try {
          for await (const event of runAgent({
            userId: user.id,
            timezone: profile?.timezone ?? "UTC",
            assistantName: profile?.assistantName ?? "JARVIS",
            displayName: profile?.displayName ?? null,
            history,
            historyTotal,
            message,
            preferredProvider: (profile as { aiProvider?: string | null } | null)?.aiProvider ?? null,
            agent: agent === "ev" ? "ev" : agent === "darwin" ? "darwin" : undefined,
          })) {
            if (event.type === "done") finalText = event.text;
            if (event.type === "tool") {
              toolSummaries.push({
                name: event.name,
                status: event.status,
                summary: event.summary,
              });
            }
            send(event);
          }
        } catch (err) {
          console.error("[agent route] stream error:", err);
          send({ type: "error", message: "The assistant encountered an error." });
        }

        // Persist the assistant reply + conversation bookkeeping.
        try {
          await savedUserMessage;
          await db.message.create({
            data: {
              conversationId: convoId,
              userId: user.id,
              role: "assistant",
              content: finalText || "(no response)",
              toolResults: toolSummaries.length ? (toolSummaries as any) : undefined,
            },
          });
          await db.conversation.update({
            where: { id: convoId },
            data: {
              updatedAt: new Date(),
              ...(isNewConvo ? { title: truncate(message, 60) } : {}),
            },
          });
        } catch (e) {
          console.error("[agent route] persist error:", e);
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
