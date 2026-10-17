import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { guessMapping, guessStatus, parseCsv, parseDate } from "@/lib/crm/csv";
import { getDb, isDbConfigured } from "@/lib/db";

describe("CSV import parsing", () => {
  it("reads quotes, commas and newlines inside quotes, CRLF, BOM and ; separators", () => {
    expect(parseCsv('﻿name,notes\r\n"Cafe, Ltd","said ""call me""\nlater"\r\n')).toEqual([["name", "notes"], ["Cafe, Ltd", 'said "call me"\nlater']]);
    expect(parseCsv("name;phone\nA;123\n")).toEqual([["name", "phone"], ["A", "123"]]);
  });

  it("recognises the usual column names (Supabase / Lovable exports included)", () => {
    const m = guessMapping(["id", "business_name", "phone_number", "Email", "instagram_handle", "Status", "next_follow_up", "notes", "created_at"]);
    expect(m).toMatchObject({ externalRef: 0, businessName: 1, phone: 2, email: 3, instagram: 4, status: 5, followUp: 6, notes: 7 });
  });

  it("maps status words only when clear, otherwise leaves them for you", () => {
    expect(guessStatus("Contacted")).toBe("contacted");
    expect(guessStatus("no answer")).toBe("contacted");
    expect(guessStatus("Interested - call back")).toBe("interested");
    expect(guessStatus("Demo booked")).toBe("demo");
    expect(guessStatus("Not Interested")).toBe("rejected");
    expect(guessStatus("Closed Won")).toBe("converted");
    expect(guessStatus("Purple")).toBeNull();
  });

  it("reads Indian day-first dates", () => {
    expect(parseDate("17/10/2026")?.getMonth()).toBe(9);
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("2026-10-17T10:00:00Z")?.toISOString()).toBe("2026-10-17T10:00:00.000Z");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("CSV import into DARWIN's CRM (integration)", () => {
  let userId = "";
  let I: typeof import("@/lib/crm/import");
  const csv = [
    "id,business_name,phone,status,next_follow_up,notes",
    "a1,Iron Temple Gym,+91 98450 11111,Contacted,20/10/2099,owner busy",
    "a2,Spice Route,+91 98450 22222,Interested,,wants menu site",
    "a3,Purple Salon,+91 98450 33333,Purple,,",
    "a4,,+91 98450 44444,Contacted,,no name",
    "a5,Brew Lab,,Not interested,,",
  ].join("\n");

  beforeAll(async () => {
    I = await import("@/lib/crm/import");
    const db = getDb();
    const u = await db.user.create({ data: { email: `imp-${Date.now()}@example.com`, passwordHash: "x", profile: { create: { timezone: "Asia/Kolkata" } } } });
    userId = u.id;
    // already in the CRM — must be reported, never overwritten
    await db.robinLead.create({ data: { userId, businessName: "Brew Lab", fingerprint: "brew lab|", source: "manual", notes: "keep me" } });
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("previews: mapping, statuses to decide, duplicates, rows without a name", async () => {
    const p = await I.previewImport(userId, csv, { sourceLabel: "Lovable" });
    expect(p.rows).toBe(5);
    expect(p.unresolvedStatuses).toEqual(["Purple"]);
    expect(p.missingName).toEqual([5]);
    expect(p.duplicates.map((x) => x.name)).toEqual(["Brew Lab"]);
    expect(p.ready).toBe(3);
  });

  it("imports a sample, then the rest — contacted stays contacted, no duplicates, nothing overwritten", async () => {
    const db = getDb();
    const sample = await I.commitImport(userId, csv, { sourceLabel: "Lovable", limit: 1 });
    expect(sample.created).toBe(1);
    const rest = await I.commitImport(userId, csv, { sourceLabel: "Lovable", statusMap: { Purple: "contacted" } });
    expect(rest.created).toBe(2);
    expect(rest.alreadyImported).toBe(1);
    expect(rest.duplicates.map((x) => x.name)).toEqual(["Brew Lab"]);
    const again = await I.commitImport(userId, csv, { sourceLabel: "Lovable" });
    expect(again.created).toBe(0);

    const leads = await db.robinLead.findMany({ where: { userId }, orderBy: { businessName: "asc" } });
    const by = Object.fromEntries(leads.map((l) => [l.businessName, l]));
    expect(by["Iron Temple Gym"].stage).toBe("contacted");
    expect(by["Iron Temple Gym"].nextFollowUpAt?.getUTCFullYear()).toBe(2099);
    expect(by["Spice Route"].stage).toBe("interested");
    expect(by["Spice Route"].notes).toContain("wants menu site");
    expect(by["Purple Salon"].stage).toBe("contacted");
    expect(by["Brew Lab"].notes).toBe("keep me");
    expect(leads).toHaveLength(4);
    expect(await db.crmBackup.count({ where: { userId, reason: "before_import" } })).toBeGreaterThanOrEqual(2);
  });
});
