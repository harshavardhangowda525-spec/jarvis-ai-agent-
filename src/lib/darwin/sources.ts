import "server-only";
import { env } from "@/lib/env";

/**
 * DARWIN lead sources — modular. Each source returns REAL businesses from an
 * authorized API. If no source is configured, DARWIN returns nothing and the
 * caller shows "NO REAL DATA AVAILABLE — CONNECT A DATA SOURCE". Nothing here
 * ever fabricates a business.
 */

export interface RawLead {
  businessName: string;
  category?: string;
  location?: string;
  website?: string;
  phone?: string;
  email?: string;
  instagram?: string;
  source: string; // google_places | csv | manual
  sourceRef?: string;
  sourceUrl?: string;
  /** Fields that came VERIFIED from the source (facts, not AI analysis). */
  verifiedFields: string[];
  metadata?: Record<string, unknown>;
}

export class LeadSourceError extends Error {}

export interface SourceInfo {
  id: string;
  label: string;
  connected: boolean;
  kind: "api" | "import";
}

/** What sources exist and whether they're connected right now. */
export function listSources(): SourceInfo[] {
  return [
    { id: "google_places", label: "Google Places", kind: "api", connected: env.googlePlacesApiKey.length > 0 },
    { id: "csv", label: "CSV Import", kind: "import", connected: true },
    { id: "manual", label: "Manual / user-provided", kind: "import", connected: true },
  ];
}

/** True when at least one automated discovery source (an API) is connected. */
export function hasDiscoverySource(): boolean {
  return env.googlePlacesApiKey.length > 0;
}

// --- Google Places (New Places API v1) -----------------------------------

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
].join(",");

function mapPlace(p: any): RawLead {
  const name = p?.displayName?.text ?? p?.displayName ?? "";
  const website = p?.websiteUri ?? undefined;
  const phone = p?.internationalPhoneNumber ?? p?.nationalPhoneNumber ?? undefined;
  const location = p?.formattedAddress ?? undefined;
  const category = p?.primaryTypeDisplayName?.text ?? p?.primaryTypeDisplayName ?? undefined;

  // Only fields Google actually returned are "verified".
  const verified: string[] = ["businessName"];
  if (website) verified.push("website");
  if (phone) verified.push("phone");
  if (location) verified.push("location");
  if (category) verified.push("category");

  return {
    businessName: name,
    category,
    location,
    website,
    phone,
    source: "google_places",
    sourceRef: p?.id,
    sourceUrl: p?.googleMapsUri,
    verifiedFields: verified,
    metadata: {
      rating: p?.rating ?? null,
      userRatingCount: p?.userRatingCount ?? null,
      businessStatus: p?.businessStatus ?? null,
      types: p?.types ?? [],
    },
  };
}

/**
 * Real business search via Google Places Text Search. Pages until `limit`
 * results or results run out. Returns the ACTUAL count found — never pads.
 */
export async function searchGooglePlaces(query: string, limit: number): Promise<RawLead[]> {
  const key = env.googlePlacesApiKey;
  if (!key) throw new LeadSourceError("Google Places isn't connected (GOOGLE_PLACES_API_KEY).");

  const out: RawLead[] = [];
  let pageToken: string | undefined;
  const want = Math.min(Math.max(limit, 1), 60);

  for (let page = 0; page < 3 && out.length < want; page++) {
    const body: Record<string, unknown> = { textQuery: query, pageSize: Math.min(20, want - out.length) };
    if (pageToken) body.pageToken = pageToken;

    let res: Response;
    try {
      res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": FIELD_MASK + ",nextPageToken",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new LeadSourceError("Couldn't reach Google Places.");
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || `Google Places error (HTTP ${res.status}).`;
      if (res.status === 403 || res.status === 400) throw new LeadSourceError(`Google Places: ${msg}`);
      throw new LeadSourceError(msg);
    }
    const places: any[] = json?.places ?? [];
    for (const p of places) out.push(mapPlace(p));
    pageToken = json?.nextPageToken;
    if (!pageToken) break;
    // Google requires a short delay before a page token becomes valid.
    await new Promise((r) => setTimeout(r, 2000));
  }
  return out.slice(0, want);
}

/**
 * Unified discovery entry point. Currently backed by Google Places. Returns the
 * REAL leads found (may be fewer than requested — that's the truth, not padded).
 * Throws LeadSourceError when no discovery source is connected.
 */
export async function discoverLeads(opts: { query: string; limit: number }): Promise<RawLead[]> {
  if (!hasDiscoverySource()) {
    throw new LeadSourceError(
      "NO REAL DATA AVAILABLE — CONNECT A DATA SOURCE. Add GOOGLE_PLACES_API_KEY to enable real business discovery, or import a CSV / add leads manually.",
    );
  }
  return searchGooglePlaces(opts.query, opts.limit);
}
