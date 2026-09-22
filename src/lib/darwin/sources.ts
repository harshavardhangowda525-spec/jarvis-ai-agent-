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
    { id: "openstreetmap", label: "OpenStreetMap (free, no key)", kind: "api", connected: true },
    { id: "csv", label: "CSV Import", kind: "import", connected: true },
    { id: "manual", label: "Manual / user-provided", kind: "import", connected: true },
  ];
}

/**
 * True when automated discovery is available. OpenStreetMap Overpass needs no
 * key, so real discovery is always available (best-effort) as a fallback.
 */
export function hasDiscoverySource(): boolean {
  return true;
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

// --- OpenStreetMap Overpass (NO KEY, zero cost — the always-on fallback) ---

const NOMINATIM_UA = "JARVIS-DARWIN/1.0 (business lead discovery)";

/** Free geocoding via Nominatim (no key). Returns [lon, lat]. */
async function geocodeNominatim(place: string): Promise<[number, number]> {
  let res: Response;
  try {
    res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`, {
      headers: { accept: "application/json", "User-Agent": NOMINATIM_UA },
      signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new LeadSourceError("Couldn't reach OpenStreetMap geocoder."); }
  const json: any = await res.json().catch(() => []);
  if (!res.ok || !Array.isArray(json) || json.length === 0) {
    throw new LeadSourceError(`OpenStreetMap couldn't locate "${place}". Try a more specific location.`);
  }
  return [parseFloat(json[0].lon), parseFloat(json[0].lat)];
}

/** Map a business term to Overpass tag selectors (union of these is queried). */
function overpassSelectors(term: string): string[] {
  const t = term.toLowerCase();
  const map: [RegExp, string[]][] = [
    [/cafe|coffee|espresso/, ['"amenity"="cafe"']],
    [/restaurant|dining|eatery|bistro/, ['"amenity"="restaurant"']],
    [/bar|pub|brewery/, ['"amenity"="bar"', '"amenity"="pub"']],
    [/bakery|patisserie/, ['"shop"="bakery"']],
    [/salon|hair|barber|beauty|nails|spa/, ['"shop"="hairdresser"', '"shop"="beauty"', '"leisure"="spa"']],
    [/gym|fitness|yoga|crossfit|pilates/, ['"leisure"="fitness_centre"', '"leisure"="sports_centre"']],
    [/hotel|hostel|guest ?house|b&b|accommodation/, ['"tourism"="hotel"', '"tourism"="guest_house"']],
    [/dentist|clinic|doctor|medical|physio|health/, ['"amenity"="dentist"', '"amenity"="clinic"', '"amenity"="doctors"']],
    [/car|garage|automotive|mechanic|dealer/, ['"shop"="car"', '"shop"="car_repair"']],
    [/law|solicitor|accountant|estate agent|agency|office|tech|it |software|studio|marketing/, ['"office"']],
    [/retail|shop|store|boutique|clothing|fashion/, ['"shop"']],
  ];
  for (const [re, sels] of map) if (re.test(t)) return sels;
  return ['"shop"']; // broad default: any shop
}

function mapOverpass(el: any): RawLead {
  const tags = el?.tags ?? {};
  const name: string = tags.name || tags["name:en"] || "";
  const website: string | undefined = tags.website || tags["contact:website"] || undefined;
  const phone: string | undefined = tags.phone || tags["contact:phone"] || undefined;
  const email: string | undefined = tags.email || tags["contact:email"] || undefined;
  const igTag: string | undefined = tags["contact:instagram"] || tags.instagram;
  const instagram: string | undefined = igTag ? (igTag.startsWith("http") ? igTag : `https://instagram.com/${String(igTag).replace(/^@/, "")}`) : undefined;
  const addr = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"], tags["addr:postcode"]].filter(Boolean).join(" ");
  const location = addr || undefined;
  const category: string | undefined = tags.shop || tags.amenity || tags.office || tags.leisure || tags.tourism || undefined;
  const lat = el?.lat ?? el?.center?.lat;
  const lon = el?.lon ?? el?.center?.lon;

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
    source: "openstreetmap",
    sourceRef: el?.type && el?.id ? `${el.type}/${el.id}` : undefined,
    sourceUrl: el?.type && el?.id ? `https://www.openstreetmap.org/${el.type}/${el.id}` : undefined,
    verifiedFields: verified,
    metadata: { osmType: el?.type ?? null, lat: lat ?? null, lon: lon ?? null },
  };
}

/**
 * Real business search via OpenStreetMap Overpass — NO API KEY, no cost. Geocodes
 * the place (Nominatim), then queries businesses within a radius. Best-effort,
 * shared public endpoint, so used as the last-resort fallback. Returns the ACTUAL
 * count found — never fabricates.
 */
export async function searchOverpass(query: string, limit: number, radiusKm = 8): Promise<RawLead[]> {
  const m = query.match(/^(.*?)\s+\bin\b\s+(.+)$/i);
  const term = (m ? m[1] : query).trim();
  const place = (m ? m[2] : query).trim();
  const want = Math.min(Math.max(limit, 1), 50);

  const [lon, lat] = await geocodeNominatim(place);
  const radius = Math.min(Math.max(radiusKm, 1), 50) * 1000;

  const selectors = overpassSelectors(term);
  const union = selectors.map((sel) => `nwr[${sel}](around:${radius},${lat},${lon});`).join("");
  const ql = `[out:json][timeout:25];(${union});out center tags ${want};`;

  let res: Response;
  try {
    res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json", "User-Agent": NOMINATIM_UA },
      body: `data=${encodeURIComponent(ql)}`,
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new LeadSourceError("Couldn't reach OpenStreetMap Overpass."); }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LeadSourceError(`OpenStreetMap Overpass error (HTTP ${res.status}). ${text.slice(0, 120)}`.trim());
  }
  const json: any = await res.json().catch(() => ({}));
  const els: any[] = json?.elements ?? [];
  // Only elements that are actually named businesses.
  return els.map(mapOverpass).filter((r) => r.businessName).slice(0, want);
}

/**
 * Unified discovery entry point. Tries connected providers in order (Google
 * Places → free Geoapify → Foursquare → OpenStreetMap Overpass) and falls
 * through to the next when one errors (e.g. Foursquare's billing wall).
 * Overpass needs no key, so real discovery ALWAYS works as a last resort.
 * Returns the REAL leads found (may be fewer than requested — that's the truth,
 * not padded). Throws LeadSourceError only when every source failed.
 */
export async function discoverLeads(opts: { query: string; limit: number }): Promise<RawLead[]> {
  const providers: { name: string; run: () => Promise<RawLead[]> }[] = [];
  if (env.googlePlacesApiKey.length > 0) providers.push({ name: "Google Places", run: () => searchGooglePlaces(opts.query, opts.limit) });
  if (env.geoapifyApiKey.length > 0) providers.push({ name: "Geoapify", run: () => searchGeoapify(opts.query, opts.limit) });
  if (env.foursquareApiKey.length > 0) providers.push({ name: "Foursquare", run: () => searchFoursquare(opts.query, opts.limit) });
  // Always-available, no-key fallback so discovery never dead-ends.
  providers.push({ name: "OpenStreetMap", run: () => searchOverpass(opts.query, opts.limit) });

  const errors: string[] = [];
  for (const p of providers) {
    try {
      const leads = await p.run();
      // A keyed provider that returns 0 falls through to the next so we still try
      // the free fallback; the last provider's result is returned as-is.
      if (leads.length > 0 || p === providers[providers.length - 1]) return leads;
      errors.push(`${p.name}: 0 results`);
    } catch (err) {
      errors.push(`${p.name}: ${err instanceof Error ? err.message.replace(/^[^:]+:\s*/, "") : "failed"}`);
    }
  }
  throw new LeadSourceError(`All lead sources failed. ${errors.join(" | ")}`);
}
