import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.GROQ_API_KEY = "gsk_test";
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
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
});
