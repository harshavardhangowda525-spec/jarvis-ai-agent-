import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import {
  phoneKey, websiteKind, judgeSite, keepWebsite, leadScore, splitAddress, placeIdOf, cleanMapsUrl, scheduleDue, rotation, defaultNextAction,
} from "@/lib/prospects/rules";
import { agentsNamed } from "@/lib/agents/instruction";
import { isChatAgent, ACTIVE_CHAT_AGENTS } from "@/lib/agents/catalog";

describe("JARVIS CRM rules (pure)", () => {
  it("one phone, however it's written", () => {
    expect(phoneKey("+91 98765-43210")).toBe("9876543210");
    expect(phoneKey("098765 43210")).toBe("9876543210");
    expect(phoneKey("12")).toBeNull();
  });
  it("a social page or listing site is not a website", () => {
    expect(websiteKind(null)).toBe("none");
    expect(websiteKind("https://www.instagram.com/gymx")).toBe("social_only");
    expect(websiteKind("wa.me/919876543210")).toBe("social_only");
    expect(websiteKind("https://gymx.business.site/")).toBe("social_only");
    expect(websiteKind("http://www.poshpixiehsr.in/")).toBe("site");
  });
  it("broken / outdated / ok — and a bot wall is not 'broken'", () => {
    const now = new Date("2026-11-11T00:00:00Z");
    expect(judgeSite({ error: "unreachable" }, now)).toBe("broken");
    expect(judgeSite({ status: 503 }, now)).toBe("broken");
    expect(judgeSite({ status: 404 }, now)).toBe("broken");
    expect(judgeSite({ status: 403 }, now)).toBe("ok");
    expect(judgeSite({ status: 200, html: `<meta name="viewport" content="width=device-width"><footer>© 2019 Gym X</footer>` }, now)).toBe("outdated");
    expect(judgeSite({ status: 200, html: `<html>${"x".repeat(600)}</html>` }, now)).toBe("outdated"); // no mobile viewport
    expect(judgeSite({ status: 200, html: `<meta name="viewport" content="width=device-width">© 2025` }, now)).toBe("ok");
    expect(keepWebsite("ok")).toBe(false);
    expect(keepWebsite("none") && keepWebsite("social_only") && keepWebsite("broken") && keepWebsite("outdated")).toBe(true);
  });
  it("lead score is the manual's 4.3", () => {
    expect(leadScore({ websiteStatus: "none", rating: 4.6, reviews: 120, phone: "+919876543210", instagram: "x", category: "Gym" })).toBe(100);
    expect(leadScore({ websiteStatus: "none", rating: 3.9, reviews: 10, phone: null, category: "Bakery" })).toBe(40);
    expect(leadScore({ websiteStatus: "broken", rating: 4.2, reviews: 60, phone: "9876543210", category: "Beauty salon" })).toBe(70);
  });
  it("reads Maps addresses and links", () => {
    expect(splitAddress("441, 2B, 14th main, 17th Cross Rd, 4th sector, HSR Layout, Bengaluru, Karnataka 560102, India", "HSR Layout", "Bengaluru")).toMatchObject({ area: "HSR Layout", city: "Bengaluru" });
    expect(splitAddress("12, 100 Feet Rd, Indiranagar, Bengaluru, Karnataka 560038, India")).toMatchObject({ area: "Indiranagar", city: "Bengaluru" });
    const u = "https://www.google.com/maps/place/Posh/data=!4m7!3m6!1s0x3bae15d6a70624db:0xfd6a1870e818fa8!8m2!3d12.9?authuser=0&hl=en";
    expect(placeIdOf(u)).toBe("0x3bae15d6a70624db:0xfd6a1870e818fa8");
    expect(cleanMapsUrl(u)).toBe("https://www.google.com/maps/place/Posh/data=!4m7!3m6!1s0x3bae15d6a70624db:0xfd6a1870e818fa8!8m2!3d12.9");
  });
  it("the daily schedule: right days, after the time, once a day; rotates every type × area", () => {
    const s = { scheduleOn: true, scheduleDays: [1, 2, 3, 4, 5, 6], scheduleTime: "10:30", lastScheduled: null as string | null, categories: ["gyms", "cafés"], areas: ["HSR", "Indiranagar"] };
    const wed1031 = new Date("2026-11-11T05:01:00Z"); // 10:31 IST, a Wednesday
    expect(scheduleDue(s, wed1031, "Asia/Kolkata")).toBe(true);
    expect(scheduleDue(s, new Date("2026-11-11T04:59:00Z"), "Asia/Kolkata")).toBe(false); // 10:29
    expect(scheduleDue({ ...s, lastScheduled: "2026-11-11" }, wed1031, "Asia/Kolkata")).toBe(false);
    expect(scheduleDue(s, new Date("2026-11-15T06:00:00Z"), "Asia/Kolkata")).toBe(false); // Sunday
    expect(scheduleDue({ ...s, scheduleOn: false }, wed1031, "Asia/Kolkata")).toBe(false);
    expect([0, 1, 2, 3, 4].map((i) => rotation(s.categories, s.areas, i))).toEqual([
      { category: "gyms", area: "HSR" }, { category: "gyms", area: "Indiranagar" }, { category: "cafés", area: "HSR" }, { category: "cafés", area: "Indiranagar" }, { category: "gyms", area: "HSR" },
    ]);
  });
  it("every open status has a next action; closed ones don't", () => {
    for (const st of ["new", "called", "not_reachable", "callback", "interested", "demo_booked", "demo_done", "quotation_sent", "negotiating"] as const) expect(defaultNextAction(st).nextAction).toBeTruthy();
    expect(defaultNextAction("won").nextAction).toBeNull();
  });
  it("DARWIN is retired: not an agent name, not a chat agent", () => {
    expect(agentsNamed("ask darwin to find 30 salons")).toEqual([]);
    expect(isChatAgent("darwin")).toBe(false);
    expect(ACTIVE_CHAT_AGENTS.map((a) => a.id)).not.toContain("darwin");
    expect(isChatAgent("aston")).toBe(true);
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("JARVIS CRM: the Google Maps finder and the pipeline (integration)", () => {
  let userId = "";
  let S: typeof import("@/lib/prospects/service");
  const site = (r: { status?: number; error?: string; html?: string }) => async () => r;
  const listing = (name: string, extra: Record<string, unknown> = {}) => ({ name, category: "Gym", address: `1, 2nd Cross, Indiranagar, Bengaluru, Karnataka 560038, India`, rating: 4.5, reviews: 80, mapsUrl: `https://www.google.com/maps/place/${encodeURIComponent(name)}/data=!4m7!3m6!1s0x3bae${Math.abs(hashCode(name)).toString(16)}:0x1!8m2`, ...extra });
  function hashCode(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

  beforeAll(async () => {
    S = await import("@/lib/prospects/service");
    userId = (await getDb().user.create({ data: { email: `crm-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    await getDb().profile.create({ data: { userId, timezone: "Asia/Kolkata" } }).catch(() => {});
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("an unpaired operator gets nothing", async () => {
    expect((await S.device("jmf_nope", { action: "next" })).authorized).toBe(false);
    expect((await S.device(null, { action: "next" })).authorized).toBe(false);
  });

  it("queues, hands the search to the laptop, keeps only no/broken websites, dedupes by phone and place, and reports honestly", async () => {
    const token = await S.pairFinder(userId);
    const q = await S.queueSearch(userId, { category: "gyms", area: "Indiranagar", limit: 3, trigger: "jarvis" });
    expect(q.paired).toBe(true);
    const n = await S.device(token, { action: "next", device: "LAPTOP (win32)" });
    if (!n.authorized) throw new Error("not authorized");
    const s = n.search as { id: string; query: string; limit: number };
    expect(s.query).toBe("gyms in Indiranagar, Bengaluru");
    expect((await S.finderStatus(userId)).online).toBe(true);

    // no website → added
    const a = await S.device(token, { action: "listing", searchId: s.id, listing: listing("Iron Den Gym", { phone: "+91 98450 11111" }) }, { checkSite: site({}) });
    expect(a).toMatchObject({ authorized: true, added: true, done: false });
    // a working website → skipped (and the site really is checked)
    let checked = "";
    const b = await S.device(token, { action: "listing", searchId: s.id, listing: listing("Gold Fitness", { phone: "+91 98450 22222", website: "https://goldfit.in" }) }, { checkSite: async (u) => { checked = u; return { status: 200, html: `<meta name="viewport" content="width=device-width">© 2026` }; } });
    expect(checked).toBe("https://goldfit.in");
    expect(b).toMatchObject({ added: false, kept: false, reason: "has a website" });
    // a dead website → added as a redesign lead
    const c = await S.device(token, { action: "listing", searchId: s.id, listing: listing("Flex Studio", { phone: "098450 33333", website: "http://flexstudio-old.in" }) }, { checkSite: site({ error: "unreachable" }) });
    expect(c).toMatchObject({ added: true });
    // the same phone again (different name/place) → duplicate, not a second lead
    const dup = await S.device(token, { action: "listing", searchId: s.id, listing: listing("Iron Den Gym Indiranagar", { phone: "9845011111" }) }, { checkSite: site({}) });
    expect(dup).toMatchObject({ added: false, reason: "already in the CRM" });
    // known place ids are skipped before opening them
    const known = await S.device(token, { action: "known", searchId: s.id, placeIds: [S ? (await getDb().prospect.findFirst({ where: { userId, businessName: "Iron Den Gym" } }))!.placeId! : "", "0xnew:0x1"] });
    expect((known as unknown as { known: string[] }).known).toHaveLength(1);
    // the third new lead reaches the limit → done
    const e = await S.device(token, { action: "listing", searchId: s.id, listing: listing("Pulse Yoga", { phone: "+91 98450 44444", website: "https://instagram.com/pulseyoga" }) }, { checkSite: site({}) });
    expect(e).toMatchObject({ added: true, done: true });
    await S.device(token, { action: "status", searchId: s.id, status: "done", text: "Finished." });

    const row = await getDb().mapsSearch.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ status: "done", visited: 5, withWebsite: 1, kept: 4, added: 3, duplicates: 1 });
    const iron = await getDb().prospect.findFirstOrThrow({ where: { userId, businessName: "Iron Den Gym" } });
    expect(iron).toMatchObject({ source: "google_maps", status: "new", websiteStatus: "none", phoneKey: "9845011111", area: "Indiranagar", city: "Bengaluru", nextAction: "First call" });
    expect(iron.leadScore).toBe(40 + 15 + 15 + 10 + 10);
    expect((await getDb().prospect.findFirstOrThrow({ where: { userId, businessName: "Flex Studio" } })).signals).toContain("Website is down — Redesign lead");
    expect((await getDb().prospect.findFirstOrThrow({ where: { userId, businessName: "Pulse Yoga" } })).websiteStatus).toBe("social_only");
    const ev = await getDb().prospectEvent.findFirst({ where: { userId, kind: "search" }, orderBy: { createdAt: "desc" } });
    expect(ev!.text).toBe("Google Maps: gyms in Indiranagar — looked at 5, 4 without a working website, 3 new to the CRM (1 already there).");
  });

  it("you can stop a running search; a CAPTCHA stop is reported as blocked", async () => {
    const token = await S.pairFinder(userId);
    const { search } = await S.queueSearch(userId, { category: "cafés", area: "HSR Layout", limit: 5, trigger: "you" });
    await S.device(token, { action: "next" });
    await S.stopSearch(userId, search.id);
    const r = await S.device(token, { action: "listing", searchId: search.id, listing: listing("Brew Bros", { phone: "+91 98450 55555" }) }, { checkSite: site({}) });
    expect(r).toMatchObject({ stop: true });
    await S.device(token, { action: "status", searchId: search.id, status: "done" });
    expect((await getDb().mapsSearch.findUniqueOrThrow({ where: { id: search.id } })).status).toBe("stopped");

    const b = await S.queueSearch(userId, { category: "salons", area: "Koramangala", limit: 2, trigger: "you" });
    await S.device(token, { action: "next" });
    await S.device(token, { action: "status", searchId: b.search.id, status: "blocked", error: "Google showed a CAPTCHA" });
    const ev = await getDb().prospectEvent.findFirst({ where: { userId, kind: "search" }, orderBy: { createdAt: "desc" } });
    expect(ev!.text).toMatch(/Stopped: Google showed a CAPTCHA/);
  });

  it("the daily cap of 30 holds", async () => {
    await getDb().mapsFinder.update({ where: { userId }, data: { dailyLimit: 5 } });
    await expect(S.queueSearch(userId, { category: "gyms", area: "Whitefield", trigger: "you" })).resolves.toMatchObject({ search: { limit: 1 } }); // 4 already added today
    await S.device((await S.pairFinder(userId)), { action: "next" }).catch(() => {});
    await getDb().prospect.create({ data: { userId, businessName: "Cap Filler", source: "google_maps", leadScore: 0 } });
    await expect(S.queueSearch(userId, { category: "gyms", area: "Whitefield", trigger: "you" })).rejects.toThrow(/Today's 5 new leads are already in/);
    await expect(S.saveSchedule(userId, { dailyLimit: 31 })).rejects.toThrow(/1–30/);
  });

  it("pipeline rules: Lost needs a reason; 3× not reachable → Lost; won clears the next action", async () => {
    const p = await S.createProspect(userId, { businessName: "Corner Bakery", phone: "+91 90000 00001", category: "Bakery" }, "you");
    expect(p).toMatchObject({ status: "new", nextAction: "First call", websiteStatus: "none" });
    await expect(S.createProspect(userId, { businessName: "Other", phone: "9000000001" }, "you")).rejects.toThrow(/already has that phone/);
    await expect(S.updateProspect(userId, p.id, { status: "lost" }, "jarvis")).rejects.toThrow(/Lost needs a reason/);
    for (let i = 0; i < 2; i++) expect((await S.updateProspect(userId, p.id, { status: i ? "called" : "not_reachable" }, "jarvis")).status).not.toBe("lost");
    await S.updateProspect(userId, p.id, { status: "not_reachable" }, "jarvis");
    const third = await S.updateProspect(userId, p.id, { status: "not_reachable" }, "jarvis");
    expect(third).toMatchObject({ status: "lost", lostReason: "unreachable", nextAction: null, unreachableCount: 3 });
    const w = await S.updateProspect(userId, p.id, { status: "won", value: 15000, note: "Signed the starter website." }, "you");
    expect(w).toMatchObject({ status: "won", lostReason: null, nextAction: null, value: 15000 });
    const b = await S.board(userId);
    expect(b.wonThisMonth).toEqual({ count: 1, value: 15000 });
    expect((await getDb().prospectEvent.findMany({ where: { prospectId: p.id } })).map((e) => e.by)).toEqual(expect.arrayContaining(["you", "jarvis"]));
  });

  it("the schedule queues the day's search once and rotates; a quiet operator's search is closed honestly", async () => {
    await S.saveSchedule(userId, { scheduleOn: true, scheduleDays: [0, 1, 2, 3, 4, 5, 6], scheduleTime: "00:00", dailyLimit: 30, categories: ["dentists"], areas: ["Jayanagar", "BTM"] });
    await getDb().mapsSearch.updateMany({ where: { userId, status: { in: ["queued", "running"] } }, data: { status: "done" } });
    const t1 = await S.tick();
    expect(t1.results.find((r) => r.userId === userId)).toEqual({ userId, queued: "dentists in Jayanagar" });
    const t2 = await S.tick();
    expect(t2.results.find((r) => r.userId === userId)).toBeUndefined(); // once a day
    const token = await S.pairFinder(userId);
    const n = await S.device(token, { action: "next" });
    const id = (n as unknown as { search: { id: string } }).search.id;
    await getDb().mapsSearch.update({ where: { id }, data: { heartbeatAt: new Date(Date.now() - S.STALE_MS - 1000) } });
    await S.tick();
    expect(await getDb().mapsSearch.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "failed", error: expect.stringMatching(/stopped answering/) });
  });
});
