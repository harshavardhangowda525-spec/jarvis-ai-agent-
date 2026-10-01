import { describe, it, expect, vi } from "vitest";
vi.hoisted(() => { process.env.GROQ_API_KEY = "gsk_test"; process.env.GEMINI_API_KEY = "AIza_test"; delete process.env.ROBIN_PROVIDER; });

// Stand-in providers that validate requests like the real ones do.
const reqs: { provider: string; body: any }[] = [];
let groqLimited = false;
let round = 0;
vi.mock("@/lib/ai/client", async (orig) => {
  const real: any = await orig();
  return { ...real, getOpenAiClient: (cfg: any) => ({ chat: { completions: { create: async (body: any) => {
    reqs.push({ provider: cfg.provider, body });
    if (cfg.provider === "groq" && groqLimited) { const e: any = new Error("413 Request too large: tokens per minute limit"); e.status = 413; throw e; }
    // Gemini: every OBJECT parameter schema must have properties
    if (cfg.provider === "gemini") {
      for (const t of body.tools ?? []) {
        const p = t.function.parameters;
        if (p?.type === "object" && (!p.properties || !Object.keys(p.properties).length)) { const e: any = new Error(`400 * GenerateContentRequest.tools[0].function_declarations.${t.function.name}.parameters.properties: should be non-empty for OBJECT type`); e.status = 400; throw e; }
      }
    }
    round++;
    if (round % 2 === 1) return (async function* () { yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${round}`, type: "function", function: { name: "robin_followups", arguments: "{}" } }] } }] }; yield { choices: [{ delta: {}, finish_reason: "tool_calls" }] }; })();
    return (async function* () { yield { choices: [{ delta: { content: `On it, from ${cfg.provider}!` } }] }; })();
  } } } }) };
});
import { runAgent } from "@/lib/ai/agent";
import { availableTools } from "@/lib/tools/registry";
import { getDb, isDbConfigured } from "@/lib/db";

describe("ROBIN's brain: requests every provider accepts", () => {
  it("no agent sends a tool whose parameters are an empty object (Gemini rejects those)", () => {
    for (const a of [undefined, "ev", "darwin", "mike", "robin"] as const) {
      const empty = availableTools(a).filter((t) => { const s: any = t.inputSchema; return s?.type === "object" && !Object.keys(s.properties ?? {}).length; });
      expect(empty.map((t) => t.name), a ?? "jarvis").toEqual([]);
    }
  });
  it("Robin gets a lean, sales-only toolset", () => {
    const names = availableTools("robin").map((t) => t.name);
    expect(names).toContain("robin_leads");
    expect(names).not.toContain("mike_chart");
    expect(names).not.toContain("nios");
    expect(JSON.stringify(availableTools("robin").map((t) => t.inputSchema)).length).toBeLessThan(9000);
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("ROBIN's brain answers (integration, stand-in providers)", () => {
  const turn = async (userId: string) => {
    const events: any[] = [];
    for await (const ev of runAgent({ userId, timezone: "Asia/Kolkata", assistantName: "JARVIS", displayName: "Harsha", history: [], message: "what's on my follow-up list?", agent: "robin" })) events.push(ev);
    return events;
  };
  it("Groq answers; and when Groq is limited, Gemini takes over without rejecting the tools", async () => {
    const u = await getDb().user.create({ data: { email: `robin-brain-${Date.now()}@example.com`, passwordHash: "x" } });
    try {
      let ev = await turn(u.id);
      expect(ev.find((e) => e.type === "tool")).toMatchObject({ name: "robin_followups", status: "ok" });
      expect(ev.at(-1)).toMatchObject({ type: "done", text: "On it, from groq!" });
      groqLimited = true;
      ev = await turn(u.id);
      expect(ev.filter((e) => e.type === "error")).toEqual([]);
      expect(ev.at(-1)).toMatchObject({ type: "done", text: "On it, from gemini!" });
    } finally { groqLimited = false; await getDb().user.delete({ where: { id: u.id } }).catch(() => {}); }
  });
});
