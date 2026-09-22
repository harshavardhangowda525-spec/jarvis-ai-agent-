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
  const order = [
    ["groq", read("GROQ_API_KEY"), "https://api.groq.com/openai/v1", read("GROQ_MODEL") || "openai/gpt-oss-120b"],
    ["cerebras", read("CEREBRAS_API_KEY"), "https://api.cerebras.ai/v1", read("CEREBRAS_MODEL") || "gpt-oss-120b"],
    ["gemini", read("GEMINI_API_KEY"), "https://generativelanguage.googleapis.com/v1beta/openai", read("GEMINI_MODEL") || "gemini-3.6-flash"],
    ["openrouter", read("OPENROUTER_API_KEY"), "https://openrouter.ai/api/v1", read("OPENROUTER_MODEL") || "meta-llama/llama-3.3-70b-instruct:free"],
    ["openai", read("OPENAI_API_KEY"), read("OPENAI_BASE_URL") || "https://api.openai.com/v1", "gpt-4o-mini"],
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
export function hasProvider() {
  return !!provider();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A single EDITH action can carry a whole file's contents inside the JSON
// (e.g. write_file for an HTML/CSS page), so the completion budget must be
// generous or the JSON gets truncated mid-string and won't parse. Configurable
// via EDITH_MAX_TOKENS. gpt-oss / gemini support far more than this default.
const MAX_TOKENS = Math.max(2048, Number(process.env.EDITH_MAX_TOKENS || 8192));

/**
 * Ask the model for a JSON object. Tries each configured provider in order,
 * falling back on transient errors (429 rate-limit / 503 overloaded / network),
 * with one short retry on the first provider. Throws only if ALL providers fail
 * — never fabricates a response.
 */
export async function askJson(system, user) {
  const providers = chain();
  if (!providers.length) throw new Error("No AI provider configured (set GROQ_API_KEY or GEMINI/CEREBRAS/OPENROUTER/OPENAI).");

  // Groq (and some others) reject json_object mode unless the prompt literally
  // contains the word "json". Guarantee it so we never eat a needless 400.
  const sys = /json/i.test(system) ? system : `${system}\n\nRespond ONLY with a single valid JSON object.`;

  // Free tiers get momentarily rate-limited (429) or overloaded (503) — often all
  // at once during a multi-step build. Rather than aborting the whole goal, retry
  // the ENTIRE chain a few times with exponential backoff, but only while the
  // failures are transient (a hard 401/404 or a bad response won't self-heal).
  const ROUNDS = Math.max(1, Number(process.env.EDITH_RETRY_ROUNDS || 3));
  let lastErr = "";

  for (let round = 0; round < ROUNDS; round++) {
    let sawTransient = false;

    for (let i = 0; i < providers.length; i++) {
      const P = providers[i];
      // Two request shapes: strict json_object mode, then a plain fallback (no
      // response_format) for models/providers that don't support it — parseJson
      // still extracts the object. This keeps a quirky provider from blocking us.
      let nextProvider = false;
      for (const useJsonMode of [true, false]) {
        if (nextProvider) break;
        try {
          const body = {
            model: P.model,
            temperature: 0.1,
            max_tokens: MAX_TOKENS,
            messages: [{ role: "system", content: sys }, { role: "user", content: user }],
          };
          if (useJsonMode) body.response_format = { type: "json_object" };

          const res = await fetch(`${P.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${P.apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
          });

          if (res.ok) {
            const data = await res.json();
            return parseJson(data.choices?.[0]?.message?.content ?? "");
          }

          const text = (await res.text().catch(() => "")).slice(0, 240);
          lastErr = `${P.provider} ${res.status}: ${text}`;
          log.warn(`Provider ${P.provider} (${P.model}) ${res.status}: ${text}`);

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
  throw new Error(`All AI providers failed. Last: ${lastErr}`);
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
