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
  groqModel: read("GROQ_MODEL"),
  openaiApiKey: read("OPENAI_API_KEY"),
  openaiBaseUrl: read("OPENAI_BASE_URL"),
  // OpenRouter (OpenAI-compatible aggregator; has free models).
  openrouterApiKey: read("OPENROUTER_API_KEY"),
  openrouterModel: read("OPENROUTER_MODEL"),
  // Cerebras (OpenAI-compatible, very fast, free tier).
  cerebrasApiKey: read("CEREBRAS_API_KEY"),
  cerebrasModel: read("CEREBRAS_MODEL"),
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
  // Groq decommissioned llama-3.3-70b-versatile (2026-08-16). GPT-OSS 120B is
  // Groq's recommended replacement. Override with GROQ_MODEL / AI_MODEL if needed.
  groq: "openai/gpt-oss-120b",
  cerebras: "gpt-oss-120b",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  ollama: "llama3.1",
};

/** Order tried when falling back (a provider is skipped if not configured). */
const AI_FALLBACK_ORDER = ["groq", "gemini", "cerebras", "openrouter", "openai", "anthropic", "ollama"];

/** Human labels for the provider picker. */
export const AI_PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq (fast, free)",
  gemini: "Google Gemini (free)",
  cerebras: "Cerebras (very fast, free)",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  ollama: "Ollama (local)",
};

/** Providers that actually have credentials configured, in fallback order. */
export function listConfiguredProviders(): { id: string; label: string }[] {
  return AI_FALLBACK_ORDER
    .filter((p) => buildAiConfig(p) !== null)
    .map((p) => ({ id: p, label: AI_PROVIDER_LABELS[p] ?? p }));
}

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
            baseUrl: "https://api.groq.com/openai/v1",
            model: env.groqModel || AI_DEFAULT_MODEL.groq }
        : null;
    case "cerebras":
      return env.cerebrasApiKey
        ? { provider, kind: "openai", apiKey: env.cerebrasApiKey,
            baseUrl: "https://api.cerebras.ai/v1",
            model: env.cerebrasModel || AI_DEFAULT_MODEL.cerebras }
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
export function resolveAiConfigs(primaryOverride?: string): AiConfig[] {
  // A per-user pick (from Settings) wins over the env default, as long as it's
  // actually configured; otherwise fall back to the env AI_PROVIDER.
  const override = (primaryOverride ?? "").toLowerCase();
  const primary = override && buildAiConfig(override) ? override : env.aiProvider;
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
  // AI_MODEL overrides the primary provider's model — but only when we're using
  // the env default (no per-user override, or the override matches AI_PROVIDER).
  // An AI_MODEL meant for Groq must not be forced onto a UI-picked Cerebras/Gemini.
  const usingEnvPrimary = !override || override === env.aiProvider;
  if (configs.length && env.aiModel && usingEnvPrimary) {
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
