import { describe, it, expect, afterEach, vi } from "vitest";
vi.hoisted(() => {
  process.env.SEARXNG_URL = "http://searx.local:8080/";
  process.env.BRAVE_SEARCH_API_KEY = "test-brave";
  process.env.SEARCH_API_KEY = "test-tavily";
  process.env.SERPER_API_KEY = "test-serper";
});
import { PROVIDERS, SearchPool, configuredProviders, dailyShares, type Provider, type ProviderId } from "@/lib/darwin/web-search";

const byId = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;
const json = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const mockFetch = (fn: (url: string, init?: RequestInit) => Response) => {
  const f = vi.fn(async (u: unknown, init?: RequestInit) => fn(String(u), init));
  vi.stubGlobal("fetch", f);
  return f;
};
afterEach(() => vi.unstubAllGlobals());

describe("free web-search providers: their answers are read the same way", () => {
  it("are used in order SearXNG → Brave → Tavily → Serper (only the configured ones)", () => {
    expect(configuredProviders().map((p) => p.id)).toEqual(["searxng", "brave", "tavily", "serper"]);
  });

  it("SearXNG: JSON results; a 403 means its json format is off", async () => {
    const f = mockFetch(() => json(200, { results: [{ url: "https://justdial.com/x", title: "Sri Ram Bakery", content: "Call 98450 12345" }] }));
    const r = await byId("searxng").run("Sri Ram Bakery Mysuru");
    expect(r).toEqual({ ok: true, results: [{ url: "https://justdial.com/x", title: "Sri Ram Bakery", content: "Call 98450 12345" }] });
    expect(String(f.mock.calls[0][0])).toMatch(/^http:\/\/searx\.local:8080\/search\?q=Sri\+Ram\+Bakery\+Mysuru&format=json/);
    mockFetch(() => json(403, "Forbidden"));
    expect(await byId("searxng").run("q")).toMatchObject({ ok: false, outage: { kind: "auth", message: expect.stringMatching(/json format/) } });
  });

  it("Brave: description + extra snippets; key / quota / rate errors", async () => {
    const f = mockFetch(() => json(200, { web: { results: [{ url: "https://facebook.com/ramb", title: "Ram Bakery", description: "Bakery in Mysuru", extra_snippets: ["ram@gmail.com"] }] } }));
    expect(await byId("brave").run("q")).toEqual({ ok: true, results: [{ url: "https://facebook.com/ramb", title: "Ram Bakery", content: "Bakery in Mysuru ram@gmail.com" }] });
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)["X-Subscription-Token"]).toBe("test-brave");
    mockFetch(() => json(401, "{}"));
    expect(await byId("brave").run("q")).toMatchObject({ ok: false, outage: { kind: "auth" } });
    mockFetch(() => json(429, { error: { code: "QUOTA_LIMITED" } }));
    expect(await byId("brave").run("q")).toMatchObject({ ok: false, outage: { kind: "credits" } });
    mockFetch(() => json(429, { error: { code: "RATE_LIMITED" } }));
    expect(await byId("brave").run("q")).toMatchObject({ ok: false, outage: { kind: "rate" } });
  });

  it("Tavily: results; 432 = out of credits", async () => {
    mockFetch(() => json(200, { results: [{ url: "https://a.in", title: "A", content: "c" }] }));
    expect(await byId("tavily").run("q")).toEqual({ ok: true, results: [{ url: "https://a.in", title: "A", content: "c" }] });
    mockFetch(() => json(432, "{}"));
    expect(await byId("tavily").run("q")).toMatchObject({ ok: false, outage: { kind: "credits" } });
  });

  it("Serper: Google's knowledge panel comes first (its website and phone), then the results", async () => {
    mockFetch(() => json(200, {
      knowledgeGraph: { title: "Ram Bakery", phoneNumber: "098450 12345", address: "Mysuru" },
      organic: [{ link: "https://instagram.com/ramb", title: "Ram Bakery (@ramb)", snippet: "Fresh bread" }],
    }));
    expect(await byId("serper").run("q")).toEqual({ ok: true, results: [
      { url: "", title: "Ram Bakery", content: "098450 12345 · Mysuru" },
      { url: "https://instagram.com/ramb", title: "Ram Bakery (@ramb)", content: "Fresh bread" },
    ] });
    mockFetch(() => json(400, { message: "Not enough credits", statusCode: 400 }));
    expect(await byId("serper").run("q")).toMatchObject({ ok: false, outage: { kind: "credits" } });
  });

  it("a timeout / unreachable service is 'down'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }));
    expect(await byId("tavily").run("q")).toMatchObject({ ok: false, outage: { kind: "down", message: "Tavily: timed out" } });
  });
});

const fake = (id: ProviderId, answers: ("ok" | "credits" | "auth" | "rate" | "down")[], monthly = 1000): Provider & { calls: number } => {
  const p = {
    id, label: id, configured: () => true, monthly: () => monthly, minIntervalMs: 0, calls: 0,
    run: async () => {
      const a = answers[Math.min(p.calls++, answers.length - 1)];
      return a === "ok" ? { ok: true as const, results: [{ url: `https://${id}`, title: id, content: "" }] } : { ok: false as const, outage: { service: "search" as const, kind: a, message: `${id} ${a}` } };
    },
  };
  return p;
};

describe("the search pool", () => {
  it("one out of credits → the next one answers, and the first isn't asked again", async () => {
    const tav = fake("tavily", ["credits"]), brave = fake("brave", ["ok"]);
    const down: string[] = [];
    const pool = new SearchPool([tav, brave], {}, (o) => down.push(o.message));
    expect(await pool.search("q")).toMatchObject({ ok: true, provider: "brave", calls: 2 });
    expect(await pool.search("q")).toMatchObject({ ok: true, provider: "brave", calls: 1 });
    expect(tav.calls).toBe(1);
    expect(down).toEqual(["tavily credits"]);
    expect(pool.used).toEqual({ tavily: 1, brave: 2 });
  });

  it("a rate limit gets one more try before moving on", async () => {
    const s = fake("serper", ["rate", "ok"]);
    expect(await new SearchPool([s]).search("q")).toMatchObject({ ok: true, calls: 2 });
  }, 5000);

  it("today's share: used up → the next provider; none left → stops for the day", async () => {
    const brave = fake("brave", ["ok"]), serper = fake("serper", ["ok"]);
    const pool = new SearchPool([brave, serper], { brave: 1, serper: 1 });
    expect(pool.capacity()).toBe(2);
    expect(await pool.search("q")).toMatchObject({ provider: "brave" });
    expect(await pool.search("q")).toMatchObject({ provider: "serper" });
    expect(pool.capacity()).toBe(0);
    expect(await pool.search("q")).toMatchObject({ ok: false, calls: 0, outage: { kind: "rate", message: expect.stringMatching(/Today's share/) } });
  });

  it("SearXNG (no monthly limit) never runs out", () => {
    expect(new SearchPool([fake("searxng", ["ok"], 0)], {}).capacity()).toBe(Infinity);
  });

  it("all of them out for the month / rejecting keys → 'credits'; one just down → 'rate' (try again later)", async () => {
    const hard = await new SearchPool([fake("brave", ["auth"]), fake("tavily", ["credits"])]).search("q");
    expect(hard).toMatchObject({ ok: false, calls: 2, outage: { kind: "credits", message: "brave auth; tavily credits" } });
    const soft = await new SearchPool([fake("brave", ["down"]), fake("tavily", ["credits"])]).search("q");
    expect(soft).toMatchObject({ ok: false, outage: { kind: "rate" } });
  });

  it("dailyShares: what's left this month ÷ days left, minus today's searches", () => {
    const ps = [fake("brave", [], 2000), fake("tavily", [], 800), fake("searxng", [], 0)];
    // Oct 5 → 27 days left
    expect(dailyShares(ps, { brave: 0, tavily: 760 }, {}, "2026-10-05")).toEqual({ brave: 74, tavily: 1 });
    expect(dailyShares(ps, {}, { brave: 70 }, "2026-10-05")).toEqual({ brave: 4, tavily: 29 });
    expect(dailyShares(ps, { tavily: 900 }, {}, "2026-10-31")).toEqual({ brave: 2000, tavily: 0 });
  });
});
