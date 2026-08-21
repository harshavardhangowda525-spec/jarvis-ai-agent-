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

  elevenLabsApiKey: read("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: read("ELEVENLABS_VOICE_ID"),
  elevenLabsModelId: read("ELEVENLABS_MODEL_ID") || "eleven_turbo_v2_5",
  elevenLabsSttModelId: read("ELEVENLABS_STT_MODEL_ID") || "scribe_v1",

  searchApiKey: read("SEARCH_API_KEY"),
  weatherApiKey: read("WEATHER_API_KEY"),
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

export function resolveAiConfig(): AiConfig | null {
  const explicit = env.aiProvider;

  // Explicit provider wins.
  if (explicit === "gemini" || (!explicit && env.geminiApiKey)) {
    if (!env.geminiApiKey) return null;
    return {
      provider: "gemini",
      kind: "openai",
      apiKey: env.geminiApiKey,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: env.aiModel || "gemini-2.0-flash",
    };
  }
  if (explicit === "groq" || (!explicit && env.groqApiKey)) {
    if (!env.groqApiKey) return null;
    return {
      provider: "groq",
      kind: "openai",
      apiKey: env.groqApiKey,
      baseUrl: "https://api.groq.com/openai/v1",
      model: env.aiModel || "llama-3.3-70b-versatile",
    };
  }
  if (explicit === "openai" || (!explicit && env.openaiApiKey)) {
    if (!env.openaiApiKey) return null;
    return {
      provider: "openai",
      kind: "openai",
      apiKey: env.openaiApiKey,
      baseUrl: env.openaiBaseUrl || undefined,
      model: env.aiModel || "gpt-4o-mini",
    };
  }
  // Default: Anthropic.
  if (env.aiApiKey) {
    return {
      provider: "anthropic",
      kind: "anthropic",
      apiKey: env.aiApiKey,
      model: env.aiModel || "claude-sonnet-5",
    };
  }
  return null;
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
};

export type CapabilityKey = keyof typeof capabilities;
