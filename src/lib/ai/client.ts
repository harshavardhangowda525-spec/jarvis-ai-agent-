import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { resolveAiConfig, resolveAiConfigs, type AiConfig } from "@/lib/env";

export class AiNotConfiguredError extends Error {
  constructor() {
    super("The AI model is not configured. Set a provider API key (e.g. GEMINI_API_KEY or AI_API_KEY).");
    this.name = "AiNotConfiguredError";
  }
}

/** Returns the active AI configuration or throws if none is configured. */
export function getAiConfig(): AiConfig {
  const cfg = resolveAiConfig();
  if (!cfg) throw new AiNotConfiguredError();
  return cfg;
}

/** The full provider fallback chain (primary first). Throws if none configured. */
export function getAiConfigs(): AiConfig[] {
  const configs = resolveAiConfigs();
  if (configs.length === 0) throw new AiNotConfiguredError();
  return configs;
}

const anthropicClients = new Map<string, Anthropic>();
const openaiClients = new Map<string, OpenAI>();

export function getAnthropicClient(cfg: AiConfig): Anthropic {
  let c = anthropicClients.get(cfg.apiKey);
  if (!c) { c = new Anthropic({ apiKey: cfg.apiKey }); anthropicClients.set(cfg.apiKey, c); }
  return c;
}

/**
 * OpenAI-compatible client (used for Gemini, Groq, OpenRouter, Ollama, …).
 * Cached per apiKey+baseUrl so multiple providers can be used in one turn.
 */
export function getOpenAiClient(cfg: AiConfig): OpenAI {
  const cacheKey = `${cfg.apiKey}::${cfg.baseUrl ?? ""}`;
  let c = openaiClients.get(cacheKey);
  if (!c) { c = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }); openaiClients.set(cacheKey, c); }
  return c;
}
