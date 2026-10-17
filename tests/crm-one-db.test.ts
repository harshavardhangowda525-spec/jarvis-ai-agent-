import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";

const d = isDbConfigured ? describe : describe.skip;

d("one CRM: DARWIN → CRM, backup, clear, restore, dedup memory (integration)", () => {
  let userId = "";
  let B: typeof import("@/lib/crm/backup");
  let S: typeof import("@/lib/robin/darwin-sync");
  let C: typeof import("@/lib/crm/api");

  beforeAll(async () => {
    B = await import("@/lib/crm/backup");
    S = await import("@/lib/robin/darwin-sync");
    C = await import("@/lib/crm/api");
    const db = getDb();
    const u = await db.user.create({ data: { email: `crm1-${Date.now()}@example.com`, passwordHash: "x", profile: { create: { timezone: "Asia/Kolkata" } } } });
    userId = u.id;
    // two businesses DARWIN discovered and verified
    for (const [i, name] of ["Iron Temple Gym", "Spice Route"].entries()) {
      await db.darwinLead.create({ data: {
        userId, businessName: name, category: "Gym", location: `${i} 100 Feet Rd, Indiranagar, Bengaluru`, phone: `+91 98450 1000${i}`,
        source: "geoapify", sourceRef: `place-${i}`, fingerprint: `fp-${i}-${Date.now()}`, stage: "new", verifiedFields: ["businessName", "phone"],
        metadata: { websiteVerification: { status: "no_website", reasons: ["No website in Google or web search"], checkedAt: "2026-10-17T05:00:00.000Z" }, phoneSource: "geoapify" },
      } });
    }
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("every DARWIN lead lands in the one CRM, with its verification evidence", async () => {
    const r = await S.syncFromDarwin(userId);
    expect(r.imported).toBe(2);
    const list = await C.crmList(userId, new URLSearchParams("status=new"));
    expect(list.total).toBe(2);
    expect(list.facets?.status.new).toBe(2);
    const one = await C.crmLead(userId, list.leads[0].id);
    expect((one.lead.evidence as { website: { status: string } }).website.status).toBe("no_website");
    expect(list.leads.every((l) => l.websiteStatus === "no_website")).toBe(true);
  });

  it("search, filters and a confirmed status change go through the CRM's own services", async () => {
    const db = getDb();
    const found = await C.crmList(userId, new URLSearchParams("q=98450 10001"));
    expect(found.leads.map((l) => l.businessName)).toEqual(["Spice Route"]);
    const id = found.leads[0].id;
    await expect(C.crmPatch(userId, id, { status: "rejected" })).rejects.toMatchObject({ code: "needs_confirmation" });
    const r = await C.crmPatch(userId, id, { status: "interested" });
    expect(r.moved).toMatchObject({ changed: true, to: "interested" });
    expect((await C.crmList(userId, new URLSearchParams("status=interested"))).total).toBe(1);
    expect(await db.robinStageChange.count({ where: { leadId: id, toStage: "interested" } })).toBe(1);
  });

  it("clearing needs the confirmed counts, backs up first, keeps touched CRM leads and DARWIN's memory", async () => {
    const db = getDb();
    const p = await B.clearPreview(userId);
    expect(p).toMatchObject({ darwinLeads: 2, untouchedCrmLeads: 1, protectedCrmLeads: 1 });
    // counts that don't match what's there now → nothing deleted
    const stale = await B.clearDarwin(userId, { confirm: true, includeUntouchedCrm: true, expect: { darwinLeads: 5, untouchedCrmLeads: 1 } });
    expect(stale.cleared).toBe(false);
    expect(await db.darwinLead.count({ where: { userId } })).toBe(2);

    const done = await B.clearDarwin(userId, { confirm: true, includeUntouchedCrm: true, expect: { darwinLeads: 2, untouchedCrmLeads: 1 } });
    expect(done).toMatchObject({ cleared: true, removed: { darwinLeads: 2, crmLeads: 1 } });
    expect(await db.darwinLead.count({ where: { userId } })).toBe(0);
    // the lead with history (moved to Interested) is still in the CRM
    expect((await db.robinLead.findMany({ where: { userId } })).map((l) => l.businessName)).toEqual(["Spice Route"]);
    expect(await db.darwinSeen.count({ where: { userId } })).toBe(2);
    const backups = await B.listBackups(userId);
    expect(backups[0]).toMatchObject({ reason: "before_clear", counts: { darwinLead: 2, robinLead: 2 } });
  });

  it("restoring the backup brings back what was removed and never duplicates what exists", async () => {
    const db = getDb();
    const backup = (await B.listBackups(userId)).find((b) => b.reason === "before_clear")!;
    const r = await B.restoreBackup(userId, backup.id);
    expect(r.restored.darwinLead).toBe(2);
    expect(r.restored.robinLead).toBe(1); // only the removed one — Spice Route already existed
    expect(await db.robinLead.count({ where: { userId } })).toBe(2);
    expect(await db.darwinLead.count({ where: { userId } })).toBe(2);
    const file = await B.backupFile(userId, backup.id);
    expect(JSON.parse(file.json).data.robinLead).toHaveLength(2);
  });
});
