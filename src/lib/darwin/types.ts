/**
 * DARWIN lead types shared by the server and the dashboard (no server imports).
 * Every value comes from a real source response or from the user — nothing here
 * is ever filled in with a guess.
 */

export type LeadFilter = "all" | "no_website" | "has_website" | "phone" | "no_phone";

export const LEAD_FILTERS: { id: LeadFilter; label: string }[] = [
  { id: "all", label: "All businesses" },
  { id: "no_website", label: "No website" },
  { id: "has_website", label: "Has website" },
  { id: "phone", label: "Phone available" },
  { id: "no_phone", label: "Phone unavailable" },
];

/** "no_website_listed" = the source data has no website — not proof there is none. */
export type WebsiteStatus = "has_website" | "no_website_listed";

export interface LeadDTO {
  id: string;
  businessName: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Metres from the searched location (when known). */
  distanceM: number | null;
  mapsUrl: string | null;
  osmUrl: string | null;
  websiteStatus: WebsiteStatus;
  stage: string;
  source: string;
  discoveredAt: string;
  lastSeenAt: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  notes: string | null;
  salesValue: number | null;
  serviceInterest: string | null;
  instagram?: string | null;
  /** Set by discovery ("no_website") or DARWIN's AI analysis (e.g. "outdated_website"). */
  opportunityType?: string | null;
  /** AI analysis score (0–100) when DARWIN qualified the lead — never a listed fact. */
  leadScore?: number | null;
}

export interface FindLeadsResult {
  leads: LeadDTO[];
  newCount: number;
  /** Returned by Geoapify but already in DARWIN's history — not shown again. */
  skippedDuplicates: number;
  /** Returned but not matching the filter / category. */
  filteredOut: number;
  exhausted: boolean;
  stoppedReason: "limit" | "exhausted" | "request_cap" | "rate_limit";
  requests: number;
  radiusKm: number;
  center: { lat: number; lon: number; label: string };
  message: string;
}
