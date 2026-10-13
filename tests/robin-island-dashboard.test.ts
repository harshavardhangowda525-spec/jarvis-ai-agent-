import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";

const d = isDbConfigured ? describe : describe.skip;

d("RUBEN's island dashboard — counts, lists, search and lead detail from the database", () => {
  let userId = "";
  let D: typeof import("@/lib/robin/island-dashboard");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    D = await import("@/lib/robin/island-dashboard");
    const crm = await import("@/lib/robin/crm");
    const engage = await import("@/lib/robin/engage");
    userId = (await getDb().user.create({ data: { email: `island-dash-${Date.now()}@example.com`, passwordHash: "x", profile: { create: { timezone: "Asia/Kolkata" } } } })).id;
    const rows = [
      ["Brew House Cafe", "+91 98450 72001", "brewhouse.cafe", null],
      ["Iron Den Gym", "+91 98450 72002", null, "https://instagram.com/irondengym"],
      ["Glow Salon", "+91 98450 72003", null, null],
      ["Lotus Spa", "+91 98450 72004", null, null],
    ] as const;
    for (const [name, phone, website, instagram] of rows) {
      ids[name] = (await crm.createLead(userId, { businessName: name, phone, city: "Bengaluru", website, instagram }, "user")).lead.id;
    }
    await crm.moveStage(userId, ids["Brew House Cafe"], "interested", { source: "user" });
    await crm.moveStage(userId, ids["Iron Den Gym"], "ready_to_purchase", { source: "user" });
    await crm.moveStage(userId, ids["Glow Salon"], "lost", { source: "user", confirm: true });
    await engage.scheduleFollowUp(userId, ids["Brew House Cafe"], { dueAt: new Date(Date.now() - 3600_000), action: "call" }, "user");
    await engage.logInteraction(userId, ids["Iron Den Gym"], { channel: "call", outcome: "interested", notes: "wants a booking site" }, "user");
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }); });

  it("counts the three statuses and open leads exactly", async () => {
    const r = await D.islandDashboard(userId);
    expect(r.counts).toMatchObject({ total: 4, ready: 1, interested: 1, rejected: 1, open: 3, won: 0 });
    expect(r.counts.overdue + r.counts.dueToday).toBe(1);
    expect(r.followups.map((f) => f.name)).toEqual(["Brew House Cafe"]);
    expect(r.pipeline.find((p) => p.id === "lost")!.count).toBe(1);
    expect(r.today).toMatch(/1 interaction logged/);
  });

  it("filters by status and searches names, phones and Instagram", async () => {
    expect((await D.islandDashboard(userId, { status: "ready" })).list.leads.map((l) => l.name)).toEqual(["Iron Den Gym"]);
    expect((await D.islandDashboard(userId, { status: "rejected" })).list.leads.map((l) => l.name)).toEqual(["Glow Salon"]);
    expect((await D.islandDashboard(userId, { status: "all", q: "72004" })).list.leads.map((l) => l.name)).toEqual(["Lotus Spa"]);
    expect((await D.islandDashboard(userId, { status: "all", q: "irondengym" })).list.leads.map((l) => l.name)).toEqual(["Iron Den Gym"]);
    expect((await D.islandDashboard(userId, { status: "all", q: "nothing like this" })).list).toMatchObject({ total: 0, leads: [] });
  });

  it("gives one lead in full: contacts, history, follow-ups — and refuses another user's lead", async () => {
    const l = await D.islandLeadFull(userId, ids["Iron Den Gym"]);
    expect(l).toMatchObject({ name: "Iron Den Gym", stage: "ready_to_purchase", stageLabel: "Ready to purchase", instagram: "https://instagram.com/irondengym", phone: "+91 98450 72002" });
    expect(l.interactions[0]).toMatchObject({ channel: "call", outcome: "interested", notes: "wants a booking site" });
    expect(l.stageHistory[0]).toMatchObject({ to: "Ready to purchase" });
    const other = (await getDb().user.create({ data: { email: `island-dash-other-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    await expect(D.islandLeadFull(other, ids["Iron Den Gym"])).rejects.toThrow();
    await getDb().user.delete({ where: { id: other } });
  });
});
