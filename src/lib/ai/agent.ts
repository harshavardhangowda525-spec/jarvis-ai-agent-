import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAiClient, AI_MODEL } from "./client";
import { buildSystemPrompt } from "./prompt";
import { availableTools, getTool } from "@/lib/tools/registry";
import type { ToolContext } from "@/lib/tools/types";
import { ToolError } from "@/lib/tools/types";
import { getDb } from "@/lib/db";

export type AgentEvent =
  | { type: "activity"; label: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "ok" | "error"; summary: string }
  | { type: "navigate"; path: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export interface AgentInput {
  userId: string;
  timezone: string;
  assistantName: string;
  displayName: string | null;
  /** Prior conversation turns, oldest first. */
  history: { role: "user" | "assistant"; content: string }[];
  /** The new user message. */
  message: string;
}

const MAX_STEPS = 8;

/**
 * The JARVIS agent loop. Yields streaming events. The model chooses tools
 * dynamically from the registry — no command matching here. Tool results are
 * fed back until the model produces a final answer or we hit MAX_STEPS.
 */
export async function* runAgent(
  input: AgentInput,
): AsyncGenerator<AgentEvent, void, unknown> {
  const client = getAiClient();
  const db = getDb();

  // Load long-term memory to personalize the system prompt.
  const memories = await db.memory.findMany({
    where: { userId: input.userId },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: { key: true, content: true },
  });

  const system = buildSystemPrompt({
    assistantName: input.assistantName,
    userDisplayName: input.displayName,
    timezone: input.timezone,
    memories,
  });

  const tools = availableTools();
  const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: input.message },
  ];

  const activityQueue: string[] = [];
  const ctx: ToolContext = {
    userId: input.userId,
    timezone: input.timezone,
    activity: (label) => activityQueue.push(label),
  };

  let finalText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    let assistantMessage: Anthropic.Message;
    let turnText = "";
    try {
      const stream = client.messages.stream({
        model: AI_MODEL,
        max_tokens: 1500,
        system,
        tools: anthropicTools,
        messages,
      });

      for await (const ev of stream) {
        if (
          ev.type === "content_block_delta" &&
          ev.delta.type === "text_delta"
        ) {
          turnText += ev.delta.text;
          finalText += ev.delta.text;
          yield { type: "text", delta: ev.delta.text };
        }
      }
      assistantMessage = await stream.finalMessage();
    } catch (err) {
      console.error("[agent] model error:", err);
      yield { type: "error", message: "The AI service failed to respond. Please try again." };
      return;
    }

    // Record the assistant turn (tool_use blocks included) for the next round.
    messages.push({ role: "assistant", content: assistantMessage.content });

    const toolUses = assistantMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      // No tools requested — this is the final answer.
      yield { type: "done", text: finalText };
      return;
    }

    // Execute each requested tool and feed results back.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const tool = getTool(use.name);
      if (!tool) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `Unknown tool: ${use.name}`,
          is_error: true,
        });
        continue;
      }

      yield { type: "activity", label: tool.activityLabel };
      const started = Date.now();
      try {
        const parsed = tool.schema.parse(use.input);
        const result = await tool.execute(parsed, ctx);

        // Drain any fine-grained activity the tool emitted.
        while (activityQueue.length) {
          yield { type: "activity", label: activityQueue.shift()! };
        }

        // Surface navigation as a first-class client action.
        const data = result.data as Record<string, unknown> | undefined;
        if (data && typeof data.navigate === "string") {
          yield { type: "navigate", path: data.navigate };
        }

        yield {
          type: "tool",
          name: tool.name,
          status: "ok",
          summary: result.summary ?? `${tool.name} completed.`,
        };

        await logTool(input.userId, tool.name, use.input, result.data, "ok", null, Date.now() - started);

        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(result.data).slice(0, 12000),
        });
      } catch (err) {
        const message =
          err instanceof ToolError
            ? err.message
            : "The tool encountered an unexpected error.";
        yield { type: "tool", name: tool.name, status: "error", summary: message };
        await logTool(input.userId, tool.name, use.input, null, "error", message, Date.now() - started);
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: message,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
    // Loop continues: model sees tool results and produces the next step.
  }

  // Safety valve: too many steps.
  if (finalText) {
    yield { type: "done", text: finalText };
  } else {
    yield {
      type: "done",
      text: "I wasn't able to fully complete that in the available steps.",
    };
  }
}

async function logTool(
  userId: string,
  tool: string,
  input: unknown,
  output: unknown,
  status: "ok" | "error",
  error: string | null,
  durationMs: number,
) {
  try {
    await getDb().toolLog.create({
      data: {
        userId,
        tool,
        input: input as any,
        output: (output ?? undefined) as any,
        status,
        error,
        durationMs,
      },
    });
  } catch {
    // logging must never break the request
  }
}
