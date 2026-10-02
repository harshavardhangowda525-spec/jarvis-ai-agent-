import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.hoisted(() => {
  process.env.GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || "test-key-requests-go-through-injected-deps";
  process.env.DARWIN_EMAIL_TARGET = "3";
  process.env.DARWIN_EMAIL_DEADLINE = "18:00";
});
import { emailsInText, emailFromResults, isFreeMail, type Signals } from "@/lib/darwin/daily/verify";
import { getDb, isDbConfigured } from "@/lib/db";
import type { DarwinDeps } from "@/lib/darwin/daily/run";
import type { Gathered } from "@/lib/darwin/daily/checks";

describe("finding a business's email on public pages", () => {
  it("reads addresses out of text, skipping site mailboxes and junk", () => {
    expect(emailsInText("Mail us: IronTemple.Gym@Gmail.com or irontemple.gym@gmail.com. support@justdial.com logo@2x.png noreply@shop.in")).toEqual(["irontemple.gym@gmail.com"]);
    expect(isFreeMail("gmail.com")).toBe(true);
    expect(isFreeMail("irontemple.in")).toBe(false);
  });

  it("only takes an address from a page that names the business — never the directory's own", () => {
    const r = emailFromResults([
      { url: "https://www.justdial.com/Bangalore/Iron-Temple-Gym", title: "Iron Temple Gym, Indiranagar", content: "Iron Temple Gym. Email irontemplegym@gmail.com. Listing issues? write to listings@justdial.com" },
    ], "Iron Temple Gym", "Indiranagar, Bengaluru");
    expect(r).toEqual({ email: "irontemplegym@gmail.com", source: "www.justdial.com" });

    // a page about someone else → nothing, even with an email on it
    expect(emailFromResults([{ url: "https://blog.example.org/x", title: "Top gyms", content: "Contact goldsgym@gmail.com" }], "Iron Temple Gym", "Indiranagar")).toBeNull();
  });

  it("an address seen once on a random page needs something tying it to the business", () => {
    const weak = [{ url: "https://news.site/story", title: "Iron Temple Gym opens", content: "Reach the owner at owner.ravi@gmail.com" }];
    expect(emailFromResults(weak, "Iron Temple Gym", "Mysuru")).toBeNull();
    // the same address on a second page naming the business → accepted
    const twice = [...weak, { url: "https://other.site/p", title: "Iron Temple Gym", content: "owner.ravi@gmail.com" }];
    expect(emailFromResults(twice, "Iron Temple Gym", "Mysuru")?.email).toBe("owner.ravi@gmail.com");
    // or the page mentions the locality
    expect(emailFromResults([{ ...weak[0], content: "Iron Temple Gym, Mysuru — owner.ravi@gmail.com" }], "Iron Temple Gym", "Mysuru")?.email).toBe("owner.ravi@gmail.com");
  });
});

/* ---------------- the email goal inside the daily run ---------------- */

const d = isDbConfigured ? describe : describe.skip;

function feature(i: number, name: string, extra: Record<string, unknown> = {}) {
  const lat = 12.97 + i * 0.001, lon = 77.59 + i * 0.001;
  return {
    geometry: { coordinates: [lon, lat] },
    properties: {
      place_id: `pid-mail-${i}`, name, lat, lon, formatted: `${i} Mail Road, Bengaluru`,
      categories: ["sport.fitness"], distance: 400 + i * 50,
      contact: { phone: `+91 98451 ${String(20000 + i).padStart(5, "0")}`, ...(extra.email ? { email: extra.email } : {}) },
    },
  };
}

d("DARWIN email goal (integration)", () => {
  let userId = "";
  let R: typeof import("@/lib/darwin/daily/run");
  const pages: Record<string, unknown[][]> = {};
  const deps = (at: () => Date): DarwinDeps => ({
    now: at,
    geocode: async (t) => ({ lat: 12.97, lon: 77.59, label: `${t}, Karnataka, India` }),
    page: async ({ category, offset }) => pages[category]?.[offset / 50] ?? [],
    gather: async (c, o): Promise<Gathered> => {
      const signals: Signals = { listed: null, google: { found: true, website: null }, search: { official: null, social: [], directories: 1 }, guessed: [], distinctive: true };
      // "Mailable…" businesses have an address on a public listing page naming them
      const slug = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const emailFound = o.wantEmail && /^Mailable/.test(c.name) ? { email: `${slug}@gmail.com`, source: "justdial.com" } : undefined;
      return { signals, google: { found: true, website: null, closed: false, phone: null, rating: 4.7, reviews: 40, mapsUri: null }, search: { officialUrl: null, social: [], directories: 1 }, calls: { google: 1, search: 1 }, ...(emailFound ? { emailFound } : {}) };
    },
    google: true, search: true,
  });
  const finish = async (id: string, dp: DarwinDeps) => {
    let r = await R.advanceRun(id, { deps: dp, budgetMs: 60_000 });
    for (let i = 0; i < 6 && r.status === "running"; i++) r = await R.advanceRun(id, { deps: dp, budgetMs: 60_000 });
    return r;
  };

  beforeAll(async () => {
    R = await import("@/lib/darwin/daily/run");
    userId = (await getDb().user.create({ data: { email: `dwmail-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("keeps searching past the leads goal until enough businesses with an email are found — found, never guessed", async () => {
    const at = new Date("2026-11-02T02:00:00Z"); // 07:30 IST
    pages.gyms = [[
      feature(1, "Plain1 Fitness Studio"), feature(2, "Plain2 Fitness Studio"),
      feature(3, "Listed3 Fitness Studio", { email: "listed3.fitness@gmail.com" }),
      feature(4, "Plain4 Fitness Studio"), feature(5, "Mailable5 Fitness Studio"),
      feature(6, "Plain6 Fitness Studio"), feature(7, "Mailable7 Fitness Studio"), feature(8, "Mailable8 Fitness Studio"),
    ]];
    await R.saveConfig(userId, { locations: ["Indiranagar"], categories: ["gyms"], target: 1, strict: true, allBangalore: false, keepGoing: false });
    expect((await R.loadConfig(userId)).emailTarget).toBe(3); // DARWIN_EMAIL_TARGET
    const run = await R.ensureRun(userId, at);
    expect(run.emailTarget).toBe(3);
    const done = await finish(run.id, deps(() => at));
    expect(done.reasons).toEqual([]);
    expect(done.status).toBe("completed");
    const leads = await getDb().darwinLead.findMany({ where: { userId, metadata: { path: ["dailyRunId"], equals: run.id } }, orderBy: { businessName: "asc" } });
    const mailed = leads.filter((l) => l.email);
    expect(mailed.map((l) => l.email)).toEqual(["listed3.fitness@gmail.com", "mailable5fitnessstudio@gmail.com", "mailable7fitnessstudio@gmail.com"]);
    expect(mailed.map((l) => (l.metadata as { emailSource?: string }).emailSource)).toEqual(["listing", "web search (justdial.com)", "web search (justdial.com)"]);
    // the leads goal (1) was already met, so businesses without an email weren't added for it
    expect(leads.length).toBe(4);
    expect(done.missingEmail).toBeGreaterThan(0);
    const report = done.report as unknown as import("@/lib/darwin/daily/report").DailyReport;
    expect(report).toMatchObject({ withEmail: 3, emailTarget: 3 });
    expect(R.spokenReport(report)).toMatch(/3 of the 3 I aimed for have a public email address/);
  }, 60_000);

  it("stops looking in time to email everyone by 6 PM, and says why it fell short", async () => {
    const morning = new Date("2026-11-03T02:00:00Z");  // 07:30 IST
    const evening = new Date("2026-11-03T12:15:00Z");  // 17:45 IST — inside the sending window
    expect(R.emailDeadlineLabel()).toBe("6:00 PM");
    expect(R.pastEmailSearch(evening, 3)).toBe(true);
    expect(R.pastEmailSearch(new Date("2026-11-03T11:30:00Z"), 3)).toBe(false); // 17:00 IST
    pages.gyms = [[feature(20, "Mailable20 Fitness Studio"), feature(21, "Mailable21 Fitness Studio")]];
    const run = await R.ensureRun(userId, morning);
    await getDb().darwinDailyRun.update({ where: { id: run.id }, data: { startedAt: morning } });
    const r = await R.advanceRun(run.id, { deps: deps(() => evening), budgetMs: 60_000 });
    expect(r.status).toBe("partial");
    expect(r.reasons.join(" ")).toMatch(/Found \d of 3 no-website businesses with a public email address/);
  }, 60_000);

  it("a goal set during the day re-opens a finished run while there's still time", async () => {
    const at = new Date("2026-11-04T04:30:00Z"); // 10:00 IST
    await R.saveConfig(userId, { emailTarget: 0 });
    pages.gyms = [[feature(30, "Plain30 Fitness Studio")]];
    const run = await R.ensureRun(userId, at);
    const done = await finish(run.id, deps(() => at));
    expect(done).toMatchObject({ status: "completed", emailTarget: 0 });
    await R.saveConfig(userId, { emailTarget: 2 });
    const reopened = await R.adoptEmailGoal(done, at);
    expect(reopened).toMatchObject({ status: "running", emailTarget: 2 });
    expect(JSON.stringify(reopened.log)).toMatch(/Email goal set: 2 .*searching again/);
    // too late to email them all → the goal is recorded but the run stays finished
    await R.saveConfig(userId, { emailTarget: 3 });
    const finished = await getDb().darwinDailyRun.update({ where: { id: run.id }, data: { status: "completed" } });
    const late = await R.adoptEmailGoal(finished, new Date("2026-11-04T12:20:00Z")); // 17:50 IST
    expect(late).toMatchObject({ status: "completed", emailTarget: 3 });
  }, 60_000);

  it("the scheduled tick emails each new business from your Gmail as they're found", async () => {
    let t = new Date("2026-11-05T02:00:00Z").getTime();
    const clock = () => new Date(t);
    await R.saveConfig(userId, { emailTarget: 2, target: 1, autoEmail: true });
    pages.gyms = [[feature(40, "Mailable40 Fitness Studio"), feature(41, "Mailable41 Fitness Studio")]];
    const sent: { to: string; subject: string; body: string }[] = [];
    const emailDeps = {
      now: clock, ready: async () => true,
      sleep: async (ms: number) => { t += ms; },
      send: async (_u: string, to: string, subject: string, body: string) => { sent.push({ to, subject, body }); t += 1_000; return `gmail-${sent.length}`; },
    };
    // other emailable leads from earlier days would also be in the queue; clear them for a clean count
    await getDb().darwinLead.updateMany({ where: { userId }, data: { stage: "contacted" } });
    let r;
    for (let i = 0; i < 8; i++) {
      r = await R.runDarwinDaily({ userIds: [userId], deps: deps(clock), budgetMs: 200_000, emailDeps });
      if (!r.more) break;
    }
    expect(sent.map((s) => s.to).sort()).toEqual(["mailable40fitnessstudio@gmail.com", "mailable41fitnessstudio@gmail.com"]);
    expect(sent[0].subject).toMatch(/^A website for Mailable4\d Fitness Studio/);
    const v = await R.darwinDailyView(userId, clock());
    expect(v.run).toMatchObject({ withEmail: 2, emailTarget: 2, emailed: 2 });
  }, 60_000);
});
