import "server-only";
import { createHash } from "node:crypto";

/**
 * Geoapify client for DARWIN. Server-side only — the API key never reaches the
 * browser (it's read from GEOAPIFY_API_KEY by the caller). Every lead is built
 * strictly from what Geoapify returned: a field that isn't in the response
 * stays empty. Nothing is guessed, padded or invented.
 */

const BASE = "https://api.geoapify.com";

export type GeoapifyErrorKind = "no_key" | "auth" | "rate_limit" | "bad_request" | "not_found" | "network";

export class GeoapifyError extends Error {
  constructor(message: string, public kind: GeoapifyErrorKind) {
    super(message);
    this.name = "GeoapifyError";
  }
}

/** HTTP status the API should answer with for each Geoapify failure. */
export function geoapifyHttpStatus(kind: GeoapifyErrorKind): number {
  return { no_key: 503, auth: 502, rate_limit: 429, bad_request: 400, not_found: 404, network: 502 }[kind];
}

async function call(url: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new GeoapifyError("Couldn't reach Geoapify. Check the internet connection and try again.", "network");
  }
  const json: any = await res.json().catch(() => ({}));
  if (res.status === 429) {
    throw new GeoapifyError("Geoapify rate limit reached — DARWIN stopped searching. Wait a minute (or until your daily quota resets), then try again.", "rate_limit");
  }
  if (res.status === 401 || res.status === 403) {
    throw new GeoapifyError("Geoapify rejected the API key. Check GEOAPIFY_API_KEY.", "auth");
  }
  if (!res.ok) {
    const detail = String(json?.message || json?.error || `HTTP ${res.status}`).slice(0, 200);
    throw new GeoapifyError(`Geoapify error: ${detail}`, res.status === 400 ? "bad_request" : "network");
  }
  return json;
}

// ---- location ----------------------------------------------------------------

export interface GeoCenter { lat: number; lon: number; label: string }

/** City, area, neighbourhood, postcode — or raw "lat,lon" coordinates. */
export async function geocode(text: string, key: string): Promise<GeoCenter> {
  const coords = text.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (coords) {
    const lat = Number(coords[1]), lon = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon, label: `${lat}, ${lon}` };
  }
  const json = await call(`${BASE}/v1/geocode/search?text=${encodeURIComponent(text)}&limit=1&format=json&apiKey=${encodeURIComponent(key)}`);
  const r = json?.results?.[0];
  if (!r || typeof r.lat !== "number" || typeof r.lon !== "number") {
    throw new GeoapifyError(`Geoapify couldn't find the location "${text}". Try a city, area or postcode.`, "not_found");
  }
  return { lat: r.lat, lon: r.lon, label: String(r.formatted || text) };
}

// ---- categories ----------------------------------------------------------------

export interface CategoryPlan {
  /** Geoapify category ids (comma-separated). */
  categories: string;
  /** Optional Geoapify name filter (used for free-text categories). */
  name?: string;
  /** Human label shown on the lead. */
  label: string;
  /** For free-text searches: a result must mention the term in its name/categories. */
  keyword?: RegExp;
}

// Natural category words → Geoapify taxonomy. Anything not listed still works
// through the free-text plan below — this is a speed-up, not a whitelist.
const CATEGORY_MAP: [RegExp, Omit<CategoryPlan, "keyword">][] = [
  [/yoga|pilates/, { categories: "sport", name: "yoga", label: "Yoga studio" }],
  [/\bgym|fitness|crossfit|workout/, { categories: "sport.fitness", label: "Gym / fitness centre" }],
  [/caf[eé]|coffee/, { categories: "catering.cafe", label: "Cafe" }],
  [/bakery|bakeries|cake shop/, { categories: "commercial.food_and_drink.bakery", label: "Bakery" }],
  [/restaurant|eatery|dining|biryani|dhaba|\bfood\b/, { categories: "catering.restaurant,catering.fast_food", label: "Restaurant" }],
  [/\bbars?\b|\bpubs?\b|brewery/, { categories: "catering.bar,catering.pub", label: "Bar / pub" }],
  [/salon|hair|barber|beauty parlou?r/, { categories: "service.beauty.hairdresser,service.beauty", label: "Salon" }],
  [/\bspas?\b|massage/, { categories: "service.beauty.spa,service.beauty.massage,leisure.spa", label: "Spa" }],
  [/dentist|dental/, { categories: "healthcare.dentist", label: "Dentist" }],
  [/physio/, { categories: "healthcare", name: "physio", label: "Physiotherapist" }],
  [/pharmac|chemist|medical store/, { categories: "healthcare.pharmacy", label: "Pharmacy" }],
  [/clinic|doctor|hospital|diagnostic|medical/, { categories: "healthcare.clinic_or_praxis,healthcare.hospital", label: "Clinic" }],
  [/coaching|tuition|academy|institute|classes|training cent/, { categories: "education", label: "Coaching / education" }],
  [/school/, { categories: "education.school", label: "School" }],
  [/cloth|apparel|boutique|fashion|garment|saree|tailor/, { categories: "commercial.clothing", label: "Clothing store" }],
  [/mobile|phone shop|smartphone/, { categories: "commercial.elektronics", name: "mobile", label: "Mobile shop" }],
  [/electronic/, { categories: "commercial.elektronics", label: "Electronics store" }],
  [/real ?estate|realtor|property|estate agent/, { categories: "office.estate_agent", label: "Real estate agency" }],
  [/hostel|guest ?house|homestay/, { categories: "accommodation.hostel,accommodation.guest_house", label: "Guest house / hostel" }],
  [/hotel|lodge|resort/, { categories: "accommodation.hotel", label: "Hotel" }],
  [/supermarket|grocery|kirana/, { categories: "commercial.supermarket,commercial.convenience", label: "Grocery store" }],
  [/jewel/, { categories: "commercial.jewelry", label: "Jewellery store" }],
  [/furniture|interior/, { categories: "commercial.furniture_and_interior", label: "Furniture / interiors" }],
  [/car (repair|service)|garage|mechanic/, { categories: "service.vehicle.repair", label: "Vehicle service" }],
  [/car dealer|showroom/, { categories: "commercial.vehicle", label: "Vehicle showroom" }],
  [/optic|eyewear|spectacle/, { categories: "commercial.health_and_beauty.optician", label: "Optician" }],
  [/laundry|dry ?clean/, { categories: "service.cleaning.laundry,service.cleaning.dry_cleaning", label: "Laundry" }],
  [/lawyer|advocate|legal/, { categories: "office.lawyer", label: "Law office" }],
  [/accountant|chartered/, { categories: "office.accountant", label: "Accountant" }],
  [/\bpets?\b|veterinar|\bvet\b/, { categories: "pet", label: "Pet shop / vet" }],
];

// Broad business buckets for free-text categories (combined with a name match).
const BROAD = "commercial,service,office,catering,healthcare,education,sport,accommodation,leisure,entertainment";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Turn what the user typed ("gyms", "coaching centers", "tattoo studios") into a search plan. */
export function categoryPlan(input: string): CategoryPlan {
  const t = input.trim().toLowerCase();
  if (!t || /^(all |any |local |small )?(business(es)?|compan(y|ies)|shops?|stores?|leads?|places?)$/.test(t)) {
    return { categories: BROAD, label: "Local business" };
  }
  for (const [re, plan] of CATEGORY_MAP) if (re.test(t)) return { ...plan };
  // Free text: search broadly, filtered by the most meaningful word (singular).
  const word = t.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(shops?|stores?|centers?|centres?|services?|the|and|near)$/.test(w))[0] ?? t;
  const stem = word.replace(/(ies)$/, "y").replace(/([^s])s$/, "$1");
  const pretty = input.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  return { categories: BROAD, name: stem, label: pretty, keyword: new RegExp(escapeRe(stem.slice(0, Math.max(4, stem.length - 1))), "i") };
}

// ---- places ------------------------------------------------------------------

export interface PlacesPage { features: any[] }

/**
 * One page of real places around a centre, nearest first. Retries once without
 * the optional name filter if Geoapify rejects the request shape.
 */
export async function searchPlaces(opts: {
  center: GeoCenter; radiusM: number; plan: CategoryPlan; limit: number; offset: number; key: string;
}): Promise<PlacesPage> {
  const { center, radiusM, plan, limit, offset, key } = opts;
  const build = (withName: boolean) => {
    const p = new URLSearchParams({
      categories: plan.categories,
      filter: `circle:${center.lon},${center.lat},${Math.round(radiusM)}`,
      bias: `proximity:${center.lon},${center.lat}`,
      limit: String(limit),
      offset: String(offset),
      lang: "en",
    });
    if (withName && plan.name) p.set("name", plan.name);
    return `${BASE}/v2/places?${p.toString()}&apiKey=${encodeURIComponent(key)}`;
  };
  try {
    const json = await call(build(true));
    return { features: Array.isArray(json?.features) ? json.features : [] };
  } catch (e) {
    if (e instanceof GeoapifyError && e.kind === "bad_request" && plan.name) {
      const json = await call(build(false));
      return { features: Array.isArray(json?.features) ? json.features : [] };
    }
    throw e;
  }
}

// ---- mapping a real place → lead ----------------------------------------------

export interface GeoLead {
  placeId: string | null;
  name: string;
  category: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  instagram: string | null;
  /** Further numbers the listing carried (a place can list several). */
  otherPhones: string[];
  lat: number;
  lon: number;
  distanceM: number | null;
  geoCategories: string[];
}

const first = (...vals: unknown[]): string | null => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

function prettyCategory(cats: string[], plan: CategoryPlan): string {
  if (!plan.keyword) return plan.label; // mapped plan: we asked for exactly this
  const specific = cats.find((c) => plan.categories.split(",").some((b) => c.startsWith(`${b}.`))) ?? cats[0];
  if (!specific) return plan.label;
  const leaf = specific.split(".").pop() ?? specific;
  return leaf.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Straight-line distance in metres (from real coordinates). */
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * Build a lead from ONE Geoapify feature. Returns null for places without a
 * name or coordinates (not a usable business record). Missing phone/website/
 * email stay null — never filled in.
 */
export function mapFeature(f: any, center: GeoCenter, plan: CategoryPlan): GeoLead | null {
  const p = f?.properties ?? {};
  const raw = p?.datasource?.raw ?? {};
  const name = first(p.name, raw.name, raw["name:en"]);
  const lat = typeof p.lat === "number" ? p.lat : f?.geometry?.coordinates?.[1];
  const lon = typeof p.lon === "number" ? p.lon : f?.geometry?.coordinates?.[0];
  if (!name || typeof lat !== "number" || typeof lon !== "number") return null;

  const cats: string[] = Array.isArray(p.categories) ? p.categories : [];
  const phones = listedPhones(p, raw);
  const phone = phones[0] ?? null;
  const website = first(p.website, p.contact?.website, raw.website, raw["contact:website"], raw.url);
  const ig = first(raw["contact:instagram"], raw.instagram);

  return {
    placeId: first(p.place_id),
    name,
    category: prettyCategory(cats, plan),
    address: first(p.formatted, [p.address_line1, p.address_line2].filter(Boolean).join(", ")),
    phone,
    website,
    email: first(p.contact?.email, raw.email, raw["contact:email"]),
    instagram: ig ? (ig.startsWith("http") ? ig : `https://instagram.com/${ig.replace(/^@/, "")}`) : null,
    otherPhones: phones.slice(1),
    lat,
    lon,
    distanceM: typeof p.distance === "number" ? Math.round(p.distance) : haversineM(center, { lat, lon }),
    geoCategories: cats,
  };
}

/**
 * Every phone number the listing actually carries — phone, mobile and WhatsApp
 * tags, with lists ("080 1234 5678; +91 98450 00000") split into separate
 * numbers. A number only counts with at least 7 digits; duplicates are dropped.
 * Nothing is formatted into existence: each value is exactly as listed.
 */
export function listedPhones(p: any, raw: any): string[] {
  const vals = [p?.contact?.phone, raw?.phone, raw?.["contact:phone"], raw?.mobile, raw?.["contact:mobile"], raw?.["phone:mobile"], raw?.["contact:whatsapp"], raw?.whatsapp];
  const out: string[] = [], seen = new Set<string>();
  for (const v of vals) {
    if (typeof v !== "string") continue;
    for (const part of v.split(/[;,|]|\s{2,}/)) {
      const num = part.trim();
      const digits = num.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) continue;
      const key = digits.slice(-10);
      if (seen.has(key)) continue;
      seen.add(key); out.push(num);
    }
  }
  return out;
}

/** For free-text categories: keep only places that actually match the term. */
export function matchesPlan(l: GeoLead, plan: CategoryPlan): boolean {
  if (!plan.keyword) return true;
  return plan.keyword.test(l.name) || l.geoCategories.some((c) => plan.keyword!.test(c));
}

// ---- identity -------------------------------------------------------------------

const normText = (s: string | null | undefined) =>
  (s ?? "").normalize("NFKD").toLowerCase().replace(/['’`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Persistent identity of a discovered business: normalized name + normalized
 * address + phone digits + coordinates (~11 m). Stored with every lead so the
 * same business is never shown as "new" twice.
 */
export function discoveryFingerprint(l: Pick<GeoLead, "name" | "address" | "phone" | "lat" | "lon">): string {
  const phone = (l.phone ?? "").replace(/\D/g, "").slice(-10);
  const basis = `${normText(l.name)}|${normText(l.address)}|${phone}|${l.lat.toFixed(4)}|${l.lon.toFixed(4)}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

/** Map links from real coordinates (only when coordinates exist). */
export function mapLinks(lat: number | null | undefined, lon: number | null | undefined) {
  if (typeof lat !== "number" || typeof lon !== "number") return { mapsUrl: null, osmUrl: null };
  return {
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
    osmUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`,
  };
}
