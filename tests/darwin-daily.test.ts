import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.hoisted(() => { process.env.GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || "test-key-requests-go-through-injected-deps"; });
import {
  classifyWebsite, scoreLead, verifyPhone, guessDomains, hostMatchesName, isDirectoryHost, categoryBucket, nameTokens, textNamesBusiness, looksParked,
  type Signals, type UrlCheck,
} from "@/lib/darwin/daily/verify";
import { getDb, isDbConfigured } from "@/lib/db";
import type { DarwinDeps } from "@/lib/darwin/daily/run";
import type { Gathered } from "@/lib/darwin/daily/checks";

const up = (url: string, extra: Partial<UrlCheck> = {}): UrlCheck => ({ url, dns: "ok", ok: true, status: 200, nameMatch: true, ...extra });
const down = (url: string, extra: Partial<UrlCheck> = {}): UrlCheck => ({ url, dns: "ok", ok: false, error: "timed out", ...extra });
const nx = (url: string): UrlCheck => ({ url, dns: "nxdomain", ok: false, error: "domain doesn't exist" });
const base: Signals = { listed: null, google: { found: true, website: null }, search: { official: null, social: [], directories: 2 }, guessed: [], distinctive: true };

describe("website verification rules", () => {
  it("no website only with an independent confirmation", () => {
    const v = classifyWebsite(base);
    expect(v.status).toBe("no_website");
    expect(v.independent).toEqual(["google", "search"]);
    expect(v.reasons.join(" ")).toMatch(/No website on the business listing.*Google business profile has no website.*no official website/);
    // nothing independent → unclear (strict), allowed when strict is off
    const bare: Signals = { ...base, google: null, search: null };
    expect(classifyWebsite(bare).status).toBe("unclear");
    expect(classifyWebsite(bare, { strict: false }).status).toBe("no_website");
  });
  it("any live official site rejects the lead", () => {
    expect(classifyWebsite({ ...base, listed: up("https://irontemple.in") }).status).toBe("website_exists");
    expect(classifyWebsite({ ...base, google: { found: true, website: "https://x.in", check: up("https://x.in") } }).status).toBe("website_exists");
    expect(classifyWebsite({ ...base, search: { official: up("https://irontemple.com"), social: [], directories: 0 } }).status).toBe("website_exists");
    expect(classifyWebsite({ ...base, guessed: [up("https://irontemple.in")] }).status).toBe("website_exists");
    // a guessed domain that belongs to someone else doesn't count
    expect(classifyWebsite({ ...base, guessed: [up("https://irontemple.in", { nameMatch: false })] }).status).toBe("no_website");
  });
  it("distinguishes temporarily unavailable, unclear, closed and dead domains", () => {
    expect(classifyWebsite({ ...base, listed: down("https://slow.in") }).status).toBe("temporarily_unavailable");
    expect(classifyWebsite({ ...base, search: { error: "search timed out", official: null, social: [], directories: 0 } }).status).toBe("unclear");
    expect(classifyWebsite({ ...base, google: { found: false, website: null, error: "Google timed out" } }).status).toBe("unclear");
    // a guessed domain we couldn't read proves nothing either way
    expect(classifyWebsite({ ...base, guessed: [down("https://maybe.in")] }).status).toBe("no_website");
    // a site behind bot protection still exists
    expect(classifyWebsite({ ...base, listed: up("https://guarded.in", { protected: true, nameMatch: false }) }).status).toBe("website_exists");
    expect(classifyWebsite({ ...base, google: { found: true, website: null, closed: true } }).status).toBe("closed");
    const dead = classifyWebsite({ ...base, listed: nx("https://gone-forever.in") });
    expect(dead.status).toBe("no_website");
    expect(dead.reasons[0]).toMatch(/no longer exists/);
    expect(classifyWebsite({ ...base, listed: up("https://parked.in", { parked: true }) }).status).toBe("no_website");
  });
});

describe("names, domains, phones, scoring", () => {
  it("matches a business to its own domain only", () => {
    expect(nameTokens("Iron Temple Gym & Fitness")).toEqual(["iron", "temple"]);
    expect(guessDomains("Iron Temple Gym")).toContain("irontemple.in");
    expect(guessDomains("Fitness Gym")).toEqual([]);
    expect(hostMatchesName("www.irontemplegym.in", "Iron Temple Gym")).toBe(true);
    expect(hostMatchesName("templeofiron.com", "Iron Temple Gym")).toBe(true);
    expect(hostMatchesName("goldsgym.com", "Iron Temple Gym")).toBe(false);
    expect(isDirectoryHost("www.justdial.com")).toBe(true);
    expect(isDirectoryHost("m.facebook.com")).toBe(true);
    expect(isDirectoryHost("irontemple.in")).toBe(false);
    expect(textNamesBusiness("Welcome to Iron Temple — Bengaluru's strength gym", "Iron Temple Gym")).toBe(true);
    expect(looksParked("This domain is for sale! Buy this domain today")).toBe(true);
  });
  it("validates phones without inventing digits", () => {
    expect(verifyPhone("+91 98450 12345")).toMatchObject({ ok: true, mobile: true });
    expect(verifyPhone("080 4123 4567")).toMatchObject({ ok: true, mobile: false });
    expect(verifyPhone("09845012345")).toMatchObject({ ok: true, mobile: true });
    expect(verifyPhone("12345")).toMatchObject({ ok: false, normalized: null });
    expect(verifyPhone(null).ok).toBe(false);
  });
  it("scores only from facts", () => {
    const hot = scoreLead({ verdict: "no_website", bucket: "Gyms", phoneOk: true, mobile: true, email: false, social: 1, distanceM: 1200, reviews: 80, rating: 4.5 });
    expect(hot.score).toBeGreaterThanOrEqual(70);
    expect(hot.highPotential).toBe(true);
    expect(hot.needs).toContain("Membership app");
    const cold = scoreLead({ verdict: "no_website", bucket: "Other", phoneOk: false, mobile: false, email: false, social: 0, distanceM: 12000, reviews: null, rating: null });
    expect(cold.highPotential).toBe(false);
    expect(cold.parts.every((p) => p.points > 0)).toBe(true);
    expect(categoryBucket("Cafe")).toBe("Restaurants/Cafes");
    expect(categoryBucket("Gym / fitness centre")).toBe("Gyms");
    expect(categoryBucket("Hardware")).toBe("Other");
  });
});

/* ---------------- the daily job against a real database ---------------- */

const d = isDbConfigured ? describe : describe.skip;

/** A Geoapify-shaped place feature (test fixture). */
function feature(i: number, cat: string, extra: Record<string, unknown> = {}) {
  const lat = 12.97 + i * 0.001, lon = 77.59 + i * 0.001;
  return {
    geometry: { coordinates: [lon, lat] },
    properties: {
      place_id: `pid-${cat}-${i}`, name: `${extra.name ?? `Shop${cat}${i} Studio`}`, lat, lon, formatted: `${i} Test Road, Bengaluru`,
      categories: [cat === "gyms" ? "sport.fitness" : "catering.cafe"], distance: 400 + i * 50,
      contact: { phone: `+91 98450 ${String(10000 + i).padStart(5, "0")}` },
      ...(extra.website ? { website: extra.website } : {}),
    },
  };
}

d("DARWIN daily run (integration)", () => {
  let userId = "";
  let R: typeof import("@/lib/darwin/daily/run");
  let clock = new Date("2026-09-28T02:00:00Z"); // 07:30 IST
  const pages: Record<string, unknown[][]> = {};
  const calls = { page: 0, gather: 0 };
  const deps = (): DarwinDeps => ({
    now: () => clock,
    geocode: async (t) => ({ lat: 12.97, lon: 77.59, label: `${t}, Karnataka, India` }),
    page: async ({ category, offset }) => { calls.page++; return pages[category]?.[offset / 50] ?? []; },
    gather: async (c): Promise<Gathered> => {
      calls.gather++;
      const name = c.name;
      const g = { found: true, website: null as string | null, closed: /Closed/.test(name), phone: null, rating: 4.6, reviews: 60, mapsUri: "https://maps.google.com/?cid=1" };
      const signals: Signals = {
        listed: c.website ? { url: c.website, dns: "ok", ok: true, status: 200, nameMatch: true } : null,
        google: { found: true, website: null, closed: g.closed },
        search: /Unclear/.test(name) ? { error: "search timed out", official: null, social: [], directories: 0 } : { official: null, social: ["https://instagram.com/x"], directories: 1 },
        guessed: [], distinctive: true,
      };
      return { signals, google: g, search: { officialUrl: null, social: ["https://instagram.com/x"], directories: 1 }, calls: { google: 1, search: 1 } };
    },
    google: true, search: true,
  });

  /** Advance until the day's search is finished (it may widen itself a couple of times first). */
  const finish = async (id: string, dp: DarwinDeps = deps(), budgetMs = 60_000) => {
    let r = await R.advanceRun(id, { deps: dp, budgetMs });
    for (let i = 0; i < 6 && r.status === "running"; i++) r = await R.advanceRun(id, { deps: dp, budgetMs });
    return r;
  };
  beforeAll(async () => {
    R = await import("@/lib/darwin/daily/run");
    const u = await getDb().user.create({ data: { email: `dwd-${Date.now()}@example.com`, passwordHash: "x" } });
    userId = u.id;
    // gyms: 3 with websites, 1 unclear, 1 closed, 1 already in the CRM, 8 genuine no-website
    const gyms = [
      ...[0, 1, 2].map((i) => feature(i, "gyms", { website: `https://gym${i}.in` })),
      feature(3, "gyms", { name: "Unclear Fitness Studio" }),
      feature(4, "gyms", { name: "Closed Iron Studio" }),
      feature(5, "gyms", { name: "Known Gym Studio" }),
      ...[6, 7, 8, 9, 10, 11, 12, 13].map((i) => feature(i, "gyms")),
    ];
    pages.gyms = [gyms];
    pages.cafes = [[20, 21, 22].map((i) => feature(i, "cafes"))];
    await getDb().darwinLead.create({ data: { userId, businessName: "Known Gym Studio", sourceRef: "pid-gyms-5", fingerprint: "known-fp", latitude: 12.975, longitude: 77.595 } });
    await R.saveConfig(userId, { locations: ["Indiranagar"], categories: ["gyms", "cafes"], target: 5, strict: true });
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("finds exactly the target of verified no-website leads, rejecting the rest", async () => {
    const run = await R.ensureRun(userId, clock);
    expect(run.status).toBe("running");
    const done = await R.advanceRun(run.id, { deps: deps(), budgetMs: 60_000 });
    expect(done.status).toBe("completed");
    expect(done.verified).toBe(5);
    expect(done.websiteRejected).toBe(3);
    expect(done.unclear).toBe(1);
    expect(done.closed).toBe(1);
    expect(done.duplicates).toBe(1); // only the business that was already in the CRM — not today's own re-reads
    expect(done.candidates).toBe(14);
    const leads = await getDb().darwinLead.findMany({ where: { userId, metadata: { path: ["dailyRunId"], equals: run.id } } });
    expect(leads).toHaveLength(5);
    expect(leads.every((l) => l.website === null && l.opportunityType === "no_website" && l.phone && (l.leadScore ?? 0) > 0)).toBe(true);
    expect(leads[0].notes).toMatch(/verified no website/);
    const report = done.report as unknown as import("@/lib/darwin/daily/report").DailyReport;
    expect(report).toMatchObject({ verified: 5, target: 5, contactable: 5, duplicates: 1, websiteRejected: 3, unclear: 1 });
    expect(report.breakdown).toEqual([{ bucket: "Gyms", count: 5 }]);
    expect(R.spokenReport(report)).toMatch(/^DARWIN has finished today's lead search\. I found 5 new businesses without verified websites\. 5 have publicly available phone numbers/);
    // rejected businesses are remembered so they aren't re-verified tomorrow
    expect(await getDb().darwinCandidate.count({ where: { userId } })).toBe(5);
  });

  it("a new day starts a fresh cycle, resumes from the saved position, and never repeats a business", async () => {
    clock = new Date("2026-09-29T02:00:00Z");
    await R.saveConfig(userId, { target: 50 });
    const run = await R.ensureRun(userId, clock);
    expect(run.date).toBe("2026-09-29");
    expect(run.verified).toBe(0);
    // tiny budget: it stops part-way and keeps its place
    const g0 = calls.gather;
    const done = await finish(run.id);
    // gyms: 3 genuine left (8 − 5 used yesterday); cafes: 3 → only 6 exist in scope
    expect(done.status).toBe("partial");
    expect(done.verified).toBe(6);
    expect(done.reasons[0]).toMatch(/Insufficient businesses found/);
    // nothing already saved or rejected yesterday was verified again
    expect(calls.gather - g0).toBe(6);
    const report = done.report as unknown as import("@/lib/darwin/daily/report").DailyReport;
    expect(R.spokenReport(report)).toMatch(/^DARWIN completed today's search\. 6 new businesses were verified as having no website\. I could not safely verify another 44, so I did not add them\./);
    const all = await getDb().darwinLead.findMany({ where: { userId }, select: { sourceRef: true } });
    expect(new Set(all.map((a) => a.sourceRef)).size).toBe(all.length);
    // the previous day's leads and report are preserved
    const yesterday = await getDb().darwinDailyRun.findUnique({ where: { userId_date: { userId, date: "2026-09-28" } } });
    expect(yesterday?.verified).toBe(5);
  }, 60_000);

  it("with no independent check configured, nothing is counted as 'no website'", async () => {
    clock = new Date("2026-09-30T02:00:00Z");
    pages.gyms = [[40, 41].map((i) => feature(i, "gyms"))];
    pages.cafes = [[]];
    const run = await R.ensureRun(userId, clock);
    const noKeys: DarwinDeps = {
      ...deps(),
      gather: async (c) => ({ signals: { listed: null, google: null, search: null, guessed: [], distinctive: true }, google: null, search: null, calls: { google: 0, search: 0 } }),
      google: false, search: false,
    };
    const done = await finish(run.id, noKeys, 30_000);
    expect(done.verified).toBe(0);
    expect(done.unclear).toBe(2);
    expect(done.reasons.join(" ")).toMatch(/no Google Places or web-search key is set/);
  }, 60_000);

  it("before the start time no run is created", async () => {
    clock = new Date("2026-10-01T23:00:00Z"); // 04:30 IST
    const r = await R.runDarwinDaily({ userIds: [userId], deps: deps(), budgetMs: 10_000 });
    expect(r.results).toEqual([]);
  });

  it("the view shows true progress", async () => {
    clock = new Date("2026-09-29T05:00:00Z");
    const v = await R.darwinDailyView(userId, clock);
    expect(v.run).toMatchObject({ verified: 6, target: 50, remaining: 44, status: "partial" });
    expect(v.history.find((h) => h.date === "2026-09-28")).toMatchObject({ verified: 5, target: 5 });
  });

  it("keeps going call after call by itself until today's leads are all found", async () => {
    let t = new Date("2026-10-02T02:00:00Z").getTime(); // 07:30 IST
    pages.gyms = [[50, 51, 52, 53, 54, 55, 56, 57].map((i) => feature(i, "gyms"))];
    pages.cafes = [[]];
    await R.saveConfig(userId, { target: 6 });
    // time moves on as it works, so one call can't do the whole day
    const ticking = (): DarwinDeps => ({ ...deps(), now: () => new Date((t += 4_000)) });
    const seen: boolean[] = [];
    let r;
    for (let i = 0; i < 20; i++) {
      r = await R.runDarwinDaily({ userIds: [userId], deps: ticking(), budgetMs: 30_000 });
      seen.push(r.more);
      if (!r.more) break;
    }
    expect(seen.length).toBeGreaterThan(1);           // it needed more than one call…
    expect(seen.slice(0, -1).every(Boolean)).toBe(true); // …said "more" each time it wasn't done…
    expect(r!.results[0]).toMatchObject({ status: "completed", verified: 6 }); // …and finished without DARWIN open
  });

  it("a call that can't move the search on doesn't ask to be called again (no spinning)", async () => {
    let t = new Date("2026-10-06T02:00:00Z").getTime();
    pages.gyms = [[70, 71, 72].map((i) => feature(i, "gyms"))];
    const stuck = (): DarwinDeps => ({ ...deps(), now: () => new Date((t += 60_000)) }); // no time to do anything
    const r = await R.runDarwinDaily({ userIds: [userId], deps: stuck(), budgetMs: 30_000 });
    expect(r.results[0].status).toBe("running");
    expect(r.more).toBe(false);
  });

  it("the scheduler may start up to its early window before the start time", async () => {
    const at = new Date("2026-10-03T23:45:00Z"); // 05:15 IST on the 4th
    expect(R.dailyDue(at)).toBe(false);
    expect(R.dailyDue(at, 60)).toBe(true);
    expect(R.dailyDue(new Date("2026-10-03T23:15:00Z"), 60)).toBe(false); // 04:45 — still too early
  });

  it("a day that was waiting for settings starts once they're there", async () => {
    const at = new Date("2026-10-05T02:00:00Z");
    const date = R.dailyNow(at).date;
    await getDb().darwinDailyRun.create({ data: { userId, date, target: 4, status: "needs_setup", config: {}, log: [] } });
    const r = await R.runDarwinDaily({ userIds: [userId], deps: { ...deps(), now: () => at }, budgetMs: 10_000 });
    expect(r.results[0].status).not.toBe("needs_setup");
    const run = await R.todayRun(userId, at);
    expect(run?.status).not.toBe("needs_setup");
  });

  it("when the area runs out before the target, the search widens itself — more kinds of business, then further out", async () => {
    const at = new Date("2026-10-07T02:00:00Z"); // 07:30 IST
    await R.saveConfig(userId, { categories: ["gyms"], target: 3, radiusKm: 6 });
    pages.gyms = [[]];                                            // nothing new nearby
    pages.pharmacies = [[80, 81, 82].map((i) => feature(i, "pharmacies", { name: `Pharma${i} Wellness Store` }))];
    const run = await R.ensureRun(userId, at);
    await getDb().darwinDailyRun.update({ where: { id: run.id }, data: { startedAt: at } });
    let r = await R.advanceRun(run.id, { deps: { ...deps(), now: () => at }, budgetMs: 60_000 });
    expect(r.status).toBe("running"); // not "partial" — it widened instead
    expect((r.config as { widened?: number; categories: string[] }).widened).toBe(1);
    expect((r.config as { categories: string[] }).categories).toContain("pharmacies");
    expect(JSON.stringify(r.log)).toMatch(/widening it to reach 3 by 2:00 PM: added \d+ more kinds of business/);
    r = await R.advanceRun(run.id, { deps: { ...deps(), now: () => at }, budgetMs: 60_000 });
    expect(r).toMatchObject({ status: "completed", verified: 3 });
  }, 60_000);

  it("widening: categories first, then the radius, then it stops", () => {
    const cfg = { locations: ["X"], categories: ["gyms"], target: 50, radiusKm: 6, requirePhone: false, strict: true, autoEmail: false } as import("@/lib/darwin/daily/run").DailyConfig;
    expect(R.widen(cfg)).toMatchObject({ step: 1, clearExhausted: false });
    cfg.widened = 1;
    expect(R.widen(cfg)).toMatchObject({ step: 2, clearExhausted: true, note: "searching up to 12 km out" });
    expect(cfg.radiusKm).toBe(12);
    cfg.widened = 2;
    expect(R.widen(cfg)).toBeNull();
  });

  it("a search that started in the morning stops at 2 PM and reports what it has", async () => {
    const morning = new Date("2026-10-08T02:00:00Z"); // 07:30 IST
    const afternoon = new Date("2026-10-08T08:45:00Z"); // 14:15 IST
    await R.saveConfig(userId, { categories: ["gyms"], target: 40 });
    pages.gyms = [[90, 91].map((i) => feature(i, "gyms", { name: `Late${i} Fitness Studio` }))];
    const run = await R.ensureRun(userId, morning);
    await getDb().darwinDailyRun.update({ where: { id: run.id }, data: { startedAt: morning } });
    const r = await R.advanceRun(run.id, { deps: { ...deps(), now: () => afternoon }, budgetMs: 60_000 });
    expect(r.status).toBe("partial");
    expect(r.reasons[0]).toMatch(/Reached the 2:00 PM deadline before finding 40/);
    expect(R.pastDeadline(afternoon)).toBe(true);
    expect(R.pastDeadline(morning)).toBe(false);
  }, 60_000);

  it("a search that only started after 2 PM isn't cut off", async () => {
    const afternoon = new Date("2026-10-09T09:30:00Z"); // 15:00 IST
    await R.saveConfig(userId, { categories: ["gyms"], target: 2 });
    pages.gyms = [[95, 96].map((i) => feature(i, "gyms", { name: `Evening${i} Fitness Studio` }))];
    const run = await R.ensureRun(userId, afternoon);
    await getDb().darwinDailyRun.update({ where: { id: run.id }, data: { startedAt: afternoon } });
    const r = await R.advanceRun(run.id, { deps: { ...deps(), now: () => afternoon }, budgetMs: 60_000 });
    expect(r).toMatchObject({ status: "completed", verified: 2 });
  }, 60_000);
});

import { darwinDailyRequest, darwinProgressLine } from "@/lib/darwin/daily/intent";
import { checkUrl, strictNameMatch } from "@/lib/darwin/daily/checks";
describe("DARWIN daily: voice + safety", () => {
  it("recognises report requests", () => {
    for (const t of ["DARWIN report", "Show me the daily report", "how many leads did DARWIN find today?", "today's leads", "DARWIN's daily progress"]) expect(darwinDailyRequest(t), t).toBe(true);
    for (const t of ["find 20 gyms in Bengaluru", "open DARWIN", "report a bug"]) expect(darwinDailyRequest(t), t).toBe(false);
    expect(darwinProgressLine({ run: { status: "running", verified: 12, target: 50, lastError: null }, startLabel: "6:00 AM", due: true }, null)).toBe("DARWIN's daily search is still running — 12 of 50 new no-website leads verified so far.");
    expect(darwinProgressLine({ run: null, startLabel: "6:00 AM", due: false }, null)).toMatch(/starts today's lead search at 6:00 AM/);
  });
  it("a guessed domain only counts with the full name plus locality or phone", () => {
    expect(strictNameMatch("Royal Bakery — fresh bread in Indiranagar, Bengaluru", "Royal Bakery", { locality: "Indiranagar, Bengaluru" })).toBe(true);
    expect(strictNameMatch("Royal Bakery — London's finest since 1901", "Royal Bakery", { locality: "Indiranagar, Bengaluru" })).toBe(false);
    expect(strictNameMatch("Welcome to Royal — luxury goods", "Royal Bakery", { locality: "Indiranagar" })).toBe(false);
    expect(strictNameMatch("Royal Bakery. Call 98450 12345", "Royal Bakery", { locality: "Mysuru", phone: "+91 98450 12345" })).toBe(true);
  });
  it("never fetches private or odd-port addresses from listing data", async () => {
    expect((await checkUrl("http://127.0.0.1/", "X")).error).toBe("private address");
    expect((await checkUrl("http://localhost/admin", "X")).error).toBe("private address");
    expect((await checkUrl("http://10.0.0.5/", "X")).error).toBe("private address");
    expect((await checkUrl("https://example.com:8443/", "X")).error).toBe("unsupported URL");
    expect((await checkUrl("ftp://example.com/", "X")).error).toBe("unsupported URL");
  });
});
