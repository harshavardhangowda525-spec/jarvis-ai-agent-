/**
 * Central environment access + capability detection.
 *
 * JARVIS never crashes on a missing optional key. Instead each capability
 * exposes an `enabled` flag; routes and the UI read these and degrade
 * gracefully ("web search is not configured", "voice is not configured").
 *
 * Server-only. Do not import into client components.
 */
import "server-only";

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

export const env = {
  databaseUrl: read("DATABASE_URL"),
  authSecret: read("AUTH_SECRET"),
  appUrl: read("APP_URL") || "http://localhost:3000",

  // Legacy/Anthropic key. Kept for backward compatibility.
  aiApiKey: read("AI_API_KEY"),
  aiModel: read("AI_MODEL"),

  // Provider selection: "gemini" | "groq" | "openai" | "anthropic".
  // If unset, it is inferred from whichever key is present.
  aiProvider: read("AI_PROVIDER").toLowerCase(),
  geminiApiKey: read("GEMINI_API_KEY"),
  groqApiKey: read("GROQ_API_KEY"),
  openaiApiKey: read("OPENAI_API_KEY"),
  openaiBaseUrl: read("OPENAI_BASE_URL"),
  // OpenRouter (OpenAI-compatible aggregator; has free models).
  openrouterApiKey: read("OPENROUTER_API_KEY"),
  openrouterModel: read("OPENROUTER_MODEL"),
  // Ollama (local, OpenAI-compatible). Default endpoint is localhost:11434.
  ollamaBaseUrl: read("OLLAMA_BASE_URL"),

  elevenLabsApiKey: read("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: read("ELEVENLABS_VOICE_ID"),
  elevenLabsModelId: read("ELEVENLABS_MODEL_ID") || "eleven_turbo_v2_5",
  elevenLabsSttModelId: read("ELEVENLABS_STT_MODEL_ID") || "scribe_v1",

  searchApiKey: read("SEARCH_API_KEY"),
  weatherApiKey: read("WEATHER_API_KEY"),

  // Infinity Web & Apps (Supabase) — read-only analysis of the site's own data
  // (leads, visitors, signups, …). The service_role key is server-side ONLY and
  // is never sent to the browser. Only GET queries are ever issued.
  supabaseUrl: read("SUPABASE_URL"),
  supabaseServiceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY"),
};

/**
 * Resolves which AI provider powers the agent. Supports Anthropic natively and
 * any OpenAI-compatible endpoint (Gemini, Groq, OpenAI, …). The provider can be
 * swapped entirely via environment variables — no code change required.
 */
export type AiKind = "anthropic" | "openai";

export interface AiConfig {
  provider: string; // gemini | groq | openai | anthropic
  kind: AiKind; // which SDK/protocol to use
  apiKey: string;
  baseUrl?: string; // for OpenAI-compatible providers
  model: string;
}

const AI_DEFAULT_MODEL: Record<string, string> = {
  gemini: "gemini-3.6-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  ollama: "llama3.1",
};

/** Order tried when falling back (a provider is skipped if not configured). */
const AI_FALLBACK_ORDER = ["groq", "gemini", "openrouter", "openai", "anthropic", "ollama"];

/** Build a single provider's config, or null if its credentials aren't set. */
function buildAiConfig(provider: string): AiConfig | null {
  switch (provider) {
    case "gemini":
      return env.geminiApiKey
        ? { provider, kind: "openai", apiKey: env.geminiApiKey,
            // No trailing slash: the OpenAI SDK appends "/chat/completions".
            baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            model: AI_DEFAULT_MODEL.gemini }
        : null;
    case "groq":
      return env.groqApiKey
        ? { provider, kind: "openai", apiKey: env.groqApiKey,
            baseUrl: "https://api.groq.com/openai/v1", model: AI_DEFAULT_MODEL.groq }
        : null;
    case "openrouter":
      return env.openrouterApiKey
        ? { provider, kind: "openai", apiKey: env.openrouterApiKey,
            baseUrl: "https://openrouter.ai/api/v1",
            model: env.openrouterModel || AI_DEFAULT_MODEL.openrouter }
        : null;
    case "openai":
      return env.openaiApiKey
        ? { provider, kind: "openai", apiKey: env.openaiApiKey,
            baseUrl: env.openaiBaseUrl || undefined, model: AI_DEFAULT_MODEL.openai }
        : null;
    case "ollama":
      // Local, OpenAI-compatible. Only joins the chain when a base URL is set
      // (won't be reachable from Vercel unless exposed via a tunnel).
      return env.ollamaBaseUrl
        ? { provider, kind: "openai", apiKey: env.openaiApiKey || "ollama",
            baseUrl: env.ollamaBaseUrl.replace(/\/$/, ""), model: AI_DEFAULT_MODEL.ollama }
        : null;
    case "anthropic":
      return env.aiApiKey
        ? { provider, kind: "anthropic", apiKey: env.aiApiKey, model: AI_DEFAULT_MODEL.anthropic }
        : null;
    default:
      return null;
  }
}

/**
 * The ordered provider chain. The chosen AI_PROVIDER (or, if blank, the first
 * configured provider) is primary; every other configured provider follows as
 * an automatic fallback. AI_MODEL overrides only the primary provider's model.
 */
export function resolveAiConfigs(): AiConfig[] {
  const primary = env.aiProvider;
  const order = [
    ...(primary && AI_FALLBACK_ORDER.includes(primary) ? [primary] : []),
    ...AI_FALLBACK_ORDER.filter((p) => p !== primary),
  ];
  const seen = new Set<string>();
  const configs: AiConfig[] = [];
  for (const p of order) {
    if (seen.has(p)) continue;
    seen.add(p);
    const cfg = buildAiConfig(p);
    if (cfg) configs.push(cfg);
  }
  if (configs.length && env.aiModel) {
    configs[0] = { ...configs[0], model: env.aiModel };
  }
  return configs;
}

/** The primary (first) provider, or null if none is configured. */
export function resolveAiConfig(): AiConfig | null {
  return resolveAiConfigs()[0] ?? null;
}

/** High-level capability matrix used by /api/status and the UI. */
export const capabilities = {
  get database() {
    return env.databaseUrl.length > 0;
  },
  get auth() {
    return env.authSecret.length >= 16;
  },
  get ai() {
    return resolveAiConfig() !== null;
  },
  get voice() {
    return env.elevenLabsApiKey.length > 0;
  },
  get search() {
    return env.searchApiKey.length > 0;
  },
  get weather() {
    return env.weatherApiKey.length > 0;
  },
  get websiteData() {
    return env.supabaseUrl.length > 0 && env.supabaseServiceRoleKey.length > 0;
  },
};

export type CapabilityKey = keyof typeof capabilities;
