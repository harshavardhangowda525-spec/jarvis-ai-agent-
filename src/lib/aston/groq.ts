import "server-only";
import type OpenAI from "openai";
import { env } from "@/lib/env";
import { getDb } from "@/lib/db";
import { getOpenAiClient } from "@/lib/ai/client";
import { redact } from "@/lib/activity/redact";

/**
 * ASTON's brain: Groq, and only Groq. ASTON never silently switches to another
 * provider (which could be a paid one) — when Groq is unavailable, ASTON keeps
 * working without AI (template alerts) and says so.
 *
 * Every request has a timeout and a bounded retry budget. A 429 is read
 * carefully: a per-minute limit with a short retry-after is waited out once;
 * an exhausted daily quota (RPD/TPD, or x-ratelimit-remaining-requests = 0)
 * blocks Groq until the reset time, and that block is persisted
 * (AstonProviderState) so a restart doesn't start hammering it again.
 */

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// Groq's production model with tool use + JSON mode (llama-3.3-70b-versatile was
// decommissioned 2026-08-16; gpt-oss-120b is Groq's recommended replacement).
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";

export const astonModel = () => env.groqModel || GROQ_DEFAULT_MODEL;

export type AiBlockReason = "not_configured" | "rate_limited" | "quota_exhausted" | "outage" | "auth_error" | "request_error";

/** Groq can't be used right now. `message` is always safe to show (no secrets). */
export class AstonAiUnavailable extends Error {
  constructor(public reason: AiBlockReason, message: string, public until: Date | null = null) {
    super(message);
    this.name = "AstonAiUnavailable";
  }
}

export interface ProviderState {
  status: string;
  blockedUntil: Date | null;
  lastError: string | null;
  lastOkAt: Date | null;
  day: string | null;
  requestsToday: number;
  remainingRequests: number | null;
  remainingTokens: number | null;
}

export interface StateStore {
  load(): Promise<ProviderState>;
  save(patch: Partial<ProviderState>): Promise<void>;
}

type ChatBody = Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model"> & { model?: string; reasoning_effort?: "low" | "medium" | "high" };

export interface GroqDeps {
  create(body: ChatBody & { model: string }, timeoutMs: number): Promise<{ data: OpenAI.Chat.ChatCompletion; headers: Record<string, string> }>;
  /** Streaming completion: response headers + the text deltas as they arrive. */
  stream(body: ChatBody & { model: string }, timeoutMs: number): Promise<{ headers: Record<string, string>; deltas: AsyncIterable<string> }>;
  sleep(ms: number): Promise<void>;
  now(): number;
  store: StateStore;
}

const EMPTY: ProviderState = { status: "ok", blockedUntil: null, lastError: null, lastOkAt: null, day: null, requestsToday: 0, remainingRequests: null, remainingTokens: null };

/** The persisted state (one row per provider). Falls back to memory if the DB is down. */
export function dbStore(provider = "groq"): StateStore {
  let mem: ProviderState = { ...EMPTY };
  return {
    async load() {
      try {
        const row = await getDb().astonProviderState.findUnique({ where: { provider } });
        mem = row ? { ...EMPTY, ...row } : { ...EMPTY };
      } catch { /* DB unavailable: keep the in-memory view */ }
      return { ...mem };
    },
    async save(patch) {
      mem = { ...mem, ...patch };
      try {
        await getDb().astonProviderState.upsert({ where: { provider }, create: { provider, ...patch }, update: patch });
      } catch (e) {
        console.error("[aston] could not persist provider state:", e instanceof Error ? redact(e.message) : e);
      }
    },
  };
}

export function memoryStore(init: Partial<ProviderState> = {}): StateStore & { state: ProviderState } {
  const s = { state: { ...EMPTY, ...init } as ProviderState };
  return Object.assign(s, {
    async load() { return { ...s.state }; },
    async save(patch: Partial<ProviderState>) { s.state = { ...s.state, ...patch }; },
  });
}

const defaultDeps = (): GroqDeps => ({
  async create(body, timeoutMs) {
    const client = getOpenAiClient({ provider: "groq", kind: "openai", apiKey: env.groqApiKey, baseUrl: GROQ_BASE_URL, model: body.model });
    const { data, response } = await client.chat.completions
      .create(body as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { timeout: timeoutMs, maxRetries: 0 })
      .withResponse();
    return { data, headers: Object.fromEntries(response.headers.entries()) };
  },
  async stream(body, timeoutMs) {
    const client = getOpenAiClient({ provider: "groq", kind: "openai", apiKey: env.groqApiKey, baseUrl: GROQ_BASE_URL, model: body.model });
    const { data, response } = await client.chat.completions
      .create({ ...(body as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming), stream: true }, { timeout: timeoutMs, maxRetries: 0 })
      .withResponse();
    async function* deltas() {
      for await (const chunk of data) {
        const d = chunk.choices[0]?.delta?.content;
        if (d) yield d;
      }
    }
    return { headers: Object.fromEntries(response.headers.entries()), deltas: deltas() };
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  store: dbStore(),
});

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const nextUtcMidnight = (t: number) => { const d = new Date(t); d.setUTCHours(24, 0, 0, 0); return d; };

/** "7m12.48s" | "1.5s" | "250ms" | "2h3m" → milliseconds (null if unparseable). */
export function parseDuration(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000); // plain seconds (retry-after)
  let ms = 0, hit = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    hit = true;
    const n = Number(m[1]);
    ms += m[2] === "h" ? n * 3_600_000 : m[2] === "m" ? n * 60_000 : m[2] === "s" ? n * 1000 : n;
  }
  return hit ? Math.round(ms) : null;
}

const lower = (h: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));

/** Classify a 429: daily quota (stop until reset) vs. a short per-minute limit. */
export function classify429(message: string, headers: Record<string, string>): { daily: boolean; waitMs: number } {
  const h = lower(headers);
  const fromMsg = parseDuration(/try again in ([0-9.hms]+)/i.exec(message)?.[1]);
  const retryAfter = parseDuration(h["retry-after"]);
  const daily = /per day|\b(RPD|TPD)\b/i.test(message) || h["x-ratelimit-remaining-requests"] === "0";
  const resetReq = parseDuration(h["x-ratelimit-reset-requests"]);
  const waitMs = (daily ? resetReq ?? retryAfter ?? fromMsg : retryAfter ?? fromMsg) ?? (daily ? 60 * 60_000 : 20_000);
  return { daily, waitMs };
}

function quotaFromHeaders(headers: Record<string, string>) {
  const h = lower(headers);
  const num = (v: string | undefined) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  // Groq: the *requests* headers are the daily (RPD) budget, *tokens* the per-minute (TPM) one.
  return { remainingRequests: num(h["x-ratelimit-remaining-requests"]), remainingTokens: num(h["x-ratelimit-remaining-tokens"]), resetRequests: parseDuration(h["x-ratelimit-reset-requests"]) };
}

const safe = (e: unknown) => redact(String((e as Error)?.message ?? e ?? "unknown error")).slice(0, 300);
const statusOf = (e: unknown): number | undefined => (e as { status?: number })?.status;

const BLOCK_MSG: Record<string, string> = {
  rate_limited: "Groq is rate-limiting requests",
  quota_exhausted: "The Groq free quota is used up",
  outage: "Groq is not responding",
  auth_error: "Groq rejected the API key",
};

/**
 * Run one Groq request with ASTON's safety rails (pre-flight block + daily cap,
 * timeout, bounded retries, 429 classification, persisted state). Throws
 * AstonAiUnavailable (user-safe message) instead of ever switching provider.
 * `canRetry` lets a stream refuse a retry once output has been shown.
 */
async function guarded<T>(
  body: ChatBody, d: GroqDeps, timeoutMs: number,
  run: (b: ChatBody & { model: string }) => Promise<{ value: T; headers: Record<string, string> }>,
  canRetry: () => boolean = () => true,
): Promise<T> {
  if (!env.groqApiKey) throw new AstonAiUnavailable("not_configured", "Groq is not configured (set GROQ_API_KEY on the server).");
  const model = body.model || astonModel();
  let st = await d.store.load();
  const now = d.now();
  const today = utcDay(now);
  if (st.day !== today) { st = { ...st, day: today, requestsToday: 0 }; await d.store.save({ day: today, requestsToday: 0 }); }

  if (st.blockedUntil && st.blockedUntil.getTime() > now) {
    throw new AstonAiUnavailable(st.status as AiBlockReason, `${BLOCK_MSG[st.status] ?? "Groq is unavailable"} — ASTON will try again after ${st.blockedUntil.toISOString()}.`, st.blockedUntil);
  }
  if (st.requestsToday >= env.astonAiDailyCap) {
    const until = nextUtcMidnight(now);
    await d.store.save({ status: "quota_exhausted", blockedUntil: until, lastError: `ASTON's daily Groq cap (${env.astonAiDailyCap} requests) is reached.` });
    throw new AstonAiUnavailable("quota_exhausted", `ASTON's daily Groq budget is used up — AI resumes after ${until.toISOString()}.`, until);
  }

  const reasoning = /gpt-oss/i.test(model) && !body.reasoning_effort ? { reasoning_effort: "low" as const } : {};
  let requests = st.requestsToday;
  for (let attempt = 0; ; attempt++) {
    requests += 1;
    await d.store.save({ requestsToday: requests });
    try {
      const { value, headers } = await run({ ...body, ...reasoning, model });
      const q = quotaFromHeaders(headers);
      const exhausted = q.remainingRequests === 0;
      const until = exhausted ? new Date(d.now() + (q.resetRequests ?? 60 * 60_000)) : null;
      await d.store.save({
        status: exhausted ? "quota_exhausted" : "ok", blockedUntil: until, lastOkAt: new Date(d.now()),
        lastError: exhausted ? "The Groq daily request quota is used up." : null,
        remainingRequests: q.remainingRequests, remainingTokens: q.remainingTokens,
      });
      return value;
    } catch (e) {
      const status = statusOf(e);
      const msg = safe(e);
      const again = attempt < env.astonAiMaxRetries && canRetry();
      if (status === 429) {
        const { daily, waitMs } = classify429(String((e as Error)?.message ?? ""), (e as { headers?: Record<string, string> }).headers ?? {});
        if (!daily && waitMs <= 5_000 && again) { await d.sleep(waitMs); continue; }
        const reason = daily ? "quota_exhausted" : "rate_limited";
        const until = new Date(d.now() + Math.max(waitMs, 5_000));
        await d.store.save({ status: reason, blockedUntil: until, lastError: msg, ...(daily ? { remainingRequests: 0 } : {}) });
        throw new AstonAiUnavailable(reason, `${BLOCK_MSG[reason]} — ASTON will try again after ${until.toISOString()}.`, until);
      }
      if (status === 401 || status === 403) {
        const until = new Date(d.now() + 60 * 60_000);
        await d.store.save({ status: "auth_error", blockedUntil: until, lastError: `Groq answered HTTP ${status} (API key rejected).` });
        throw new AstonAiUnavailable("auth_error", "Groq rejected the API key — check GROQ_API_KEY on the server.", until);
      }
      const retryable = status === undefined || status >= 500 || status === 408;
      if (!retryable) {
        await d.store.save({ lastError: `HTTP ${status}: ${msg}` });
        throw new AstonAiUnavailable("request_error", `Groq refused the request (HTTP ${status}): ${msg}`);
      }
      if (again) {
        await d.sleep(Math.min(8_000, 500 * 3 ** attempt) + Math.floor(Math.random() * 250));
        continue;
      }
      // Out of retries: open the circuit for two minutes so callers fail fast.
      const until = new Date(d.now() + 120_000);
      await d.store.save({ status: "outage", blockedUntil: until, lastError: status ? `HTTP ${status}: ${msg}` : msg });
      throw new AstonAiUnavailable("outage", `Groq is not responding (${status ? `HTTP ${status}` : "network error/timeout"}) — ASTON will try again after ${until.toISOString()}.`, until);
    }
  }
}

/** One Groq chat completion with ASTON's safety rails. */
export async function groqChat(body: ChatBody, opts: { deps?: Partial<GroqDeps> } = {}): Promise<OpenAI.Chat.ChatCompletion> {
  const d: GroqDeps = { ...defaultDeps(), ...opts.deps } as GroqDeps;
  return guarded(body, d, env.astonAiTimeoutMs, async (b) => {
    const { data, headers } = await d.create(b, env.astonAiTimeoutMs);
    return { value: data, headers };
  });
}

/**
 * A streamed Groq completion (same rails). `onDelta` receives the text as it
 * is written. A failure before the first token is retried; after output has
 * started it is not (the caller resumes the step instead).
 */
export async function groqStream(body: ChatBody, onDelta: (text: string) => void, opts: { deps?: Partial<GroqDeps>; timeoutMs?: number } = {}): Promise<string> {
  const d: GroqDeps = { ...defaultDeps(), ...opts.deps } as GroqDeps;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let emitted = false;
  return guarded(body, d, timeoutMs, async (b) => {
    const { headers, deltas } = await d.stream(b, timeoutMs);
    let text = "";
    for await (const piece of deltas) {
      emitted = true;
      text += piece;
      onDelta(piece);
    }
    return { value: text, headers };
  }, () => !emitted);
}

export interface AiStatus {
  provider: "groq";
  configured: boolean;
  model: string;
  status: string;
  blockedUntil: string | null;
  requestsToday: number;
  dailyCap: number;
  remainingRequests: number | null;
  remainingTokens: number | null;
  lastError: string | null;
  lastOkAt: string | null;
}

export async function aiStatus(store: StateStore = dbStore()): Promise<AiStatus> {
  const s = await store.load();
  const today = utcDay(Date.now());
  const blocked = s.blockedUntil && s.blockedUntil.getTime() > Date.now();
  return {
    provider: "groq",
    configured: env.groqApiKey.length > 0,
    model: astonModel(),
    status: !env.groqApiKey ? "not_configured" : blocked ? s.status : s.status === "auth_error" ? "auth_error" : "ok",
    blockedUntil: blocked ? s.blockedUntil!.toISOString() : null,
    requestsToday: s.day === today ? s.requestsToday : 0,
    dailyCap: env.astonAiDailyCap,
    remainingRequests: s.remainingRequests,
    remainingTokens: s.remainingTokens,
    lastError: s.lastError,
    lastOkAt: s.lastOkAt ? s.lastOkAt.toISOString() : null,
  };
}

export interface GroqCheck {
  ok: boolean;
  model: string;
  modelListed: boolean | null;
  toolCalling: boolean | null;
  jsonOutput: boolean | null;
  latencyMs: number | null;
  error: string | null;
}

/**
 * A REAL end-to-end check of the configured model: is it listed by Groq, can it
 * call a tool, and can it return JSON. Three small requests — run on demand.
 */
export async function verifyGroq(deps?: Partial<GroqDeps> & { fetchImpl?: typeof fetch }): Promise<GroqCheck> {
  const model = astonModel();
  const out: GroqCheck = { ok: false, model, modelListed: null, toolCalling: null, jsonOutput: null, latencyMs: null, error: null };
  if (!env.groqApiKey) return { ...out, error: "GROQ_API_KEY is not set on the server." };
  try {
    const f = deps?.fetchImpl ?? fetch;
    const r = await f(`${GROQ_BASE_URL}/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${env.groqApiKey}` }, signal: AbortSignal.timeout(15_000) });
    out.modelListed = r.ok;
    if (!r.ok) return { ...out, error: `Groq does not list the model "${model}" (HTTP ${r.status}). Set GROQ_MODEL to a current model from console.groq.com/docs/models.` };
    const t0 = Date.now();
    const tool = await groqChat({
      messages: [{ role: "user", content: "Check the status of project Alpha using the tool." }],
      tools: [{ type: "function", function: { name: "project_status", description: "Get a project's status", parameters: { type: "object", properties: { project: { type: "string" } }, required: ["project"] } } }],
      tool_choice: "required",
      max_tokens: 200,
    }, { deps });
    out.latencyMs = Date.now() - t0;
    out.toolCalling = (tool.choices[0]?.message?.tool_calls?.length ?? 0) > 0;
    const json = await groqChat({
      messages: [{ role: "system", content: 'Reply with JSON only: {"ok": true}' }, { role: "user", content: "ping" }],
      response_format: { type: "json_object" },
      max_tokens: 100,
    }, { deps });
    try { out.jsonOutput = JSON.parse(json.choices[0]?.message?.content ?? "")?.ok === true; } catch { out.jsonOutput = false; }
    out.ok = !!(out.modelListed && out.toolCalling && out.jsonOutput);
    if (!out.ok) out.error = "The model answered, but tool calling or JSON output did not work as expected.";
    return out;
  } catch (e) {
    return { ...out, error: e instanceof AstonAiUnavailable ? e.message : safe(e) };
  }
}
