import "server-only";
import type { AiConfig } from "@/lib/env";
import { getAnthropicClient, getOpenAiClient } from "./client";

/**
 * One plain (non-streamed) completion, trying each provider in order until one
 * answers. For background jobs such as learning memories from past chats.
 */
export async function completeWithFallback(
  configs: AiConfig[],
  system: string,
  user: string,
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  let lastErr: unknown = new Error("No AI provider is configured.");
  for (const cfg of configs) {
    const timeout = cfg.timeoutMs ?? opts.timeoutMs ?? 45_000;
    try {
      if (cfg.kind === "anthropic") {
        const r = await getAnthropicClient(cfg).messages.create(
          { model: cfg.model, max_tokens: opts.maxTokens ?? 1200, system, messages: [{ role: "user", content: user }] },
          { timeout, maxRetries: 0 },
        );
        return r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      }
      const r = await getOpenAiClient(cfg).chat.completions.create(
        { model: cfg.model, max_tokens: opts.maxTokens ?? 1200, messages: [{ role: "system", content: system }, { role: "user", content: user }] },
        { timeout, maxRetries: 0 },
      );
      return r.choices[0]?.message?.content ?? "";
    } catch (err) {
      lastErr = err;
      console.error(`[complete] ${cfg.provider} failed:`, (err as Error)?.message);
    }
  }
  throw lastErr;
}
