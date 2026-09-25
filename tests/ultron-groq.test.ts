import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ULTRON on Groq's free plan: requests must fit the per-minute token limit, a
 * stale key in one file mustn't block a good key in another, and "wait N
 * seconds" answers are waited out instead of failing the task.
 */
type Call = { key: string; maxTokens: number; promptChars: number };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

function fakeGroq(opts: { goodKeys: string[]; limit?: number; rateLimitOnce?: number; underCount?: number }) {
  let limited = false;
  globalThis.fetch = (async (_url: string, init: any) => {
    const key = String(init.headers.Authorization).replace("Bearer ", "");
    const body = JSON.parse(init.body);
    const promptChars = body.messages.map((m: any) => m.content).join("").length;
    calls.push({ key, maxTokens: body.max_tokens, promptChars });
    const json = (status: number, obj: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
    if (!opts.goodKeys.includes(key)) return json(401, { error: { message: "Invalid API Key", code: "invalid_api_key" } });
    // Groq counts prompt + requested reply against the per-minute limit.
    const requested = Math.ceil(promptChars / 3.2) + (opts.underCount ?? 0) + body.max_tokens;
    const limit = opts.limit ?? 8000;
    if (requested > limit) {
      return json(413, { error: { message: `Request too large for model \`openai/gpt-oss-120b\` in organization \`org_01abcdefghijklmnopqrstuvwx\` service tier \`on_demand\` on tokens per minute (TPM): Limit ${limit}, Requested ${requested}, please reduce your message size and try again.`, type: "tokens", code: "rate_limit_exceeded" } });
    }
    if (opts.rateLimitOnce && !limited) {
      limited = true;
      return json(429, { error: { message: "Rate limit reached … Please try again in 1.2s." } }, { "retry-after": String(opts.rateLimitOnce) });
    }
    return json(200, { choices: [{ message: { role: "assistant", content: '{"done":true,"report":"ok"}' } }] });
  }) as typeof fetch;
}

async function loadProvider(keys: { source: string; key: string }[]) {
  vi.resetModules();
  process.env.GROQ_API_KEY = keys[0]?.key ?? "";
  delete process.env.ULTRON_AI_PROVIDER;
  delete process.env.ULTRON_MAX_TOKENS;
  (globalThis as any).__ULTRON_GROQ_KEYS__ = keys;
  return import("../edith/src/provider.mjs");
}

const SYSTEM = "You are ULTRON. Reply in json. " + "Rules and tool catalog. ".repeat(180); // ≈ 4.4k chars like the real prompt
const STEP = "GOAL: build a site\n\nHISTORY:\n" + "ultron.read_file → OK: <html>… ".repeat(120);

describe("ULTRON on Groq", () => {
  beforeEach(() => { calls = []; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("sizes each request to fit the free plan's per-minute limit (no 'request too large')", async () => {
    fakeGroq({ goodKeys: ["gsk_good"] });
    const p = await loadProvider([{ source: ".env.local", key: "gsk_good" }]);
    expect(await p.askJson(SYSTEM, STEP)).toEqual({ done: true, report: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0].maxTokens).toBeLessThan(8000 - Math.ceil(calls[0].promptChars / 3.2));
  });

  it("if Groq still says too large, it retries once with a smaller reply budget", async () => {
    fakeGroq({ goodKeys: ["gsk_good"], underCount: 900 }); // Groq counts more tokens than our estimate
    const p = await loadProvider([{ source: ".env.local", key: "gsk_good" }]);
    expect(await p.askJson(SYSTEM, STEP)).toEqual({ done: true, report: "ok" });
    expect(calls).toHaveLength(2);
    expect(calls[1].maxTokens).toBeLessThan(calls[0].maxTokens);
  });

  it("an old key in edith/.env falls through to the working key in .env.local", async () => {
    fakeGroq({ goodKeys: ["gsk_new"] });
    const p = await loadProvider([{ source: "edith/.env", key: "gsk_old" }, { source: ".env.local", key: "gsk_new" }]);
    expect(await p.askJson(SYSTEM, STEP)).toEqual({ done: true, report: "ok" });
    expect(calls.map((c) => c.key)).toEqual(["gsk_old", "gsk_new"]);
    // …and keeps using the good key for the next steps.
    calls = [];
    await p.askJson(SYSTEM, STEP);
    expect(calls.map((c) => c.key)).toEqual(["gsk_new"]);
  });

  it("when every key is rejected, the error names the file to fix", async () => {
    fakeGroq({ goodKeys: [] });
    const p = await loadProvider([{ source: "edith/.env", key: "gsk_old" }]);
    await expect(p.askJson(SYSTEM, STEP)).rejects.toThrow(/Groq rejected the key in edith\/\.env/);
  });

  it("waits out Groq's per-minute limit instead of failing the task", async () => {
    fakeGroq({ goodKeys: ["gsk_good"], rateLimitOnce: 1 });
    const p = await loadProvider([{ source: ".env.local", key: "gsk_good" }]);
    const waited: number[] = [];
    expect(await p.askJson(SYSTEM, STEP, { onWait: (s: number) => waited.push(s) })).toEqual({ done: true, report: "ok" });
    expect(waited).toEqual([1]);
    expect(calls).toHaveLength(2);
  });
});
