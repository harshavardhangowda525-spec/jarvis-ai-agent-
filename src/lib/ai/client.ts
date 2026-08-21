import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env, capabilities } from "@/lib/env";

let client: Anthropic | null = null;

export function getAiClient(): Anthropic {
  if (!capabilities.ai) {
    throw new AiNotConfiguredError();
  }
  if (!client) {
    client = new Anthropic({ apiKey: env.aiApiKey });
  }
  return client;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("The AI model is not configured. Set AI_API_KEY.");
    this.name = "AiNotConfiguredError";
  }
}

export const AI_MODEL = env.aiModel;
