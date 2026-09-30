/**
 * DARWIN's website verification + lead scoring rules. PURE — no network here;
 * checks.ts gathers the signals, this decides. Nothing is inferred beyond what
 * the signals say, and only a confident "no_website" can count toward the
 * daily target.
 */

export type WebsiteVerdict = "no_website" | "website_exists" | "unclear" | "temporarily_unavailable" | "closed";

export interface UrlCheck {
  url: string;
  /** DNS: the host resolves / doesn't exist / lookup failed. */
  dns: "ok" | "nxdomain" | "error";
  /** Got a 2xx/3xx page. */
  ok: boolean;
  status?: number;
  error?: string;
  title?: string;
  /** The page names the business (distinctive name tokens found). */
  nameMatch?: boolean;
  /** Domain-for-sale / parking page. */
  parked?: boolean;
  /** Answered behind bot protection (exists, content unreadable). */
  protected?: boolean;
}

export interface Signals {
  /** Website from the business listing itself (OpenStreetMap / Geoapify tags). */
  listed: UrlCheck | null;
  /** Google Places profile: null = not checked (no key); found=false = no matching profile. */
  google: null | { found: boolean; website: string | null; check?: UrlCheck; closed?: boolean; error?: string };
  /** Web search: null = not checked (no key). */
  search: null | { error?: string; official: UrlCheck | null; social: string[]; directories: number };
  /** Domains guessed from the business name that resolve. */
  guessed: UrlCheck[];
  /** The name has distinctive words (so name ↔ domain matching means something). */
  distinctive: boolean;
}

export interface Verdict { status: WebsiteVerdict; website: string | null; reasons: string[]; independent: string[] }

const live = (c: UrlCheck | null | undefined) => !!c && c.ok && !c.parked;
const tempDown = (c: UrlCheck | null | undefined) => !!c && c.dns === "ok" && !c.ok && !c.parked;
const gone = (c: UrlCheck | null | undefined) => !!c && (c.dns === "nxdomain" || !!c.parked);

/**
 * Decide the website status.
 *  - website_exists: any official site answers (listing, Google profile, web search, or a name-matched domain).
 *  - temporarily_unavailable: a site exists (its domain resolves) but didn't answer now.
 *  - unclear: a check that matters failed, or nothing independent could confirm the absence.
 *  - no_website: no listed / profiled / searchable / guessable site, confirmed by at least one
 *    independent source beyond the listing (Google profile without a website, or a web search
 *    with no official site) — unless `strict` is off.
 */
export function classifyWebsite(s: Signals, opts: { strict: boolean } = { strict: true }): Verdict {
  const reasons: string[] = [];
  const independent: string[] = [];
  if (s.google?.closed) return { status: "closed", website: null, reasons: ["Google lists the business as permanently closed."], independent };

  const sites: [string, UrlCheck | null | undefined][] = [
    ["listing", s.listed], ["Google profile", s.google?.check], ["web search", s.search?.official],
  ];
  for (const [src, c] of sites) if (live(c)) return { status: "website_exists", website: c!.url, reasons: [`Official website from the ${src} is online (${c!.url}).`], independent };
  const matched = s.guessed.find((g) => live(g) && g.nameMatch);
  if (matched) return { status: "website_exists", website: matched.url, reasons: [`Found a website that names the business: ${matched.url}.`], independent };

  for (const [src, c] of sites) if (tempDown(c)) return { status: "temporarily_unavailable", website: c!.url, reasons: [`The ${src} website ${c!.url} exists but didn't respond (${c!.error ?? `HTTP ${c!.status ?? "?"}`}).`], independent };
  // Google says there's a website but we couldn't even check it
  if (s.google?.website && !s.google.check) return { status: "unclear", website: s.google.website, reasons: ["Google lists a website that couldn't be checked."], independent };

  if (s.search?.error) return { status: "unclear", website: null, reasons: [`Web search check failed: ${s.search.error}.`], independent };
  if (s.google?.error) return { status: "unclear", website: null, reasons: [`Google profile check failed: ${s.google.error}.`], independent };

  // ---- no website: say exactly what was checked
  if (s.listed) reasons.push(gone(s.listed) ? `The listed site ${s.listed.url} no longer exists${s.listed.parked ? " (parked domain)" : ""}.` : `Listing site ${s.listed.url} unusable.`);
  else reasons.push("No website on the business listing.");
  if (s.google) {
    if (s.google.found && !s.google.website) { reasons.push("Google business profile has no website."); independent.push("google"); }
    else if (s.google.found && gone(s.google.check)) { reasons.push("The website on the Google profile no longer exists."); independent.push("google"); }
    else if (!s.google.found) reasons.push("No matching Google business profile.");
  }
  if (s.search) {
    reasons.push(`Web search found no official website${s.search.directories ? ` (only ${s.search.directories} directory/social listing${s.search.directories === 1 ? "" : "s"})` : ""}.`);
    independent.push("search");
  }
  if (s.distinctive) reasons.push(`No website under the business's name (${s.guessed.length ? "only unrelated or parked domains" : "no matching domains"}).`);
  if (opts.strict && !independent.length) {
    return { status: "unclear", website: null, reasons: [...reasons, "No independent source (Google profile or web search) could confirm there's no website."], independent };
  }
  return { status: "no_website", website: null, reasons, independent };
}

/* ---------------- names ↔ domains ---------------- */

const GENERIC = new Set([
  "the", "and", "of", "pvt", "private", "ltd", "limited", "llp", "inc", "co", "company", "india", "new", "best", "sri", "shri", "shree", "sree",
  "gym", "gyms", "fitness", "fit", "health", "club", "cafe", "coffee", "restaurant", "restaurants", "hotel", "kitchen", "foods", "food", "bakery", "bakers", "sweets",
  "salon", "salons", "spa", "beauty", "parlour", "parlor", "unisex", "hair", "studio", "studios", "clinic", "clinics", "dental", "hospital", "care", "medical", "diagnostics",
  "centre", "center", "centres", "centers", "coaching", "classes", "academy", "institute", "tuition", "tutorials", "school", "education",
  "store", "stores", "shop", "shops", "mart", "traders", "trading", "enterprises", "enterprise", "services", "service", "solutions", "agency", "agencies",
  "boutique", "fashion", "fashions", "collection", "collections", "garments", "textiles", "mobile", "mobiles", "electronics", "communication", "communications",
  "house", "home", "point", "zone", "world", "hub", "palace", "corner", "express", "family", "multi", "speciality", "specialty", "plus",
]);

/** Distinctive words of a business name (lower-case, ascii-folded). */
export function nameTokens(name: string): string[] {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
}

/** Domains the business could plausibly own, e.g. "Iron Temple Gym" → irontemple.in, irontemplegym.com … */
export function guessDomains(name: string, max = 6): string[] {
  const t = nameTokens(name);
  if (!t.length) return [];
  const all = name.normalize("NFKD").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  const core = t.join("");
  const bases = [...new Set([core, all].filter((b) => b.length >= 5 && b.length <= 40))];
  const out: string[] = [];
  for (const b of bases) for (const tld of [".com", ".in", ".co.in"]) out.push(`${b}${tld}`);
  return out.slice(0, max);
}

/** Does this host belong to the business (its distinctive words make up the domain label)? */
export function hostMatchesName(host: string, name: string): boolean {
  const t = nameTokens(name);
  if (!t.length) return false;
  const label = host.toLowerCase().replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/g, "");
  const core = t.join("");
  if (core.length >= 5 && label.includes(core)) return true;
  const hits = t.filter((w) => label.includes(w)).length;
  return t.length >= 2 ? hits >= 2 : hits === 1 && t[0].length >= 5 && label.startsWith(t[0]);
}

/** Does a page's text name the business? (its distinctive words, most of them) */
export function textNamesBusiness(text: string, name: string): boolean {
  const t = nameTokens(name);
  if (!t.length) return false;
  const low = text.toLowerCase();
  return t.filter((w) => low.includes(w)).length >= Math.max(1, Math.ceil(t.length * 0.66));
}

const PARKED = /domain (is )?for sale|buy this domain|this domain (may be|is) for sale|domain parking|parked (free|domain)|hugedomains|sedo(parking)?\b|godaddy.{0,20}(parked|for sale)|dan\.com|afternic|domain has expired|account suspended/i;
export function looksParked(text: string): boolean { return PARKED.test(text); }

/** Directory, marketplace, map and social hosts — a listing there is NOT an official website. */
const DIRECTORY = /(^|\.)(justdial|sulekha|indiamart|tradeindia|facebook|fb|instagram|twitter|x|linkedin|youtube|zomato|swiggy|magicpin|dineout|eazydiner|practo|lybrate|google|goo\.gl|g\.page|maps\.app\.goo|tripadvisor|yelp|wikipedia|wikimapia|lbb|nobroker|housing|99acres|magicbricks|urbancompany|urbanclap|asklaila|yellowpages|grotal|mapquest|foursquare|booking|makemytrip|goibibo|oyorooms|agoda|cult|fitpass|gymsnearby|bookmyshow|whatsapp|wa\.me|linktr|pinterest|quora|reddit|threads|shiksha|collegedunia|urbanpro|nearbuy|dunzo|zepto|blinkit|amazon|flipkart|meesho|myntra|ajio|nykaa|glassdoor|naukri|indeed|olx|quikr|clickindia|hotfrog|cybo|brownbook|allevents|townscript|fresha|booksy|setmore|zoho|wix)\.[a-z.]+$/i;
export function isDirectoryHost(host: string): boolean { return DIRECTORY.test(host.toLowerCase()); }
export function isSocialUrl(url: string): boolean { return /(^|\.)(instagram|facebook|fb)\.com\//i.test(url); }

export function hostOf(url: string): string {
  try { return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase(); } catch { return ""; }
}

/* ---------------- phone ---------------- */

/** Validate a listed phone number (India-first, but accepts other E.164 numbers). */
export function verifyPhone(raw: string | null | undefined): { ok: boolean; normalized: string | null; mobile: boolean } {
  if (!raw) return { ok: false, normalized: null, mobile: false };
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.startsWith("0091")) d = d.slice(4);
  else if (d.startsWith("91") && d.length === 12) d = d.slice(2);
  else if (d.startsWith("+")) { const n = d.slice(1); return { ok: n.length >= 8 && n.length <= 15, normalized: n.length >= 8 ? `+${n}` : null, mobile: false }; }
  const trunk = /^0[1-9]/.test(d);
  d = d.replace(/^0+/, "");
  // "0" + a metro STD code (080 Bengaluru, 022 Mumbai…) is a landline even though it starts with 8/7/9
  const metroLandline = trunk && /^(11|20|22|33|40|44|79|80)\d{8}$/.test(d);
  if (/^[6-9]\d{9}$/.test(d) && !metroLandline) return { ok: true, normalized: `+91 ${d.slice(0, 5)} ${d.slice(5)}`, mobile: true };
  if (/^[1-9]\d{9}$/.test(d)) return { ok: true, normalized: `+91 ${d}`, mobile: false }; // landline with STD code
  return { ok: false, normalized: null, mobile: false };
}

/* ---------------- categories + scoring ---------------- */

export const BUCKETS = ["Gyms", "Restaurants/Cafes", "Salons/Spas", "Coaching Centers", "Clinics", "Retail Stores", "Other"] as const;
export type Bucket = (typeof BUCKETS)[number];

export function categoryBucket(category: string | null | undefined): Bucket {
  const c = (category ?? "").toLowerCase();
  if (/gym|fitness|yoga|pilates|crossfit|sport/.test(c)) return "Gyms";
  if (/restaurant|cafe|café|coffee|bakery|food|dhaba|bar|pub|eatery|fast/.test(c)) return "Restaurants/Cafes";
  if (/salon|spa|beauty|hair|barber|massage|parlou?r/.test(c)) return "Salons/Spas";
  if (/coaching|education|tuition|academy|institute|school|training|classes/.test(c)) return "Coaching Centers";
  if (/clinic|dent|physio|doctor|hospital|health|pharmac|diagnostic|optic|vet/.test(c)) return "Clinics";
  if (/store|shop|cloth|apparel|boutique|retail|mobile|electronic|jewel|furniture|grocery|supermarket|mart/.test(c)) return "Retail Stores";
  return "Other";
}

/** Categories that especially need bookings / ordering / memberships online. */
const APP_READY: Bucket[] = ["Gyms", "Restaurants/Cafes", "Salons/Spas", "Clinics", "Coaching Centers"];

export interface ScoreInput {
  verdict: WebsiteVerdict;
  bucket: Bucket;
  phoneOk: boolean;
  mobile: boolean;
  email: boolean;
  social: number;          // social profiles actually found (instagram / facebook)
  distanceM: number | null;
  reviews: number | null;  // Google review count (only when Google was checked)
  rating: number | null;
}

export interface Score { score: number; highPotential: boolean; parts: { label: string; points: number }[]; needs: string[] }

/** Sales-signal score (0–100) from facts only — nothing is guessed to raise it. */
export function scoreLead(i: ScoreInput): Score {
  const parts: Score["parts"] = [];
  const add = (label: string, points: number) => { if (points) parts.push({ label, points }); };
  if (i.verdict === "no_website") add("Verified: no website", 30);
  if (i.phoneOk) add(i.mobile ? "Mobile number listed" : "Phone listed", i.mobile ? 20 : 16);
  if (i.email) add("Email listed", 4);
  add(APP_READY.includes(i.bucket) ? `${i.bucket}: bookings/ordering business` : "Local business", APP_READY.includes(i.bucket) ? 14 : 7);
  if (i.distanceM != null) add(i.distanceM <= 3000 ? "Within 3 km" : i.distanceM <= 8000 ? "Within 8 km" : "In the search area", i.distanceM <= 3000 ? 10 : i.distanceM <= 8000 ? 6 : 2);
  if (i.social > 0) add("Active on social media, no site", 10);
  if (i.reviews != null) add(i.reviews >= 50 ? `${i.reviews} Google reviews` : i.reviews >= 10 ? `${i.reviews} Google reviews` : "", i.reviews >= 50 ? 12 : i.reviews >= 10 ? 6 : 0);
  if (i.rating != null && i.rating >= 4.2 && (i.reviews ?? 0) >= 10) add(`Rated ${i.rating} on Google`, 4);
  const score = Math.min(100, parts.reduce((s, p) => s + p.points, 0));
  const needs = ["Website"];
  if (i.bucket === "Restaurants/Cafes") needs.push("Online ordering");
  if (i.bucket === "Salons/Spas" || i.bucket === "Clinics") needs.push("Online booking");
  if (i.bucket === "Gyms") needs.push("Membership app");
  if (i.bucket === "Coaching Centers") needs.push("Enrolment & student app");
  return { score, highPotential: score >= 70 && i.phoneOk, parts, needs };
}

/* ---------------- phone numbers from public web pages ---------------- */

/** Numbers that are never a small business's own line: toll-free, repeated digits, directory helplines. */
const NOT_A_BUSINESS_LINE = [/^\+91 1[89]00/, /^\+91 (\d)\1{3} ?\1{5}$/, /^\+91 (88888 88888|99999 99999|12345 67890)$/];

/** Valid phone numbers written in a piece of text (Indian formats), normalised, in order, without repeats. */
export function phonesInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:\+\s?91[\s.-]*|\b0?91[\s.-]*|\b0)?\(?\d{2,5}\)?(?:[\s.-]?\d){5,10}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) continue;
    const v = verifyPhone(m[0]);
    if (!v.ok || !v.normalized || NOT_A_BUSINESS_LINE.some((re) => re.test(v.normalized!))) continue;
    if (!out.includes(v.normalized)) out.push(v.normalized);
  }
  return out;
}

export interface SearchResultText { url: string; title?: string | null; content?: string | null }

/**
 * The business's own phone number from web search results — never a guess:
 * only numbers inside results that name the business count. A number seen in
 * two such results wins; one seen once also needs the result to be a business
 * listing (directory/social page) or to mention the locality.
 */
export function phoneFromResults(results: SearchResultText[], name: string, locality: string): { phone: string; source: string } | null {
  const place = nameTokens(locality).slice(0, 2);
  const tally = new Map<string, { n: number; strong: boolean; source: string }>();
  for (const r of results) {
    const text = `${r.title ?? ""}\n${r.content ?? ""}`;
    if (!textNamesBusiness(text, name)) continue;
    const host = hostOf(r.url);
    const listing = isDirectoryHost(host) || isSocialUrl(r.url);
    const local = place.some((w) => text.toLowerCase().includes(w));
    for (const p of phonesInText(text)) {
      const t = tally.get(p) ?? { n: 0, strong: false, source: host || "web" };
      t.n++; t.strong ||= listing || local;
      tally.set(p, t);
    }
  }
  const best = [...tally.entries()].filter(([, t]) => t.n >= 2 || t.strong).sort((a, b) => b[1].n - a[1].n)[0];
  return best ? { phone: best[0], source: best[1].source } : null;
}
