import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { audit, createLead, findDuplicate, logRobin, moveStage } from "@/lib/robin/crm";
import { scheduleFollowUp } from "@/lib/robin/engage";
import { createBackup } from "./backup";
import { guessMapping, guessStatus, IMPORT_FIELDS, parseCsv, parseDate, type ImportField } from "./csv";
import { stageForStatus, isCrmStatus, statusLabel, type CrmStatus } from "./status";

/**
 * Import leads from another CRM (a Lovable/Supabase table export, Google
 * Sheets, Excel → CSV) into DARWIN's CRM.
 *
 * - Preview first: the columns it recognised, the status values and what they
 *   map to (unclear ones are left for you), duplicates of leads you already
 *   have, and rows without a business name.
 * - Then a small sample, then the rest. Every row keeps a stable id
 *   (`externalRef`), so importing the same file twice never duplicates.
 * - An existing business is never overwritten: it's reported and skipped.
 * - Contacted leads stay contacted; nothing is sent to anyone.
 */

export type Mapping = Partial<Record<ImportField, number>>;

export interface ImportOptions {
  mapping?: Mapping;
  /** Your choice for each status value from the file (value → DARWIN status). */
  statusMap?: Record<string, CrmStatus>;
  /** For rows with an empty or unmapped status. Default: contacted (these are leads you've already worked). */
  defaultStatus?: CrmStatus;
  /** Shown as the lead's source, e.g. "lovable". */
  sourceLabel?: string;
}

const clean = (v: string | undefined) => (v ?? "").trim() || null;

/**
 * The same business already in the CRM: phone / email / name + city (the CRM's
 * own check), or — for imports — exactly the same name, even if the city or
 * phone is written differently. Such rows are skipped and listed, never merged.
 */
async function existingFor(userId: string, l: { businessName: string; phone: string | null; email: string | null; city: string | null; address: string | null }) {
  return (await findDuplicate(userId, l))
    ?? (await getDb().robinLead.findFirst({ where: { userId, businessName: { equals: l.businessName.trim(), mode: "insensitive" } } }));
}
const cellOf = (row: string[], m: Mapping, f: ImportField) => (m[f] === undefined ? null : clean(row[m[f]!]));
const sourceId = (label?: string) => `import:${(label || "csv").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "csv"}`;

/** A row's stable id: its own id column, or a hash of its content. */
function refOf(row: string[], m: Mapping): string {
  return cellOf(row, m, "externalRef") ?? createHash("sha256").update(row.map((x) => x.trim().toLowerCase()).join("\u0001")).digest("hex").slice(0, 24);
}

export function readFile(text: string, mapping?: Mapping) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The file has no rows under its header line.");
  const [headers, ...body] = rows;
  if (body.length > 5000) throw new Error(`The file has ${body.length} rows — import up to 5,000 at a time.`);
  return { headers, body, mapping: mapping ?? guessMapping(headers) };
}

export async function previewImport(userId: string, text: string, o: ImportOptions = {}) {
  const { headers, body, mapping } = readFile(text, o.mapping);
  const db = getDb();
  const src = sourceId(o.sourceLabel);
  const already = new Set((await db.robinLead.findMany({ where: { userId, source: src, externalRef: { not: null } }, select: { externalRef: true } })).map((x) => x.externalRef!));

  const statusCounts = new Map<string, number>();
  const missingName: number[] = [];
  const duplicates: { row: number; name: string; existingId: string; existingName: string }[] = [];
  let alreadyImported = 0, ready = 0;
  for (const [i, row] of body.entries()) {
    const name = cellOf(row, mapping, "businessName");
    const st = cellOf(row, mapping, "status") ?? "";
    statusCounts.set(st, (statusCounts.get(st) ?? 0) + 1);
    if (!name) { missingName.push(i + 2); continue; }
    if (already.has(refOf(row, mapping))) { alreadyImported++; continue; }
    const dup = await existingFor(userId, { businessName: name, phone: cellOf(row, mapping, "phone"), email: cellOf(row, mapping, "email"), city: cellOf(row, mapping, "city"), address: cellOf(row, mapping, "address") });
    if (dup) duplicates.push({ row: i + 2, name, existingId: dup.id, existingName: dup.businessName });
    else ready++;
  }
  const statuses = [...statusCounts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => {
    const chosen = o.statusMap?.[value];
    const guess = value ? guessStatus(value) : null;
    return { value, count, guess, mappedTo: chosen ?? guess ?? null };
  });
  return {
    rows: body.length, headers,
    mapping: Object.fromEntries(Object.entries(mapping).map(([f, i]) => [f, { column: i, header: headers[i!] }])),
    unmappedHeaders: headers.filter((_, i) => !Object.values(mapping).includes(i)),
    fields: IMPORT_FIELDS.map((f) => ({ id: f.id, label: f.label })),
    statuses,
    unresolvedStatuses: statuses.filter((s) => s.value && !s.mappedTo).map((s) => s.value),
    defaultStatus: o.defaultStatus ?? "contacted",
    sample: body.slice(0, 5).map((row) => Object.fromEntries(IMPORT_FIELDS.map((f) => [f.id, cellOf(row, mapping, f.id)]))),
    missingName, duplicates, alreadyImported, ready,
  };
}

/**
 * Import. `limit` imports only the first N new rows (the sample test); run it
 * again without a limit for the rest — rows already imported are skipped.
 */
export async function commitImport(userId: string, text: string, o: ImportOptions & { limit?: number } = {}) {
  const { body, mapping } = readFile(text, o.mapping);
  if (mapping.businessName === undefined) throw new Error("Choose which column holds the business name.");
  const db = getDb();
  const src = sourceId(o.sourceLabel);
  const def = isCrmStatus(o.defaultStatus) ? o.defaultStatus : "contacted";
  const backup = await createBackup(userId, "before_import");
  const already = new Set((await db.robinLead.findMany({ where: { userId, source: src, externalRef: { not: null } }, select: { externalRef: true } })).map((x) => x.externalRef!));
  const res = { created: 0, duplicates: [] as { row: number; name: string; existing: string }[], alreadyImported: 0, missingName: 0, errors: [] as { row: number; name: string; error: string }[], createdIds: [] as string[], backupId: backup.id };
  const now = new Date();
  for (const [i, row] of body.entries()) {
    if (o.limit && res.created >= o.limit) break;
    const name = cellOf(row, mapping, "businessName");
    if (!name) { res.missingName++; continue; }
    const ref = refOf(row, mapping);
    if (already.has(ref)) { res.alreadyImported++; continue; }
    const input = {
      businessName: name, phone: cellOf(row, mapping, "phone"), whatsapp: cellOf(row, mapping, "whatsapp"), email: cellOf(row, mapping, "email"),
      website: cellOf(row, mapping, "website"), instagram: cellOf(row, mapping, "instagram"), city: cellOf(row, mapping, "city"),
      address: cellOf(row, mapping, "address"), category: cellOf(row, mapping, "category"),
    };
    try {
      const dup = await existingFor(userId, input);
      if (dup) { res.duplicates.push({ row: i + 2, name, existing: dup.businessName }); continue; }
      const rawStatus = cellOf(row, mapping, "status") ?? "";
      const status: CrmStatus = (rawStatus && (o.statusMap?.[rawStatus] ?? guessStatus(rawStatus))) || def;
      const notes = [cellOf(row, mapping, "notes"), rawStatus && !o.statusMap?.[rawStatus] && !guessStatus(rawStatus) ? `Status in ${o.sourceLabel || "the old CRM"}: ${rawStatus}` : null].filter(Boolean).join("\n") || null;
      const { lead } = await createLead(userId, {
        ...input, notes, externalRef: ref, source: src,
        websiteStatus: input.website ? "has_website" : "unknown",
      }, "user");
      already.add(ref);
      const lastContact = parseDate(cellOf(row, mapping, "lastContact") ?? "");
      if (lastContact) await db.robinLead.update({ where: { id: lead.id }, data: { lastContactAt: lastContact } });
      // a follow-up you had planned stays planned (reminders go to you, never to the lead)
      const fu = parseDate(cellOf(row, mapping, "followUp") ?? "");
      if (fu && status !== "rejected" && status !== "converted") await scheduleFollowUp(userId, lead.id, { dueAt: fu, action: "call", notes: "From the imported CRM" }, "user");
      // the status it had there (set last, so scheduling a follow-up can't move it)
      if (status !== "new") await moveStage(userId, lead.id, stageForStatus(status), { source: "user", confirm: true, note: `Imported from ${o.sourceLabel || "CSV"} as ${statusLabel(status)}`, at: now });
      await logRobin(userId, lead.id, "imported", `${name} imported from ${o.sourceLabel || "CSV"} (${statusLabel(status)}) — already worked, not contacted again`, { ref, rawStatus }, 1);
      res.created++;
      res.createdIds.push(lead.id);
    } catch (e) {
      res.errors.push({ row: i + 2, name, error: (e as Error).message.slice(0, 160) });
    }
  }
  await audit(userId, "crm_import", "lead", null, "user", { source: src, created: res.created, duplicates: res.duplicates.length, errors: res.errors.length, backup: backup.id });
  const remaining = body.filter((row) => cellOf(row, mapping, "businessName") && !already.has(refOf(row, mapping))).length - res.duplicates.length;
  return { ...res, remaining: Math.max(0, remaining) };
}
