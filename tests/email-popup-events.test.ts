import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";

vi.hoisted(() => { process.env.GROQ_API_KEY = "gsk_test"; process.env.JARVIS_PROVIDER = "auto"; delete process.env.AI_PROVIDER; });

// The model: first asks to send an email via the gmail tool, then says it's done.
let step = 0;
let toolArgs: Record<string, unknown> = {};
vi.mock("@/lib/ai/client", async (orig) => ({
  ...(await orig<any>()),
  getOpenAiClient: () => ({
    chat: { completions: { create: async () => (async function* () {
      if (step++ === 0) {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "gmail", arguments: JSON.stringify(toolArgs) } }] } }] };
      } else {
        yield { choices: [{ delta: { content: "Done." } }] };
      }
    })() } },
  }),
}));
vi.mock("@/lib/integrations/google", () => ({ getGoogleAccessToken: async () => "tok" }));

import { runAgent, type AgentEvent } from "@/lib/ai/agent";
import { getDb, isDbConfigured } from "@/lib/db";

const realFetch = globalThis.fetch;
const d = isDbConfigured ? describe : describe.skip;
d("email compose popup events", () => {
  let userId = "";
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `mail-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { if (userId) await getDb().user.delete({ where: { id: userId } }).catch(() => {}); });
  afterEach(() => { globalThis.fetch = realFetch; });

  const run = async () => {
    step = 0;
    const events: AgentEvent[] = [];
    for await (const ev of runAgent({ userId, timezone: "UTC", assistantName: "JARVIS", displayName: null, history: [], message: "email Priya" })) events.push(ev);
    return events.filter((e) => e.type === "email" || e.type === "tool");
  };
  const gmail = (status: number, body: unknown) => {
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).includes("gmail.googleapis.com")) return new Response(JSON.stringify(body), { status });
      return realFetch(url, init);
    }) as typeof fetch;
  };

  it("announces the full email BEFORE sending, then 'sent' with the Gmail id", async () => {
    toolArgs = { action: "send", to: "priya@example.com", subject: "Tomorrow's demo", body: "Hi Priya,\nSee you at 10.\n— Harsha" };
    gmail(200, { id: "18c2f0a1b2c3d4e5" });
    const ev = await run();
    expect(ev[0]).toMatchObject({ type: "email", phase: "sending", to: "priya@example.com", subject: "Tomorrow's demo", body: "Hi Priya,\nSee you at 10.\n— Harsha" });
    expect(ev[1]).toMatchObject({ type: "email", phase: "sent", gmailId: "18c2f0a1b2c3d4e5", id: (ev[0] as any).id });
    expect(ev[2]).toMatchObject({ type: "tool", name: "gmail", status: "ok" });
  });

  it("reports 'failed' when Gmail refuses — never a fake 'sent'", async () => {
    toolArgs = { action: "send", to: "priya@example.com", subject: "Hi", body: "Hello" };
    gmail(500, { error: { message: "backend error" } });
    const ev = await run();
    expect(ev.map((e) => (e.type === "email" ? e.phase : e.type))).toEqual(["sending", "failed", "tool"]);
    expect(ev[1]).toMatchObject({ type: "email", phase: "failed", error: "Couldn't send the email." });
  });

  it("reading Gmail doesn't open the compose popup", async () => {
    toolArgs = { action: "list" };
    gmail(200, { messages: [] });
    const ev = await run();
    expect(ev.some((e) => e.type === "email")).toBe(false);
  });
});
