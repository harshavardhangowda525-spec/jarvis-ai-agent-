import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

// The key must exist before env.ts is read.
vi.hoisted(() => { process.env.GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || "test-geoapify-key"; });

import { categoryPlan, mapFeature, matchesPlan, discoveryFingerprint, mapLinks, haversineM, GeoapifyError } from "@/lib/darwin/geoapify";
import { findNewLeads, radiusSchedule, passesFilter, resultMessage, MAX_REQUESTS } from "@/lib/darwin/discovery";
import { getDb, isDbConfigured } from "@/lib/db";

const CENTER = { lat: 12.9716, lon: 77.5946, label: "Bengaluru, Karnataka, India" };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("categoryPlan", () => {
  it("maps common words to Geoapify categories", () => {
    expect(categoryPlan("gyms").categories).toBe("sport.fitness");
    expect(categoryPlan("Cafes").categories).toBe("catering.cafe");
    expect(categoryPlan("dental clinics").categories).toBe("healthcare.dentist");
    expect(categoryPlan("coaching centers").categories).toBe("education");
    expect(categoryPlan("real estate agents").categories).toBe("office.estate_agent");
    expect(categoryPlan("gyms").keyword).toBeUndefined();
  });

  it("free text searches broadly with a name stem and keyword check", () => {
    const p = categoryPlan("tattoo studios");
    expect(p.name).toBe("tattoo");
    expect(p.categories).toContain("commercial");
    expect(p.keyword!.test("Inkline Tattoo Parlour")).toBe(true);
    expect(p.label).toBe("Tattoo Studios");
  });
});

describe("mapFeature", () => {
  const plan = categoryPlan("gyms");

  it("uses only real fields and never invents a phone", () => {
    const l = mapFeature({ properties: { name: "Iron Temple", lat: 12.97, lon: 77.6, formatted: "12 MG Road, Bengaluru", place_id: "p1", categories: ["sport.fitness"] } }, CENTER, plan)!;
    expect(l.name).toBe("Iron Temple");
    expect(l.phone).toBeNull();
    expect(l.website).toBeNull();
    expect(l.address).toBe("12 MG Road, Bengaluru");
    expect(l.placeId).toBe("p1");
    expect(l.distanceM).toBeGreaterThan(0);
  });

  it("reads phone/website from contact and raw OSM tags", () => {
    const l = mapFeature({ properties: { name: "Flex", lat: 12.9, lon: 77.5, datasource: { raw: { "contact:phone": "+91 80 1234 5678", "contact:website": "https://flex.in" } } } }, CENTER, plan)!;
    expect(l.phone).toBe("+91 80 1234 5678");
    expect(l.website).toBe("https://flex.in");
  });

  it("rejects junk phone values and nameless places", () => {
    expect(mapFeature({ properties: { name: "X", lat: 1, lon: 1, contact: { phone: "n/a" } } }, CENTER, plan)!.phone).toBeNull();
    expect(mapFeature({ properties: { lat: 1, lon: 1 } }, CENTER, plan)).toBeNull();
    expect(mapFeature({ properties: { name: "No coords" } }, CENTER, plan)).toBeNull();
  });

  it("free-text plan only keeps places matching the term", () => {
    const tp = categoryPlan("tattoo studios");
    const yes = mapFeature({ properties: { name: "Black Ink Tattoos", lat: 1, lon: 1 } }, CENTER, tp)!;
    const no = mapFeature({ properties: { name: "Corner Bakery", lat: 1, lon: 1 } }, CENTER, tp)!;
    expect(matchesPlan(yes, tp)).toBe(true);
    expect(matchesPlan(no, tp)).toBe(false);
  });
});

describe("identity & links", () => {
  it("fingerprint ignores case/punctuation/phone formatting but separates branches", () => {
    const a = discoveryFingerprint({ name: "Gold's Gym", address: "MG Road, Bengaluru", phone: "+91 98450 12345", lat: 12.97161, lon: 77.59461 });
    const b = discoveryFingerprint({ name: "GOLDS GYM", address: "mg road bengaluru", phone: "098450-12345", lat: 12.97162, lon: 77.59459 });
    const other = discoveryFingerprint({ name: "Gold's Gym", address: "Indiranagar, Bengaluru", phone: null, lat: 12.9784, lon: 77.6408 });
    expect(a).toBe(b);
    expect(a).not.toBe(other);
  });

  it("map links only when coordinates exist", () => {
    expect(mapLinks(null, 1)).toEqual({ mapsUrl: null, osmUrl: null });
    expect(mapLinks(12.9, 77.5).mapsUrl).toContain("12.9,77.5");
  });

  it("radius schedule widens and caps at 50 km", () => {
    expect(radiusSchedule(5000)).toEqual([5000, 10000, 20000, 40000]);
    expect(radiusSchedule(30000)).toEqual([30000, 50000]);
  });

  it("filters are strict about what the data says", () => {
    expect(passesFilter({ phone: null, website: null }, "no_website")).toBe(true);
    expect(passesFilter({ phone: null, website: "x" }, "no_website")).toBe(false);
    expect(passesFilter({ phone: "1", website: null }, "phone")).toBe(true);
    expect(passesFilter({ phone: "1", website: null }, "no_phone")).toBe(false);
  });

  it("messages are honest", () => {
    expect(resultMessage({ newCount: 18, skippedDuplicates: 7, stoppedReason: "limit", limit: 20 })).toBe("Found 18 new leads · 7 previously discovered leads skipped.");
    expect(resultMessage({ newCount: 6, skippedDuplicates: 0, stoppedReason: "exhausted", limit: 20 })).toBe("Found 6 new leads. No additional unseen qualifying businesses were returned.");
    expect(resultMessage({ newCount: 0, skippedDuplicates: 0, stoppedReason: "exhausted", limit: 20 })).toBe("No new qualifying leads found for this search.");
  });
});

// ---------------------------------------------------------------------------
// Discovery engine against a real Postgres, with a simulated Geoapify
// ---------------------------------------------------------------------------

interface FakePlace { id: string; name: string; lat: number; lon: number; phone?: string; website?: string }

/** Deterministic fake world: `n` gyms spread 0.2–45 km from the centre. */
function world(n: number, maxKm = 45): FakePlace[] {
  const out: FakePlace[] = [];
  for (let i = 0; i < n; i++) {
    const km = 0.2 + (i * maxKm) / n;
    const ang = (i * 137.5 * Math.PI) / 180;
    out.push({
      id: `place-${i}`,
      name: `Test Gym ${i}`,
      lat: CENTER.lat + (km / 111) * Math.cos(ang),
      lon: CENTER.lon + (km / 111) * Math.sin(ang),
      ...(i % 3 !== 0 ? { phone: `+91 80 ${String(4000_0000 + i)}` } : {}),
      ...(i % 4 === 0 ? { website: `https://gym${i}.example.com` } : {}),
    });
  }
  return out;
}

function fakeGeoapify(places: FakePlace[], opts: { rateLimitAfter?: number } = {}) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.startsWith("/v1/geocode/search")) {
      return new Response(JSON.stringify({ results: [{ lat: CENTER.lat, lon: CENTER.lon, formatted: CENTER.label }] }), { status: 200 });
    }
    const placeCalls = calls.filter((c) => c.startsWith("/v2/places")).length;
    if (opts.rateLimitAfter != null && placeCalls > opts.rateLimitAfter) return new Response("{}", { status: 429 });
    const [, lon, lat, r] = /circle:([\d.-]+),([\d.-]+),(\d+)/.exec(url.searchParams.get("filter")!)!.map(Number) as any;
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset") || 0);
    const inside = places
      .map((p) => ({ p, d: haversineM({ lat, lon }, p) }))
      .filter((x) => x.d <= r)
      .sort((a, b) => a.d - b.d)
      .slice(offset, offset + limit);
    return new Response(JSON.stringify({
      features: inside.map(({ p, d }) => ({
        type: "Feature",
        properties: {
          name: p.name, lat: p.lat, lon: p.lon, place_id: p.id, distance: d, categories: ["sport.fitness"],
          formatted: `${p.name}, Bengaluru`, ...(p.website ? { website: p.website } : {}),
          ...(p.phone ? { contact: { phone: p.phone } } : {}),
        },
      })),
    }), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, placeCalls: () => calls.filter((c) => c.startsWith("/v2/places")).length };
}

const d = isDbConfigured ? describe : describe.skip;

d("findNewLeads (integration)", () => {
  let userId = "";
  beforeAll(async () => {
    const u = await getDb().user.create({ data: { email: `darwin-geo-${Date.now()}@example.com`, passwordHash: "x" } });
    userId = u.id;
  });
  afterAll(async () => { if (userId) await getDb().user.delete({ where: { id: userId } }).catch(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const clean = async () => {
    await getDb().darwinLead.deleteMany({ where: { userId } });
    await getDb().darwinSearchCursor.deleteMany({ where: { userId } });
  };

  it("returns N real new leads, phone first, and never repeats them", async () => {
    await clean();
    const places = world(400);
    fakeGeoapify(places);
    const r1 = await findNewLeads({ userId, category: "gyms", location: "Bangalore", limit: 20, filter: "all" });
    expect(r1.newCount).toBe(20);
    expect(r1.stoppedReason).toBe("limit");
    expect(r1.message).toBe("Found 20 new leads.");
    const ids1 = r1.leads.map((l) => l.businessName);
    expect(new Set(ids1).size).toBe(20);
    // phone-first ordering
    const firstNoPhone = r1.leads.findIndex((l) => !l.phone);
    if (firstNoPhone >= 0) expect(r1.leads.slice(firstNoPhone).every((l) => !l.phone)).toBe(true);
    // every lead maps to a real fake place
    for (const l of r1.leads) { const p = places.find((x) => x.name === l.businessName); expect(p).toBeDefined(); expect(l.latitude).toBeCloseTo(p!.lat, 9); }

    const r2 = await findNewLeads({ userId, category: "gyms", location: "Bangalore", limit: 20, filter: "all" });
    expect(r2.newCount).toBe(20);
    const overlap = r2.leads.filter((l) => ids1.includes(l.businessName));
    expect(overlap).toHaveLength(0);
    expect(await getDb().darwinLead.count({ where: { userId } })).toBe(40);
  });

  it("history survives: a different search over the same area skips known leads", async () => {
    // same area, different filter → new cursor, starts at offset 0 → meets known leads
    fakeGeoapify(world(400));
    const r = await findNewLeads({ userId, category: "gyms", location: "Bangalore", limit: 10, filter: "phone" });
    expect(r.skippedDuplicates).toBeGreaterThan(0);
    expect(r.message).toMatch(/previously discovered lead/);
    expect(r.leads.every((l) => !!l.phone)).toBe(true);
    const dupNames = await getDb().darwinLead.groupBy({ by: ["fingerprint"], where: { userId }, _count: true });
    expect(dupNames.every((g) => g._count === 1)).toBe(true);
  });

  it("no_website filter only returns leads with no website listed", async () => {
    await clean();
    fakeGeoapify(world(400));
    const r = await findNewLeads({ userId, category: "gyms", location: "Bangalore", limit: 15, filter: "no_website" });
    expect(r.newCount).toBe(15);
    expect(r.leads.every((l) => l.website === null && l.websiteStatus === "no_website_listed")).toBe(true);
  });

  it("widens the radius and reports exhaustion honestly", async () => {
    await clean();
    const g = fakeGeoapify(world(30, 35)); // tiny world, all within the widest circle
    const r = await findNewLeads({ userId, category: "gyms", location: "Bangalore", limit: 50, filter: "all" });
    expect(r.newCount).toBe(30);
    expect(r.exhausted).toBe(true);
    expect(r.stoppedReason).toBe("exhausted");
    expect(r.message).toBe("Found 30 new leads. No additional unseen qualifying businesses were returned.");
    expect(g.placeCalls()).toBeLessThanOrEqual(MAX_REQUESTS);

    const again = await findNewLeads({ userId, category: "gyms", location: "Bangalore", limit: 20, filter: "all" });
    expect(again.newCount).toBe(0);
    expect(again.message).toBe("No new qualifying leads found for this search.");
  });

  it("stops after the per-click request cap instead of looping", async () => {
    await clean();
    // Every place has a website → a no_website search can never qualify anything.
    const places = world(1000).map((p) => ({ ...p, website: "https://x.example.com" }));
    const g = fakeGeoapify(places);
    const r = await findNewLeads({ userId, category: "gyms", location: "Bangalore", limit: 20, filter: "no_website" });
    expect(r.newCount).toBe(0);
    expect(g.placeCalls()).toBe(MAX_REQUESTS);
    expect(r.stoppedReason).toBe("request_cap");
    expect(r.message).toMatch(/paused after/);
  });

  it("stops on a rate limit and keeps what it found", async () => {
    await clean();
    fakeGeoapify(world(400), { rateLimitAfter: 1 });
    const r = await findNewLeads({ userId, category: "gyms", location: "Bangalore", limit: 50, filter: "phone" });
    expect(r.stoppedReason).toBe("rate_limit");
    expect(r.newCount).toBeGreaterThan(0);
    expect(r.message).toMatch(/rate limit/i);
    expect(await getDb().darwinLead.count({ where: { userId } })).toBe(r.newCount);
  });

  it("keeps the extras in a backlog and serves them next time", async () => {
    await clean();
    const g = fakeGeoapify(world(400));
    const r1 = await findNewLeads({ userId, category: "gyms", location: "Bangalore", limit: 5, filter: "all" });
    expect(r1.newCount).toBe(5);
    const before = g.placeCalls();
    const r2 = await findNewLeads({ userId, category: "gyms", location: "Bangalore", limit: 5, filter: "all" });
    expect(r2.newCount).toBe(5);
    expect(g.placeCalls()).toBe(before); // served from the saved backlog, no new request
    expect(r2.leads.some((l) => r1.leads.some((o) => o.businessName === l.businessName))).toBe(false);
  });

  it("fails clearly when the location can't be found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })));
    await expect(findNewLeads({ userId, category: "gyms", location: "Nowhereville 000", limit: 5, filter: "all" }))
      .rejects.toBeInstanceOf(GeoapifyError);
  });
});
