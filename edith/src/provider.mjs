/**
 * LLM provider for EDITH's reasoning + code generation.
 * Standalone, reuses the same env keys as JARVIS. First configured
 * OpenAI-compatible provider wins. No fake fallback engine — if nothing is
 * configured, the agent reports it honestly.
 */
import { log } from "./log.mjs";

const read = (n) => (process.env[n] ?? "").trim();

/** All configured providers, preferred first, then the rest in default order. */
function resolveChain() {
  // Order matters: OpenRouter's llama-3.3-70b is a very reliable JSON producer,
  // so it sits right after Groq and ahead of Gemini (which often returns 503 on
  // the free tier). Cerebras is later since its free tier may require billing.
  // Ollama runs on your own machine — free and unlimited. Enabled when you set
  // OLLAMA_MODEL (e.g. qwen2.5-coder:7b). It needs no real key; "ollama" is a
  // placeholder the OpenAI-compatible endpoint ignores.
  const ollamaModel = read("OLLAMA_MODEL");
  const ollamaBase = (read("OLLAMA_BASE_URL") || "http://127.0.0.1:11434").replace(/\/$/, "");
  const order = [
    ["groq", read("GROQ_API_KEY"), "https://api.groq.com/openai/v1", read("GROQ_MODEL") || "openai/gpt-oss-120b"],
    ["openrouter", read("OPENROUTER_API_KEY"), "https://openrouter.ai/api/v1", read("OPENROUTER_MODEL") || "deepseek/deepseek-chat-v3-0324:free"],
    ["mistral", read("MISTRAL_API_KEY"), "https://api.mistral.ai/v1", read("MISTRAL_MODEL") || "mistral-small-latest"],
    ["github", read("GITHUB_MODELS_TOKEN"), "https://models.github.ai/inference", read("GITHUB_MODELS_MODEL") || "openai/gpt-4.1-mini"],
    ["sambanova", read("SAMBANOVA_API_KEY"), "https://api.sambanova.ai/v1", read("SAMBANOVA_MODEL") || "Meta-Llama-3.3-70B-Instruct"],
    ["gemini", read("GEMINI_API_KEY"), "https://generativelanguage.googleapis.com/v1beta/openai", read("GEMINI_MODEL") || "gemini-3.6-flash"],
    ["cerebras", read("CEREBRAS_API_KEY"), "https://api.cerebras.ai/v1", read("CEREBRAS_MODEL") || "gpt-oss-120b"],
    ["openai", read("OPENAI_API_KEY"), read("OPENAI_BASE_URL") || "https://api.openai.com/v1", "gpt-4o-mini"],
    // Last resort: local model, never rate-limited or billed.
    ["ollama", ollamaModel ? "ollama" : "", `${ollamaBase}/v1`, ollamaModel],
  ];
  const preferred = read("EDITH_AI_PROVIDER").toLowerCase() || read("AI_PROVIDER").toLowerCase();
  const configured = order.filter((p) => p[1]).map(([provider, apiKey, baseUrl, model]) => ({ provider, apiKey, baseUrl, model }));
  // Move the preferred provider to the front if it's configured.
  const i = configured.findIndex((p) => p.provider === preferred);
  if (i > 0) configured.unshift(configured.splice(i, 1)[0]);
  return configured;
}

function resolveProvider() {
  return resolveChain()[0] ?? null;
}
void resolveProvider; // kept for reference; chain() is the live path

// Resolve lazily: run.mjs loads .env AFTER modules are imported, so resolving at
// import time would miss the keys. Cache on first real use.
let _chain;
let _resolved = false;
function chain() {
  if (!_resolved) { _chain = resolveChain(); _resolved = true; }
  return _chain;
}
function provider() { return chain()[0] ?? null; }

export function providerName() {
  const p = provider();
  const rest = chain().length - 1;
  return p ? `${p.provider} (${p.model})${rest > 0 ? ` +${rest} fallback` : ""}` : "none";
}
/** Ordered list of EVERY configured provider (name + model) for diagnostics. */
export function providerSummary() {
  const c = chain();
  return c.length ? c.map((p) => `${p.provider}(${p.model})`).join(" → ") : "none";
}
export function hasProvider() {
  return !!provider();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A single EDITH action can carry a whole file's contents inside the JSON
// (e.g. write_file for an HTML/CSS page), so the completion budget must be
// generous or the JSON gets truncated mid-string and won't parse. Configurable
// via EDITH_MAX_TOKENS. gpt-oss / gemini support far more than this default.
const MAX_TOKENS = Math.max(2048, Number(process.env.EDITH_MAX_TOKENS || 8192));

// Providers that answered with a "this won't fix itself soon" error — no billing
// (402), bad/unauthorised key (401/403) or unknown model (404). We skip them for
// a while instead of wasting a request on every step; after the cool-down they
// are tried again (daily free quotas do reset).
const DEAD_MS = 15 * 60_000;
const dead = new Map(); // provider -> { until, reason }
function isDead(name) {
  const d = dead.get(name);
  if (!d) return false;
  if (Date.now() > d.until) { dead.delete(name); return false; }
  return true;
}
function explain(status, text) {
  if (status === 402 || /payment|billing|credit|quota/i.test(text)) return "out of free quota / needs billing";
  if (status === 401) return "API key invalid";
  if (status === 403) return "key not allowed (check account/region)";
  if (status === 404) return "model not found (check the *_MODEL setting)";
  if (status === 429) return "rate-limited";
  if (status === 503) return "overloaded";
  return `HTTP ${status}`;
}

/**
 * Ask the model for a JSON object. Tries each configured provider in order,
 * falling back on transient errors (429 rate-limit / 503 overloaded / network),
 * with one short retry on the first provider. Throws only if ALL providers fail
 * — never fabricates a response.
 */
export async function askJson(system, user) {
  const providers = chain();
  if (!providers.length) throw new Error("No AI provider configured (set GROQ_API_KEY, MISTRAL_API_KEY, GITHUB_MODELS_TOKEN, SAMBANOVA_API_KEY, GEMINI/CEREBRAS/OPENROUTER/OPENAI, or OLLAMA_MODEL).");

  // Groq (and some others) reject json_object mode unless the prompt literally
  // contains the word "json". Guarantee it so we never eat a needless 400.
  const sys = /json/i.test(system) ? system : `${system}\n\nRespond ONLY with a single valid JSON object.`;

  // Free tiers get momentarily rate-limited (429) or overloaded (503) — often all
  // at once during a multi-step build. Rather than aborting the whole goal, retry
  // the ENTIRE chain a few times with exponential backoff, but only while the
  // failures are transient (a hard 401/404 or a bad response won't self-heal).
  const ROUNDS = Math.max(1, Number(process.env.EDITH_RETRY_ROUNDS || 3));
  let lastErr = "";
  const errors = new Map(); // provider -> short reason (latest), for a useful final message

  for (let round = 0; round < ROUNDS; round++) {
    let sawTransient = false;

    for (let i = 0; i < providers.length; i++) {
      const P = providers[i];
      if (isDead(P.provider)) { errors.set(P.provider, dead.get(P.provider).reason); continue; }
      // gpt-oss is a REASONING model: on Groq, strict json_object mode fails
      // (json_validate_failed) and long reasoning can eat the whole budget, so
      // we skip json mode for it and cap reasoning to leave room for the answer.
      const isGptOss = /gpt-oss/i.test(P.model);
      const groqGptOss = P.provider === "groq" && isGptOss;
      // Request shapes to try: strict json_object first, then a plain fallback.
      const shapes = groqGptOss ? [false] : [true, false];
      let nextProvider = false;
      for (const useJsonMode of shapes) {
        if (nextProvider) break;
        try {
          const body = {
            model: P.model,
            temperature: 0.1,
            max_tokens: MAX_TOKENS,
            messages: [{ role: "system", content: sys }, { role: "user", content: user }],
          };
          if (useJsonMode) body.response_format = { type: "json_object" };
          // gpt-oss is a reasoning model. Keep reasoning short so it actually
          // emits the final JSON answer (and we also read the reasoning channel
          // below as a fallback). Do NOT hide reasoning — that can delete the
          // only channel the answer was written to.
          if (isGptOss && (P.provider === "groq" || P.provider === "cerebras")) {
            body.reasoning_effort = "low";
          }

          const res = await fetch(`${P.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${P.apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
          });

          if (res.ok) {
            const data = await res.json();
            const msg = data.choices?.[0]?.message ?? {};
            // Prefer content; fall back to the reasoning channel if content is empty.
            const out = (msg.content && msg.content.trim()) ? msg.content : (msg.reasoning || "");
            return parseJson(out);
          }

          const text = (await res.text().catch(() => "")).slice(0, 240);
          lastErr = `${P.provider} ${res.status}: ${text}`;
          errors.set(P.provider, explain(res.status, text));
          log.warn(`Provider ${P.provider} (${P.model}) ${res.status}: ${text}`);

          // Won't recover by retrying: park this provider for a while.
          if ([401, 402, 403, 404].includes(res.status)) {
            dead.set(P.provider, { until: Date.now() + DEAD_MS, reason: explain(res.status, text) });
            log.warn(`Skipping ${P.provider} for ${DEAD_MS / 60000} min — ${explain(res.status, text)}.`);
          }

          if (res.status === 429 || res.status === 503) {
            sawTransient = true; nextProvider = true; break; // transient → next provider, retry later
          }
          // A response_format/json complaint → retry this provider WITHOUT json mode.
          if (res.status === 400 && useJsonMode && /json|response_format/i.test(text)) {
            continue; // try the plain (non-json-mode) shape
          }
          nextProvider = true; break; // any other hard error → next provider
        } catch (err) {
          lastErr = `${P.provider}: ${err.message}`;
          errors.set(P.provider, /timeout|aborted/i.test(err.message) ? "timed out" : `unreachable (${err.message})`);
          log.warn(`Provider ${P.provider} error: ${err.message}`);
          // Network/timeout errors are transient and worth a later retry.
          if (/timeout|network|fetch failed|ECONN|socket|aborted/i.test(err.message)) sawTransient = true;
          nextProvider = true; break; // → next provider
        }
      }
    }

    // Whole chain failed this round. Back off and retry only if it might recover.
    if (round < ROUNDS - 1 && sawTransient) {
      const wait = 1500 * Math.pow(2, round); // 1.5s, 3s, 6s…
      log.warn(`All providers busy — retrying in ${wait}ms (round ${round + 2}/${ROUNDS})…`);
      await sleep(wait);
      continue;
    }
    break; // nothing transient to wait on, or out of rounds
  }
  const detail = [...errors.entries()].map(([name, why]) => `${name}: ${why}`).join(" · ");
  const hint = [...errors.values()].every((w) => /quota|billing|invalid|not allowed|rate-limited/.test(w))
    ? " — add another free key (MISTRAL_API_KEY, GITHUB_MODELS_TOKEN, SAMBANOVA_API_KEY) or run a local model with OLLAMA_MODEL in edith/.env."
    : "";
  throw new Error(`All AI providers failed. ${detail || `Last: ${lastErr}`}${hint}`);
}

function parseJson(text) {
  const raw = (text ?? "").trim();
  // Strip a ```json … ``` (or ``` … ```) code fence if the model added one.
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  for (const candidate of [unfenced, raw]) {
    try { return JSON.parse(candidate); } catch { /* try extraction */ }
    // Outermost { … } — greedy, so it captures a complete object amid any prose.
    const m = candidate.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  }

  // Heuristic: an opening brace but no matching close → the response was cut off.
  const looksTruncated = unfenced.includes("{") && !/\}\s*$/.test(unfenced);
  log.warn("Model returned non-JSON:", raw.slice(0, 200));
  throw new Error(
    looksTruncated
      ? "The model's JSON was cut off (raise EDITH_MAX_TOKENS or use a larger model)."
      : "The model returned an unparseable response.",
  );
}
