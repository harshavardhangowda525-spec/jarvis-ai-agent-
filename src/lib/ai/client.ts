import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { resolveAiConfig, type AiConfig } from "@/lib/env";

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

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let openaiClientKey = "";

export function getAnthropicClient(cfg: AiConfig): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: cfg.apiKey });
  return anthropicClient;
}

/**
 * OpenAI-compatible client (used for Gemini, Groq, OpenAI, …). Cached per
 * apiKey+baseUrl so a config change is picked up.
 */
export function getOpenAiClient(cfg: AiConfig): OpenAI {
  const cacheKey = `${cfg.apiKey}::${cfg.baseUrl ?? ""}`;
  if (!openaiClient || openaiClientKey !== cacheKey) {
    openaiClient = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
    openaiClientKey = cacheKey;
  }
  return openaiClient;
}
