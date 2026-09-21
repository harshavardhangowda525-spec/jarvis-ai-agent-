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

/**
 * Ask the model for a JSON object. Tries each configured provider in order,
 * falling back on transient errors (429 rate-limit / 503 overloaded / network),
 * with one short retry on the first provider. Throws only if ALL providers fail
 * — never fabricates a response.
 */
export async function askJson(system, user) {
  const providers = chain();
  if (!providers.length) throw new Error("No AI provider configured (set GROQ_API_KEY or GEMINI/CEREBRAS/OPENROUTER/OPENAI).");

  let lastErr = "";
  for (let i = 0; i < providers.length; i++) {
    const P = providers[i];
    for (let attempt = 0; attempt < (i === 0 ? 2 : 1); attempt++) {
      try {
        const res = await fetch(`${P.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${P.apiKey}` },
          body: JSON.stringify({
            model: P.model,
            temperature: 0.1,
            max_tokens: 2048,
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (res.ok) {
          const data = await res.json();
          return parseJson(data.choices?.[0]?.message?.content ?? "");
        }
        const body = (await res.text().catch(() => "")).slice(0, 200);
        lastErr = `${P.provider} ${res.status}: ${body}`;
        // Retry/fall back only on transient statuses; fail fast on 400/401/404.
        if (res.status === 503 || res.status === 429) {
          if (attempt === 0 && i === 0) { await sleep(2000); continue; } // one quick retry
          break; // move to the next provider
        }
        throw new Error(`EDITH LLM error ${res.status}: ${body}`);
      } catch (err) {
        lastErr = `${P.provider}: ${err.message}`;
        if (err.message?.startsWith("EDITH LLM error")) throw err; // non-transient
        break; // network/timeout → next provider
      }
    }
  }
  throw new Error(`All AI providers failed. Last: ${lastErr}`);
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* try to extract */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  log.warn("Model returned non-JSON:", text.slice(0, 160));
  throw new Error("The model returned an unparseable response.");
}
