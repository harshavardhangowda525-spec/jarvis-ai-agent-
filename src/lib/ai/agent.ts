import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { getAiConfigs, getAnthropicClient, getOpenAiClient } from "./client";
import { getLiveBrain } from "./brain";
import { trimHistoryForLocal } from "./history";
import { env } from "@/lib/env";
import { buildSystemPrompt } from "./prompt";
import { availableTools, getTool } from "@/lib/tools/registry";
import type { ToolContext, ToolDefinition } from "@/lib/tools/types";
import { ToolError } from "@/lib/tools/types";
import { getDb } from "@/lib/db";
import { buildEvSystemPrompt } from "@/lib/ev/prompt";
import { memorySummary } from "@/lib/ev/memory";
import { resolveIgCreds } from "@/lib/ev/instagram";
import { darwinConfigured } from "@/lib/ev/darwin";
import { capabilities } from "@/lib/env";
import { buildDarwinSystemPrompt } from "@/lib/darwin/prompt";
import { emailChannelReady } from "@/lib/darwin/email";

export type AgentEvent =
  | { type: "activity"; label: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "ok" | "error"; summary: string }
  | { type: "navigate"; path: string }
  | { type: "open"; url: string; label: string }
  | { type: "provider"; name: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export interface AgentInput {
  userId: string;
  timezone: string;
  assistantName: string;
  displayName: string | null;
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  /** Per-user preferred primary AI provider (from Settings); overrides env default. */
  preferredProvider?: string | null;
  /** Which internal agent is driving: "ev" (marketing) or "darwin" (lead-gen/CRM). */
  agent?: "ev" | "darwin";
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
  // Your own Ollama brain (unlimited) leads whenever the PC gateway is online.
  const brain = await getLiveBrain(input.userId).catch(() => null);
  const configs = getAiConfigs(input.preferredProvider ?? undefined, brain);
  const db = getDb();

  const isEv = input.agent === "ev";
  const isDarwin = input.agent === "darwin";

  let system: string;
  if (isEv) {
    // EV's marketing brain: its own personality, mission, memory + honesty rules.
    const [memory, igCreds] = await Promise.all([
      memorySummary(input.userId),
      resolveIgCreds(input.userId).catch(() => null),
    ]);
    system = buildEvSystemPrompt({
      userDisplayName: input.displayName,
      timezone: input.timezone,
      memory,
      darwinAvailable: darwinConfigured() || true, // DARWIN is now internal
      instagramAvailable: !!igCreds,
      imageAvailable: capabilities.evImage,
      videoAvailable: capabilities.magicHour,
    });
  } else if (isDarwin) {
    // DARWIN's lead-gen/CRM brain — real data only.
    const [leads, dueFollowUps, emailReady] = await Promise.all([
      db.darwinLead.findMany({ where: { userId: input.userId }, select: { stage: true } }),
      db.darwinFollowUp.count({ where: { userId: input.userId, status: "pending", dueAt: { lte: new Date() } } }),
      emailChannelReady(input.userId).catch(() => false),
    ]);
    const byStage: Record<string, number> = {};
    for (const l of leads) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
    const crmSummary = leads.length
      ? `CRM: ${leads.length} real leads (${Object.entries(byStage).map(([s, n]) => `${n} ${s}`).join(", ")}). ${dueFollowUps} follow-up(s) due now.`
      : "CRM is empty — no leads discovered yet. Use darwin_search to find real businesses.";
    system = buildDarwinSystemPrompt({
      userDisplayName: input.displayName,
      timezone: input.timezone,
      crmSummary,
      discoveryAvailable: !!env.geoapifyApiKey,
      emailAvailable: emailReady,
    });
  } else {
    const memories = await db.memory.findMany({
      where: { userId: input.userId },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: { key: true, content: true },
    });
    system = buildSystemPrompt({
      assistantName: input.assistantName,
      userDisplayName: input.displayName,
      timezone: input.timezone,
      memories,
    });
  }

  const tools = availableTools(isEv ? "ev" : isDarwin ? "darwin" : undefined);
  const activityQueue: string[] = [];
  const ctx: ToolContext = {
    userId: input.userId,
    timezone: input.timezone,
    activity: (label) => activityQueue.push(label),
  };

  // Try each configured provider in order. If one fails BEFORE producing any
  // output (e.g. rate-limited), fall back to the next — but never re-run after
  // text or a tool has already been committed (avoids duplicate side effects).
  const failures: string[] = []; // "Ollama: didn't answer in 150s" — shown if all fail
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    // The local (Ollama) brain re-reads everything it's sent on a CPU, so give it
    // a short recent history and a tighter reply budget; cloud keeps the full window.
    const local = cfg.provider === "ollama";
    const s: SharedCtx = { system, tools, ctx, activityQueue, model: cfg.model, maxTokens: local ? 1024 : 2048 };
    const turnInput = local ? { ...input, history: trimHistoryForLocal(input.history, env.ollamaHistory) } : input;
    let committed = false;
    yield { type: "provider", name: cfg.provider };
    const gen =
      cfg.kind === "anthropic"
        ? anthropicLoop(getAnthropicClient(cfg), turnInput, s)
        : openaiLoop(getOpenAiClient(cfg), turnInput, s);
    try {
      for await (const ev of gen) {
        if (ev.type === "text" || ev.type === "tool" || ev.type === "navigate" || ev.type === "open") {
          committed = true;
        }
        yield ev;
        if (ev.type === "done") return;
      }
      return;
    } catch (err) {
      console.error(`[agent] provider ${cfg.provider} failed:`, err);
      failures.push(`${label(cfg.provider)}: ${shortReason(err, cfg.timeoutMs)}`);
      const next = configs[i + 1];
      if (!committed && next) {
        yield { type: "activity", label: `${label(cfg.provider)} ${shortReason(err, cfg.timeoutMs)} — switching to ${label(next.provider)}…` };
        continue;
      }
      // Several providers tried → say what happened to EACH, not just the last.
      yield { type: "error", message: failures.length > 1 && !committed ? `No AI provider could answer — ${failures.join(" · ")}.` : aiErrorMessage(err) };
      return;
    }
  }
}

function label(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

interface SharedCtx {
  system: string;
  tools: ToolDefinition[];
  ctx: ToolContext;
  activityQueue: string[];
  model: string;
  /** Reply budget per step (smaller for the local brain = faster answers). */
  maxTokens?: number;
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
    if (data && typeof data.openUrl === "string") {
      yield { type: "open", url: data.openUrl, label: String(data.label ?? "link") };
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
        max_tokens: s.maxTokens ?? 2048,
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
      // Propagate to runAgent so it can fall back to the next provider.
      throw err;
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
        max_tokens: s.maxTokens ?? 2048,
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
      // Propagate to runAgent so it can fall back to the next provider.
      throw err;
    }

    const calls = toolCalls.filter((c) => c && c.name);
    if (calls.length === 0) {
      yield { type: "done", text: finalText };
      return;
    }

    // Record the assistant turn with its tool calls. Use "" not null — some
    // OpenAI-compatible providers (e.g. Gemini's compat endpoint) reject an
    // assistant message with null content on a tool-call turn (400).
    messages.push({
      role: "assistant",
      content: content || "",
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

/** One short phrase per failed provider (for the combined "all failed" message). */
function shortReason(err: unknown, timeoutMs?: number): string {
  const e = err as { status?: number; name?: string; message?: string };
  if (e?.name === "APIConnectionTimeoutError" || /timed? ?out/i.test(e?.message ?? "")) {
    return timeoutMs ? `didn't answer within ${Math.round(timeoutMs / 1000)}s` : "timed out";
  }
  if (e?.name === "APIConnectionError") return "unreachable";
  if (e?.status === 429) return "rate-limited (free limit reached)";
  if (e?.status === 401 || e?.status === 403) return "key rejected";
  if (e?.status === 402) return "needs billing";
  if (e?.status === 404) return "model not found";
  if (e?.status === 502 || e?.status === 530) return "unreachable";
  return e?.status ? `error ${e.status}` : "failed";
}

/** Maps provider SDK errors to honest, user-facing messages. */
function aiErrorMessage(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 429) {
    return "The AI provider is rate-limiting requests (free-tier limit reached). Please wait a moment and try again.";
  }
  if (status === 401 || status === 403) {
    return "The AI provider rejected the API key. Check your API key configuration.";
  }
  // Try to extract the provider's own error message for clearer diagnostics.
  const anyErr = err as { message?: string; error?: { message?: string } };
  const detail = (anyErr?.error?.message || anyErr?.message || "").toString().slice(0, 200);
  if (status === 404) {
    return `The AI model wasn't found — check AI_MODEL / provider. ${detail}`.trim();
  }
  if (status === 400) {
    return `The AI provider rejected the request. ${detail}`.trim();
  }
  if (detail) return `AI error${status ? ` (HTTP ${status})` : ""}: ${detail}`;
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
