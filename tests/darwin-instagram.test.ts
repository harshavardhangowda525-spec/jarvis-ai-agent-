import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
vi.hoisted(() => { process.env.GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || "test-key-requests-go-through-injected-deps"; process.env.DARWIN_INSTAGRAM_TARGET = "20"; });
import { getDb, isDbConfigured } from "@/lib/db";
import { igHandle, parseCounts, scoreIgLead, verifyInstagram, type IgResult } from "@/lib/darwin/instagram/verify";
import type { Gathered } from "@/lib/darwin/daily/checks";
import type { Provider } from "@/lib/darwin/web-search";
import type { IgDeps } from "@/lib/darwin/instagram/run";

const res = (url: string, title: string, content = ""): IgResult => ({ url, title, content });

describe("Instagram handles and counts are read exactly", () => {
  it("profile links → handles; posts, reels and Instagram's own pages aren't accounts", () => {
    expect(igHandle("https://www.instagram.com/the.brew.room/?hl=en")).toBe("the.brew.room");
    expect(igHandle("instagram.com/BrewRoom_BLR")).toBe("brewroom_blr");
    expect(igHandle("@brewroom")).toBe("brewroom");
    expect(igHandle("https://www.instagram.com/p/C8x1y2z/")).toBeNull();
    expect(igHandle("https://www.instagram.com/reel/abc/")).toBeNull();
    expect(igHandle("https://www.instagram.com/explore/")).toBeNull();
    expect(igHandle("https://www.facebook.com/brewroom")).toBeNull();
  });
  it("Instagram's own summary line", () => {
    expect(parseCounts("1,234 Followers, 56 Following, 78 Posts - See Instagram photos and videos from Brew Room (@brewroom)")).toEqual({ followers: 1234, following: 56, posts: 78 });
    expect(parseCounts("Brew Room · 12.5K followers · 340 posts")).toEqual({ followers: 12500, following: null, posts: 340 });
    expect(parseCounts("Best cafe in town")).toEqual({ followers: null, following: null, posts: null });
  });
});

describe("Instagram is VERIFIED only with real evidence", () => {
  const base = { name: "Brew Spot 3 Cafe", locality: "Indiranagar, Bengaluru", phone: "+91 98450 20003", listingInstagram: null, profiles: {} };
  it("the account exists, carries the name, and names the area → verified, with what proved it", () => {
    const r = verifyInstagram({ ...base, results: [res("https://www.instagram.com/brewspot3cafe/", "Brew Spot 3 Cafe (@brewspot3cafe) • Instagram photos and videos", "2,345 Followers, 80 Following, 120 Posts - Specialty coffee in Indiranagar")] });
    expect(r.status).toBe("verified");
    expect(r.handle).toBe("brewspot3cafe");
    expect(r.followers).toBe(2345);
    expect(r.posts).toBe(120);
    expect(r.fullName).toBe("Brew Spot 3 Cafe");
    expect(r.evidence.join(" ")).toMatch(/index.*carries the business's name.*area \(indiranagar\)/);
  });
  it("the business's own map listing links the account → verified even without the area in the text", () => {
    const r = verifyInstagram({ ...base, listingInstagram: "https://instagram.com/brewspot3cafe", results: [res("https://www.instagram.com/brewspot3cafe/", "Brew Spot 3 Cafe (@brewspot3cafe) • Instagram photos and videos")] });
    expect(r.status).toBe("verified");
    expect(r.evidence[0]).toMatch(/map listing links/);
  });
  it("a namesake somewhere else (no area, no phone) → not verified", () => {
    const r = verifyInstagram({ ...base, results: [res("https://www.instagram.com/brewspot3cafe/", "Brew Spot 3 Cafe (@brewspot3cafe) • Instagram photos and videos", "Cafe in Bandra, Mumbai")] });
    expect(r.status).toBe("not_verified");
    expect(r.reason).toMatch(/couldn't be tied to this business's area or phone/);
  });
  it("Instagram says the account doesn't exist → not verified", () => {
    const r = verifyInstagram({ ...base, listingInstagram: "brewspot3cafe", results: [], profiles: { brewspot3cafe: { status: 404, title: "", description: "" } } });
    expect(r.status).toBe("not_verified");
    expect(r.reason).toMatch(/doesn't exist/);
  });
  it("a link that only looks like a profile (no proof it exists) → not verified", () => {
    const r = verifyInstagram({ ...base, results: [res("https://www.instagram.com/brewspot3cafe/", "Coffee lovers in Indiranagar", "brew spot")] });
    expect(r.status).toBe("not_verified");
    expect(r.reason).toMatch(/Couldn't confirm @brewspot3cafe exists/);
  });
  it("an account with a different name → not verified; no account at all → no handle", () => {
    expect(verifyInstagram({ ...base, results: [res("https://www.instagram.com/bangalorefoodie/", "Bangalore Foodie (@bangalorefoodie) • Instagram", "Indiranagar eats")] }).status).toBe("not_verified");
    const none = verifyInstagram({ ...base, results: [res("https://www.justdial.com/x", "Brew Spot 3 Cafe - Justdial", "Indiranagar")] });
    expect(none).toMatchObject({ status: "not_verified", handle: null });
  });
  it("Instagram's own profile page (when it answers) proves the account and gives the counts", () => {
    const r = verifyInstagram({ ...base, listingInstagram: "brewspot3cafe", results: [], profiles: { brewspot3cafe: { status: 200, title: "Brew Spot 3 Cafe (@brewspot3cafe) • Instagram photos and videos", description: "980 Followers, 12 Following, 64 Posts - See Instagram photos and videos from Brew Spot 3 Cafe (@brewspot3cafe)" } } });
    expect(r).toMatchObject({ status: "verified", followers: 980, posts: 64 });
    expect(r.evidence.join(" ")).toMatch(/Instagram serves the profile/);
  });
});

describe("lead quality comes only from real signals", () => {
  it("unknown counts score nothing and say so; high potential needs a phone", () => {
    const known = scoreIgLead({ followers: 5000, posts: 120, phoneOk: true, mobile: true, category: "Cafe", fromListing: false, byHandle: true, rating: null, reviews: null });
    const unknown = scoreIgLead({ followers: null, posts: null, phoneOk: true, mobile: true, category: "Cafe", fromListing: false, byHandle: true, rating: null, reviews: null });
    expect(known.score).toBeGreaterThan(unknown.score);
    expect(known.activity).toBe("5.0K followers · 120 posts — strong audience");
    expect(unknown.activity).toBe("Counts not public");
    expect(known.highPotential).toBe(true);
    expect(scoreIgLead({ followers: 5000, posts: 120, phoneOk: false, mobile: false, category: "Cafe", fromListing: false, byHandle: true, rating: null, reviews: null }).highPotential).toBe(false);
  });
});

/* ---------------- the task itself (real database; map/search/Instagram answers injected) ---------------- */

const d = isDbConfigured ? describe : describe.skip;
function feature(i: number) {
  const lat = 12.97 + i * 0.001, lon = 77.64 + i * 0.001;
  return { geometry: { coordinates: [lon, lat] }, properties: { place_id: `pid-ig-${i}`, name: `Brew Spot ${i} Cafe`, lat, lon, formatted: `${i} Test Road, Indiranagar, Bengaluru`, categories: ["catering.cafe"], distance: 300, contact: { phone: `+91 98450 ${String(20000 + i)}` } } };
}
const igTitle = (i: number) => `Brew Spot ${i} Cafe (@brewspot${i}cafe) • Instagram photos and videos`;
/** What the "web" says about each business (by number in its name). */
function webFor(q: string): IgResult[] {
  const i = Number(q.match(/Brew Spot (\d+)/)?.[1] ?? -1);
  if (i === 2) return [res("https://www.justdial.com/b2", "Brew Spot 2 Cafe - Justdial", "Indiranagar")]; // no Instagram at all
  if (i === 3) return [res(`https://www.instagram.com/brewspot${i}cafe/`, igTitle(i), "Cafe in Bandra, Mumbai")]; // a namesake
  return [res(`https://www.instagram.com/brewspot${i}cafe/`, igTitle(i), `${1000 + i * 100} Followers, 40 Following, ${30 + i} Posts - Cafe in Indiranagar`)];
}

d('"Instagram + No Website Leads" — after the main search, kept apart from it', () => {
  let userId = "";
  const clock = new Date("2026-10-07T08:00:00Z");
  const searches: string[] = [];
  const provider: Provider = {
    id: "searxng", label: "SearXNG", configured: () => true, monthly: () => 0, minIntervalMs: 0,
    run: async (q) => { searches.push(q); return { ok: true, results: webFor(q) }; },
  };
  const deps = (): IgDeps => ({
    now: () => clock,
    geocode: async (t) => ({ lat: 12.97, lon: 77.64, label: `${t}, Bengaluru, Karnataka` }),
    page: async ({ category, offset }) => (category === "cafes" && offset === 0 ? Array.from({ length: 10 }, (_, i) => feature(i)) : []),
    profile: async (h) => (h === "brewspot7cafe" ? { status: 404, title: "", description: "" } : null), // Instagram: 7 is gone, others behind the login wall
    gather: async (c): Promise<Gathered> => {
      const i = Number(c.name.match(/(\d+)/)?.[1]);
      const official = i === 4 ? { url: "https://brewspot4.in/", dns: "ok" as const, ok: true, nameMatch: true } : null; // 4 has a website
      return {
        signals: { listed: null, google: null, search: i === 5 ? { error: "search returned nothing usable", official: null, social: [], directories: 0 } : { official, social: [], directories: 1 }, guessed: [], distinctive: true },
        google: null, search: null, calls: { google: 0, search: 1 },
      };
    },
    searchProviders: [provider],
  });

  beforeEach(async () => {
    if (userId) await getDb().user.deleteMany({ where: { id: userId } });
    userId = (await getDb().user.create({ data: { email: `ig-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x" } })).id;
    searches.length = 0;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  const primary = (status: string) => getDb().darwinDailyRun.create({
    data: { userId, date: "2026-10-07", target: 5, status, verified: status === "completed" ? 5 : 2, config: { locations: ["Indiranagar"], allBangalore: false } },
  });

  it("waits until the main search is COMPLETE — never starts alongside it", async () => {
    const IG = await import("@/lib/darwin/instagram/run");
    expect(await IG.ensureIgRun(await primary("running"), clock)).toBeNull();
    await getDb().darwinDailyRun.deleteMany({ where: { userId } });
    expect(await IG.ensureIgRun(await primary("partial"), clock)).toBeNull();
  });

  it("finds Instagram + no-website businesses, leaves out anything unverified, and never touches the main list", async () => {
    const IG = await import("@/lib/darwin/instagram/run");
    const p = await primary("completed");
    // business 0 is already a main daily lead
    await getDb().darwinLead.create({ data: { userId, businessName: "Brew Spot 0 Cafe", fingerprint: "fp-main-0", sourceRef: "pid-ig-0", source: "geoapify", stage: "new", phone: "+91 98450 20000" } });
    const run = await IG.ensureIgRun(p, clock);
    expect(run?.status).toBe("running");
    let r = await IG.advanceIgRun(run!.id, { deps: deps(), budgetMs: 60_000 });
    for (let i = 0; i < 5 && r.status === "running"; i++) r = await IG.advanceIgRun(run!.id, { deps: deps(), budgetMs: 60_000 });

    expect(r.status).toBe("completed");
    const leads = await getDb().darwinIgLead.findMany({ where: { userId }, orderBy: { businessName: "asc" } });
    expect(leads.map((l) => l.instagramUsername)).toEqual(["brewspot1cafe", "brewspot6cafe", "brewspot8cafe", "brewspot9cafe"]);
    for (const l of leads) {
      expect(l).toMatchObject({ instagramStatus: "verified", websiteStatus: "no_official_website", contactStatus: "not_contacted", followUpStatus: "none", foundDate: "2026-10-07" });
      expect(l.instagramUrl).toBe(`https://www.instagram.com/${l.instagramUsername}/`);
      expect(l.phone).toMatch(/98450/);
      expect(l.instagramEvidence.length).toBeGreaterThan(1);
    }
    expect(leads[0]).toMatchObject({ followers: 1100, posts: 31 });
    expect(r).toMatchObject({
      found: 9, duplicates: 1,            // 0 is already a main lead
      noInstagram: 1,                     // 2
      igVerified: 6,                      // 1, 4, 5, 6, 8, 9
      websiteFound: 1,                    // 4
      unverified: 3,                      // 3 (namesake), 5 (website check incomplete), 7 (account doesn't exist)
      noWebsite: 4, saved: 4, contactable: 4,
    });
    expect(IG.igSummary(r)).toMatchObject({ businessesFound: 9, instagramVerified: 6, noWebsiteVerified: 4, contactable: 4, duplicatesRemoved: 1, unverifiedExcluded: 3 });
    // the main daily list is untouched
    expect(await getDb().darwinLead.count({ where: { userId } })).toBe(1);
    expect(await getDb().darwinCandidate.count({ where: { userId } })).toBe(0);
    expect((await getDb().darwinDailyRun.findUniqueOrThrow({ where: { id: p.id } })).verified).toBe(5);
    // searches were spent only as needed: one Instagram search each (website checks went through `gather`)
    expect(searches.every((q) => /instagram$/.test(q))).toBe(true);
    expect(r.apiRequests).toMatchObject({ searchBy: { searxng: 9 } });
  });

  it("the next day, nothing already looked at is checked again", async () => {
    const IG = await import("@/lib/darwin/instagram/run");
    let r = await IG.advanceIgRun((await IG.ensureIgRun(await primary("completed"), clock))!.id, { deps: deps(), budgetMs: 60_000 });
    expect(r.saved).toBe(5); // no main lead this time: 0 counts too
    await getDb().darwinSearchCursor.deleteMany({ where: { userId } }); // the area is read again from the start
    const day2 = new Date("2026-10-08T08:00:00Z");
    const p2 = await getDb().darwinDailyRun.create({ data: { userId, date: "2026-10-08", target: 5, status: "completed", verified: 5, config: { locations: ["Indiranagar"], allBangalore: false } } });
    const run2 = await IG.ensureIgRun(p2, day2);
    searches.length = 0;
    r = await IG.advanceIgRun(run2!.id, { deps: { ...deps(), now: () => day2 }, budgetMs: 60_000 });
    expect(r.found).toBe(0);
    expect(searches).toEqual([]);
  });

  it("with no web search at all it says what to set up instead of guessing", async () => {
    const IG = await import("@/lib/darwin/instagram/run");
    const run = await IG.ensureIgRun(await primary("completed"), clock);
    const r = await IG.advanceIgRun(run!.id, { deps: { ...deps(), searchProviders: [] }, budgetMs: 60_000 });
    expect(r.status).toBe("needs_setup");
    expect(r.lastError).toMatch(/SearXNG \(npm run searxng\)/);
    expect(await getDb().darwinIgLead.count({ where: { userId } })).toBe(0);
  });
});
