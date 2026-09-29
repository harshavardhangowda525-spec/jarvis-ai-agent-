import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
vi.hoisted(() => { process.env.DARWIN_AUTO_EMAIL_DAILY_CAP = "3"; process.env.DARWIN_AUTO_EMAIL_GAP_SEC = "45"; delete process.env.DARWIN_AUTO_EMAIL; });
import { getDb, isDbConfigured } from "@/lib/db";
import { usableEmail, composeOutreach, sendAutoEmails, type AutoEmailDeps } from "@/lib/darwin/auto-email";

describe("DARWIN automatic outreach: what gets written", () => {
  it("only real, writable addresses", () => {
    expect(usableEmail(" Hello@CafeBloom.in ")).toBe("hello@cafebloom.in");
    expect(usableEmail("mailto:info@gym.co.in?subject=hi")).toBe("info@gym.co.in");
    for (const bad of ["noreply@shop.in", "no-reply@x.com", "someone@example.com", "logo@2x.png", "not an email", "", null]) expect(usableEmail(bad), String(bad)).toBeNull();
  });

  it("the email says only what's known, who it's from, and how to opt out", () => {
    const e = composeOutreach({ businessName: "Iron Temple Gym", category: "Gyms", location: "12 CMH Road, Indiranagar, Bengaluru, 560038", website: null, opportunityType: "no_website" });
    expect(e.subject).toBe("A website for Iron Temple Gym");
    expect(e.body).toMatch(/^Hi Iron Temple Gym team,/);
    expect(e.body).toContain("noticed you don't have a website yet");
    expect(e.body).toContain("Infinity Web & Apps");
    expect(e.body).toContain("8317480583");
    expect(e.body).toMatch(/reply "stop" and we won't email you again/);
    // not verified as website-less → no such claim
    const f = composeOutreach({ businessName: "Cafe Bloom", website: "https://cafebloom.in", opportunityType: "outdated_website" });
    expect(f.body).not.toMatch(/don't have a website/);
    expect(f.subject).toBe("A quick idea for Cafe Bloom");
  });
});

const d = isDbConfigured ? describe : describe.skip;

d("DARWIN automatic outreach (database)", () => {
  let userId = "";
  const sent: { to: string; subject: string }[] = [];
  let t = new Date("2026-10-02T03:00:00Z").getTime();
  let fail: string | null = null;
  const deps = (ready = true): AutoEmailDeps => ({
    now: () => new Date(t),
    sleep: async (ms) => { t += ms; },
    ready: async () => ready,
    send: async (_u, to, subject) => { if (fail) throw new Error(fail); t += 1_000; sent.push({ to, subject }); return `gm_${sent.length}`; },
  });
  const lead = (name: string, email: string | null, extra: Record<string, unknown> = {}) =>
    getDb().darwinLead.create({ data: { userId, businessName: name, email, fingerprint: `fp-${name}`, opportunityType: "no_website", location: "Indiranagar, Bengaluru, India", ...extra } });

  beforeAll(async () => {
    userId = (await getDb().user.create({ data: { email: `dwmail-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    await lead("Alpha Gym", "alpha@gym.in");
    await lead("Alpha Gym Branch", "ALPHA@gym.in");          // same inbox → never a second email
    await lead("No Email Cafe", null);
    await lead("Already Called Salon", "salon@x.in", { stage: "contacted" });
    await lead("Robot Shop", "noreply@robot.in");
    await lead("Opted Out Spa", "spa@x.in", { metadata: { doNotEmail: true } });
    await lead("Beta Bakery", "beta@bakery.in");
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("without Gmail nothing is sent — and it says so", async () => {
    const r = await sendAutoEmails(userId, { until: t + 200_000, deps: deps(false) });
    expect(r).toMatchObject({ sent: 0, waiting: 2 });
    expect(r.stopped).toMatch(/Gmail isn't connected/);
    expect(sent).toHaveLength(0);
  });

  it("emails each eligible lead once, spaced out, and marks them contacted", async () => {
    const t0 = t;
    const r = await sendAutoEmails(userId, { until: t + 200_000, deps: deps() });
    expect(r).toMatchObject({ sent: 2, failed: 0, waiting: 0 });
    expect(sent.map((s) => s.to).sort()).toEqual(["alpha@gym.in", "beta@bakery.in"]);
    expect(t - t0).toBeGreaterThanOrEqual(45_000); // the gap between the two
    const msgs = await getDb().darwinMessage.findMany({ where: { userId }, include: { lead: true } });
    expect(msgs.every((m) => m.status === "sent" && m.externalId?.startsWith("gm_") && m.sentAt)).toBe(true);
    expect(msgs.every((m) => m.lead.stage === "contacted")).toBe(true);
    const act = await getDb().darwinActivity.findMany({ where: { userId, type: "message_sent" } });
    expect(act.map((a) => a.detail).join(" ")).toMatch(/automatically/);
    // a second pass never writes to anyone again
    const again = await sendAutoEmails(userId, { until: t + 200_000, deps: deps() });
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("Gmail refusing (quota) puts the lead back and stops; it goes out on a later pass", async () => {
    await lead("Gamma Studio", "gamma@studio.in");
    t += 60_000;
    fail = "Daily user sending quota exceeded";
    const r = await sendAutoEmails(userId, { until: t + 200_000, deps: deps() });
    expect(r.sent).toBe(0);
    expect(r.stopped).toMatch(/Gmail refused: Daily user sending quota exceeded/);
    const g = await getDb().darwinLead.findFirst({ where: { userId, businessName: "Gamma Studio" }, include: { messages: true } });
    expect(g?.stage).toBe("new");
    expect(g?.messages).toHaveLength(0);
    fail = null;
    expect((await sendAutoEmails(userId, { until: t + 200_000, deps: deps() })).sent).toBe(1);
  });

  it("never more than the daily cap in 24 hours, and stops when this call's time is up", async () => {
    for (const n of ["Delta", "Epsilon", "Zeta"]) await lead(`${n} Clinic`, `${n.toLowerCase()}@clinic.in`);
    t += 60_000;
    // 3 sent in the last 24 h already (cap 3) → none now
    const capped = await sendAutoEmails(userId, { until: t + 400_000, deps: deps() });
    expect(capped.sent).toBe(0);
    expect(capped.stopped).toMatch(/limit of 3/);
    // a day later: room again, but only ~1 minute left in this call → one send, the rest wait
    t += 25 * 3_600_000;
    const short = await sendAutoEmails(userId, { until: t + 70_000, deps: deps() });
    expect(short.sent).toBe(1);
    expect(short.waiting).toBe(2);
  });

  it("the scheduled daily job sends them by itself (no DARWIN open)", async () => {
    await lead("Eta Yoga", "eta@yoga.in");
    t += 25 * 3_600_000;
    const { runDarwinDaily } = await import("@/lib/darwin/daily/run");
    const early = new Date("2026-10-01T22:00:00Z"); // 03:30 IST — before the search starts
    const r = await runDarwinDaily({
      userIds: [userId], budgetMs: 240_000,
      deps: { now: () => early } as never,
      emailDeps: deps(),
    });
    expect(r.results[0]).toMatchObject({ status: "not_started", emailed: 3 });
    expect(sent.slice(-3).map((x) => x.to).sort()).toEqual(["delta@clinic.in", "epsilon@clinic.in", "eta@yoga.in"]);
  });
});
