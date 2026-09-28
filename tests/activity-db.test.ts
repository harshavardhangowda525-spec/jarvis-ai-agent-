import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.hoisted(() => { process.env.CRON_SECRET = "cron-test-secret"; });
import { getDb, isDbConfigured } from "@/lib/db";
import { yesterdayIn } from "@/lib/activity/dates";

const d = isDbConfigured ? describe : describe.skip;
const TZ = "Asia/Kolkata";

d("activity history (integration)", () => {
  let userId = "", otherId = "";
  let A: typeof import("@/lib/activity/record");
  let S: typeof import("@/lib/briefing/server");
  let T: typeof import("@/lib/tools/activity");
  const ctx = () => ({ userId, timezone: TZ, activity: () => {} });

  beforeAll(async () => {
    A = await import("@/lib/activity/record");
    S = await import("@/lib/briefing/server");
    T = await import("@/lib/tools/activity");
    const db = getDb();
    const u = await db.user.create({ data: { email: `act-${Date.now()}@example.com`, passwordHash: "x", profile: { create: { timezone: TZ, displayName: "Harsha" } } } });
    const o = await db.user.create({ data: { email: `act2-${Date.now()}@example.com`, passwordHash: "x" } });
    userId = u.id; otherId = o.id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: { in: [userId, otherId] } } }).catch(() => {}); });

  const yesterdayAt = (hIst: number) => {
    const y = yesterdayIn(TZ);
    const [Y, M, D] = y.split("-").map(Number);
    return new Date(Date.UTC(Y, M - 1, D, hIst) - 5.5 * 3600_000);
  };

  it("stores events with the user's local date, secrets redacted, repeats dropped", async () => {
    const at = yesterdayAt(23);
    const id = await A.recordActivity(userId, { category: "command", agent: "jarvis", source: "chat", action: "set my groq key to gsk_abcdefghijklmnopqrstuvwxyz0123", at });
    const again = await A.recordActivity(userId, { category: "command", agent: "jarvis", source: "chat", action: "set my groq key to gsk_abcdefghijklmnopqrstuvwxyz0123", at });
    expect(again).toBe(id);
    const row = await getDb().activityEvent.findUnique({ where: { id: id! } });
    expect(row!.action).not.toContain("gsk_");
    expect(row!.agent).toBe("JARVIS");
    expect(row!.date).toBe(yesterdayIn(TZ)); // 23:00 IST is still "yesterday" there, though it's a different UTC date
    await getDb().activityEvent.delete({ where: { id: id! } });
  });

  it("builds yesterday's briefing from real rows and stores the daily summary", async () => {
    const db = getDb();
    await A.recordActivity(userId, { category: "business", agent: "DARWIN", source: "darwin", action: "Discovered 12 new gym leads near Bengaluru via Geoapify.", status: "success", importance: 3, project: "DARWIN", metadata: { type: "discovered", count: 12 }, at: yesterdayAt(10) });
    await A.recordActivity(userId, { category: "development", agent: "ULTRON", source: "client", action: "ULTRON completed: portfolio site", status: "success", importance: 3, project: "ULTRON", at: yesterdayAt(18) });
    await db.task.create({ data: { userId, title: "Fix login bug", status: "done", completedAt: yesterdayAt(12), createdAt: yesterdayAt(9) } });
    await db.task.create({ data: { userId, title: "Send Chai Point quotation", priority: "high", createdAt: yesterdayAt(9) } });
    // today's activity must NOT appear in yesterday's briefing
    await A.recordActivity(userId, { category: "marketing", agent: "EV", source: "tool", action: "Content created: post", status: "success", importance: 3 });

    const y = yesterdayIn(TZ);
    const b = await S.loadBriefing(userId, { from: y, to: y, label: "Yesterday", kind: "day" }, TZ);
    const m = Object.fromEntries(b.metrics.map((x) => [x.key, x.value]));
    expect(m).toMatchObject({ leads: 12, tasksCompleted: 1, tasksRemaining: 1, projects: 2, development: 1 });
    expect(b.agents.find((a) => a.name === "EV")!.status).toBe("inactive");
    expect(b.unfinished).toEqual(["Send Chai Point quotation"]);

    const stored = await db.dailySummary.findUnique({ where: { userId_date: { userId, date: y } } });
    expect(stored!.eventCount).toBe(2);
    expect((stored!.data as { unfinished_tasks: string[] }).unfinished_tasks).toEqual(["Send Chai Point quotation"]);

    // more activity for that day turns up later → the stored summary refreshes
    await A.recordActivity(userId, { category: "communication", agent: "JARVIS", source: "user", action: "Called Iron Temple Gym", status: "success", importance: 3, at: yesterdayAt(20) });
    await S.loadBriefing(userId, { from: y, to: y, label: "Yesterday", kind: "day" }, TZ);
    expect((await db.dailySummary.findUnique({ where: { userId_date: { userId, date: y } } }))!.eventCount).toBe(3);
  });

  it("the activity tool logs, answers history questions and forgets", async () => {
    const tool = T.activityTool;
    const logged = await tool.execute({ action: "log", category: "business", what: "Sent a quotation to Chai Point", outcome: "₹4,999 website" }, ctx());
    expect((logged.data as { logged: boolean }).logged).toBe(true);
    const hist = await tool.execute({ action: "history", phrase: "yesterday" }, ctx());
    const h = hist.data as { metrics: Record<string, number>; briefing: string[] };
    expect(h.metrics["Leads Generated"]).toBe(12);
    expect(h.briefing.join(" ")).toContain("DARWIN found 12 new leads");
    const f = await tool.execute({ action: "forget" }, ctx());
    expect(f.data).toMatchObject({ forgotten: true, event: "Sent a quotation to Chai Point" });
    const f2 = await tool.execute({ action: "forget", match: "iron temple" }, ctx());
    expect(f2.data).toMatchObject({ forgotten: true, event: "Called Iron Temple Gym" });
  });

  it("one user can't forget another user's events", async () => {
    const id = await A.recordActivity(userId, { category: "task", agent: "JARVIS", source: "task", action: "Task created: private", importance: 2 });
    expect(await A.forgetActivity(otherId, id!)).toBe(false);
    expect(await A.forgetActivity(userId, id!)).toBe(true);
  });

  it("the end-of-day job refuses without the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/daily-summary/route");
    expect((await GET(new Request("http://x/api/cron/daily-summary"))).status).toBe(401);
    const ok = await GET(new Request("http://x/api/cron/daily-summary", { headers: { authorization: "Bearer cron-test-secret" } }));
    expect(ok.status).toBe(200);
  });
});
