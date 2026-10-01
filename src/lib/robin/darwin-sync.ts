import "server-only";
import type { DarwinLead } from "@prisma/client";
import { getDb } from "@/lib/db";
import { audit, createLead, loadSettings, logRobin, advanceTo, type LeadInput, type Source } from "./crm";

/**
 * DARWIN → ROBIN. DARWIN finds and verifies businesses; Robin receives them.
 * Robin never searches for leads itself. Each DARWIN lead comes over once:
 * duplicates are merged into the existing CRM record (remembered as an alias so
 * they aren't re-checked), and any email DARWIN really sent is carried into
 * Robin's contact history.
 */

type Meta = {
  search?: { location?: string };
  google?: { mapsUri?: string | null; rating?: number | null; reviews?: number | null } | null;
  websiteVerification?: { status?: string };
  bucket?: string;
};

export function darwinToLead(d: DarwinLead): LeadInput {
  const m = (d.metadata ?? {}) as Meta;
  const parts = (d.location ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const city = m.search?.location ?? (parts.length >= 2 ? parts.slice(-3, -1).join(", ") || parts.slice(-2).join(", ") : parts[0] ?? null);
  const status = d.opportunityType === "no_website" ? "no_website"
    : d.opportunityType === "outdated_website" ? "outdated"
      : d.opportunityType === "poor_website" ? "poor"
        : d.website ? "has_website"
          : m.websiteVerification?.status === "no_website" ? "no_website" : "unknown";
  const maps = m.google?.mapsUri || (d.latitude != null && d.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${d.latitude},${d.longitude}` : null);
  return {
    darwinLeadId: d.id, businessName: d.businessName, category: d.category, phone: d.phone, email: d.email, website: d.website,
    instagram: d.instagram, address: d.location, city, mapsUrl: maps, websiteStatus: status, opportunityType: d.opportunityType,
    darwinScore: d.leadScore, rating: m.google?.rating ?? null, reviews: m.google?.reviews ?? null,
    source: "darwin", discoveredAt: d.discoveredAt, potentialValue: d.salesValue ?? null, serviceInterest: d.serviceInterest ?? null,
  };
}

export interface SyncResult { imported: number; duplicates: number; names: string[]; remaining: number; skipped?: "off" }

/**
 * Bring DARWIN's leads that Robin hasn't seen yet into the CRM.
 * `ids` = only these (the "Send to Robin" button works even with auto-import off).
 */
export async function syncFromDarwin(userId: string, o: { ids?: string[]; limit?: number; source?: Source } = {}): Promise<SyncResult> {
  const db = getDb();
  if (!o.ids && !(await loadSettings(userId)).autoImport) return { imported: 0, duplicates: 0, names: [], remaining: 0, skipped: "off" };
  const known = await db.robinLead.findMany({ where: { userId, OR: [{ darwinLeadId: { not: null } }, { darwinAliases: { isEmpty: false } }] }, select: { darwinLeadId: true, darwinAliases: true } });
  const seen = new Set(known.flatMap((k) => [k.darwinLeadId, ...k.darwinAliases].filter(Boolean) as string[]));
  const limit = Math.min(o.limit ?? 200, 500);
  const where = { userId, ...(o.ids ? { id: { in: o.ids } } : {}), ...(seen.size ? { id: { notIn: [...seen], ...(o.ids ? { in: o.ids } : {}) } } : {}) };
  const [batch, total] = await Promise.all([
    db.darwinLead.findMany({ where, orderBy: { discoveredAt: "asc" }, take: limit }),
    db.darwinLead.count({ where }),
  ]);
  const res: SyncResult = { imported: 0, duplicates: 0, names: [], remaining: Math.max(0, total - batch.length) };
  for (const d of batch) {
    const { lead, duplicate } = await createLead(userId, darwinToLead(d), o.source ?? "darwin");
    if (duplicate) {
      res.duplicates++;
      if (lead.darwinLeadId !== d.id && !lead.darwinAliases.includes(d.id)) {
        await db.robinLead.update({ where: { id: lead.id }, data: { darwinAliases: { push: d.id } } });
      }
      continue;
    }
    res.imported++;
    if (res.names.length < 8) res.names.push(lead.businessName);
    // outreach DARWIN really did (Gmail confirmed) becomes part of Robin's contact history
    const sent = await db.darwinMessage.findMany({ where: { userId, leadId: d.id, status: { in: ["sent", "delivered", "replied"] } }, orderBy: { sentAt: "asc" } });
    for (const m of sent) {
      await db.robinInteraction.create({ data: { userId, leadId: lead.id, channel: m.channel === "instagram_dm" ? "instagram" : "email", status: m.status === "replied" ? "sent" : m.status, subject: m.subject, notes: m.body.slice(0, 4000), externalId: m.externalId, occurredAt: m.sentAt ?? m.createdAt } });
      await logRobin(userId, lead.id, "email", `DARWIN's email to ${lead.businessName} carried over (sent ${(m.sentAt ?? m.createdAt).toISOString().slice(0, 10)})`, { darwinMessageId: m.id }, 1);
      if (m.status === "replied") await db.robinInteraction.create({ data: { userId, leadId: lead.id, channel: "email", direction: "inbound", status: "received", outcome: "replied", occurredAt: m.sentAt ?? m.createdAt } });
    }
    if (sent.length) {
      const last = sent[sent.length - 1];
      const l2 = await db.robinLead.update({ where: { id: lead.id }, data: { lastContactAt: last.sentAt ?? last.createdAt } });
      await advanceTo(userId, l2, "contacted", "darwin", "DARWIN emailed them");
    }
  }
  if (res.imported) {
    const title = `${res.imported} new lead${res.imported === 1 ? "" : "s"} received from Darwin`;
    await db.robinNotification.create({ data: { userId, kind: "darwin_import", title, body: res.names.join(", ") + (res.imported > res.names.length ? ` and ${res.imported - res.names.length} more` : "") } });
    await audit(userId, "darwin_import", "lead", null, o.source ?? "darwin", { imported: res.imported, duplicates: res.duplicates });
  }
  return res;
}
