import "server-only";
import type { Prisma, RobinLead } from "@prisma/client";
import { getDb } from "@/lib/db";
import { createLead, moveStage, updateLead, userTz, type LeadPatch, type Source } from "@/lib/robin/crm";
import { fmtWhen } from "@/lib/robin/engage";
import { islandLeadFull } from "@/lib/robin/island-dashboard";
import { CRM_STATUSES, isCrmStatus, stageForStatus, stagesOf, statusOfStage, type CrmStatus, type FollowUpFilter, type WebsiteFilter } from "./status";

/**
 * DARWIN's CRM — the ONE lead store. JARVIS's CRM page, RUBEN's pop-up, the
 * agents' tools and the import all read and change leads through this module
 * (or the RUBIN CRM services it calls). Nothing here keeps a copy.
 *
 * Unknown information stays unknown: a lead without a phone has phone null,
 * a website that wasn't checked is "unknown", never "none".
 */

export interface CrmFilters {
  q?: string;
  status?: CrmStatus | "open" | "all";
  niche?: string;
  location?: string;
  website?: WebsiteFilter;
  followUp?: FollowUpFilter;
  source?: string;
  /** Only these leads (a voice command's results). */
  ids?: string[];
  sort?: "recent" | "followup" | "name";
  limit?: number;
  offset?: number;
}

export interface CrmRow {
  id: string; number: number | null; businessName: string; category: string | null; city: string | null;
  phone: string | null; website: string | null; websiteStatus: string; instagram: string | null; email: string | null;
  source: string; status: CrmStatus; stage: string; stageLabel: string;
  lastContactAt: string | null; nextFollowUpAt: string | null; nextFollowUp: string | null; overdue: boolean;
  /** What to do next, from the record (never a guess). */
  nextAction: string;
}

const STAGE_LABEL: Record<string, string> = {
  new: "Not contacted", qualified: "Not contacted", contacted: "Contacted", interested: "Interested", follow_up: "Follow-up",
  demo_scheduled: "Demo scheduled", demo_completed: "Demo done", quotation_sent: "Proposal sent", negotiating: "Negotiating",
  ready_to_purchase: "Ready to purchase", won: "Converted", lost: "Rejected", not_interested: "Not interested", do_not_contact: "Do not contact",
};

function websiteState(l: Pick<RobinLead, "website" | "websiteStatus">): string {
  if (l.website) return "has_website";
  return l.websiteStatus === "no_website" ? "no_website" : l.websiteStatus && l.websiteStatus !== "has_website" ? l.websiteStatus : "unknown";
}

function nextAction(l: RobinLead, now: Date, fu: { action: string; dueAt: Date } | null): string {
  const st = statusOfStage(l.stage);
  if (st === "rejected") return l.stage === "do_not_contact" ? "Do not contact" : "None";
  if (st === "converted") return "Deliver the project";
  if (fu) return `${fu.dueAt < now ? "Overdue: " : ""}${fu.action.replace(/_/g, " ")}`;
  if (st === "new") return l.phone ? "Call" : l.instagram ? "Instagram DM" : l.email ? "Email" : "Find a contact";
  if (st === "demo") return "Hold the demo";
  if (st === "proposal") return "Follow up on the proposal";
  if (st === "ready") return "Close the sale";
  return "Schedule a follow-up";
}

export function whereFor(userId: string, f: CrmFilters, now = new Date()): Prisma.RobinLeadWhereInput {
  const and: Prisma.RobinLeadWhereInput[] = [{ userId }];
  if (f.status && f.status !== "all") {
    and.push(f.status === "open" ? { stage: { notIn: [...stagesOf("converted"), ...stagesOf("rejected")] } } : { stage: { in: stagesOf(f.status) } });
  }
  if (f.niche) and.push({ category: { equals: f.niche, mode: "insensitive" } });
  if (f.location) and.push({ OR: [{ city: { contains: f.location, mode: "insensitive" } }, { address: { contains: f.location, mode: "insensitive" } }] });
  if (f.source) and.push({ source: f.source });
  if (f.ids?.length) and.push({ id: { in: f.ids } });
  if (f.website === "has") and.push({ website: { not: null } });
  if (f.website === "none") and.push({ website: null, websiteStatus: "no_website" });
  if (f.website === "unknown") and.push({ website: null, NOT: { websiteStatus: "no_website" } });
  if (f.followUp && f.followUp !== "any") {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000), week = new Date(start.getTime() + 7 * 86_400_000);
    if (f.followUp === "overdue") and.push({ nextFollowUpAt: { lt: now } });
    if (f.followUp === "today") and.push({ nextFollowUpAt: { gte: start, lt: end } });
    if (f.followUp === "due") and.push({ nextFollowUpAt: { lt: end } });
    if (f.followUp === "week") and.push({ nextFollowUpAt: { gte: start, lt: week } });
    if (f.followUp === "none") and.push({ nextFollowUpAt: null });
  }
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const or: Prisma.RobinLeadWhereInput[] = [
      { businessName: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } }, { address: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } }, { website: { contains: q, mode: "insensitive" } },
      { instagram: { contains: q.replace(/^@/, ""), mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } },
    ];
    if (digits.length >= 4) or.push({ phone: { contains: digits.slice(-10) } }, { phoneKey: { contains: digits.slice(-10) } });
    if (/^#?\d{1,6}$/.test(q)) or.push({ number: Number(q.replace("#", "")) });
    and.push({ OR: or });
  }
  return { AND: and };
}

export async function listLeads(userId: string, f: CrmFilters = {}) {
  const db = getDb();
  const now = new Date();
  const tz = await userTz(userId);
  const where = whereFor(userId, f, now);
  const orderBy: Prisma.RobinLeadOrderByWithRelationInput[] =
    f.sort === "followup" ? [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }]
      : f.sort === "name" ? [{ businessName: "asc" }]
        : [{ updatedAt: "desc" }];
  const take = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const [rows, total] = await Promise.all([
    db.robinLead.findMany({ where, orderBy, take, skip: Math.max(0, f.offset ?? 0) }),
    db.robinLead.count({ where }),
  ]);
  const fus = await db.robinFollowUp.findMany({ where: { userId, leadId: { in: rows.map((r) => r.id) }, status: "pending" }, orderBy: { dueAt: "asc" }, select: { leadId: true, action: true, dueAt: true } });
  const firstFu = new Map<string, { action: string; dueAt: Date }>();
  for (const x of fus) if (!firstFu.has(x.leadId)) firstFu.set(x.leadId, x);
  const leads: CrmRow[] = rows.map((l) => {
    const fu = firstFu.get(l.id) ?? null;
    const next = fu?.dueAt ?? l.nextFollowUpAt;
    return {
      id: l.id, number: l.number, businessName: l.businessName, category: l.category, city: l.city,
      phone: l.phone, website: l.website, websiteStatus: websiteState(l), instagram: l.instagram, email: l.email,
      source: l.source, status: statusOfStage(l.stage), stage: l.stage, stageLabel: STAGE_LABEL[l.stage] ?? l.stage,
      lastContactAt: l.lastContactAt?.toISOString() ?? null, nextFollowUpAt: next?.toISOString() ?? null,
      nextFollowUp: next ? fmtWhen(next, tz) : null, overdue: !!next && next < now && !["converted", "rejected"].includes(statusOfStage(l.stage)),
      nextAction: nextAction(l, now, fu),
    };
  });
  return { leads, total, offset: f.offset ?? 0 };
}

/** Counts behind the filters: statuses, niches, locations, sources (all real). */
export async function facets(userId: string) {
  const db = getDb();
  const [stages, niches, cities, sources, total] = await Promise.all([
    db.robinLead.groupBy({ by: ["stage"], where: { userId }, _count: { _all: true } }),
    db.robinLead.groupBy({ by: ["category"], where: { userId, category: { not: null } }, _count: { _all: true }, orderBy: { _count: { category: "desc" } }, take: 40 }),
    db.robinLead.groupBy({ by: ["city"], where: { userId, city: { not: null } }, _count: { _all: true }, orderBy: { _count: { city: "desc" } }, take: 40 }),
    db.robinLead.groupBy({ by: ["source"], where: { userId }, _count: { _all: true } }),
    db.robinLead.count({ where: { userId } }),
  ]);
  const status: Record<CrmStatus, number> = Object.fromEntries(CRM_STATUSES.map((s) => [s.id, 0])) as Record<CrmStatus, number>;
  for (const s of stages) status[statusOfStage(s.stage)] += s._count._all;
  return {
    total,
    status,
    niches: niches.map((n) => ({ value: n.category as string, count: n._count._all })),
    locations: cities.map((c) => ({ value: c.city as string, count: c._count._all })),
    sources: sources.map((s) => ({ value: s.source, count: s._count._all })),
  };
}

/** One lead: contact history, notes, follow-ups, stage history, verification evidence. */
export async function leadDetail(userId: string, id: string) {
  const full = await islandLeadFull(userId, id);
  const l = await getDb().robinLead.findFirstOrThrow({ where: { id, userId } });
  return {
    ...full,
    status: statusOfStage(l.stage),
    source: l.source, externalRef: l.externalRef, websiteStatus: websiteState(l),
    evidence: (l.evidence ?? null) as Record<string, unknown> | null,
    priority: l.priorityOverride ?? l.priority,
    lastContactAt: l.lastContactAt?.toISOString() ?? null,
  };
}

/** Set a lead's status — through RUBIN's stage service (history, audit, decisions ask first). */
export async function setStatus(userId: string, id: string, status: CrmStatus, o: { source: Source; confirm?: boolean; note?: string | null }) {
  if (!isCrmStatus(status)) throw new Error("Unknown status.");
  return moveStage(userId, id, stageForStatus(status), { source: o.source, confirm: o.confirm, note: o.note });
}

export { createLead, updateLead, type LeadPatch };
