/**
 * LLM provider for ULTRON's reasoning + code generation.
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
  const configured = order.filter((p) => p[1]).map(([provider, apiKey, baseUrl, model]) => ({ provider, apiKey, baseUrl, model }));
  // Groq: every key found (environment, edith/.env, .env.local, .env) in order,
  // so a stale key in one file falls through to a working one in another.
  const groq = configured.find((p) => p.provider === "groq");
  if (groq) {
    const found = Array.isArray(globalThis.__ULTRON_GROQ_KEYS__) ? globalThis.__ULTRON_GROQ_KEYS__ : [];
    const keys = [{ source: "GROQ_API_KEY", key: groq.apiKey }, ...found].filter((k, i, a) => a.findIndex((x) => x.key === k.key) === i);
    // The key actually in effect keeps the name of the file it came from.
    const own = found.find((k) => k.key === groq.apiKey);
    if (own) keys[0].source = own.source;
    groq.keys = keys; groq.keyIdx = 0; groq.badKeys = [];
    groq.tpm = Math.max(2000, Number(read("GROQ_TPM")) || 8000); // free-plan tokens/minute for gpt-oss-120b
    groq.slack = 0;
  }
  // ULTRON runs on the providers listed in ULTRON_AI_PROVIDER, in that order —
  // by default Groq, with Gemini as the backup. Nothing else is used.
  const list = providerList();
  if (!list.includes("auto")) return list.map((name) => configured.find((p) => p.provider === name)).filter(Boolean);
  // "auto": every configured provider. Speed first — cloud keys answer and your
  // Ollama model is the unlimited backup; BRAIN_PRIORITY=first puts Ollama first.
  const brainFirst = read("BRAIN_PRIORITY").toLowerCase() === "first" && ollamaModel ? "ollama" : "";
  const preferred = brainFirst || read("AI_PROVIDER").toLowerCase();
  // Move the preferred provider to the front if it's configured.
  const i = configured.findIndex((p) => p.provider === preferred);
  if (i > 0) configured.unshift(configured.splice(i, 1)[0]);
  return configured;
}

/** "groq,gemini" (default), another provider id / comma list, or "auto" for the whole chain. */
export function onlyProvider() {
  return read("ULTRON_AI_PROVIDER").toLowerCase() || "groq,gemini";
}
export function providerList() {
  return onlyProvider().split(/[\s,>]+/).filter(Boolean);
}
const KEY_FOR = { groq: "GROQ_API_KEY (free at console.groq.com)", gemini: "GEMINI_API_KEY (free at aistudio.google.com/apikey)" };
/** What to tell the user when none of ULTRON's providers is set up. */
export function missingProviderMessage() {
  const list = providerList();
  if (list.includes("auto")) return "No AI provider configured (set GROQ_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, GITHUB_MODELS_TOKEN, SAMBANOVA_API_KEY, CEREBRAS/OPENROUTER/OPENAI, or OLLAMA_MODEL).";
  if (list.every((p) => KEY_FOR[p])) {
    return `ULTRON runs on ${list.map((p) => p[0].toUpperCase() + p.slice(1)).join(", then ")}, and none of them is set up — add ${list.map((p) => KEY_FOR[p]).join(" or ")} to edith/.env or the app's .env.local.`;
  }
  return `ULTRON_AI_PROVIDER=${onlyProvider()} — none of those providers is configured in edith/.env.`;
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

// A single ULTRON action can carry a whole file's contents inside the JSON
// (e.g. write_file for an HTML/CSS page), so the completion budget must be
// generous or the JSON gets truncated mid-string and won't parse. Configurable
// via ULTRON_MAX_TOKENS. gpt-oss / gemini support far more than this default.
const MAX_TOKENS = Math.max(2048, Number(process.env.ULTRON_MAX_TOKENS || 8192));

// Groq's free plan counts the prompt PLUS the requested reply (max_tokens)
// against a per-minute token limit (8,000 for gpt-oss-120b) and refuses any
// single request above it. So for Groq the reply budget is sized to fit.
const estTokens = (s) => Math.ceil((s?.length ?? 0) / 3.2);
function maxTokensFor(P, sys, user) {
  if (P.provider !== "groq") return MAX_TOKENS;
  const room = P.tpm - estTokens(sys) - estTokens(user) - 250 - (P.slack || 0);
  return Math.max(600, Math.min(MAX_TOKENS, room));
}

/**
 * How many characters the step message (goal + history) may use so the reply
 * still has room — Infinity unless the first provider is budget-limited (Groq).
 */
export function promptBudgetChars(systemText) {
  const P = chain()[0];
  if (!P || P.provider !== "groq") return Infinity;
  return Math.max(2500, Math.floor((P.tpm - 2600 - estTokens(systemText) - (P.slack || 0)) * 3.2));
}
/** Which file the Groq key in use came from (e.g. ".env.local"). */
export function groqKeySource() {
  const P = chain().find((p) => p.provider === "groq");
  return P?.keys?.[P.keyIdx]?.source ?? null;
}
/** True when ULTRON's first provider is Groq (prompts are kept compact). */
export function groqFirst() { return chain()[0]?.provider === "groq"; }

/** Seconds Groq asks us to wait (retry-after header, or "try again in 7.5s" / "1m2s"). */
function waitSeconds(res, text) {
  const h = Number(res.headers?.get?.("retry-after"));
  if (Number.isFinite(h) && h > 0) return Math.ceil(h);
  const m = text.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
  return m ? Math.ceil(Number(m[1] || 0) * 60 + Number(m[2])) : 0;
}

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
// What a real key looks like per provider + where to get a fresh one. Used to
// turn a bare "401" into an actionable message (never prints the key itself).
const KEY_INFO = {
  groq: { prefix: "gsk_", where: "console.groq.com/keys" },
  gemini: { prefix: "AIza", where: "aistudio.google.com/apikey" },
  openrouter: { prefix: "sk-or-", where: "openrouter.ai/keys" },
  cerebras: { prefix: "csk-", where: "cloud.cerebras.ai" },
  mistral: { prefix: "", where: "console.mistral.ai/api-keys" },
  github: { prefix: "github_pat_", where: "github.com/settings/tokens (fine-grained, Models: read)" },
  sambanova: { prefix: "", where: "cloud.sambanova.ai/apis" },
  openai: { prefix: "sk-", where: "platform.openai.com/api-keys" },
};

function explain(status, text, P) {
  if (status === 402 || /payment|billing|credit|quota/i.test(text)) return "out of free quota / needs billing";
  if (/data policy|privacy/i.test(text)) return "blocked by your OpenRouter privacy settings (openrouter.ai/settings/privacy → allow free models)";
  if (status === 401 || (status === 400 && /api.?key|API_KEY_INVALID|unauthor/i.test(text))) {
    const info = P && KEY_INFO[P.provider];
    if (info?.prefix && P.apiKey && !P.apiKey.startsWith(info.prefix)) {
      return `API key invalid — ${P.provider} keys start with "${info.prefix}" and yours doesn't; create one at ${info.where}`;
    }
    if (P?.provider === "groq" && P.keys?.length) {
      const bad = [...new Set([...(P.badKeys ?? []), P.keys[P.keyIdx]?.source].filter(Boolean))];
      return `Groq rejected the key in ${bad.join(" and ")} (invalid or revoked) — create a new one at ${info.where} and put it in ${bad[0] === ".env.local" || bad[0] === ".env" ? bad[0] : "edith/.env (or delete that line there so the app's .env.local key is used)"}`;
    }
    return info ? `API key invalid or revoked — create a new one at ${info.where}` : "API key invalid";
  }
  if (status === 413 || /request too large|tokens per minute|\bTPM\b/i.test(text)) {
    return P?.provider === "groq"
      ? "this step is larger than your Groq plan's tokens-per-minute limit"
      : "request too large for this model";
  }
  if (status === 403) return "key not allowed (check account/region)";
  if (status === 404) return "model not found (check the *_MODEL setting)";
  if (status === 429) return "rate-limited";
  if (status === 503) return "overloaded";
  return `HTTP ${status}`;
}

// OpenRouter rotates its free models often, so a hard-coded ":free" id goes
// stale. When ours 404s, ask OpenRouter which free models exist right now and
// switch to the best one (public endpoint; no extra config needed).
let _orFree = null;
export async function pickOpenRouterFree(exclude = "") {
  if (_orFree && _orFree !== exclude) return _orFree;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const { data = [] } = await res.json();
    const free = data.filter((m) =>
      m?.id && m.id !== exclude &&
      (m.id.endsWith(":free") || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)) &&
      (m.context_length ?? 0) >= 16000);
    const prefs = [/deepseek.*(chat|v3|r1)/i, /qwen.*coder/i, /llama-3\.3-70b/i, /qwen/i, /gemini.*flash/i, /mistral|devstral/i, /llama/i];
    const score = (m) => { const i = prefs.findIndex((re) => re.test(m.id)); return (i === -1 ? 99 : i) * 1e7 - (m.context_length ?? 0); };
    free.sort((a, b) => score(a) - score(b));
    _orFree = free[0]?.id ?? null;
    return _orFree;
  } catch {
    return null;
  }
}

// Local Ollama is never rate-limited but can be slow (especially the first call,
// which loads the model from disk), so it gets far more time than cloud APIs.
const OLLAMA_TIMEOUT_MS = Math.max(30_000, Number(process.env.OLLAMA_TIMEOUT_MS || 300_000));
function timeoutFor(P) { return P.provider === "ollama" ? OLLAMA_TIMEOUT_MS : 60_000; }

/**
 * Load the Ollama model into memory now (and keep it there for 24h) so ULTRON's
 * first real step doesn't pay the 30–90s load time. Safe to call repeatedly.
 */
export async function warmOllama() {
  const P = chain().find((p) => p.provider === "ollama");
  if (!P) return { configured: false };
  const base = P.baseUrl.replace(/\/v1\/?$/, "");
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: P.model, prompt: "", keep_alive: "24h" }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      return { configured: true, ok: false, model: P.model, error: /not found/i.test(text) ? `model not downloaded — run: ollama pull ${P.model}` : `HTTP ${res.status} ${text}` };
    }
    return { configured: true, ok: true, model: P.model, seconds: Math.round((Date.now() - t0) / 1000) };
  } catch (err) {
    const msg = /timeout|aborted/i.test(err.message)
      ? `still loading after ${Math.round(OLLAMA_TIMEOUT_MS / 1000)}s — this PC may be too slow for ${P.model}; try a smaller model (e.g. qwen2.5-coder:3b)`
      : "can't reach Ollama — open the Ollama app (llama icon in the tray) or run: ollama serve";
    return { configured: true, ok: false, model: P.model, error: msg };
  }
}

/**
 * Ask the model for a JSON object. Tries each configured provider in order,
 * falling back on transient errors (429 rate-limit / 503 overloaded / network),
 * with one short retry on the first provider. Throws only if ALL providers fail
 * — never fabricates a response.
 */
export async function askJson(system, user, { onWait } = {}) {
  const providers = chain();
  if (!providers.length) throw new Error(missingProviderMessage());

  // Groq (and some others) reject json_object mode unless the prompt literally
  // contains the word "json". Guarantee it so we never eat a needless 400.
  const sys = /json/i.test(system) ? system : `${system}\n\nRespond ONLY with a single valid JSON object.`;

  // Free tiers get momentarily rate-limited (429) or overloaded (503) — often all
  // at once during a multi-step build. Rather than aborting the whole goal, retry
  // the ENTIRE chain a few times with exponential backoff, but only while the
  // failures are transient (a hard 401/404 or a bad response won't self-heal).
  const ROUNDS = Math.max(1, Number(process.env.ULTRON_RETRY_ROUNDS || 3));
  let lastErr = "";
  const errors = new Map(); // provider -> short reason (latest), for a useful final message
  let waits = 0; // times we waited out Groq's per-minute limit for this step
  let shrunk = false; // retried once with a smaller reply budget

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
            max_tokens: maxTokensFor(P, sys, user),
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
            signal: AbortSignal.timeout(timeoutFor(P)),
          });

          if (res.ok) {
            const data = await res.json();
            const msg = data.choices?.[0]?.message ?? {};
            // Prefer content; fall back to the reasoning channel if content is empty.
            const out = (msg.content && msg.content.trim()) ? msg.content : (msg.reasoning || "");
            return parseJson(out);
          }

          const text = (await res.text().catch(() => "")).slice(0, 700);
          lastErr = `${P.provider} ${res.status}: ${text}`;
          errors.set(P.provider, explain(res.status, text, P));
          log.warn(`Provider ${P.provider} (${P.model}) ${res.status}: ${text.slice(0, 300)}`);

          // OpenRouter model retired → switch to a current free model and retry it.
          if (P.provider === "openrouter" && !P.swapped && (res.status === 404 || /not a valid model|model.*(not found|does not exist)/i.test(text)) && !/data policy|privacy/i.test(text)) {
            const alt = await pickOpenRouterFree(P.model);
            if (alt) {
              log.info(`OpenRouter model ${P.model} is unavailable — switching to free model ${alt}.`);
              P.model = alt; P.swapped = true; errors.delete(P.provider);
              i -= 1; nextProvider = true; break; // re-run this provider with the new model
            }
          }
          if (P.provider === "groq") {
            // A rejected key → try the next Groq key found in another file.
            if (res.status === 401 && P.keys && P.keyIdx < P.keys.length - 1) {
              P.badKeys.push(P.keys[P.keyIdx].source);
              P.keyIdx += 1; P.apiKey = P.keys[P.keyIdx].key; errors.delete(P.provider);
              log.warn(`Groq rejected the key in ${P.badKeys.at(-1)} — trying the one in ${P.keys[P.keyIdx].source}.`);
              i -= 1; nextProvider = true; break;
            }
            // One request bigger than the plan's per-minute limit → shrink the reply budget once.
            const lim = text.match(/Limit (\d+), Requested (\d+)/i);
            if (lim && (res.status === 413 || /request too large|reduce your message size/i.test(text))) {
              const limit = Number(lim[1]), requested = Number(lim[2]);
              P.tpm = Math.min(P.tpm, limit);
              P.slack = (P.slack || 0) + Math.max(0, requested - limit) + 150;
              if (!shrunk && maxTokensFor(P, sys, user) >= 600 && body.max_tokens > maxTokensFor(P, sys, user)) {
                shrunk = true; errors.delete(P.provider);
                log.info(`Groq plan limit ${limit} tokens/min — retrying with a smaller reply budget (${maxTokensFor(P, sys, user)}).`);
                i -= 1; nextProvider = true; break;
              }
            }
            // Per-minute tokens used up by earlier steps: with a backup (Gemini)
            // available, rest Groq for as long as it asks and use the backup now;
            // otherwise wait it out (up to ~75s).
            if (res.status === 429 && !/request too large/i.test(text)) {
              const secs = waitSeconds(res, text) || 20;
              const backup = providers.some((q) => q !== P && !isDead(q.provider));
              if (backup) {
                dead.set(P.provider, { until: Date.now() + secs * 1000, reason: "rate-limited" });
                log.info(`Groq per-minute limit reached — using the backup for the next ${secs}s.`);
                errors.set(P.provider, "rate-limited");
                nextProvider = true; break;
              }
              if (secs <= 75 && waits < 3) {
                waits += 1; errors.delete(P.provider);
                log.info(`Groq per-minute limit reached — waiting ${secs}s.`);
                try { onWait?.(secs); } catch { /* ignore */ }
                await sleep(secs * 1000 + 250);
                i -= 1; nextProvider = true; break;
              }
            }
          }
          // Won't recover by retrying: park this provider for a while.
          if ([401, 402, 403, 404].includes(res.status)) {
            dead.set(P.provider, { until: Date.now() + DEAD_MS, reason: explain(res.status, text, P) });
            log.warn(`Skipping ${P.provider} for ${DEAD_MS / 60000} min — ${explain(res.status, text, P)}.`);
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
  const hint = onlyProvider() === "auto" && [...errors.values()].every((w) => /quota|billing|invalid|not allowed|rate-limited/.test(w))
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
      ? "The model's JSON was cut off (raise ULTRON_MAX_TOKENS or use a larger model)."
      : "The model returned an unparseable response.",
  );
}

/**
 * Test every configured provider with a tiny request and report which keys work.
 * Powers `npm run check`. Never prints the keys themselves.
 */
export async function checkProviders(onProgress = () => {}) {
  const out = [];
  for (const P of chain()) {
    if (P.provider === "ollama") {
      onProgress(`Loading ${P.model} into memory (the first time can take a minute or two)…`);
      const w = await warmOllama();
      if (!w.ok) { out.push({ provider: P.provider, model: P.model, ok: false, reason: w.error }); continue; }
      onProgress(`  model loaded in ${w.seconds}s`);
    }
    const probe = async () => fetch(`${P.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${P.apiKey}` },
      body: JSON.stringify({ model: P.model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the word ok." }] }),
      signal: AbortSignal.timeout(P.provider === "ollama" ? 180_000 : 30_000),
    });
    try {
      let res = await probe();
      let text = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 240);
      if (!res.ok && P.provider === "openrouter" && res.status === 404 && !/data policy|privacy/i.test(text)) {
        const alt = await pickOpenRouterFree(P.model);
        if (alt) { P.model = alt; P.swapped = true; res = await probe(); text = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 240); }
      }
      out.push({ provider: P.provider, model: P.model, ok: res.ok, reason: res.ok ? (P.swapped ? "works (auto-picked current free model)" : "works") : explain(res.status, text, P) });
    } catch (err) {
      out.push({ provider: P.provider, model: P.model, ok: false, reason: /timeout|aborted/i.test(err.message) ? "timed out" : `unreachable (${err.message})` });
    }
  }
  return out;
}
