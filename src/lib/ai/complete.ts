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

/**
 * A streamed completion: `onDelta` gets the text as it's written (ASTON shows
 * code appearing live). Falls back to the next provider only if nothing had
 * arrived yet — never mid-answer.
 */
export async function streamWithFallback(
  configs: AiConfig[],
  system: string,
  user: string,
  onDelta: (text: string) => void,
  opts: { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal; onThinking?: () => void } = {},
): Promise<{ text: string; provider: string }> {
  let lastErr: unknown = new Error("No AI provider is configured.");
  for (const cfg of configs) {
    const timeout = cfg.timeoutMs ?? opts.timeoutMs ?? 45_000;
    let text = "";
    try {
      if (cfg.kind === "anthropic") {
        const s = getAnthropicClient(cfg).messages.stream(
          { model: cfg.model, max_tokens: opts.maxTokens ?? 4000, system, messages: [{ role: "user", content: user }] },
          { timeout, maxRetries: 0, signal: opts.signal },
        );
        for await (const ev of s) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { text += ev.delta.text; onDelta(ev.delta.text); }
        }
      } else {
        const s = await getOpenAiClient(cfg).chat.completions.create(
          { model: cfg.model, max_tokens: opts.maxTokens ?? 4000, stream: true, messages: [{ role: "system", content: system }, { role: "user", content: user }] },
          { timeout, maxRetries: 0, signal: opts.signal },
        );
        for await (const c of s) {
          const err = (c as unknown as { error?: { message?: string } }).error;
          if (err) throw new Error(err.message ?? "The provider reported an error.");
          const delta = c.choices?.[0]?.delta as { content?: string | null; reasoning_content?: string } | undefined;
          if (delta?.reasoning_content && !text) opts.onThinking?.();
          const d = delta?.content;
          if (d) { text += d; onDelta(d); }
        }
      }
      if (!text.trim()) throw new Error(`${cfg.provider} returned an empty answer.`);
      return { text, provider: cfg.provider };
    } catch (err) {
      lastErr = err;
      console.error(`[stream] ${cfg.provider} failed:`, (err as Error)?.message);
      if (text || opts.signal?.aborted) throw err; // mid-answer: don't start over somewhere else
    }
  }
  throw lastErr;
}
