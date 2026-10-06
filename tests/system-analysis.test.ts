import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { isSystemAnalysis } from "@/lib/system/intent";
import { nodeVerdict, AGENT_NODES } from "@/lib/system/types";
import { getDb, isDbConfigured } from "@/lib/db";

describe("'Analyze the system' is recognised", () => {
  it.each(["Analyze the system", "analyse the system", "JARVIS, analyze yourself", "run a system diagnostic", "Run a full system analysis", "self-diagnostic", "diagnose yourself", "jarvis run diagnostics", "can you scan the system please"])("%s", (t) => {
    expect(isSystemAnalysis(t)).toBe(true);
  });
  it.each(["analyze bitcoin", "analyze this chart", "what's the system time", "open system settings", "check my email", "scan for leads"])("not: %s", (t) => {
    expect(isSystemAnalysis(t)).toBe(false);
  });
});

describe("node verdicts come only from the checks", () => {
  it("any failure → error, any warning → warning, else healthy (notes don't count against it)", () => {
    expect(nodeVerdict(["ok", "info", "fail", "ok"])).toBe("error");
    expect(nodeVerdict(["ok", "warn", "info"])).toBe("warning");
    expect(nodeVerdict(["ok", "info"])).toBe("healthy");
    expect(nodeVerdict(["info", "info"])).toBe("inactive"); // nothing set up isn't "verified"
  });
  it("six agents around the core", () => { expect(AGENT_NODES.map((n) => n.id)).toEqual(["ev", "darwin", "mike", "rubin", "ultron", "voice"]); });
});

const d = isDbConfigured ? describe : describe.skip;
d("the analysis run (real database, network answers faked)", () => {
  let userId = "";
  beforeEach(async () => {
    await getDb().user.deleteMany({ where: { email: "sysscan@example.com" } });
    userId = (await getDb().user.create({ data: { email: "sysscan@example.com", passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { email: "sysscan@example.com" } }); });

  it("streams stage → focus → every planned check → a verdict per node → done, and the counts add up", async () => {
    const { runDiagnostics } = await import("@/lib/system/diagnostics");
    const calls: string[] = [];
    const fakeFetch = vi.fn(async (u: unknown) => {
      const url = String(u); calls.push(url);
      if (url.includes("binance")) return new Response("{}", { status: 200 });
      if (url.includes("elevenlabs")) return new Response(JSON.stringify({ character_count: 950, character_limit: 1000 }), { status: 200 });
      return new Response(JSON.stringify({ data: [{ id: "some-other-model" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const events = [];
    for await (const e of runDiagnostics(userId, { ultron: { known: true, reachable: false } }, { fetch: fakeFetch, now: () => Date.now() })) events.push(e);

    const start = events[0];
    expect(start.type).toBe("start");
    const checks = events.filter((e) => e.type === "check");
    expect(checks.length).toBe((start as { total: number }).total);
    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    const s = (done as { summary: Record<string, number> }).summary;
    expect(s.ok + s.warn + s.fail + s.info).toBe(checks.length);
    // stages in order, each announced once
    expect(events.filter((e) => e.type === "stage").map((e) => (e as { stage: string }).stage)).toEqual(["core", "agents", "connections", "performance", "security"]);
    // every node gets exactly one verdict, after its checks
    const verdicts = events.filter((e) => e.type === "node").map((e) => (e as { node: string }).node);
    expect(new Set(verdicts).size).toBe(verdicts.length);
    expect(verdicts.sort()).toEqual(["core", "darwin", "ev", "mike", "rubin", "ultron", "voice"].sort());
    // real findings from real inputs
    const by = (label: string) => checks.find((c) => (c as { label: string }).label === label) as { status: string; detail: string };
    expect(by("Database").status).toBe("ok");
    expect(by("Local runtime").status).toBe("warn"); // known on this device but not answering
    if (process.env.ELEVENLABS_API_KEY) expect(by("Speech (ElevenLabs)").detail).toMatch(/95%/);
    expect(by("Accounts").detail).toMatch(/sign-up is open/);
    // read-only: nothing was written for this user
    expect(await getDb().darwinLead.count({ where: { userId } })).toBe(0);
    expect(await getDb().robinLead.count({ where: { userId } })).toBe(0);
  }, 30_000);

  it("a provider whose model list lacks the configured model is flagged, not passed", async () => {
    const { plan } = await import("@/lib/system/diagnostics");
    const specs = plan(userId, { ultron: null }, { fetch: (async () => new Response(JSON.stringify({ data: [{ id: "other" }] }), { status: 200 })) as unknown as typeof fetch, now: () => Date.now() });
    const prov = specs.filter((s) => s.label.startsWith("AI provider"));
    for (const p of prov) expect((await p.run()).status).toBe("warn");
    const rejected = plan(userId, { ultron: null }, { fetch: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch, now: () => Date.now() });
    for (const p of rejected.filter((s) => s.label.startsWith("AI provider"))) expect((await p.run()).status).toBe("fail");
  });
});
