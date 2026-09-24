import "server-only";
import { mapLinks } from "./geoapify";
import type { LeadDTO } from "./types";

/** Columns needed to render a lead (select these, then pass the row to toLeadDTO). */
export const LEAD_SELECT = {
  id: true, businessName: true, category: true, location: true, phone: true, website: true, email: true,
  latitude: true, longitude: true, stage: true, source: true, discoveredAt: true, lastSeenAt: true,
  lastContactedAt: true, nextFollowUpAt: true, notes: true, salesValue: true, serviceInterest: true, metadata: true,
} as const;

type LeadRow = {
  id: string; businessName: string; category: string | null; location: string | null; phone: string | null;
  website: string | null; email: string | null; latitude: number | null; longitude: number | null; stage: string;
  source: string; discoveredAt: Date; lastSeenAt: Date | null; lastContactedAt: Date | null; nextFollowUpAt: Date | null;
  notes: string | null; salesValue: number | null; serviceInterest: string | null; metadata: unknown;
};

export function toLeadDTO(r: LeadRow): LeadDTO {
  const meta = (r.metadata ?? {}) as { distanceM?: number };
  return {
    id: r.id,
    businessName: r.businessName,
    category: r.category,
    address: r.location,
    phone: r.phone,
    website: r.website,
    email: r.email,
    latitude: r.latitude,
    longitude: r.longitude,
    distanceM: typeof meta.distanceM === "number" ? meta.distanceM : null,
    ...mapLinks(r.latitude, r.longitude),
    websiteStatus: r.website ? "has_website" : "no_website_listed",
    stage: r.stage,
    source: r.source,
    discoveredAt: r.discoveredAt.toISOString(),
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    lastContactedAt: r.lastContactedAt?.toISOString() ?? null,
    nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null,
    notes: r.notes,
    salesValue: r.salesValue,
    serviceInterest: r.serviceInterest,
  };
}
