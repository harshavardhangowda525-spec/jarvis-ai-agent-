import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { getAiConfigs, getAnthropicClient, getOpenAiClient } from "./client";
import { getLiveBrain } from "./brain";
import { trimHistoryForLocal } from "./history";
import { explicitMemory, loadMemories, memoryPromptBlock, saveMemory, type MemoryRow } from "./user-memory";
import type { AiConfig, BrainEndpoint } from "@/lib/env";
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
  /** Where the time went: server prep, first word, whole answer (ms from request start). */
  | { type: "timing"; provider: string; model: string; setupMs: number; firstWordMs: number | null; totalMs: number }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export interface AgentInput {
  userId: string;
  timezone: string;
  assistantName: string;
  displayName: string | null;
  history: { role: "user" | "assistant"; content: string }[];
  /** Messages in the whole conversation (history may be only its tail). */
  historyTotal?: number;
  /** When the request arrived (for the timing report). */
  startedAt?: number;
  /** Lookups the route already started in parallel with its own queries. */
  prefetch?: { brain?: Promise<BrainEndpoint | null>; memories?: Promise<MemoryRow[]> };
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
  // Looked up in parallel with the prompt's own data (awaited below).
  const startedAt = input.startedAt ?? Date.now();
  const brainLookup = input.prefetch?.brain ?? getLiveBrain(input.userId).catch(() => null);
  const db = getDb();

  const isEv = input.agent === "ev";
  const isDarwin = input.agent === "darwin";

  // "Remember that …" / "From now on …" is saved straight away, so it's kept
  // even if the model (especially a small local one) forgets to call the tool.
  let memoryNote = "";
  const fact = explicitMemory(input.message);
  let savedNow = false;
  if (fact) {
    const res = await saveMemory(input.userId, fact, { source: "user" }).catch(() => null);
    savedNow = !!res?.saved;
    if (res?.saved) yield { type: "tool", name: "memory", status: "ok", summary: `Saved to memory: ${fact}` };
    memoryNote = res?.saved || (res && res.reason === "duplicate")
      ? `\n\n(The user's latest message is already saved in long-term memory as: "${fact}". Just confirm briefly — don't call the memory tool for it.)`
      : res && res.reason === "secret"
        ? "\n\n(The user asked you to remember something that looks like a secret — it was NOT stored. Say so briefly.)"
        : "";
  }
  // Everything the user has told JARVIS — shared by every agent and every brain.
  const memoriesLookup = (!savedNow && input.prefetch?.memories) || loadMemories(input.userId, 60).catch(() => []);

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
    system = buildSystemPrompt({
      assistantName: input.assistantName,
      userDisplayName: input.displayName,
      timezone: input.timezone,
      memories: await memoriesLookup,
    });
  }
  if (isEv || isDarwin) {
    // EV and DARWIN share JARVIS's memory of the user (preferences, business…).
    system += memoryPromptBlock(await memoriesLookup,
      `# What you know about ${input.displayName || "the user"} (shared memory with JARVIS — use it to personalise; never contradict it)`);
  }
  system += memoryNote;

  const brain = await brainLookup;
  const configs = isEv ? evConfigs(brain) : getAiConfigs(input.preferredProvider ?? undefined, brain);
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
  // Skip providers that just rate-limited us / rejected the key — retrying them
  // on every message only adds a wasted round trip before the one that answers.
  const now = Date.now();
  const available = configs.filter((c) => (parkedUntil.get(parkKey(c)) ?? 0) <= now);
  const chain = available.length ? available : configs;
  let setupMs = -1;
  let firstWordAt: number | null = null;
  const timing = (cfg: AiConfig): AgentEvent => ({
    type: "timing", provider: cfg.provider, model: cfg.model,
    setupMs: Math.max(0, setupMs), firstWordMs: firstWordAt ? firstWordAt - startedAt : null, totalMs: Date.now() - startedAt,
  });
  for (let i = 0; i < chain.length; i++) {
    const cfg = chain[i];
    // The local (Ollama) brain re-reads everything it's sent on a CPU, so give it
    // a short recent history and a tighter reply budget. Cloud gets a longer
    // (but still bounded) window: less to read = a faster first word and fewer
    // free-tier "tokens per minute" rate limits.
    const local = cfg.provider === "ollama";
    const total = input.historyTotal ?? input.history.length;
    const s: SharedCtx = {
      system, tools, ctx, activityQueue, model: cfg.model,
      // Spoken answers are short; a CPU writes only a few tokens a second.
      maxTokens: local ? 512 : 2048,
      // Headers arrive at once from the gateway, so the limit JARVIS enforces is
      // "time until the FIRST WORD" — then it falls back to the cloud.
      firstTokenMs: local ? cfg.timeoutMs : undefined,
      leanTools: local,
      // gpt-oss "thinks" before answering; a low effort keeps the first word quick.
      reasoningEffort: /gpt-oss/i.test(cfg.model) && ["groq", "cerebras"].includes(cfg.provider) && !["none", "off", "default"].includes(env.reasoningEffort)
        ? env.reasoningEffort : undefined,
    };
    const turnInput = {
      ...input,
      history: local
        ? trimHistoryForLocal(input.history, env.ollamaHistory, 1200, total)
        : trimHistoryForLocal(input.history, 16, 2000, total),
    };
    let committed = false;
    if (setupMs < 0) setupMs = Date.now() - startedAt;
    yield { type: "provider", name: cfg.provider };
    const gen =
      cfg.kind === "anthropic"
        ? anthropicLoop(getAnthropicClient(cfg), turnInput, s)
        : openaiLoop(getOpenAiClient(cfg), turnInput, s);
    try {
      for await (const ev of gen) {
        if (ev.type === "text" || ev.type === "tool" || ev.type === "navigate" || ev.type === "open") {
          committed = true;
          firstWordAt ??= Date.now();
        }
        if (ev.type === "done") { yield timing(cfg); yield ev; return; }
        yield ev;
      }
      yield timing(cfg);
      return;
    } catch (err) {
      console.error(`[agent] provider ${cfg.provider} failed:`, err);
      const park = parkFor(err);
      if (park) parkedUntil.set(parkKey(cfg), Date.now() + park);
      failures.push(`${label(cfg.provider)}: ${shortReason(err, cfg.timeoutMs)}`);
      const next = chain[i + 1];
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

/**
 * EV's brain. By default EV uses Groq ONLY — no other cloud model and not the PC
 * brain (EV_PROVIDER changes this). If that provider isn't configured at all,
 * EV falls back to the normal chain rather than going silent.
 */
function evConfigs(brain: BrainEndpoint | null): AiConfig[] {
  const pick = env.evProvider;
  if (pick === "auto") return getAiConfigs(undefined, brain);
  if (pick === "ollama") return getAiConfigs("ollama", brain); // PC first when reachable, cloud as backup
  const all = getAiConfigs(pick, brain);
  const only = all.filter((c) => c.provider === pick);
  return only.length ? only : all;
}

// provider+model → time until which it's skipped (per server instance).
const parkedUntil = new Map<string, number>();
const parkKey = (c: AiConfig) => `${c.provider}:${c.model}`;

/** How long to skip a provider after this error (0 = don't). */
function parkFor(err: unknown): number {
  const e = err as { status?: number; headers?: Record<string, string> | Headers };
  const h = e?.headers as any;
  const retryAfter = Number(typeof h?.get === "function" ? h.get("retry-after") : h?.["retry-after"]);
  if (e?.status === 429) return Math.min(Math.max(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 20_000, 5_000), 10 * 60_000);
  if (e?.status === 401 || e?.status === 403 || e?.status === 404) return 10 * 60_000; // bad key / model gone
  if (e?.status === 402) return 30 * 60_000; // needs billing
  return 0;
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
  /** Give up (and fall back) if no text/tool call arrives within this time. */
  firstTokenMs?: number;
  /** Shorter tool descriptions — less for a local model to read each turn. */
  leanTools?: boolean;
  /** reasoning_effort for reasoning models (e.g. gpt-oss on Groq/Cerebras). */
  reasoningEffort?: string;
}

/** First sentence of a tool description (the local model's prompt is read on a CPU). */
const firstSentence = (d: string) => (d.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? d).trim();

class FirstTokenTimeout extends Error {
  constructor(ms: number) {
    super(`timed out — no reply within ${Math.round(ms / 1000)}s`);
    this.name = "FirstTokenTimeout";
  }
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
      description: s.leanTools ? firstSentence(t.description) : t.description,
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

    const ac = new AbortController();
    let timedOut = false;
    let waiting = s.firstTokenMs
      ? setTimeout(() => { timedOut = true; ac.abort(); }, s.firstTokenMs)
      : null;
    const gotFirstToken = () => { if (waiting) { clearTimeout(waiting); waiting = null; } };
    try {
      const stream = await client.chat.completions.create({
        model: s.model,
        max_tokens: s.maxTokens ?? 2048,
        tools,
        messages,
        stream: true,
        ...(s.reasoningEffort ? { reasoning_effort: s.reasoningEffort as "low" } : {}),
      }, { signal: ac.signal });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content || delta.tool_calls) gotFirstToken();
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
      // An aborted SDK stream just ends quietly — make the timeout an error so
      // runAgent falls back to the next provider.
      if (timedOut) throw new FirstTokenTimeout(s.firstTokenMs!);
    } catch (err) {
      // Propagate to runAgent so it can fall back to the next provider.
      throw timedOut ? new FirstTokenTimeout(s.firstTokenMs!) : err;
    } finally {
      gotFirstToken();
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
  if (e?.name === "APIConnectionTimeoutError" || e?.name === "FirstTokenTimeout" || /timed? ?out/i.test(e?.message ?? "")) {
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
