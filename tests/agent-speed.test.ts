import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.GROQ_API_KEY = "gsk_test";
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  delete process.env.OLLAMA_BASE_URL;
  process.env.JARVIS_PROVIDER = "auto"; // the chain tests; JARVIS's real default (Ollama only) is tested below
});

// Fake cloud providers: record every request; Groq can be told to rate-limit.
const calls: { baseURL: string; params: any }[] = [];
let groqRateLimited = false;
vi.mock("@/lib/ai/client", async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getOpenAiClient: (cfg: any) => ({
      chat: {
        completions: {
          create: async (params: any) => {
            calls.push({ baseURL: cfg.baseUrl ?? "openai", params });
            if (cfg.provider === "groq" && groqRateLimited) {
              const err: any = new Error("429 rate limited");
              err.status = 429; err.headers = { "retry-after": "30" };
              throw err;
            }
            return (async function* () {
              yield { choices: [{ delta: { content: "Hello" } }] };
              yield { choices: [{ delta: { content: " there." } }] };
            })();
          },
        },
      },
    }),
  };
});

import { runAgent, type AgentEvent } from "@/lib/ai/agent";
import { getDb, isDbConfigured } from "@/lib/db";
import { env } from "@/lib/env";

const d = isDbConfigured ? describe : describe.skip;
d("agent speed behaviour", () => {
  let userId = "";
  beforeAll(async () => {
    const u = await getDb().user.create({ data: { email: `speed-${Date.now()}@example.com`, passwordHash: "x" } });
    userId = u.id;
  });
  afterAll(async () => { if (userId) await getDb().user.delete({ where: { id: userId } }).catch(() => {}); });

  const run = async (history: { role: "user" | "assistant"; content: string }[] = []) => {
    const events: AgentEvent[] = [];
    for await (const ev of runAgent({ userId, timezone: "UTC", assistantName: "JARVIS", displayName: "Harsha", history, message: "hi", startedAt: Date.now() })) events.push(ev);
    return events;
  };

  it("Groq answers first with low reasoning effort, bounded history, and a timing report", async () => {
    calls.length = 0;
    const history = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` }));
    const events = await run(history);
    expect(calls[0].baseURL).toContain("groq");
    expect(calls[0].params.reasoning_effort).toBe("low");
    expect(calls[0].params.messages.length).toBeLessThanOrEqual(1 + 16 + 1); // system + ≤16 history + message
    const timing = events.find((e) => e.type === "timing") as Extract<AgentEvent, { type: "timing" }>;
    expect(timing).toMatchObject({ provider: "groq" });
    expect(timing.firstWordMs).not.toBeNull();
    expect(events.at(-1)).toMatchObject({ type: "done", text: "Hello there." });
  });

  it("after Groq rate-limits, the next message skips it instead of wasting a round trip", async () => {
    groqRateLimited = true;
    calls.length = 0;
    const first = await run();
    expect(calls.map((c) => c.baseURL.includes("groq") ? "groq" : "other")).toEqual(["groq", "other"]);
    expect(first.find((e) => e.type === "timing")).toMatchObject({ provider: "openai" });
    calls.length = 0;
    await run();
    expect(calls.map((c) => c.baseURL.includes("groq") ? "groq" : "other")).toEqual(["other"]); // parked
    const second = calls[0].params;
    expect(second.reasoning_effort).toBeUndefined(); // only for gpt-oss on Groq/Cerebras
  });
  it("EV uses Groq only — not the PC brain, and no other provider even when Groq is rate-limited", async () => {
    const brain = { baseUrl: "https://my-pc.trycloudflare.com", model: "qwen2.5:3b" };
    const ask = async (agent?: "ev") => {
      calls.length = 0;
      const events: AgentEvent[] = [];
      for await (const ev of runAgent({ userId, timezone: "UTC", assistantName: "JARVIS", displayName: "Harsha", history: [], message: "hi", agent, prefetch: { brain: Promise.resolve(brain) } })) events.push(ev);
      return { urls: calls.map((c) => c.baseURL), events };
    };
    groqRateLimited = false;
    expect((await ask("ev")).urls).toEqual(["https://api.groq.com/openai/v1"]);
    groqRateLimited = true; // Groq says 429 → EV reports it instead of switching provider
    const limited = await ask("ev");
    expect(limited.urls.every((u) => u.includes("groq"))).toBe(true);
    expect(limited.events.at(-1)).toMatchObject({ type: "error" });
    // JARVIS (here on "auto") is unaffected: it still falls back.
    expect((await ask()).urls.some((u) => !u.includes("groq"))).toBe(true);
  });

  it("by default JARVIS runs only on the PC brain, and DARWIN only on Groq", async () => {
    const pcBrain = { baseUrl: "https://my-pc.trycloudflare.com", model: "qwen2.5:3b" };
    const ask = async (agent: "darwin" | undefined, brain: typeof pcBrain | null) => {
      calls.length = 0;
      const events: AgentEvent[] = [];
      for await (const ev of runAgent({ userId, timezone: "UTC", assistantName: "JARVIS", displayName: "Harsha", history: [], message: "hi", agent, prefetch: { brain: Promise.resolve(brain) } })) events.push(ev);
      return { urls: calls.map((c) => c.baseURL), events };
    };
    const saved = env.jarvisProvider;
    (env as { jarvisProvider: string }).jarvisProvider = "ollama";
    try {
      groqRateLimited = false;
      const jarvis = await ask(undefined, pcBrain);
      expect(jarvis.urls).toEqual(["https://my-pc.trycloudflare.com/v1"]);
      expect(jarvis.events.at(-1)).toMatchObject({ type: "done", text: "Hello there." });
      // PC brain offline → an honest message, and no cloud model is used instead.
      const offline = await ask(undefined, null);
      expect(offline.urls).toEqual([]);
      expect(offline.events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("npm run brain") });
      // DARWIN never touches the PC brain or any other cloud.
      expect((await ask("darwin", pcBrain)).urls).toEqual(["https://api.groq.com/openai/v1"]);
    } finally {
      (env as { jarvisProvider: string }).jarvisProvider = saved;
    }
  });
});
