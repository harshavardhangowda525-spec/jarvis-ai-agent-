import "server-only";
import { getDb } from "@/lib/db";
import { leadFingerprint } from "./dedup";
import type { RawLead } from "./sources";

/** Record a real activity-log event. */
export async function logActivity(userId: string, type: string, detail: string, leadId?: string, meta?: Record<string, unknown>) {
  try {
    await getDb().darwinActivity.create({ data: { userId, type, detail, leadId: leadId ?? null, meta: (meta ?? undefined) as object | undefined } });
  } catch { /* logging must never break the flow */ }
}

export interface UpsertResult { created: number; duplicates: number; leadIds: string[] }

/**
 * Insert real leads with duplicate protection. A lead whose fingerprint already
 * exists for this user is skipped (never duplicated). Returns real counts.
 */
export async function upsertLeads(userId: string, raws: RawLead[]): Promise<UpsertResult> {
  const db = getDb();
  const res: UpsertResult = { created: 0, duplicates: 0, leadIds: [] };
  for (const r of raws) {
    if (!r.businessName?.trim()) continue;
    const fingerprint = leadFingerprint(r);
    const existing = await db.darwinLead.findFirst({ where: { userId, fingerprint }, select: { id: true } });
    if (existing) { res.duplicates++; continue; }
    const lead = await db.darwinLead.create({
      data: {
        userId,
        businessName: r.businessName.trim(),
        category: r.category ?? null,
        location: r.location ?? null,
        website: r.website ?? null,
        phone: r.phone ?? null,
        email: r.email ?? null,
        instagram: r.instagram ?? null,
        source: r.source,
        sourceRef: r.sourceRef ?? null,
        sourceUrl: r.sourceUrl ?? null,
        lastVerifiedAt: new Date(),
        verifiedFields: r.verifiedFields ?? [],
        fingerprint,
        metadata: (r.metadata ?? undefined) as object | undefined,
      },
      select: { id: true },
    });
    res.created++;
    res.leadIds.push(lead.id);
    await logActivity(userId, "discovered", `Discovered ${r.businessName} via ${r.source}.`, lead.id, { source: r.source });
  }
  return res;
}

/** Follow-up buckets in the user's timezone. */
export function followUpBuckets(tz: string) {
  const now = new Date();
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = fmt(now);
  const tomorrow = fmt(new Date(now.getTime() + 86_400_000));
  return { now, today, tomorrow };
}
