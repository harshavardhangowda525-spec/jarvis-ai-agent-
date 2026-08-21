import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { capabilities } from "@/lib/env";
import { runAgent, type AgentEvent } from "@/lib/ai/agent";
import { agentRequestSchema } from "@/lib/validation";
import { fail, handleError, rateLimit } from "@/lib/api";
import { truncate } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

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

    if (!capabilities.ai) {
      return fail("The AI model is not configured. Set AI_API_KEY.", 503);
    }

    const { conversationId, message } = agentRequestSchema.parse(await req.json());
    const db = getDb();

    // Resolve or create the conversation (ownership enforced).
    let convo = conversationId
      ? await db.conversation.findFirst({
          where: { id: conversationId, userId: user.id },
        })
      : null;
    if (!convo) {
      convo = await db.conversation.create({
        data: { userId: user.id, title: truncate(message, 60) },
      });
    }

    const profile = await db.profile.findUnique({ where: { userId: user.id } });

    // Load recent history (last 20 turns) for context.
    const priorRows = await db.message.findMany({
      where: { conversationId: convo.id, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "asc" },
      take: 40,
    });
    const history = priorRows.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Persist the incoming user message.
    await db.message.create({
      data: {
        conversationId: convo.id,
        userId: user.id,
        role: "user",
        content: message,
      },
    });

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
            message,
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
