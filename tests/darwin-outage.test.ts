import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
// requests go through the injected deps below; the email goal is off for these
vi.hoisted(() => { process.env.GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || "test-key-requests-go-through-injected-deps"; process.env.DARWIN_EMAIL_TARGET = "0"; });
import { getDb, isDbConfigured } from "@/lib/db";
import type { DarwinDeps } from "@/lib/darwin/daily/run";
import type { Gathered, Outage } from "@/lib/darwin/daily/checks";
import { googleOutage, searchOutage } from "@/lib/darwin/daily/checks";
import { GeoapifyError } from "@/lib/darwin/geoapify";

describe("service outages are recognised (not mistaken for 'unclear' businesses)", () => {
  it("Tavily: out of credits / key / rate / down", () => {
    expect(searchOutage(432)).toMatchObject({ service: "search", kind: "credits" });
    expect(searchOutage(433)).toMatchObject({ kind: "credits" });
    expect(searchOutage(401)).toMatchObject({ kind: "auth" });
    expect(searchOutage(429)).toMatchObject({ kind: "rate" });
    expect(searchOutage(503)).toMatchObject({ kind: "down" });
    expect(searchOutage(400)).toBeNull();
  });
  it("Google Places: billing, key, quota", () => {
    expect(googleOutage(403, { error: { status: "PERMISSION_DENIED", message: "This API project is not authorized; billing must be enabled" } })).toMatchObject({ service: "google", kind: "credits" });
    expect(googleOutage(400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } })).toMatchObject({ kind: "auth" });
    expect(googleOutage(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } })).toMatchObject({ kind: "rate" });
    expect(googleOutage(400, { error: { status: "INVALID_ARGUMENT", message: "Invalid textQuery" } })).toBeNull();
  });
});

const d = isDbConfigured ? describe : describe.skip;

function feature(i: number) {
  const lat = 12.97 + i * 0.001, lon = 77.64 + i * 0.001;
  return {
    geometry: { coordinates: [lon, lat] },
    properties: {
      place_id: `pid-out-${i}`, name: `Brew Spot ${i} Cafe`, lat, lon, formatted: `${i} Test Road, Bengaluru`,
      categories: ["catering.cafe"], distance: 300 + i * 40, contact: { phone: `+91 98450 ${String(20000 + i)}` },
    },
  };
}

d("DARWIN keeps going through service outages", () => {
  let userId = "";
  let R: typeof import("@/lib/darwin/daily/run");
  let clock = new Date("2026-10-05T02:00:00Z"); // 07:30 IST
  let outage: Outage | null = null;
  let geoFail: GeoapifyError | null = null;
  const used = { search: 0, google: 0 };
  const deps = (o: Partial<DarwinDeps> = {}): DarwinDeps => ({
    now: () => clock,
    geocode: async (t) => ({ lat: 12.97, lon: 77.64, label: `${t}, Karnataka, India` }),
    page: async ({ offset }) => { if (geoFail) throw geoFail; return offset === 0 ? Array.from({ length: 12 }, (_, i) => feature(i)) : []; },
    gather: async (_c, opts): Promise<Gathered> => {
      // the configured services answer — or fail as a whole
      const out: Outage[] = [];
      if (outage && ((outage.service === "search" && opts.search) || (outage.service === "google" && opts.google))) out.push(outage);
      if (opts.search) used.search++;
      if (opts.google) used.google++;
      const searchOk = opts.search && !out.some((x) => x.service === "search");
      const googleOk = opts.google && !out.some((x) => x.service === "google");
      return {
        signals: {
          listed: null,
          google: opts.google ? (googleOk ? { found: true, website: null, closed: false } : { found: false, website: null, closed: false, error: "Google HTTP 403" }) : null,
          search: opts.search ? (searchOk ? { official: null, social: [], directories: 1 } : { error: "search HTTP 432", official: null, social: [], directories: 0 }) : null,
          guessed: [], distinctive: true,
        },
        google: null, search: null,
        calls: { google: opts.google ? 1 : 0, search: opts.search ? 1 : 0 },
        ...(out.length ? { outage: out } : {}),
      };
    },
    google: false, search: true,
    ...o,
  });
  const finish = async (id: string, dp: DarwinDeps) => {
    let r = await R.advanceRun(id, { deps: dp, budgetMs: 60_000 });
    for (let i = 0; i < 6 && r.status === "running"; i++) r = await R.advanceRun(id, { deps: dp, budgetMs: 60_000 });
    return r;
  };
  const fresh = async () => {
    if (userId) await getDb().user.deleteMany({ where: { id: userId } });
    R = await import("@/lib/darwin/daily/run");
    const u = await getDb().user.create({ data: { email: `dwo-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x" } });
    userId = u.id;
    await R.saveConfig(userId, { locations: ["Indiranagar"], categories: ["cafes"], target: 5, strict: true, allBangalore: false, keepGoing: false, requirePhone: true });
    outage = null; geoFail = null; used.search = 0; used.google = 0;
  };
  beforeEach(fresh);
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("web search out of credits: today's search stops with that reason — and no business is written off", async () => {
    outage = { service: "search", kind: "credits", message: "The web search (Tavily) has used up its plan's credits (HTTP 432)" };
    const run = await R.ensureRun(userId, clock);
    const r = await finish(run.id, deps());
    expect(r.status).toBe("partial");
    expect(r.verified).toBe(0);
    expect(r.unclear).toBe(0);
    expect(r.reasons[0]).toMatch(/couldn't confirm .*used up its plan's credits/);
    expect(r.lastError).toMatch(/Tavily/);
    expect(await getDb().darwinCandidate.count({ where: { userId } })).toBe(0); // nothing marked "unclear" for 3 weeks
    // the credits are back (or the key fixed): "search now" finds them
    outage = null;
    const again = await R.searchNow(userId, clock);
    const r2 = await finish(again.run.id, deps());
    expect(r2.verified).toBe(5);
    expect(r2.status).toBe("completed");
  });

  it("Google Places down but the web search works: carries on with the web search", async () => {
    outage = { service: "google", kind: "credits", message: "Google Places refused the request — billing must be enabled" };
    const run = await R.ensureRun(userId, clock);
    const r = await finish(run.id, deps({ google: true, search: true }));
    expect(r.status).toBe("completed");
    expect(r.verified).toBe(5);
    expect(JSON.stringify(r.log)).toMatch(/Google Places refused/);
  });

  it("a brief outage (rate limit / down) just pauses until the next tick", async () => {
    outage = { service: "search", kind: "rate", message: "The web search (Tavily) rate limit was reached" };
    const run = await R.ensureRun(userId, clock);
    const r = await R.advanceRun(run.id, { deps: deps(), budgetMs: 60_000 });
    expect(r.status).toBe("running");
    expect(r.lastError).toMatch(/paused/);
    expect(await getDb().darwinCandidate.count({ where: { userId } })).toBe(0);
    outage = null;
    const r2 = await finish(run.id, deps());
    expect(r2.verified).toBe(5);
  });

  it("Geoapify key rejected / quota used up: stops with that reason instead of marking every area searched", async () => {
    geoFail = new GeoapifyError("Geoapify's quota for this API key is used up — it resets daily (or upgrade the Geoapify plan).", "auth");
    const run = await R.ensureRun(userId, clock);
    const r = await finish(run.id, deps());
    expect(r.status).toBe("partial");
    expect(r.reasons[0]).toMatch(/couldn't search: Geoapify's quota/);
    expect(r.exhaustedCombos).toEqual([]);
  });

  it("businesses an earlier outage marked 'unclear' are looked at again right away", async () => {
    for (let i = 0; i < 12; i++) {
      const l = feature(i);
      const { discoveryFingerprint, mapFeature, categoryPlan } = await import("@/lib/darwin/geoapify");
      const g = mapFeature(l, { lat: 12.97, lon: 77.64, label: "x" }, categoryPlan("cafes"))!;
      await getDb().darwinCandidate.create({ data: { userId, fingerprint: discoveryFingerprint(g), placeId: g.placeId, name: g.name, status: "unclear", reasons: ["Web search check failed: search HTTP 432."], runDate: "2026-10-04" } });
    }
    const run = await R.ensureRun(userId, clock);
    const r = await finish(run.id, deps());
    expect(r.alreadyChecked).toBe(0);
    expect(r.verified).toBe(5);
  });

  it("web-search credits are paced over the month: today's share, then it stops for the day and says why", async () => {
    // earlier this month: 760 of 800 used → 40 left over 27 days (5th–31st) → 1 a day
    await getDb().darwinDailyRun.create({ data: { userId, date: "2026-10-01", target: 5, status: "completed", config: {}, apiRequests: { geoapify: 10, google: 0, search: 760 } } });
    expect(await R.searchAllowance(userId, "2026-10-05", 800)).toBe(1);
    expect(await R.searchAllowance(userId, "2026-10-05", 0)).toBe(Infinity);
    expect(await R.searchAllowance(userId, "2026-11-01", 800)).toBe(26); // a new month starts fresh (800 / 30)
    const run = await R.ensureRun(userId, clock);
    const r = await finish(run.id, deps());
    expect(r.status).toBe("partial");
    expect(used.search).toBeLessThanOrEqual(4); // at most one batch past the share — never the whole month's credits
    expect(r.reasons[0]).toMatch(/Today's share of this month's web-search credits/);
  });
});

describe("fewer web-search credits: Google settles it first", () => {
  it("Google found the business (and its phone) → no web search; no Google match → web search", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "test"; process.env.SEARCH_API_KEY = "test";
    vi.resetModules();
    const { gatherSignals } = await import("@/lib/darwin/daily/checks");
    const hits: string[] = [];
    let googleHasIt = true;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("places.googleapis.com")) {
        hits.push("google");
        const places = googleHasIt ? [{ displayName: { text: "Brew Spot Cafe" }, location: { latitude: 12.97, longitude: 77.64 }, nationalPhoneNumber: "098450 20001", businessStatus: "OPERATIONAL" }] : [];
        return new Response(JSON.stringify({ places }), { status: 200 });
      }
      if (u.includes("api.tavily.com")) { hits.push("search"); return new Response(JSON.stringify({ results: [] }), { status: 200 }); }
      throw new Error("offline"); // guessed domains etc.
    }) as typeof fetch;
    try {
      const c = { name: "Brew Spot Cafe", address: "1 Test Road", lat: 12.97, lon: 77.64, website: null, locality: "Indiranagar", phone: null };
      const a = await gatherSignals(c, { google: true, search: true });
      expect(hits).toEqual(["google"]);
      expect(a.calls).toEqual({ google: 1, search: 0 });
      hits.length = 0; googleHasIt = false;
      const b = await gatherSignals(c, { google: true, search: true });
      expect(hits).toEqual(["google", "search"]);
      expect(b.calls).toEqual({ google: 1, search: 1 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
