import "server-only";
import { leadNumberOf } from "./numbers";
import type { Prisma, RobinLead } from "@prisma/client";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { recordActivity } from "@/lib/activity/record";
import { validTz, todayIn, startOfDay, addDays } from "@/lib/activity/dates";
import { verifyPhone } from "@/lib/darwin/daily/verify";
import { qualify, type QualifyInput } from "./qualify";
import { CLOSED, STAGE_ORDER, CONFIRM_STAGES, DEFAULT_SERVICES, DEFAULT_SETTINGS, STAGE_LABEL, isStage, type RobinSettings, type Stage, type Priority, PRIORITIES } from "./types";

/**
 * ROBIN's CRM core: leads, duplicate detection, qualification, stage changes
 * (with full history), audit. Every write here is a real database record and
 * every change says who made it (you, your voice, Robin, DARWIN, a webhook).
 */

export type Source = "user" | "voice" | "robin" | "darwin" | "system" | "webhook";

export class RobinError extends Error {
  constructor(message: string, public status = 400, public code?: "needs_confirmation" | "not_found" | "ambiguous" | "invalid") {
    super(message);
    this.name = "RobinError";
  }
}

// ---------------------------------------------------------------- helpers

export async function userTz(userId: string): Promise<string> {
  const p = await getDb().profile.findUnique({ where: { userId }, select: { timezone: true } }).catch(() => null);
  // a profile that was never set says "UTC" — use the business's own timezone instead
  return p?.timezone && p.timezone !== "UTC" ? validTz(p.timezone) : validTz(env.darwinDailyTz);
}

/** [start of today, start of tomorrow) in the user's timezone. */
export function dayBounds(tz: string, now = new Date(), offsetDays = 0) {
  const d = addDays(todayIn(tz, +now), offsetDays);
  return { date: d, start: startOfDay(d, tz), end: startOfDay(addDays(d, 1), tz) };
}

export const normName = (s: string) =>
  s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\b(the|pvt|ltd|private|limited|llp)\b/g, " ").replace(/\s+/g, " ").trim();
export const fingerprintOf = (name: string, city?: string | null) => `${normName(name)}|${normName(city ?? "").split(" ").slice(0, 2).join(" ")}`;
export function phoneKeyOf(phone?: string | null): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-10) : null;
}

export async function audit(userId: string, action: string, entity: string, entityId: string | null, source: Source, detail?: Record<string, unknown>) {
  await getDb().robinAudit.create({ data: { userId, action, entity, entityId, source, detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined } }).catch(() => {});
}

export async function logRobin(userId: string, leadId: string | null, type: string, detail: string, meta?: Record<string, unknown>, importance = 2) {
  await getDb().robinActivity.create({ data: { userId, leadId, type, detail: detail.slice(0, 500), meta: (meta ?? undefined) as Prisma.InputJsonValue | undefined } });
  // and JARVIS's own history (briefings), never blocking the CRM write
  void recordActivity(userId, { category: "business", agent: "ROBIN", action: detail, importance, source: "robin", metadata: leadId ? { leadId, type } : { type } });
}

// ---------------------------------------------------------------- settings + services

export async function loadSettings(userId: string): Promise<RobinSettings> {
  const row = await getDb().robinSettings.findUnique({ where: { userId } });
  return { ...DEFAULT_SETTINGS, ...((row?.data as Partial<RobinSettings> | null) ?? {}) };
}

export async function saveSettings(userId: string, patch: Partial<RobinSettings>, source: Source = "user"): Promise<RobinSettings> {
  const next = { ...(await loadSettings(userId)), ...patch };
  await getDb().robinSettings.upsert({ where: { userId }, create: { userId, data: next as unknown as Prisma.InputJsonValue }, update: { data: next as unknown as Prisma.InputJsonValue } });
  await audit(userId, "settings_changed", "settings", null, source, { keys: Object.keys(patch) });
  return next;
}

/** Your services. Created once with names only — prices stay empty until YOU set them. */
export async function listServices(userId: string) {
  const db = getDb();
  let rows = await db.robinService.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { name: "asc" }] });
  if (!rows.length) {
    await db.robinService.createMany({ data: DEFAULT_SERVICES.map((name, position) => ({ userId, name, position })), skipDuplicates: true });
    rows = await db.robinService.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { name: "asc" }] });
  }
  return rows;
}

// ---------------------------------------------------------------- leads

export interface LeadInput extends QualifyInput {
  darwinLeadId?: string | null;
  mapsUrl?: string | null;
  websiteQuality?: string | null;
  opportunityType?: string | null;
  source?: string;
  discoveredAt?: Date | null;
  potentialValue?: number | null;
  serviceInterest?: string | null;
  notes?: string | null;
}

/** An existing Robin lead that is the same business (DARWIN id, phone, email, or name + city). */
export async function findDuplicate(userId: string, l: { darwinLeadId?: string | null; phone?: string | null; email?: string | null; businessName: string; city?: string | null; address?: string | null }): Promise<RobinLead | null> {
  const db = getDb();
  const or: Prisma.RobinLeadWhereInput[] = [];
  if (l.darwinLeadId) or.push({ darwinLeadId: l.darwinLeadId });
  const pk = phoneKeyOf(l.phone);
  if (pk) or.push({ phoneKey: pk });
  if (l.email) or.push({ email: { equals: l.email.trim(), mode: "insensitive" } });
  or.push({ fingerprint: fingerprintOf(l.businessName, l.city ?? l.address) });
  return db.robinLead.findFirst({ where: { userId, OR: or }, orderBy: { createdAt: "asc" } });
}

/**
 * Create a lead — or, if the business is already in the CRM, fill in what was
 * missing on the existing record instead of creating a second one.
 */
export async function createLead(userId: string, input: LeadInput, source: Source): Promise<{ lead: RobinLead; duplicate: boolean }> {
  const db = getDb();
  const name = input.businessName.trim().slice(0, 160);
  if (!name) throw new RobinError("A business name is required.", 422, "invalid");
  const dup = await findDuplicate(userId, { ...input, businessName: name });
  if (dup) {
    const fill: Prisma.RobinLeadUpdateInput = {};
    for (const k of ["phone", "whatsapp", "email", "website", "instagram", "address", "city", "mapsUrl", "category"] as const) {
      if (!dup[k] && input[k]) (fill as Record<string, unknown>)[k] = input[k];
    }
    if (!dup.darwinLeadId && input.darwinLeadId) {
      // another DARWIN record of the same business → link it (only one per id is allowed)
      const taken = await db.robinLead.findFirst({ where: { userId, darwinLeadId: input.darwinLeadId }, select: { id: true } });
      if (!taken) fill.darwinLeadId = input.darwinLeadId;
    }
    if (fill.phone) fill.phoneKey = phoneKeyOf(input.phone);
    const lead = Object.keys(fill).length ? await db.robinLead.update({ where: { id: dup.id }, data: fill }) : dup;
    await logRobin(userId, dup.id, "duplicate", `Duplicate of ${dup.businessName} detected${source === "darwin" ? " in DARWIN's leads" : ""} — kept the existing record${Object.keys(fill).length ? " and added the missing details" : ""}.`, { source }, 1);
    return { lead, duplicate: true };
  }
  const q = qualify({ ...input, businessName: name });
  const stage: Stage = q.priority === "high" || q.priority === "medium" ? "qualified" : "new";
  const now = new Date();
  // the lead's short number (1, 2, 3 …); two leads arriving at once → the second takes the next one
  let lead: RobinLead | null = null;
  for (let attempt = 0; !lead; attempt++) {
    const number = await nextLeadNumber(userId);
    try {
      lead = await createRow(number);
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002" || attempt >= 6 || !String((e as { meta?: { target?: unknown } }).meta?.target ?? "number").includes("number")) throw e;
    }
  }
  async function createRow(number: number) { return db.robinLead.create({
    data: {
      userId, number, businessName: name, darwinLeadId: input.darwinLeadId ?? null, category: input.category ?? null,
      phone: input.phone ?? null, whatsapp: input.whatsapp ?? null, email: input.email?.trim() || null, website: input.website ?? null,
      instagram: input.instagram ?? null, address: input.address ?? null, city: input.city ?? null, mapsUrl: input.mapsUrl ?? null,
      websiteStatus: input.websiteStatus ?? (input.website ? "has_website" : "unknown"), websiteQuality: input.websiteQuality ?? null,
      opportunityType: input.opportunityType ?? null, darwinScore: input.darwinScore ?? null, rating: input.rating ?? null, reviews: input.reviews ?? null,
      source: input.source ?? source, discoveredAt: input.discoveredAt ?? null,
      fingerprint: fingerprintOf(name, input.city ?? input.address), phoneKey: phoneKeyOf(input.phone),
      score: q.score, priority: q.priority, reasons: q.reasons as unknown as Prisma.InputJsonValue, qualifiedAt: now,
      stage, stageChangedAt: now, potentialValue: input.potentialValue ?? null, serviceInterest: input.serviceInterest ?? null, notes: input.notes ?? null,
      scores: { create: { userId, score: q.score, priority: q.priority, reasons: q.reasons as unknown as Prisma.InputJsonValue } },
      stageChanges: { create: [{ userId, fromStage: null, toStage: "new", source, note: source === "darwin" ? "Received from DARWIN" : "Created" }, ...(stage !== "new" ? [{ userId, fromStage: "new", toStage: stage, source: "robin" as const, note: `Qualified as ${q.priority} priority` }] : [])] },
    },
  }); }
  await logRobin(userId, lead.id, "imported", source === "darwin" ? `DARWIN handed over ${name}` : `${name} added to the CRM`, { source });
  await logRobin(userId, lead.id, "qualified", `${name} qualified as ${q.priority === "needs_review" ? "Needs Review" : `${q.priority[0].toUpperCase()}${q.priority.slice(1)} Priority`}`, { score: q.score, reasons: q.reasons }, 1);
  await audit(userId, "lead_created", "lead", lead.id, source, { name, priority: q.priority, score: q.score });
  return { lead, duplicate: false };
}

export async function requalify(userId: string, leadId: string, source: Source = "robin"): Promise<RobinLead> {
  const db = getDb();
  const l = await mustLead(userId, leadId);
  const q = qualify(l);
  const lead = await db.robinLead.update({
    where: { id: l.id },
    data: { score: q.score, priority: l.priorityOverride ?? q.priority, reasons: q.reasons as unknown as Prisma.InputJsonValue, qualifiedAt: new Date(), scores: { create: { userId, score: q.score, priority: q.priority, reasons: q.reasons as unknown as Prisma.InputJsonValue } } },
  });
  await audit(userId, "lead_requalified", "lead", l.id, source, { score: q.score, priority: q.priority });
  return lead;
}

/** Your override always wins over Robin's ranking (null = go back to Robin's). */
export async function setPriority(userId: string, leadId: string, override: Priority | null, source: Source): Promise<RobinLead> {
  if (override && !PRIORITIES.includes(override)) throw new RobinError("Unknown priority.", 422, "invalid");
  const l = await mustLead(userId, leadId);
  const computed = qualify(l).priority;
  const lead = await getDb().robinLead.update({ where: { id: l.id }, data: { priorityOverride: override, priority: override ?? computed } });
  await logRobin(userId, l.id, "priority", override ? `${l.businessName} set to ${override.replace("_", " ")} priority by you` : `${l.businessName} back to Robin's ranking (${computed.replace("_", " ")})`, { override }, 1);
  await audit(userId, "priority_override", "lead", l.id, source, { from: l.priority, to: override ?? computed });
  return lead;
}

export async function mustLead(userId: string, leadId: string): Promise<RobinLead> {
  const l = await getDb().robinLead.findFirst({ where: { id: leadId, userId } });
  if (!l) throw new RobinError("That lead isn't in your CRM.", 404, "not_found");
  return l;
}

/**
 * Move a lead to another stage. Decisions (WON, LOST, DO NOT CONTACT) need
 * `confirm: true` — Robin never makes them on its own.
 */
export async function moveStage(userId: string, leadId: string, to: string, o: { source: Source; note?: string | null; confirm?: boolean; at?: Date }): Promise<{ lead: RobinLead; changed: boolean; from: string }> {
  if (!isStage(to)) throw new RobinError(`"${to}" isn't a pipeline stage.`, 422, "invalid");
  const l = await mustLead(userId, leadId);
  if (l.stage === to) return { lead: l, changed: false, from: l.stage };
  if (CONFIRM_STAGES.includes(to) && !o.confirm) {
    throw new RobinError(`Moving ${l.businessName} to ${STAGE_LABEL[to]} needs your confirmation.`, 409, "needs_confirmation");
  }
  if (l.stage === "do_not_contact" && !o.confirm) {
    throw new RobinError(`${l.businessName} is marked Do Not Contact — confirm to move it back into the pipeline.`, 409, "needs_confirmation");
  }
  const at = o.at ?? new Date();
  const db = getDb();
  const [lead] = await db.$transaction([
    db.robinLead.update({ where: { id: l.id }, data: { stage: to, stageChangedAt: at, ...(["lost", "not_interested"].includes(to) && o.note ? { lostReason: o.note.slice(0, 300) } : {}) } }),
    db.robinStageChange.create({ data: { userId, leadId: l.id, fromStage: l.stage, toStage: to, source: o.source, note: o.note?.slice(0, 300) ?? null, createdAt: at } }),
  ]);
  await logRobin(userId, l.id, "stage", `${l.businessName} moved to ${STAGE_LABEL[to]}`, { from: l.stage, to, source: o.source }, to === "won" ? 4 : 2);
  await audit(userId, "stage_changed", "lead", l.id, o.source, { from: l.stage, to, note: o.note ?? null });
  return { lead, changed: true, from: l.stage };
}

/** Move forward only (used by logged interactions: a call never drags a quoted lead back to "contacted"). */
export async function advanceTo(userId: string, lead: RobinLead, to: Stage, source: Source, note?: string) {
  if (CLOSED.includes(lead.stage as Stage) || STAGE_ORDER[lead.stage as Stage] >= STAGE_ORDER[to]) return lead;
  return (await moveStage(userId, lead.id, to, { source, note })).lead;
}

const EDITABLE = ["businessName", "category", "phone", "whatsapp", "email", "website", "instagram", "address", "city", "mapsUrl", "websiteStatus", "websiteQuality", "opportunityType", "potentialValue", "serviceInterest", "assignedTo", "notes"] as const;
export type LeadPatch = Partial<Record<(typeof EDITABLE)[number], string | number | null>>;

export async function updateLead(userId: string, leadId: string, patch: LeadPatch, source: Source): Promise<RobinLead> {
  const l = await mustLead(userId, leadId);
  const data: Prisma.RobinLeadUpdateInput = {};
  for (const k of EDITABLE) if (k in patch) (data as Record<string, unknown>)[k] = patch[k] === "" ? null : patch[k];
  if ("phone" in patch) data.phoneKey = phoneKeyOf(patch.phone as string | null);
  if ("businessName" in patch || "city" in patch) data.fingerprint = fingerprintOf(String(patch.businessName ?? l.businessName), (patch.city as string | null) ?? l.city ?? l.address);
  const lead = await getDb().robinLead.update({ where: { id: l.id }, data });
  const contactChanged = ["phone", "whatsapp", "email", "instagram", "website", "websiteStatus", "category"].some((k) => k in patch);
  await audit(userId, "lead_updated", "lead", l.id, source, { fields: Object.keys(patch) });
  if ("potentialValue" in patch) await logRobin(userId, l.id, "value", `${l.businessName}: potential value set to ${patch.potentialValue ?? "none"}`, undefined, 1);
  if ("notes" in patch && patch.notes) await logRobin(userId, l.id, "note", `Note added to ${l.businessName}`, undefined, 1);
  return contactChanged ? requalify(userId, l.id, source) : lead;
}

/**
 * Find a lead by what you said ("ABC Cafe", "abc café", "the salon on MG road").
 * Exact → starts with → contains → shared words. Returns every close match so
 * Robin can ask "which one?" instead of guessing.
 */
/** The next free lead number for this user. */
export async function nextLeadNumber(userId: string): Promise<number> {
  const top = await getDb().robinLead.aggregate({ where: { userId }, _max: { number: true } });
  return (top._max.number ?? 0) + 1;
}

/** The lead with this number ("7", "#7", "lead seven"), or null. */
export async function leadByNumber(userId: string, number: number): Promise<RobinLead | null> {
  return getDb().robinLead.findUnique({ where: { userId_number: { userId, number } } });
}

/** By number ("7", "lead 7", "#7") or by name. */
export async function findLeadsByName(userId: string, query: string, take = 5): Promise<RobinLead[]> {
  const n = leadNumberOf(query);
  if (n) {
    const l = await leadByNumber(userId, n);
    return l ? [l] : [];
  }
  const q = normName(query);
  if (!q) return [];
  const words = q.split(" ").filter((w) => w.length >= 2 && !["cafe", "the", "and", "shop", "store"].includes(w) || q.split(" ").length === 1);
  const db = getDb();
  const cands = await db.robinLead.findMany({
    where: { userId, OR: [{ businessName: { contains: query.trim(), mode: "insensitive" } }, ...words.map((w) => ({ businessName: { contains: w, mode: "insensitive" as const } }))] },
    take: 60, orderBy: { updatedAt: "desc" },
  });
  const rank = (l: RobinLead) => {
    const n = normName(l.businessName);
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    if (n.includes(q)) return 60;
    const nw = new Set(n.split(" "));
    const hit = q.split(" ").filter((w) => nw.has(w)).length;
    return hit ? 20 + (hit / q.split(" ").length) * 30 : 0;
  };
  const ranked = cands.map((l) => ({ l, r: rank(l) })).filter((x) => x.r > 0).sort((a, b) => b.r - a.r);
  if (!ranked.length) return [];
  // a clearly best match wins on its own
  if (ranked.length === 1 || ranked[0].r >= 80 && ranked[0].r > (ranked[1]?.r ?? 0)) return [ranked[0].l];
  return ranked.slice(0, take).map((x) => x.l);
}

/** One lead from a name, or a RobinError that says why not (none / which one?). */
export async function resolveLead(userId: string, query: string): Promise<RobinLead> {
  const hits = await findLeadsByName(userId, query);
  if (!hits.length) throw new RobinError(leadNumberOf(query) ? `There's no lead number ${leadNumberOf(query)} in your CRM.` : `I couldn't find "${query}" in your CRM.`, 404, "not_found");
  if (hits.length > 1) throw new RobinError(`I found ${hits.length} matches for "${query}": ${hits.map((h) => h.businessName).join(", ")}. Which one?`, 409, "ambiguous");
  return hits[0];
}

/** WhatsApp link for a lead (its WhatsApp number, else a mobile number). Opening it sends nothing. */
export function whatsappLink(l: Pick<RobinLead, "whatsapp" | "phone">, text?: string): string | null {
  const p = verifyPhone(l.whatsapp || l.phone);
  if (!p.ok || (!l.whatsapp && !p.mobile)) return null;
  const digits = (p.normalized ?? "").replace(/\D/g, "");
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
export function telLink(l: Pick<RobinLead, "phone">): string | null {
  const p = verifyPhone(l.phone);
  return p.ok ? `tel:${(p.normalized ?? "").replace(/\s/g, "")}` : null;
}
export function instagramLink(l: Pick<RobinLead, "instagram">): string | null {
  if (!l.instagram) return null;
  if (/^https?:\/\//i.test(l.instagram)) return l.instagram;
  const h = l.instagram.replace(/^@/, "").trim();
  return h ? `https://instagram.com/${encodeURIComponent(h)}` : null;
}
