import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.GROQ_API_KEY = "gsk_test";
  process.env.GEMINI_API_KEY = "AIza_test";
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.EV_PROVIDER;
  delete process.env.DARWIN_PROVIDER;
});

// Fake providers: Groq can be told to rate-limit; everything records its URL.
const calls: string[] = [];
let groqDown = false;
vi.mock("@/lib/ai/client", async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getOpenAiClient: (cfg: any) => ({
      chat: { completions: { create: async () => {
        calls.push(cfg.provider);
        if (cfg.provider === "groq" && groqDown) { const e: any = new Error("429 rate limited"); e.status = 429; e.headers = { "retry-after": "1" }; throw e; }
        return (async function* () { yield { choices: [{ delta: { content: `hi from ${cfg.provider}` } }] }; })();
      } } },
    }),
  };
});

import { runAgent, agentConfigs, type AgentEvent } from "@/lib/ai/agent";
import { env } from "@/lib/env";
import { getDb, isDbConfigured } from "@/lib/db";

describe("EV and DARWIN: Groq first, Gemini as the backup", () => {
  it("the chain is exactly Groq → Gemini (never the PC brain or anything else)", () => {
    const brain = { baseUrl: "https://pc.example", model: "qwen2.5:3b" };
    expect(agentConfigs("ev", brain).configs.map((c) => c.provider)).toEqual(["groq", "gemini"]);
    expect(agentConfigs("darwin", brain).configs.map((c) => c.provider)).toEqual(["groq", "gemini"]);
  });

  it("with neither key set, it says exactly what to add", () => {
    const saved = env.evProvider;
    (env as { evProvider: string }).evProvider = "cerebras,openai";
    expect(agentConfigs("ev", null).missing).toMatch(/none of them is configured/);
    (env as { evProvider: string }).evProvider = saved;
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("fallback in a real turn", () => {
  let userId = "";
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `fb-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { if (userId) await getDb().user.delete({ where: { id: userId } }).catch(() => {}); });

  const ask = async (agent: "ev" | "darwin") => {
    calls.length = 0;
    const events: AgentEvent[] = [];
    for await (const ev of runAgent({ userId, timezone: "UTC", assistantName: "JARVIS", displayName: null, history: [], message: "hi", agent })) events.push(ev);
    return events;
  };

  it("Groq rate-limited → Gemini answers for EV and DARWIN", async () => {
    groqDown = true;
    const ev = await ask("ev");
    expect(calls).toEqual(["groq", "gemini"]);
    expect(ev.at(-1)).toMatchObject({ type: "done", text: "hi from gemini" });
    // Groq is rested for its retry-after, so the next turn goes straight to Gemini.
    const dw = await ask("darwin");
    expect(calls).toEqual(["gemini"]);
    expect(dw.at(-1)).toMatchObject({ type: "done", text: "hi from gemini" });
    groqDown = false;
  });
});
