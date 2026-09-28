import "server-only";
import type { DarwinDailyRun } from "@prisma/client";
import { getDb } from "@/lib/db";
import { BUCKETS, type Bucket } from "./verify";

/**
 * The daily report, computed from the leads this run actually saved and the
 * run's own counters. Nothing is estimated.
 */
export interface DailyReport {
  date: string;
  status: string;
  target: number;
  verified: number;
  remaining: number;
  candidates: number;
  duplicates: number;
  alreadyChecked: number;
  websiteRejected: number;
  unclear: number;
  tempUnavailable: number;
  closed: number;
  missingPhone: number;
  contactable: number;
  highPotential: number;
  breakdown: { bucket: Bucket; count: number }[];
  reasons: string[];
  sources: { listing: boolean; domain: boolean; google: boolean; search: boolean };
  apiRequests: { geoapify: number; google: number; search: number };
  top: { id: string; name: string; category: string | null; phone: string | null; score: number | null; location: string | null }[];
  completedAt: string | null;
}

export async function runLeads(run: Pick<DarwinDailyRun, "id" | "userId">) {
  return getDb().darwinLead.findMany({
    where: { userId: run.userId, metadata: { path: ["dailyRunId"], equals: run.id } },
    orderBy: [{ leadScore: "desc" }, { discoveredAt: "asc" }],
    select: { id: true, businessName: true, category: true, phone: true, leadScore: true, location: true, metadata: true },
  });
}

export async function buildReport(run: DarwinDailyRun): Promise<DailyReport> {
  const leads = await runLeads(run);
  const counts = new Map<Bucket, number>();
  let contactable = 0, high = 0;
  for (const l of leads) {
    const m = (l.metadata ?? {}) as { bucket?: Bucket; highPotential?: boolean };
    const b = m.bucket && BUCKETS.includes(m.bucket) ? m.bucket : "Other";
    counts.set(b, (counts.get(b) ?? 0) + 1);
    if (l.phone) contactable++;
    if (m.highPotential) high++;
  }
  const api = { geoapify: 0, google: 0, search: 0, ...((run.apiRequests as DailyReport["apiRequests"] | null) ?? {}) };
  return {
    date: run.date,
    status: run.status,
    target: run.target,
    verified: leads.length,
    remaining: Math.max(0, run.target - leads.length),
    candidates: run.candidates,
    duplicates: run.duplicates,
    alreadyChecked: run.alreadyChecked,
    websiteRejected: run.websiteRejected,
    unclear: run.unclear,
    tempUnavailable: run.tempUnavailable,
    closed: run.closed,
    missingPhone: leads.filter((l) => !l.phone).length,
    contactable,
    highPotential: high,
    breakdown: BUCKETS.map((b) => ({ bucket: b, count: counts.get(b) ?? 0 })).filter((x) => x.count > 0),
    reasons: run.reasons,
    sources: { listing: true, domain: true, google: api.google > 0, search: api.search > 0 },
    apiRequests: api,
    top: leads.slice(0, 10).map((l) => ({ id: l.id, name: l.businessName, category: l.category, phone: l.phone, score: l.leadScore, location: l.location })),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}
