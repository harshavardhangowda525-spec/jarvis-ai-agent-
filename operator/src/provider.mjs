/**
 * LLM provider for the operator's brain (planning + next-action decisions).
 *
 * Standalone (no dependency on the Next app): it reads the same environment
 * variables you already use for JARVIS and calls the first configured
 * OpenAI-compatible provider. Groq/Cerebras/OpenRouter/Gemini/OpenAI all speak
 * the /chat/completions protocol, so a single fetch path covers them.
 */
import { log } from "./log.mjs";

const read = (n) => (process.env[n] ?? "").trim();

function resolveProvider() {
  const order = [
    ["groq", read("GROQ_API_KEY"), "https://api.groq.com/openai/v1", read("GROQ_MODEL") || "openai/gpt-oss-120b"],
    ["cerebras", read("CEREBRAS_API_KEY"), "https://api.cerebras.ai/v1", read("CEREBRAS_MODEL") || "gpt-oss-120b"],
    ["gemini", read("GEMINI_API_KEY"), "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.6-flash"],
    ["openrouter", read("OPENROUTER_API_KEY"), "https://openrouter.ai/api/v1", read("OPENROUTER_MODEL") || "meta-llama/llama-3.3-70b-instruct:free"],
    ["openai", read("OPENAI_API_KEY"), read("OPENAI_BASE_URL") || "https://api.openai.com/v1", "gpt-4o-mini"],
  ];
  const preferred = read("AI_PROVIDER").toLowerCase();
  const configured = order.filter((p) => p[1]);
  const chosen = configured.find((p) => p[0] === preferred) || configured[0];
  if (!chosen) return null;
  const [provider, apiKey, baseUrl, model] = chosen;
  return { provider, apiKey, baseUrl, model: read("AI_MODEL") && provider === preferred ? read("AI_MODEL") : model };
}

const PROVIDER = resolveProvider();

export function providerName() {
  return PROVIDER ? `${PROVIDER.provider} (${PROVIDER.model})` : "none";
}

export function hasProvider() {
  return !!PROVIDER;
}

/**
 * Ask the brain for a JSON object. `system` frames the task, `user` carries the
 * command + current page observation. Returns the parsed JSON, or throws.
 */
export async function askJson(system, user) {
  if (!PROVIDER) throw new Error("No AI provider configured. Set GROQ_API_KEY (or GEMINI/CEREBRAS/OPENROUTER/OPENAI).");
  const res = await fetch(`${PROVIDER.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${PROVIDER.apiKey}` },
    body: JSON.stringify({
      model: PROVIDER.model,
      temperature: 0.1,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Planner LLM error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return parseJson(text);
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  log.warn("Planner returned non-JSON:", text.slice(0, 200));
  throw new Error("The brain returned an unparseable plan.");
}
