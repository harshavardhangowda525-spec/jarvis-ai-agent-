import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";

/**
 * The full journey, on the real database:
 * DARWIN finds a business → it appears in ROBIN → duplicate detection → Robin
 * qualifies it → it's in the CRM → you contact it → the interaction is logged →
 * a follow-up is created and shows on the dashboard → demo → quotation (PDF) →
 * accepted → lead becomes a client → revenue appears in analytics.
 */
const d = isDbConfigured ? describe : describe.skip;

d("ROBIN: Darwin lead → client (integration)", () => {
  let userId = "";
  let darwinId = "";
  let leadId = "";
  let quoteId = "";
  const db = () => getDb();
  let crm: typeof import("@/lib/robin/crm");
  let sync: typeof import("@/lib/robin/darwin-sync");
  let engage: typeof import("@/lib/robin/engage");
  let quotes: typeof import("@/lib/robin/quotes");
  let clients: typeof import("@/lib/robin/clients");
  let overview: typeof import("@/lib/robin/overview");
  let analytics: typeof import("@/lib/robin/analytics");
  let briefing: typeof import("@/lib/robin/briefing");

  beforeAll(async () => {
    [crm, sync, engage, quotes, clients, overview, analytics, briefing] = await Promise.all([
      import("@/lib/robin/crm"), import("@/lib/robin/darwin-sync"), import("@/lib/robin/engage"), import("@/lib/robin/quotes"),
      import("@/lib/robin/clients"), import("@/lib/robin/overview"), import("@/lib/robin/analytics"), import("@/lib/robin/briefing"),
    ]);
    userId = (await db().user.create({ data: { email: `robin-${Date.now()}@example.com`, passwordHash: "x", profile: { create: { timezone: "Asia/Kolkata" } } } })).id;
  });
  afterAll(async () => { await db().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("1–5 · DARWIN finds a business; it appears in Robin, qualified, once", async () => {
    // what DARWIN's daily search saves for a verified no-website business
    const dl = await db().darwinLead.create({ data: {
      userId, businessName: "ABC Café", category: "Cafe", location: "12 MG Road, Indiranagar, Bengaluru, Karnataka", phone: "+91 98450 11111",
      instagram: "https://instagram.com/abccafe", source: "geoapify", fingerprint: "abc-fp", opportunityType: "no_website", leadScore: 78,
      latitude: 12.97, longitude: 77.64, metadata: { search: { location: "Indiranagar, Bengaluru" }, google: { mapsUri: "https://maps.google.com/?cid=42", rating: 4.5, reviews: 62 } },
    } });
    darwinId = dl.id;
    // the same business found again by another DARWIN search (different record, same phone)
    await db().darwinLead.create({ data: { userId, businessName: "ABC Cafe", category: "Cafe", location: "MG Road, Bengaluru", phone: "098450 11111", source: "geoapify", fingerprint: "abc-fp-2", opportunityType: "no_website" } });

    const r = await sync.syncFromDarwin(userId);
    expect(r).toMatchObject({ imported: 1, duplicates: 1, names: ["ABC Café"] });
    const leads = await db().robinLead.findMany({ where: { userId } });
    expect(leads).toHaveLength(1); // duplicate detection: one CRM record
    const lead = leads[0];
    leadId = lead.id;
    expect(lead).toMatchObject({ darwinLeadId: darwinId, businessName: "ABC Café", websiteStatus: "no_website", city: "Indiranagar, Bengaluru", mapsUrl: "https://maps.google.com/?cid=42", reviews: 62 });
    expect(lead.darwinAliases).toHaveLength(1);
    // qualification: transparent reasons, a priority, and it entered the pipeline as QUALIFIED
    expect(lead.priority).toBe("high");
    expect(lead.stage).toBe("qualified");
    const reasons = (lead.reasons as { label: string }[]).map((x) => x.label);
    expect(reasons).toEqual(expect.arrayContaining(["No website", "Mobile number available", "Instagram profile listed", "Local business", "Website service appears relevant"]));
    expect((await import("@/lib/robin/qualify")).explain({ priority: "high", reasons: lead.reasons as never })).toMatch(/^High Priority because:\n• No website/);
    // the hand-over is announced, and syncing again changes nothing
    const n = await db().robinNotification.findFirst({ where: { userId, kind: "darwin_import" } });
    expect(n?.title).toBe("1 new lead received from Darwin");
    expect(await sync.syncFromDarwin(userId)).toMatchObject({ imported: 0, duplicates: 0 });
    // stage history recorded from the start
    const hist = await db().robinStageChange.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } });
    expect(hist.map((h) => [h.fromStage, h.toStage, h.source])).toEqual([[null, "new", "darwin"], ["new", "qualified", "robin"]]);
    // on the chart
    const ov = await overview.robinOverview(userId);
    expect(ov.nodes.find((n) => n.id === "qualified")?.leads.map((l) => l.name)).toEqual(["ABC Café"]);
    expect(ov.counts).toMatchObject({ total: 1, qualified: 1 });
    // the command center's side panels
    expect(ov.dash).toMatchObject({ qualifiedToday: 1, activeConversations: 0, proposals: 0, conversion: { value: 0, won: 0, total: 1 }, followUpRate: { value: null, done: 0, due: 0 } });
  });

  it("6–9 · you call; the call is logged; a follow-up is created and shows on the dashboard", async () => {
    const tomorrow4pm = new Date(Date.now() + 86_400_000);
    const r = await engage.logInteraction(userId, leadId, { channel: "call", outcome: "interested", notes: "Owner wants an online menu", followUp: { dueAt: tomorrow4pm, action: "call" } }, "user");
    expect(r.interaction).toMatchObject({ channel: "call", outcome: "interested", status: "logged" });
    // contacted → interested → follow-up (forward only), each change in the history
    const stages = (await db().robinStageChange.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } })).map((h) => h.toStage);
    expect(stages).toEqual(["new", "qualified", "contacted", "interested", "follow_up"]);
    expect(r.lead.lastContactAt).not.toBeNull();
    expect(r.followUp?.status).toBe("pending");
    // due now → it's on the dashboard as due today
    await db().robinFollowUp.update({ where: { id: r.followUp!.id }, data: { dueAt: new Date(Date.now() + 60_000) } });
    await db().robinLead.update({ where: { id: leadId }, data: { nextFollowUpAt: new Date(Date.now() + 60_000) } });
    const ov = await overview.robinOverview(userId);
    expect(ov.today.followUps).toBe(1);
    // you talked to them → an active conversation; the due follow-up is a pending action
    expect(ov.dash.activeConversations).toBe(1);
    expect(ov.dash.pending).toMatchObject({ dueToday: 1, total: 1 });
    expect(ov.nodes.find((n) => n.id === "follow_up")?.leads[0]).toMatchObject({ name: "ABC Café", flag: "today" });
    expect(ov.next).toMatchObject({ name: "ABC Café", text: "Follow up today", why: "it's due today" });
    const q = await engage.followUpQueue(userId);
    expect(q.today).toHaveLength(1);
    await engage.completeFollowUp(userId, r.followUp!.id);
    expect((await db().robinLead.findUnique({ where: { id: leadId } }))?.nextFollowUpAt).toBeNull();
  });

  it("10 · a demo is scheduled (and announced once, 30 minutes before)", async () => {
    const at = new Date(Date.now() + 20 * 60_000);
    const demo = await engage.scheduleDemo(userId, leadId, { at, demoType: "online" }, "user");
    expect((await db().robinLead.findUnique({ where: { id: leadId } }))?.stage).toBe("demo_scheduled");
    const rem = await engage.demoReminders(userId);
    expect(rem[0].text).toMatch(/^Your demo with ABC Café starts in (19|20) minutes\.$/);
    expect(await engage.demoReminders(userId)).toHaveLength(0); // once
    await engage.updateDemo(userId, demo.id, { status: "completed" }, "user");
    expect((await db().robinLead.findUnique({ where: { id: leadId } }))?.stage).toBe("demo_completed");
  });

  it("11 · a quotation is generated from YOUR prices, with a real PDF", async () => {
    // no price set anywhere → Robin refuses rather than inventing one
    await expect(quotes.createQuotation(userId, leadId, { items: [{ service: "Website" }] }, "user")).rejects.toThrow(/No price for "Website"/);
    await db().robinService.update({ where: { userId_name: { userId, name: "Website" } }, data: { price: 40000 } });
    const q = await quotes.createQuotation(userId, leadId, { items: [{ service: "Website" }, { service: "Hosting", unitPrice: 5000 }], discount: 5000 }, "user");
    quoteId = q.id;
    expect(q).toMatchObject({ subtotal: 45000, discount: 5000, taxPct: 18, taxAmount: 7200, total: 47200, status: "draft" });
    expect(q.number).toMatch(/^Q-\d{6}-001$/);
    const pdf = await quotes.renderQuotationPdf(userId, q.id);
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.bytes.length).toBeGreaterThan(5000);
    // emailing needs your confirmation first
    await expect(quotes.sendQuotation(userId, q.id, { via: "gmail", to: "owner@abccafe.in" }, "user")).rejects.toThrow(/Ready to email/);
    await quotes.sendQuotation(userId, q.id, { via: "manual" }, "user");
    expect((await db().robinLead.findUnique({ where: { id: leadId } }))).toMatchObject({ stage: "quotation_sent", potentialValue: 47200 });
  });

  it("12–13 · accepted (with your confirmation) → converted into a client, history intact", async () => {
    await expect(quotes.decideQuotation(userId, quoteId, "accepted", {}, "user")).rejects.toThrow(/Mark quotation .* as accepted/);
    const r = await quotes.decideQuotation(userId, quoteId, "accepted", { confirm: true }, "user");
    expect(r.convertSuggested).toBe(true);
    // Robin never marks a lead WON on its own
    await expect(crm.moveStage(userId, leadId, "won", { source: "voice" })).rejects.toThrow(/needs your confirmation/);
    await expect(clients.convertToClient(userId, leadId, {}, "user")).rejects.toThrow(/Convert ABC Café into a client \(₹47,200\)\?/);
    const c = await clients.convertToClient(userId, leadId, { confirm: true }, "user");
    expect(c.client).toMatchObject({ businessName: "ABC Café", amount: 47200, status: "active", paymentStatus: "unpaid", project: "Website + Hosting" });
    expect((await db().robinLead.findUnique({ where: { id: leadId } }))?.stage).toBe("won");
    await clients.addPayment(userId, c.client.id, { amount: 23600, method: "UPI" }, "user");
    expect((await db().robinClient.findUnique({ where: { id: c.client.id } }))?.paymentStatus).toBe("partial");
    // the whole history stays with it
    const lead = await db().robinLead.findUnique({ where: { id: leadId }, include: { interactions: true, followUps: true, demos: true, quotations: true, stageChanges: true, activities: true } });
    expect(lead!.interactions.length).toBeGreaterThanOrEqual(1);
    expect(lead!.followUps).toHaveLength(1);
    expect(lead!.demos).toHaveLength(1);
    expect(lead!.quotations).toHaveLength(1);
    expect(lead!.stageChanges.at(-1)?.toStage).toBe("won");
    expect(await db().robinAudit.count({ where: { userId, action: "client_converted" } })).toBe(1);
  });

  it("14 · revenue appears in analytics and the dashboard", async () => {
    const a = await analytics.robinAnalytics(userId, "7d");
    expect(a.totals).toMatchObject({ leads: 1, won: 1, revenue: 47200, received: 23600, avgDeal: 47200 });
    expect(a.rates.conversion).toEqual({ value: 100, num: 1, den: 1 });
    expect(a.rates.contact.value).toBe(100);
    expect(a.funnel.find((f) => f.id === "won")?.count).toBe(1);
    expect(a.revenueSeries.won.reduce((s, v) => s + v, 0)).toBe(47200);
    expect(a.activity.calls.reduce((s, v) => s + v, 0)).toBe(1);
    expect(a.sources).toEqual([{ label: "darwin", count: 1 }]);
    const ov = await overview.robinOverview(userId);
    expect(ov.counts).toMatchObject({ won: 1, revenueWon: 47200, clients: 1 });
    expect(ov.nodes.find((n) => n.id === "won")?.value).toBe(47200);
    expect(ov.dash.conversion).toEqual({ value: 100, won: 1, total: 1 });
    expect(ov.dash.activeConversations).toBe(0); // won — no longer an open conversation
    // the eight stages, in the order they sit on the arc; the funnel follows the real journey
    expect(ov.nodes.map((n) => n.label)).toEqual(["NEW CONTACT", "CONTACTED", "QUALIFIED", "INTERESTED", "FOLLOW-UP", "PROPOSAL SENT", "WON", "REJECTED"]);
    expect(ov.funnel.map((f) => f.id)).toEqual(["new", "qualified", "contacted", "interested", "follow_up", "proposal", "won", "lost"]);
    const b = await briefing.robinBriefing(userId);
    expect(b.newFromDarwin).toBe(1);
    expect(b.text).toMatch(/1 new lead arrived from Darwin\./);
  });

  it("voice-style lookups validate the target before anything changes", async () => {
    expect((await crm.findLeadsByName(userId, "abc cafe")).map((l) => l.businessName)).toEqual(["ABC Café"]);
    await expect(crm.resolveLead(userId, "Zeta Salon")).rejects.toThrow(/couldn't find "Zeta Salon"/);
    await crm.createLead(userId, { businessName: "ABC Bakery", phone: "+91 90000 12345", city: "Mysuru", websiteStatus: "no_website" }, "user");
    await expect(crm.resolveLead(userId, "ABC")).rejects.toThrow(/I found 2 matches for "ABC"/);
  });

  it("every lead has its own number; you can name it by number, and follow-up notes are kept", async () => {
    // numbers follow on in order — also when several leads arrive at the same moment
    const first = (await db().robinLead.findMany({ where: { userId }, orderBy: { number: "asc" }, select: { number: true } })).map((l) => l.number);
    expect(first).toEqual(first.map((_, i) => i + 1));
    const made = await Promise.all(["Brew House", "Iron Den Gym", "Dosa Corner", "Kettle Cafe", "Pulse Fitness"].map((n, i) => crm.createLead(userId, { businessName: n, phone: `+91 98450 7${String(1000 + i).padStart(4, "0")}`, city: "Bengaluru" }, "user")));
    const nums = made.map((m) => m.lead.number!).sort((a, b) => a - b);
    expect(nums).toEqual(nums.map((_, i) => first.length + 1 + i));
    // name it by number
    const brew = made[0].lead;
    expect((await crm.resolveLead(userId, String(brew.number))).id).toBe(brew.id);
    expect((await crm.resolveLead(userId, `lead ${brew.number}`)).businessName).toBe("Brew House");
    expect((await crm.resolveLead(userId, `#${brew.number}`)).id).toBe(brew.id);
    await expect(crm.resolveLead(userId, "lead 999")).rejects.toThrow(/There's no lead number 999/);
    // a follow-up with its note; a later note joins it; done with a note
    const due = new Date(Date.now() + 2 * 3_600_000);
    const fu = await engage.scheduleFollowUp(userId, brew.id, { dueAt: due, notes: "wants an online menu" }, "voice");
    const added = await engage.addFollowUpNote(userId, { leadId: brew.id, text: "owner prefers WhatsApp" }, "voice");
    expect(added).toMatchObject({ on: "followup", lead: { number: brew.number, businessName: "Brew House" } });
    const q = await engage.followUpQueue(userId);
    const row = [...q.today, ...q.upcoming].find((f) => f.id === fu.id)!;
    expect(row.lead.number).toBe(brew.number);
    expect(row.notes).toBe("wants an online menu\nowner prefers WhatsApp");
    const { followUpBreakdown } = await import("@/lib/robin/numbers");
    expect(followUpBreakdown(q)).toContain(`lead ${brew.number}, Brew House — call,`);
    expect(followUpBreakdown(q)).toContain("Note: wants an online menu; owner prefers WhatsApp.");
    await engage.completeFollowUp(userId, fu.id, { notes: "sent the price list" }, "voice");
    expect((await db().robinFollowUp.findUnique({ where: { id: fu.id } }))?.notes).toBe("wants an online menu\nowner prefers WhatsApp\nDone: sent the price list");
    // no follow-up scheduled → the note goes on the lead itself
    const onLead = await engage.addFollowUpNote(userId, { leadId: brew.id, text: "call after 6 pm" }, "voice");
    expect(onLead.on).toBe("lead");
    expect((await db().robinLead.findUnique({ where: { id: brew.id } }))?.notes).toMatch(/\d{4}-\d{2}-\d{2}: call after 6 pm$/);
    // cards on the chart carry the number
    const ov = await overview.robinOverview(userId);
    expect(ov.nodes.flatMap((n) => n.leads).find((l) => l.id === brew.id)?.number).toBe(brew.number);
  });
});
