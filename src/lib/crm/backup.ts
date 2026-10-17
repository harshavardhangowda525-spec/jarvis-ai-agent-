import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/robin/crm";
import { darwinEvidence } from "@/lib/robin/darwin-sync";

/**
 * Backups of the CRM and DARWIN's discovered leads, and the confirmed clearing
 * of DARWIN's records.
 *
 * - A backup is a gzip'd JSON snapshot of every lead table for one user, kept
 *   in the database (CrmBackup) and downloadable as a file.
 * - Restoring re-creates records that are missing; it never overwrites a
 *   record that exists.
 * - Clearing always makes a backup first, needs `confirm: true` with the exact
 *   counts you were shown, keeps the businesses in DARWIN's dedup memory, and
 *   never removes a CRM lead with any contact history.
 */

type Db = PrismaClient;
const VERSION = 1;

/** Tables in restore order (parents before children). */
const TABLES = [
  "darwinLead", "darwinActivity", "darwinFollowUp", "darwinMessage",
  "robinLead", "robinLeadScore", "robinStageChange", "robinActivity", "robinInteraction", "robinFollowUp", "robinDemo",
  "robinQuotation", "robinQuotationItem", "robinClient", "robinPayment",
] as const;
type Table = (typeof TABLES)[number];

async function snapshot(db: Db, userId: string): Promise<Record<Table, unknown[]>> {
  const by = { where: { userId } };
  const [darwinLead, darwinActivity, darwinFollowUp, darwinMessage, robinLead, robinLeadScore, robinStageChange, robinActivity, robinInteraction, robinFollowUp, robinDemo, robinQuotation, robinClient, robinPayment] = await Promise.all([
    db.darwinLead.findMany(by), db.darwinActivity.findMany(by), db.darwinFollowUp.findMany(by), db.darwinMessage.findMany(by),
    db.robinLead.findMany(by), db.robinLeadScore.findMany(by), db.robinStageChange.findMany(by), db.robinActivity.findMany(by),
    db.robinInteraction.findMany(by), db.robinFollowUp.findMany(by), db.robinDemo.findMany(by), db.robinQuotation.findMany(by),
    db.robinClient.findMany(by), db.robinPayment.findMany(by),
  ]);
  const robinQuotationItem = robinQuotation.length ? await db.robinQuotationItem.findMany({ where: { quotationId: { in: robinQuotation.map((q) => q.id) } } }) : [];
  return { darwinLead, darwinActivity, darwinFollowUp, darwinMessage, robinLead, robinLeadScore, robinStageChange, robinActivity, robinInteraction, robinFollowUp, robinDemo, robinQuotation, robinQuotationItem, robinClient, robinPayment };
}

const countsOf = (s: Record<Table, unknown[]>) => Object.fromEntries(TABLES.map((t) => [t, s[t].length])) as Record<Table, number>;

export async function createBackup(userId: string, reason: "manual" | "before_clear" | "before_import" | "before_restore", db: Db = getDb()) {
  const data = await snapshot(db, userId);
  const counts = countsOf(data);
  const gz = gzipSync(Buffer.from(JSON.stringify({ version: VERSION, userId, createdAt: new Date().toISOString(), data })));
  const row = await db.crmBackup.create({ data: { userId, reason, counts, bytes: gz.length, data: gz } });
  // keep the 20 newest: older ones are removed (bounded storage)
  const old = await db.crmBackup.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip: 20, select: { id: true } });
  if (old.length) await db.crmBackup.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  await audit(userId, "crm_backup", "backup", row.id, "user", { reason, counts });
  return { id: row.id, createdAt: row.createdAt.toISOString(), reason, counts, bytes: row.bytes };
}

export async function listBackups(userId: string) {
  const rows = await getDb().crmBackup.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, reason: true, counts: true, bytes: true } });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** The backup as a JSON file (for keeping outside the app). */
export async function backupFile(userId: string, id: string): Promise<{ name: string; json: string }> {
  const r = await getDb().crmBackup.findFirstOrThrow({ where: { id, userId } });
  return { name: `jarvis-crm-backup-${r.createdAt.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`, json: gunzipSync(r.data).toString("utf8") };
}

/** Re-create every record from a backup that is missing now. Existing records are left as they are. */
export async function restoreBackup(userId: string, id: string, db: Db = getDb()) {
  const r = await db.crmBackup.findFirstOrThrow({ where: { id, userId } });
  const parsed = JSON.parse(gunzipSync(r.data).toString("utf8")) as { version: number; userId: string; data: Record<Table, Record<string, unknown>[]> };
  if (parsed.userId !== userId) throw new Error("That backup belongs to another account.");
  const before = await createBackup(userId, "before_restore", db);
  const restored: Partial<Record<Table, number>> = {};
  for (const t of TABLES) {
    const rows = parsed.data[t] ?? [];
    if (!rows.length) continue;
    // createMany + skipDuplicates: only ids that don't exist are written
    const model = (db as unknown as Record<Table, { createMany: (a: { data: unknown[]; skipDuplicates: boolean }) => Promise<{ count: number }> }>)[t];
    const res = await model.createMany({ data: rows, skipDuplicates: true });
    restored[t] = res.count;
  }
  await audit(userId, "crm_restore", "backup", id, "user", { restored, safetyBackup: before.id });
  return { restored, safetyBackupId: before.id };
}

// ---------------- clearing DARWIN's records ----------------

export interface ClearPreview {
  darwinLeads: number;
  darwinFollowUps: number;
  darwinMessages: number;
  /** CRM leads that came from DARWIN and were never touched (no calls, messages, follow-ups, notes, demos, quotes). */
  untouchedCrmLeads: number;
  /** CRM leads with history — never cleared. */
  protectedCrmLeads: number;
  examples: string[];
}

async function untouchedCrmIds(db: Db, userId: string): Promise<{ ids: string[]; protectedCount: number }> {
  const fromDarwin = await db.robinLead.findMany({
    where: { userId, source: "darwin" },
    select: { id: true, stage: true, notes: true, lastContactAt: true, _count: { select: { interactions: true, followUps: true, demos: true, quotations: true } }, client: { select: { id: true } } },
  });
  const ids: string[] = [];
  let protectedCount = 0;
  for (const l of fromDarwin) {
    const touched = !["new", "qualified"].includes(l.stage) || !!l.notes || !!l.lastContactAt || !!l.client
      || l._count.interactions + l._count.followUps + l._count.demos + l._count.quotations > 0;
    if (touched) protectedCount++; else ids.push(l.id);
  }
  return { ids, protectedCount };
}

export async function clearPreview(userId: string, db: Db = getDb()): Promise<ClearPreview> {
  const [darwinLeads, darwinFollowUps, darwinMessages, sample, crm] = await Promise.all([
    db.darwinLead.count({ where: { userId } }), db.darwinFollowUp.count({ where: { userId } }), db.darwinMessage.count({ where: { userId } }),
    db.darwinLead.findMany({ where: { userId }, orderBy: { discoveredAt: "desc" }, take: 5, select: { businessName: true } }),
    untouchedCrmIds(db, userId),
  ]);
  return { darwinLeads, darwinFollowUps, darwinMessages, untouchedCrmLeads: crm.ids.length, protectedCrmLeads: crm.protectedCount, examples: sample.map((s) => s.businessName) };
}

/**
 * Clear DARWIN's discovered-lead records (and, if asked, the untouched CRM
 * leads DARWIN created). `expect` must equal the preview you confirmed — if
 * anything changed since, nothing is deleted.
 */
export async function clearDarwin(userId: string, o: { confirm: boolean; includeUntouchedCrm: boolean; expect: { darwinLeads: number; untouchedCrmLeads: number } }, db: Db = getDb()) {
  if (!o.confirm) throw new Error("Clearing needs your confirmation.");
  const p = await clearPreview(userId, db);
  if (p.darwinLeads !== o.expect.darwinLeads || (o.includeUntouchedCrm && p.untouchedCrmLeads !== o.expect.untouchedCrmLeads)) {
    return { cleared: false as const, reason: "The records changed since you looked — review the new counts and confirm again.", preview: p };
  }
  const backup = await createBackup(userId, "before_clear", db);
  // what DARWIN verified stays with the CRM lead it became
  const darwin = await db.darwinLead.findMany({ where: { userId } });
  for (const d of darwin) {
    await db.robinLead.updateMany({ where: { userId, darwinLeadId: d.id, evidence: { equals: Prisma.DbNull } }, data: { evidence: darwinEvidence(d) as Prisma.InputJsonValue } });
  }
  // remembered, so a cleared business is never "discovered" as new again
  await db.darwinSeen.createMany({ data: darwin.map((d) => ({ userId, fingerprint: d.fingerprint, sourceRef: d.sourceRef })), skipDuplicates: true });
  const { ids } = o.includeUntouchedCrm ? await untouchedCrmIds(db, userId) : { ids: [] as string[] };
  const [leads, crm] = await db.$transaction([
    db.darwinLead.deleteMany({ where: { userId } }), // follow-ups, messages and lead activity cascade
    db.robinLead.deleteMany({ where: { userId, id: { in: ids } } }),
  ]);
  const after = await clearPreview(userId, db);
  await audit(userId, "darwin_cleared", "lead", null, "user", { darwinLeads: leads.count, crmLeads: crm.count, backup: backup.id });
  return { cleared: true as const, removed: { darwinLeads: leads.count, crmLeads: crm.count }, backupId: backup.id, after };
}
