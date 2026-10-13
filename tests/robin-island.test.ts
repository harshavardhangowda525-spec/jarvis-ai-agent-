import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import type { IslandReply } from "@/lib/robin/island-types";

const d = isDbConfigured ? describe : describe.skip;

d("RUBEN's island — spoken commands drive the real CRM", () => {
  let userId = "";
  let I: typeof import("@/lib/robin/island");
  const asked: { text: string; ctx: string | null }[] = [];
  const deps = { ask: async (_u: string, text: string, ctx: string | null) => { asked.push({ text, ctx }); return { text: `Pitch for ${ctx?.split(",")[0]}: a fast mobile site with online booking.` }; } };
  const say = (text: string, extra: { leadId?: string | null; pending?: IslandReply["pending"] } = {}) => I.runIslandCommand(userId, { text, ...extra }, deps);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    I = await import("@/lib/robin/island");
    const crm = await import("@/lib/robin/crm");
    userId = (await getDb().user.create({ data: { email: `island-${Date.now()}@example.com`, passwordHash: "x", profile: { create: { timezone: "Asia/Kolkata" } } } })).id;
    for (const [name, phone] of [["Brew House Cafe", "+91 98450 71001"], ["Iron Den Gym", "+91 98450 71002"], ["Glow Salon", "+91 98450 71003"]] as const) {
      ids[name] = (await crm.createLead(userId, { businessName: name, phone, city: "Bengaluru" }, "user")).lead.id;
    }
    await crm.moveStage(userId, ids["Brew House Cafe"], "interested", { source: "user" });
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }); });

  it('"Open CRM" opens the pop-up; "Close CRM" collapses it (no data promised)', async () => {
    expect(await say("Open CRM")).toMatchObject({ open: true, card: null });
    expect(await say("Close CRM.")).toMatchObject({ open: false });
  });

  it('"Show my interested prospects" lists only interested leads, from the database', async () => {
    const r = await say("Show my interested prospects");
    expect(r.card).toMatchObject({ type: "leads", title: "Interested (follow up)" });
    expect((r.card as { leads: { name: string }[] }).leads.map((l) => l.name)).toEqual(["Brew House Cafe"]);
  });

  it('"Find leads ready to purchase" — none yet, said plainly; then mark one and it appears', async () => {
    expect((await say("Find leads ready to purchase")).card).toMatchObject({ type: "text", text: "No leads are marked ready to purchase." });
    const open = await say("Open Iron Den Gym");
    expect(open.card).toMatchObject({ type: "lead", lead: { name: "Iron Den Gym", phone: "+91 98450 71002" } });
    expect(open.leadId).toBe(ids["Iron Den Gym"]);
    const mark = await say("Mark this lead as ready to purchase", { leadId: open.leadId });
    expect(mark.card).toMatchObject({ type: "done", text: "Iron Den Gym → Ready to purchase." });
    expect((await getDb().robinLead.findUniqueOrThrow({ where: { id: ids["Iron Den Gym"] } })).stage).toBe("ready_to_purchase");
    expect((await say("Which leads are ready to buy?")).card).toMatchObject({ type: "leads", leads: [{ name: "Iron Den Gym" }] });
  });

  it('"Mark this lead as interested" changes the open lead; "open the details for this business" shows it', async () => {
    const r = await say("Mark this lead as interested", { leadId: ids["Glow Salon"] });
    expect(r.card).toMatchObject({ type: "done" });
    expect((await getDb().robinLead.findUniqueOrThrow({ where: { id: ids["Glow Salon"] } })).stage).toBe("interested");
    expect((await say("Open the details for this business", { leadId: ids["Glow Salon"] })).card).toMatchObject({ type: "lead", lead: { name: "Glow Salon", stageLabel: "Interested" } });
  });

  it("a decision (won / rejected) waits for yes — and no means no change", async () => {
    const ask = await say("Mark Glow Salon as lost");
    expect(ask.card).toMatchObject({ type: "confirm" });
    expect(ask.pending).toMatchObject({ kind: "move", leadId: ids["Glow Salon"], stage: "lost" });
    expect((await getDb().robinLead.findUniqueOrThrow({ where: { id: ids["Glow Salon"] } })).stage).toBe("interested"); // not yet
    expect((await say("no", { pending: ask.pending })).card).toMatchObject({ type: "done", text: "Nothing changed for Glow Salon." });
    expect((await getDb().robinLead.findUniqueOrThrow({ where: { id: ids["Glow Salon"] } })).stage).toBe("interested");
    const yes = await say("yes", { pending: ask.pending });
    expect(yes.card).toMatchObject({ type: "done", text: "Glow Salon → Rejected." });
    expect((await getDb().robinLead.findUniqueOrThrow({ where: { id: ids["Glow Salon"] } })).stage).toBe("lost");
  });

  it('"Schedule a follow-up for tomorrow" for the open lead → a real follow-up; "which clients need follow-up today?" reads the queue', async () => {
    const r = await say("Schedule a follow-up for tomorrow at 11am", { leadId: ids["Brew House Cafe"] });
    expect(r.card).toMatchObject({ type: "done" });
    const f = await getDb().robinFollowUp.findFirstOrThrow({ where: { userId, leadId: ids["Brew House Cafe"], status: "pending" } });
    expect(f.dueAt.getTime()).toBeGreaterThan(Date.now());
    const today = await say("Which clients need follow-up today?");
    expect(today.card).toMatchObject({ type: "text", text: "No follow-ups due today." }); // it's tomorrow
    expect((await say("Find clients who need follow-up")).card).toMatchObject({ type: "text", text: "No follow-ups due today." }); // same queue
    const all = await say("show my follow-ups");
    expect(all.card).toMatchObject({ type: "followups", items: [{ name: "Brew House Cafe" }] });
  });

  it("a lead that doesn't exist, or 'this lead' with none open, says so — nothing invented", async () => {
    expect((await say("Open Moonlight Bakery")).card).toMatchObject({ type: "error", text: 'No lead matches "Moonlight Bakery".' });
    expect((await say("Mark this lead as interested")).card).toMatchObject({ type: "error" });
  });

  it('"Prepare a pitch for this gym" goes to RUBIN\'s brain with the open lead as context', async () => {
    const r = await say("Prepare a pitch for this gym", { leadId: ids["Iron Den Gym"] });
    expect(asked.at(-1)!.ctx).toMatch(/^Iron Den Gym/);
    expect(r.card).toMatchObject({ type: "text", text: expect.stringMatching(/^Pitch for Iron Den Gym/) });
  });

  it('"Summarize today\'s client interactions" reads today\'s real interactions', async () => {
    expect((await say("Summarize today's client interactions")).card).toMatchObject({ type: "text", text: "No client interactions logged today." });
    const { logInteraction } = await import("@/lib/robin/engage");
    await logInteraction(userId, ids["Brew House Cafe"], { channel: "call", outcome: "interested", notes: "wants online menu" }, "user");
    const r = await say("Summarize today's client interactions");
    expect(r.card).toMatchObject({ type: "text", title: "Today · 1 interaction" });
    expect((r.card as { text: string }).text).toMatch(/Brew House Cafe — call, interested: wants online menu/);
  });

  it("due follow-ups surface as island notices", async () => {
    await getDb().robinFollowUp.create({ data: { userId, leadId: ids["Iron Den Gym"], dueAt: new Date(Date.now() - 30_000), action: "call" } });
    const n = await I.islandNotices(userId, new Date(Date.now() - 120_000));
    expect(n.map((x) => x.text)).toEqual([expect.stringMatching(/^FOLLOW-UP · Iron Den Gym/)]);
  });
});
