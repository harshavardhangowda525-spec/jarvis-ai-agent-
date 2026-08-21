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

  aiApiKey: read("AI_API_KEY"),
  aiModel: read("AI_MODEL") || "claude-sonnet-5",

  elevenLabsApiKey: read("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: read("ELEVENLABS_VOICE_ID"),
  elevenLabsModelId: read("ELEVENLABS_MODEL_ID") || "eleven_turbo_v2_5",
  elevenLabsSttModelId: read("ELEVENLABS_STT_MODEL_ID") || "scribe_v1",

  searchApiKey: read("SEARCH_API_KEY"),
  weatherApiKey: read("WEATHER_API_KEY"),
};

/** High-level capability matrix used by /api/status and the UI. */
export const capabilities = {
  get database() {
    return env.databaseUrl.length > 0;
  },
  get auth() {
    return env.authSecret.length >= 16;
  },
  get ai() {
    return env.aiApiKey.length > 0;
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
