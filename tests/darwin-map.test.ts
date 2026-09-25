import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.hoisted(() => { process.env.GROQ_API_KEY = "gsk_test"; delete process.env.AI_PROVIDER; });

// The model: asks darwin_map for the latest leads, then says it's done.
let step = 0;
let toolArgs: Record<string, unknown> = {};
vi.mock("@/lib/ai/client", async (orig) => ({
  ...(await orig<any>()),
  getOpenAiClient: () => ({
    chat: { completions: { create: async () => (async function* () {
      if (step++ === 0) yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "darwin_map", arguments: JSON.stringify(toolArgs) } }] } }] };
      else yield { choices: [{ delta: { content: "Opened." } }] };
    })() } },
  }),
}));

import { googleMapsAreaUrl, googleMapsLeadUrl } from "@/lib/darwin/maps";
import { GENERATE_LEADS_RE, MAP_REQUEST_RE } from "@/lib/darwin/command";
import { darwinMapTool } from "@/lib/tools/darwin/map";
import { runAgent, type AgentEvent } from "@/lib/ai/agent";
import { getDb, isDbConfigured } from "@/lib/db";

describe("Google Maps links", () => {
  it("opens a business's own listing by name + address, else its exact coordinates", () => {
    expect(googleMapsLeadUrl({ businessName: "Gold's Gym", location: "12 MG Road, Bengaluru" }))
      .toBe("https://www.google.com/maps/search/?api=1&query=Gold's%20Gym%2C%2012%20MG%20Road%2C%20Bengaluru");
    expect(googleMapsLeadUrl({ businessName: "Iron House", location: null, latitude: 12.97, longitude: 77.59 }))
      .toBe("https://www.google.com/maps/search/?api=1&query=12.97%2C77.59");
  });

  it("maps several leads as one search centred on them", () => {
    const url = googleMapsAreaUrl([
      { businessName: "A", latitude: 12.90, longitude: 77.50 },
      { businessName: "B", latitude: 13.00, longitude: 77.70 },
    ], "gyms", "Bangalore");
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/gyms\/@12\.950000,77\.600000,\d+z$/);
    expect(googleMapsAreaUrl([{ businessName: "A" }], "cafes", "Pune")).toContain("query=cafes%20in%20Pune");
  });

  it("a map request isn't mistaken for a new lead search", () => {
    for (const t of ["open these leads in Google Maps", "show me the leads on the map", "search the leads in google maps"]) {
      expect(MAP_REQUEST_RE.test(t)).toBe(true);
    }
    expect(MAP_REQUEST_RE.test("find 20 gyms in Mapusa")).toBe(false);
    expect(GENERATE_LEADS_RE.test("find 20 gyms in Mapusa")).toBe(true);
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("darwin_map", () => {
  let userId = "";
  const ctx = () => ({ userId, timezone: "UTC", activity: () => {} });
  beforeAll(async () => {
    const db = getDb();
    userId = (await db.user.create({ data: { email: `map-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    const lead = (name: string, lat: number, lon: number, at: Date, stage = "new") => db.darwinLead.create({
      data: { userId, businessName: name, category: "Gym", location: `${name} St, Bengaluru`, latitude: lat, longitude: lon, discoveredAt: at, stage, fingerprint: name,
        metadata: { search: { category: "gyms", location: "Bangalore" } } },
    });
    const old = new Date(Date.now() - 86_400_000);
    await lead("Old Iron Gym", 12.8, 77.4, old, "interested");
    await lead("Pulse Fitness", 12.95, 77.6, new Date());
    await lead("Core Gym", 12.97, 77.62, new Date());
  });
  afterAll(async () => { if (userId) await getDb().user.delete({ where: { id: userId } }).catch(() => {}); });

  it("with nothing named, shows the leads from the latest search on one map, with a link each", async () => {
    const r = await darwinMapTool.execute({}, ctx());
    const data = r.data as any;
    expect(data.leads.map((l: any) => l.businessName).sort()).toEqual(["Core Gym", "Pulse Fitness"]);
    expect(data.openUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/gyms\/@12\.96/);
    expect(data.links.map((l: any) => l.label).sort()).toEqual(["Core Gym", "Pulse Fitness"]);
    expect(r.summary).toContain("gyms in Bangalore");
  });

  it("one named lead opens its own listing; a stage maps that group; unknown names are reported", async () => {
    const one = (await darwinMapTool.execute({ name: "old iron" }, ctx())).data as any;
    expect(one.openUrl).toContain("query=Old%20Iron%20Gym%2C%20Old%20Iron%20Gym%20St");
    expect(((await darwinMapTool.execute({ stage: "interested" }, ctx())).data as any).leads).toHaveLength(1);
    await expect(darwinMapTool.execute({ name: "Nope Gym" }, ctx())).rejects.toThrow('No lead called "Nope Gym"');
  });

  it("DARWIN opens the map in a new tab and lists a Maps link per lead", async () => {
    step = 0;
    toolArgs = {};
    const events: AgentEvent[] = [];
    for await (const ev of runAgent({ userId, timezone: "UTC", assistantName: "JARVIS", displayName: null, history: [], message: "open these leads in google maps", agent: "darwin" })) events.push(ev);
    const open = events.find((e) => e.type === "open") as Extract<AgentEvent, { type: "open" }>;
    expect(open.url).toContain("google.com/maps/search/gyms/@");
    expect(events.filter((e) => e.type === "link").map((e: any) => e.label).sort()).toEqual(["Core Gym", "Pulse Fitness"]);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
});
