import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { getAiConfig, getAnthropicClient, getOpenAiClient } from "./client";
import { buildSystemPrompt } from "./prompt";
import { availableTools, getTool } from "@/lib/tools/registry";
import type { ToolContext, ToolDefinition } from "@/lib/tools/types";
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
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
}

const MAX_STEPS = 8;

/**
 * The JARVIS agent loop. Provider-agnostic: it loads memory, builds the system
 * prompt, and hands the tool registry to whichever model is configured. The
 * model chooses tools dynamically — no command matching here.
 */
export async function* runAgent(
  input: AgentInput,
): AsyncGenerator<AgentEvent, void, unknown> {
  const cfg = getAiConfig();
  const db = getDb();

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
  const activityQueue: string[] = [];
  const ctx: ToolContext = {
    userId: input.userId,
    timezone: input.timezone,
    activity: (label) => activityQueue.push(label),
  };

  const shared = { system, tools, ctx, activityQueue, model: cfg.model };

  if (cfg.kind === "anthropic") {
    yield* anthropicLoop(getAnthropicClient(cfg), input, shared);
  } else {
    yield* openaiLoop(getOpenAiClient(cfg), input, shared);
  }
}

interface SharedCtx {
  system: string;
  tools: ToolDefinition[];
  ctx: ToolContext;
  activityQueue: string[];
  model: string;
}

/** Runs one tool call and yields the corresponding events; returns the result string for the model. */
async function* runOneTool(
  name: string,
  rawInput: unknown,
  s: SharedCtx,
  userId: string,
): AsyncGenerator<AgentEvent, { content: string; isError: boolean }, unknown> {
  const tool = getTool(name);
  if (!tool) {
    return { content: `Unknown tool: ${name}`, isError: true };
  }
  yield { type: "activity", label: tool.activityLabel };
  const started = Date.now();
  try {
    const parsed = tool.schema.parse(rawInput);
    const result = await tool.execute(parsed, s.ctx);

    while (s.activityQueue.length) {
      yield { type: "activity", label: s.activityQueue.shift()! };
    }
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
    await logTool(userId, tool.name, rawInput, result.data, "ok", null, Date.now() - started);
    return { content: JSON.stringify(result.data).slice(0, 12000), isError: false };
  } catch (err) {
    const message =
      err instanceof ToolError ? err.message : "The tool encountered an unexpected error.";
    yield { type: "tool", name: tool.name, status: "error", summary: message };
    await logTool(userId, tool.name, rawInput, null, "error", message, Date.now() - started);
    return { content: message, isError: true };
  }
}

// --- Anthropic provider --------------------------------------------------
async function* anthropicLoop(
  client: Anthropic,
  input: AgentInput,
  s: SharedCtx,
): AsyncGenerator<AgentEvent, void, unknown> {
  const anthropicTools: Anthropic.Tool[] = s.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: input.message },
  ];

  let finalText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    let assistantMessage: Anthropic.Message;
    try {
      const stream = client.messages.stream({
        model: s.model,
        max_tokens: 2048,
        system: s.system,
        tools: anthropicTools,
        messages,
      });
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          finalText += ev.delta.text;
          yield { type: "text", delta: ev.delta.text };
        }
      }
      assistantMessage = await stream.finalMessage();
    } catch (err) {
      console.error("[agent] anthropic error:", err);
      yield { type: "error", message: aiErrorMessage(err) };
      return;
    }

    messages.push({ role: "assistant", content: assistantMessage.content });
    const toolUses = assistantMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) {
      yield { type: "done", text: finalText };
      return;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const res = yield* runOneTool(use.name, use.input, s, input.userId);
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: res.content,
        is_error: res.isError,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }
  yield { type: "done", text: finalText || "I couldn't complete that in the available steps." };
}

// --- OpenAI-compatible provider (Gemini / Groq / OpenAI) -----------------
async function* openaiLoop(
  client: OpenAI,
  input: AgentInput,
  s: SharedCtx,
): AsyncGenerator<AgentEvent, void, unknown> {
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = s.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: s.system },
    ...input.history.map((m) => ({ role: m.role, content: m.content }) as any),
    { role: "user", content: input.message },
  ];

  let finalText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    let content = "";
    // Accumulate streamed tool calls by index. `extra` carries provider-specific
    // metadata (e.g. Gemini's thought_signature) that MUST be echoed back on the
    // follow-up turn or reasoning models reject the request.
    const toolCalls: { id: string; name: string; args: string; extra?: unknown }[] = [];

    try {
      const stream = await client.chat.completions.create({
        model: s.model,
        max_tokens: 2048,
        tools,
        messages,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          finalText += delta.content;
          yield { type: "text", delta: delta.content };
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) toolCalls[idx] = { id: "", name: "", args: "" };
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].args += tc.function.arguments;
            const extra = (tc as any).extra_content;
            if (extra) toolCalls[idx].extra = extra;
          }
        }
      }
    } catch (err) {
      console.error("[agent] openai-compatible error:", err);
      yield { type: "error", message: aiErrorMessage(err) };
      return;
    }

    const calls = toolCalls.filter((c) => c && c.name);
    if (calls.length === 0) {
      yield { type: "done", text: finalText };
      return;
    }

    // Record the assistant turn with its tool calls.
    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: calls.map((c) => ({
        id: c.id || c.name,
        type: "function",
        function: { name: c.name, arguments: c.args || "{}" },
        // Preserve provider metadata (Gemini thought_signature) when present.
        ...(c.extra ? { extra_content: c.extra } : {}),
      })),
    } as any);

    for (const c of calls) {
      let parsedArgs: unknown = {};
      try {
        parsedArgs = c.args ? JSON.parse(c.args) : {};
      } catch {
        parsedArgs = {};
      }
      const res = yield* runOneTool(c.name, parsedArgs, s, input.userId);
      messages.push({
        role: "tool",
        tool_call_id: c.id || c.name,
        content: res.content,
      });
    }
  }
  yield { type: "done", text: finalText || "I couldn't complete that in the available steps." };
}

/** Maps provider SDK errors to honest, user-facing messages. */
function aiErrorMessage(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 429) {
    return "The AI provider is rate-limiting requests (free-tier limit reached). Please wait a moment and try again.";
  }
  if (status === 401 || status === 403) {
    return "The AI provider rejected the API key. Check your configuration.";
  }
  if (status === 400) {
    return "The AI provider rejected the request. Please try again.";
  }
  return "The AI service failed to respond. Please try again.";
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
    /* logging must never break the request */
  }
}
