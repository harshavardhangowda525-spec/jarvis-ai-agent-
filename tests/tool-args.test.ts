import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.hoisted(() => { process.env.GROQ_API_KEY = "gsk_test"; process.env.JARVIS_PROVIDER = "groq"; delete process.env.AI_PROVIDER; });

// Fake Groq: 1st call rejects the tool call (as Groq does), 2nd asks for
// open_link with a null "site", 3rd answers. Records the tools it was sent.
let call = 0;
let sentTools: any[] = [];
vi.mock("@/lib/ai/client", async (orig) => ({
  ...(await orig<any>()),
  getOpenAiClient: () => ({
    chat: { completions: { create: async (params: any) => {
      sentTools = params.tools;
      const n = call++;
      if (n === 0) {
        const err: any = new Error("400 Tool call validation failed: parameters for tool open_link did not match schema: errors: [`/site`: expected string, but got null]");
        err.status = 400; err.error = { code: "tool_use_failed" };
        throw err;
      }
      return (async function* () {
        if (n === 1) yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "open_link", arguments: JSON.stringify({ site: null, url: "https://www.google.com/maps/search/?api=1&query=gyms" }) } }] } }] };
        else yield { choices: [{ delta: { content: "Opened Google Maps." } }] };
      })();
    } } },
  }),
}));

import { allowNullOptionals, dropNullArgs, isToolCallRejection } from "@/lib/ai/tool-schema";
import { runAgent, type AgentEvent } from "@/lib/ai/agent";
import { getDb, isDbConfigured } from "@/lib/db";

describe("tool argument tolerance", () => {
  it("optional parameters also accept null; required ones don't change", () => {
    const s = allowNullOptionals({
      type: "object",
      properties: { action: { type: "string", enum: ["a", "b"] }, site: { type: "string", enum: ["maps"] }, limit: { type: "number" } },
      required: ["action"],
    });
    expect(s.properties.action).toEqual({ type: "string", enum: ["a", "b"] });
    expect(s.properties.site).toEqual({ type: ["string", "null"], enum: ["maps", null] });
    expect(s.properties.limit).toEqual({ type: ["number", "null"] });
  });

  it("null arguments count as not given", () => {
    expect(dropNullArgs({ site: null, url: "https://x.com", n: 0 })).toEqual({ url: "https://x.com", n: 0 });
  });

  it("recognises Groq's tool-call rejection", () => {
    expect(isToolCallRejection({ status: 400, message: "Tool call validation failed: …" })).toBe(true);
    expect(isToolCallRejection({ status: 400, error: { code: "tool_use_failed" } })).toBe(true);
    expect(isToolCallRejection({ status: 429, message: "Tool call validation failed" })).toBe(false);
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("agent with a model that sends null tool arguments", () => {
  let userId = "";
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `args-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { if (userId) await getDb().user.delete({ where: { id: userId } }).catch(() => {}); });

  it("retries a rejected tool call, then runs open_link with site: null instead of erroring", async () => {
    const events: AgentEvent[] = [];
    for await (const ev of runAgent({ userId, timezone: "UTC", assistantName: "JARVIS", displayName: null, history: [], message: "open gyms in google maps" })) events.push(ev);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.find((e) => e.type === "open")).toMatchObject({ url: "https://www.google.com/maps/search/?api=1&query=gyms" });
    expect(events.at(-1)).toMatchObject({ type: "done", text: "Opened Google Maps." });
    const openLink = sentTools.find((t) => t.function.name === "open_link");
    expect(openLink.function.parameters.properties.site.type).toEqual(["string", "null"]);
  });
});
