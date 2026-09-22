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
    { id: "geoapify", label: "Geoapify Places (free)", kind: "api", connected: env.geoapifyApiKey.length > 0 },
    { id: "foursquare", label: "Foursquare Places", kind: "api", connected: env.foursquareApiKey.length > 0 },
    { id: "csv", label: "CSV Import", kind: "import", connected: true },
    { id: "manual", label: "Manual / user-provided", kind: "import", connected: true },
  ];
}

/** True when at least one automated discovery source (an API) is connected. */
export function hasDiscoverySource(): boolean {
  return env.googlePlacesApiKey.length > 0 || env.foursquareApiKey.length > 0 || env.geoapifyApiKey.length > 0;
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

// --- Foursquare Places (free alternative to Google Places) ----------------

function mapFoursquare(p: any): RawLead {
  // Defensive across Foursquare API generations (v3 + new Places API).
  const name: string = p?.name ?? "";
  const website: string | undefined = p?.website || undefined;
  const phone: string | undefined = p?.tel || undefined;
  const email: string | undefined = p?.email || undefined;
  const loc = p?.location ?? {};
  const location: string | undefined =
    loc?.formatted_address || [loc?.address, loc?.locality, loc?.region, loc?.postcode].filter(Boolean).join(", ") || undefined;
  const category: string | undefined = p?.categories?.[0]?.name ?? p?.categories?.[0]?.short_name ?? undefined;
  const id: string | undefined = p?.fsq_place_id ?? p?.fsq_id ?? p?.id;
  const instagram: string | undefined = p?.social_media?.instagram
    ? `https://instagram.com/${String(p.social_media.instagram).replace(/^@/, "")}`
    : undefined;

  const verified: string[] = ["businessName"];
  if (website) verified.push("website");
  if (phone) verified.push("phone");
  if (email) verified.push("email");
  if (location) verified.push("location");
  if (category) verified.push("category");

  return {
    businessName: name,
    category,
    location,
    website,
    phone,
    email,
    instagram,
    source: "foursquare",
    sourceRef: id,
    sourceUrl: id ? `https://foursquare.com/v/${id}` : undefined,
    verifiedFields: verified,
    metadata: {
      rating: p?.rating ?? null,
      popularity: p?.popularity ?? null,
      categories: (p?.categories ?? []).map((c: any) => c?.name).filter(Boolean),
    },
  };
}

/**
 * Real business search via Foursquare Places. Free tier, single API key. The
 * query is split into a search term + a "near" locality (from "<term> in
 * <place>") so results are geographically scoped. Returns the ACTUAL count.
 */
export async function searchFoursquare(query: string, limit: number): Promise<RawLead[]> {
  const key = env.foursquareApiKey;
  if (!key) throw new LeadSourceError("Foursquare isn't connected (FOURSQUARE_API_KEY).");

  // Split "cafes in London, UK" → term="cafes", near="London, UK".
  const m = query.match(/^(.*?)\s+\bin\b\s+(.+)$/i);
  const term = (m ? m[1] : query).trim();
  const near = (m ? m[2] : "").trim();
  const want = Math.min(Math.max(limit, 1), 50);

  const fields = "fsq_place_id,fsq_id,name,website,tel,email,location,categories,social_media,rating,popularity";
  const params = new URLSearchParams({ query: term || "business", limit: String(want), fields });
  if (near) params.set("near", near);

  // Foursquare has two key generations that use different hosts + auth:
  //  • New Places API  → places-api.foursquare.com, Bearer token + version header
  //  • Legacy v3       → api.foursquare.com/v3, raw Authorization header
  // A key only works on the generation it was issued for, so we try the new API
  // first and transparently fall back to legacy v3 on an auth/route failure —
  // whichever kind of key you generated, discovery just works.
  const attempts: { url: string; headers: Record<string, string> }[] = [
    {
      url: `https://places-api.foursquare.com/places/search?${params.toString()}`,
      headers: { accept: "application/json", authorization: `Bearer ${key}`, "X-Places-Api-Version": env.foursquareApiVersion },
    },
    {
      url: `https://api.foursquare.com/v3/places/search?${params.toString()}`,
      headers: { accept: "application/json", authorization: key },
    },
  ];

  let lastMsg = "Foursquare request failed.";
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    let res: Response;
    try {
      res = await fetch(a.url, { method: "GET", headers: a.headers, signal: AbortSignal.timeout(20_000) });
    } catch {
      lastMsg = "Couldn't reach Foursquare Places.";
      continue; // network hiccup → try the other generation
    }
    const json: any = await res.json().catch(() => ({}));
    if (res.ok) {
      const results: any[] = json?.results ?? [];
      return results.map(mapFoursquare).filter((r) => r.businessName).slice(0, want);
    }
    lastMsg = json?.message || json?.error?.message || json?.error || `HTTP ${res.status}`;
    // Only fall through to the legacy endpoint for auth/route errors; a real
    // query error (e.g. 400 bad params) should surface immediately.
    if (![401, 403, 404].includes(res.status)) break;
  }
  throw new LeadSourceError(`Foursquare: ${lastMsg}`);
}

// --- Geoapify Places (TRULY free — 3k/day, API key, no credit card) -------

// Map a free-text business term to Geoapify's category taxonomy. Falls back to
// the broad "commercial" bucket (all shops/businesses) for anything unmapped.
function geoapifyCategories(term: string): string {
  const t = term.toLowerCase();
  const map: [RegExp, string][] = [
    [/cafe|coffee|espresso/, "catering.cafe"],
    [/restaurant|dining|eatery|bistro/, "catering.restaurant"],
    [/bar|pub|brewery/, "catering.bar,catering.pub"],
    [/bakery|patisserie/, "commercial.food_and_drink.bakery"],
    [/salon|hair|barber|beauty|nails|spa/, "service.beauty,service.beauty.hairdresser"],
    [/gym|fitness|yoga|crossfit|pilates/, "sport.fitness,leisure.spa"],
    [/hotel|hostel|guest ?house|b&b|accommodation/, "accommodation.hotel,accommodation"],
    [/retail|shop|store|boutique|clothing|fashion/, "commercial"],
    [/dentist|clinic|doctor|medical|physio|health/, "healthcare"],
    [/law|solicitor|accountant|estate agent|agency|office|tech|it |software|studio|marketing/, "office,commercial.business"],
    [/car|garage|automotive|mechanic|dealer/, "commercial.vehicle,service.vehicle"],
  ];
  for (const [re, cat] of map) if (re.test(t)) return cat;
  return "commercial";
}

function mapGeoapify(f: any): RawLead {
  const p = f?.properties ?? {};
  const raw = p?.datasource?.raw ?? {};
  const name: string = p?.name || raw?.name || "";
  const website: string | undefined = p?.website || raw?.website || raw?.["contact:website"] || undefined;
  const phone: string | undefined = raw?.phone || raw?.["contact:phone"] || p?.contact?.phone || undefined;
  const email: string | undefined = raw?.email || raw?.["contact:email"] || undefined;
  const location: string | undefined = p?.formatted || p?.address_line2 || undefined;
  const category: string | undefined = (Array.isArray(p?.categories) ? p.categories[0] : undefined) || raw?.shop || raw?.amenity || undefined;
  const igTag: string | undefined = raw?.["contact:instagram"] || raw?.instagram;
  const instagram: string | undefined = igTag ? (igTag.startsWith("http") ? igTag : `https://instagram.com/${String(igTag).replace(/^@/, "")}`) : undefined;
  const id: string | undefined = p?.place_id ?? p?.datasource?.raw?.osm_id?.toString();

  const verified: string[] = ["businessName"];
  if (website) verified.push("website");
  if (phone) verified.push("phone");
  if (email) verified.push("email");
  if (location) verified.push("location");
  if (category) verified.push("category");

  return {
    businessName: name,
    category,
    location,
    website,
    phone,
    email,
    instagram,
    source: "geoapify",
    sourceRef: id,
    sourceUrl: p?.lon && p?.lat ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=19/${p.lat}/${p.lon}` : undefined,
    verifiedFields: verified,
    metadata: { categories: p?.categories ?? [], osm: raw?.osm_id ?? null },
  };
}

/**
 * Real business search via Geoapify. Geoapify Places needs a geographic filter
 * (not free text), so we geocode "<term> in <place>" → lat/lon, then query
 * businesses in a radius. Returns the ACTUAL count found.
 */
export async function searchGeoapify(query: string, limit: number, radiusKm = 10): Promise<RawLead[]> {
  const key = env.geoapifyApiKey;
  if (!key) throw new LeadSourceError("Geoapify isn't connected (GEOAPIFY_API_KEY).");

  const m = query.match(/^(.*?)\s+\bin\b\s+(.+)$/i);
  const term = (m ? m[1] : query).trim();
  const place = (m ? m[2] : query).trim();
  const want = Math.min(Math.max(limit, 1), 50);

  // 1) Geocode the place → coordinates.
  let geo: Response;
  try {
    geo = await fetch(`https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(place)}&limit=1&apiKey=${key}`, {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new LeadSourceError("Couldn't reach Geoapify (geocoding)."); }
  const geoJson: any = await geo.json().catch(() => ({}));
  if (!geo.ok) throw new LeadSourceError(`Geoapify: ${geoJson?.message || `geocoding failed (HTTP ${geo.status})`}`);
  const coords = geoJson?.features?.[0]?.geometry?.coordinates; // [lon, lat]
  if (!coords || coords.length < 2) throw new LeadSourceError(`Geoapify couldn't locate "${place}". Try a more specific location.`);
  const [lon, lat] = coords;

  // 2) Query businesses within the radius.
  const radius = Math.min(Math.max(radiusKm, 1), 50) * 1000;
  const cats = geoapifyCategories(term);
  const url = `https://api.geoapify.com/v2/places?categories=${encodeURIComponent(cats)}&filter=circle:${lon},${lat},${radius}&bias=proximity:${lon},${lat}&limit=${want}&apiKey=${key}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  } catch { throw new LeadSourceError("Couldn't reach Geoapify (places)."); }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new LeadSourceError(`Geoapify: ${json?.message || json?.error || `places failed (HTTP ${res.status})`}`);
  const feats: any[] = json?.features ?? [];
  return feats.map(mapGeoapify).filter((r) => r.businessName).slice(0, want);
}

/**
 * Unified discovery entry point. Tries connected providers in order (Google
 * Places → free Geoapify → Foursquare) and falls through to the next when one
 * errors (e.g. Foursquare's billing wall). Returns the REAL leads found (may be
 * fewer than requested — that's the truth, not padded). Throws LeadSourceError
 * only when no source is connected or every connected source failed.
 */
export async function discoverLeads(opts: { query: string; limit: number }): Promise<RawLead[]> {
  const providers: { name: string; run: () => Promise<RawLead[]> }[] = [];
  if (env.googlePlacesApiKey.length > 0) providers.push({ name: "Google Places", run: () => searchGooglePlaces(opts.query, opts.limit) });
  if (env.geoapifyApiKey.length > 0) providers.push({ name: "Geoapify", run: () => searchGeoapify(opts.query, opts.limit) });
  if (env.foursquareApiKey.length > 0) providers.push({ name: "Foursquare", run: () => searchFoursquare(opts.query, opts.limit) });

  if (providers.length === 0) {
    throw new LeadSourceError(
      "NO REAL DATA AVAILABLE — CONNECT A DATA SOURCE. Add the free GEOAPIFY_API_KEY (no credit card) or GOOGLE_PLACES_API_KEY to enable real business discovery, or import a CSV / add leads manually.",
    );
  }

  const errors: string[] = [];
  for (const p of providers) {
    try {
      return await p.run(); // first provider that responds wins (even with 0 results)
    } catch (err) {
      errors.push(`${p.name}: ${err instanceof Error ? err.message.replace(/^[^:]+:\s*/, "") : "failed"}`);
    }
  }
  throw new LeadSourceError(`All connected lead sources failed. ${errors.join(" | ")}`);
}
