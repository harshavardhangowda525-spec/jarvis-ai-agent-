import "server-only";
import { SearchPool, searchConfigured, type ProviderId } from "../web-search";
import { promises as dns } from "node:dns";
import net from "node:net";
import { env } from "@/lib/env";
import {
  guessDomains, hostMatchesName, hostOf, isDirectoryHost, isSocialUrl, looksParked, nameTokens, textNamesBusiness, phoneFromResults, verifyPhone, emailFromResults, isFreeMail,
  type Signals, type UrlCheck,
} from "./verify";

/**
 * The real-world checks behind DARWIN's website verification: DNS, a fetch of
 * the site, the Google business profile (when GOOGLE_PLACES_API_KEY is set) and
 * a web search (SearXNG, Brave, Tavily or Serper — see ../web-search). Every URL comes from
 * third-party data, so fetches are SSRF-guarded: http(s) on default ports only,
 * public IPs only, and redirects are re-validated hop by hop.
 */

const UA = "Mozilla/5.0 (compatible; DARWIN-verify/1.0; +https://infinitywebapps)";

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))]);
}

export async function resolveHost(host: string): Promise<{ state: "ok" | "nxdomain" | "error"; ips: string[] }> {
  try {
    const r = await withTimeout(dns.lookup(host, { all: true }), 5000, "DNS");
    return { state: "ok", ips: r.map((x) => x.address) };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { state: code === "ENOTFOUND" || code === "ENODATA" ? "nxdomain" : "error", ips: [] };
  }
}

/** Fetch a site safely and say whether it's up, whose it is, and whether it's parked. */
export interface StrictMatch { locality: string; phone?: string | null }

/** Full business name in the page AND its locality or phone — for domains we only guessed. */
export function strictNameMatch(text: string, businessName: string, m: StrictMatch): boolean {
  const norm = (x: string) => x.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const t = ` ${norm(text)} `;
  if (!t.includes(` ${norm(businessName)} `)) return false;
  const places = norm(m.locality).split(" ").filter((w) => w.length >= 4);
  const digits = (m.phone ?? "").replace(/\D/g, "").slice(-8);
  return places.some((w) => t.includes(` ${w} `)) || (digits.length === 8 && text.replace(/\D/g, "").includes(digits));
}

export async function checkUrl(input: string, businessName: string, timeoutMs = 8000, strict?: StrictMatch): Promise<UrlCheck> {
  let url = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^https?:\/\//i.test(url)) return { url, dns: "error", ok: false, error: "unsupported URL" };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const out: UrlCheck = { url, dns: "error", ok: false };
  let current: URL;
  try { current = new URL(url); } catch { return { ...out, error: "invalid URL" }; }
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(current.protocol) || (current.port && current.port !== "80" && current.port !== "443")) return { ...out, error: "unsupported URL" };
    const r = await resolveHost(current.hostname);
    if (hop === 0) out.dns = r.state;
    if (r.state !== "ok") return { ...out, error: r.state === "nxdomain" ? "domain doesn't exist" : "DNS lookup failed" };
    if (r.ips.some(isPrivateIp)) return { ...out, error: "private address" };
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      // https failed on the first hop → try plain http once
      if (hop === 0 && current.protocol === "https:") {
        try { current = new URL(current.toString().replace(/^https:/, "http:")); continue; } catch { /* fallthrough */ }
      }
      const msg = (e as Error)?.name === "TimeoutError" ? "timed out" : ((e as Error)?.message || "connection failed").slice(0, 80);
      return { ...out, error: msg };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      try { current = new URL(res.headers.get("location")!, current); } catch { return { ...out, status: res.status, error: "bad redirect" }; }
      await res.body?.cancel().catch(() => {});
      continue;
    }
    out.status = res.status;
    out.url = current.toString();
    // bot protection (Cloudflare etc.) answering means the site exists — we just can't read it
    const guarded = res.status === 401 || res.status === 403 || res.status === 429 || (res.status === 503 && /cloudflare|captcha|challenge/i.test(`${res.headers.get("server")} ${res.headers.get("cf-mitigated")}`));
    if (guarded) { await res.body?.cancel().catch(() => {}); return { ...out, ok: true, protected: true, nameMatch: strict ? false : hostMatchesName(current.hostname, businessName) }; }
    if (res.status >= 400) { await res.body?.cancel().catch(() => {}); return { ...out, error: `HTTP ${res.status}` }; }
    const html = (await readCapped(res, 200_000)).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const text = `${title} ${html.replace(/<[^>]+>/g, " ")}`.replace(/\s+/g, " ").slice(0, 60_000);
    return { ...out, ok: true, title: title.slice(0, 140), parked: looksParked(text) || /^(index of|welcome to nginx|apache2 .*default page|it works!?)/i.test(title), nameMatch: strict ? strictNameMatch(text, businessName, strict) : textNamesBusiness(text, businessName) || hostMatchesName(current.hostname, businessName) };
  }
  return { ...out, error: "too many redirects" };
}

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (n < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value); n += value.length;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

/* ---------------- Google business profile ---------------- */

/**
 * A verification service that isn't working at all right now (out of credits,
 * key rejected, billing off, rate-limited, down) — as opposed to a check that ran
 * and found nothing. DARWIN pauses instead of marking every business "unclear".
 */
export interface Outage {
  service: "search" | "google";
  /** credits/auth won't fix themselves today; rate/down usually pass within minutes. */
  kind: "credits" | "auth" | "rate" | "down";
  message: string;
}

export interface GoogleProfile { found: boolean; website: string | null; closed: boolean; phone: string | null; rating: number | null; reviews: number | null; mapsUri: string | null; error?: string; outage?: Outage }

/** Google Places refusing ALL requests (key, billing, API not enabled, quota) → an outage, not a per-business result. */
export function googleOutage(status: number, body: { error?: { status?: string; message?: string } } | null): Outage | null {
  const st = body?.error?.status ?? "";
  const msg = String(body?.error?.message ?? "").slice(0, 140);
  if (status === 429 || st === "RESOURCE_EXHAUSTED") return { service: "google", kind: "rate", message: `Google Places quota or rate limit reached${msg ? ` (${msg})` : ""}` };
  if (status === 401 || status === 403 || st === "PERMISSION_DENIED" || st === "UNAUTHENTICATED" || /api key|billing/i.test(msg)) {
    return { service: "google", kind: /billing/i.test(msg) ? "credits" : "auth", message: `Google Places refused the request — ${msg || `HTTP ${status}`}. Check GOOGLE_PLACES_API_KEY, that the Places API (New) is enabled, and billing` };
  }
  if (status >= 500) return { service: "google", kind: "down", message: `Google Places is having problems (HTTP ${status})` };
  return null;
}

/** Tavily (web search) refusing ALL requests → an outage. 432/433 = the plan's credits are used up. */
export function searchOutage(status: number): Outage | null {
  if (status === 432 || status === 433) return { service: "search", kind: "credits", message: `The web search (Tavily) has used up its plan's credits (HTTP ${status}) — they renew with your Tavily plan, or upgrade at tavily.com` };
  if (status === 401 || status === 403) return { service: "search", kind: "auth", message: `The web search (Tavily) rejected the key (HTTP ${status}) — check SEARCH_API_KEY` };
  if (status === 429) return { service: "search", kind: "rate", message: "The web search (Tavily) rate limit was reached" };
  if (status >= 500) return { service: "search", kind: "down", message: `The web search (Tavily) is having problems (HTTP ${status})` };
  return null;
}

const tokenSim = (a: string, b: string) => {
  const A = new Set(nameTokens(a)), B = new Set(nameTokens(b));
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  let i = 0; for (const t of A) if (B.has(t)) i++;
  return i / Math.min(A.size, B.size);
};
const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6_371_000, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export function googleAvailable() { return !!env.googlePlacesApiKey; }

/** Find this business's Google profile (same name, within 400 m). */
export async function googleProfile(name: string, address: string | null, at: { lat: number; lon: number }): Promise<GoogleProfile> {
  const empty: GoogleProfile = { found: false, website: null, closed: false, phone: null, rating: null, reviews: null, mapsUri: null };
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.googlePlacesApiKey,
        "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.businessStatus,places.rating,places.userRatingCount,places.googleMapsUri,places.location",
      },
      body: JSON.stringify({ textQuery: `${name}${address ? `, ${address}` : ""}`, pageSize: 5, locationBias: { circle: { center: { latitude: at.lat, longitude: at.lon }, radius: 500 } } }),
      signal: AbortSignal.timeout(15_000),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const outage = googleOutage(res.status, j);
      return { ...empty, error: j?.error?.message ? `Google: ${String(j.error.message).slice(0, 120)}` : `Google HTTP ${res.status}`, ...(outage ? { outage } : {}) };
    }
    for (const p of j?.places ?? []) {
      const pn = p?.displayName?.text ?? "";
      const loc = p?.location;
      const near = loc ? metres(at, { lat: loc.latitude, lon: loc.longitude }) <= 400 : false;
      if (near && tokenSim(pn, name) >= 0.5) {
        return {
          found: true, website: p.websiteUri ?? null, closed: p.businessStatus === "CLOSED_PERMANENTLY",
          phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
          rating: typeof p.rating === "number" ? p.rating : null, reviews: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
          mapsUri: p.googleMapsUri ?? null,
        };
      }
    }
    return empty;
  } catch (e) {
    const error = (e as Error)?.name === "TimeoutError" ? "Google timed out" : "Google unreachable";
    return { ...empty, error, outage: { service: "google", kind: "down", message: `Google Places ${error.replace(/^Google /, "")}` } };
  }
}

/* ---------------- web search ---------------- */

/** Any web search configured for DARWIN (SearXNG, Brave, Tavily or Serper). */
export function searchAvailable() { return searchConfigured(); }

export interface SearchSignal {
  officialUrl: string | null; social: string[]; directories: number; error?: string; outage?: Outage;
  phone?: { phone: string; source: string } | null; email?: { email: string; source: string } | null;
  /** Provider requests made (a provider that failed and the one that answered both count). */
  calls?: number; provider?: ProviderId;
}

/**
 * Search the web for the business; pick out an official site vs directory/social listings.
 * The search goes through `pool` — every free provider configured, in turn (see lib/darwin/web-search).
 */
export async function webSearchSignal(name: string, locality: string, wantPhone = false, wantEmail = false, pool: SearchPool = new SearchPool()): Promise<SearchSignal> {
  try {
    // no listed phone → ask for the contact number too (directory pages show it)
    const answer = await pool.search(`"${name}" ${locality}${wantPhone || wantEmail ? " contact" : ""}${wantPhone ? " number" : ""}${wantEmail ? " email" : ""}`);
    if (!answer.ok) return { officialUrl: null, social: [], directories: 0, error: `search failed: ${answer.outage.message}`, outage: answer.outage, calls: answer.calls };
    let official: string | null = null, directories = 0;
    const social: string[] = [];
    for (const r of answer.results) {
      const url = String(r?.url ?? "");
      const host = hostOf(url);
      if (!host) continue;
      if (isSocialUrl(url) && textNamesBusiness(`${r?.title ?? ""} ${url}`, name)) { social.push(url); continue; }
      if (isDirectoryHost(host)) { directories++; continue; }
      if (/\.business\.site$/.test(host) && !official) { official = url; continue; } // Google's free sites are websites too
      if (!official && hostMatchesName(host, name)) official = `https://${host}/`;
    }
    const texts = answer.results.map((r) => ({ url: r.url, title: r.title, content: r.content }));
    const phone = phoneFromResults(texts, name, locality);
    const email = wantEmail ? emailFromResults(texts, name, locality) : null;
    return { officialUrl: official, social: [...new Set(social)].slice(0, 4), directories, phone, email, calls: answer.calls, provider: answer.provider };
  } catch (e) {
    const error = (e as Error)?.message || "search failed";
    return { officialUrl: null, social: [], directories: 0, error, outage: { service: "search", kind: "down", message: `The web search failed (${error})` }, calls: 0 };
  }
}

/* ---------------- all signals for one business ---------------- */

export interface CandidateInput { name: string; address: string | null; lat: number; lon: number; website: string | null; locality: string; phone?: string | null; email?: string | null }
export interface Gathered {
  signals: Signals; google: GoogleProfile | null; search: SearchSignal | null; calls: { google: number; search: number };
  /** A phone number found outside the listing and Google (web search or Foursquare), with where it came from. */
  phoneFound?: { phone: string; source: string } | null;
  /** An email address found on public pages naming the business (web search), with where it came from. */
  emailFound?: { email: string; source: string } | null;
  /** A service that wasn't working at all — this business's result can't be trusted, check it again later. */
  outage?: Outage[];
}

/**
 * The business's phone on Foursquare: the nearest place (within 300 m) whose
 * name matches. Tries the new Places API, then legacy v3, like discovery does.
 */
export async function foursquarePhone(name: string, lat: number, lon: number): Promise<{ phone: string; source: string } | null> {
  const key = env.foursquareApiKey;
  if (!key) return null;
  const params = new URLSearchParams({ query: name.slice(0, 80), ll: `${lat},${lon}`, radius: "300", limit: "5", fields: "name,tel,distance" });
  const attempts: { url: string; headers: Record<string, string> }[] = [
    { url: `https://places-api.foursquare.com/places/search?${params}`, headers: { accept: "application/json", authorization: `Bearer ${key}`, "X-Places-Api-Version": env.foursquareApiVersion } },
    { url: `https://api.foursquare.com/v3/places/search?${params}`, headers: { accept: "application/json", authorization: key } },
  ];
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, { headers: a.headers, signal: AbortSignal.timeout(12_000) });
      if (res.status === 401 || res.status === 403 || res.status === 404) continue; // other key generation
      if (!res.ok) return null;
      const j: any = await res.json();
      for (const p of j?.results ?? []) {
        if (!textNamesBusiness(String(p?.name ?? ""), name)) continue;
        const v = verifyPhone(p?.tel);
        if (v.ok && v.normalized) return { phone: v.normalized, source: "Foursquare" };
      }
      return null;
    } catch { return null; }
  }
  return null;
}

export async function gatherSignals(c: CandidateInput, opts: { google: boolean; search: boolean; foursquare?: boolean; wantEmail?: boolean; searcher?: SearchPool }): Promise<Gathered> {
  const listed = c.website ? await checkUrl(c.website, c.name) : null;
  // a live listed website settles it — no paid lookups needed
  if (listed?.ok && !listed.parked) {
    return { signals: { listed, google: null, search: null, guessed: [], distinctive: nameTokens(c.name).length > 0 }, google: null, search: null, calls: { google: 0, search: 0 } };
  }
  const guessing = (async () => {
      const out: UrlCheck[] = [];
      for (const d of guessDomains(c.name)) {
        const r = await resolveHost(d);
        if (r.state === "ok") out.push(await checkUrl(d, c.name, 6000, { locality: `${c.locality} ${c.address ?? ""}`, phone: c.phone }));
      }
      return out;
    })();
  // Google first: when it found the business (with or without a website) that settles the
  // website question on its own — the web search (paid credits) only runs when it's still
  // needed: no Google, no Google match, or a phone / email still to find
  const g = opts.google ? await googleProfile(c.name, c.address, c) : null;
  const googleSettles = !!g && g.found && !g.error;
  const wantPhone = !verifyPhone(c.phone).ok && !verifyPhone(g?.phone).ok;
  const wantEmail = !!opts.wantEmail && !c.email;
  const useSearch = opts.search && (!googleSettles || wantPhone || wantEmail);
  const [s, guessed] = await Promise.all([
    useSearch ? webSearchSignal(c.name, c.locality, wantPhone, wantEmail, opts.searcher) : Promise.resolve(null),
    guessing,
  ]);
  const gCheck = g?.website ? await checkUrl(g.website, c.name) : undefined;
  // no phone on the listing or Google → the web search's, else Foursquare's
  const needPhone = !verifyPhone(c.phone).ok && !verifyPhone(g?.phone).ok;
  const phoneFound = !needPhone ? null : s?.phone ?? (opts.foursquare ? await foursquarePhone(c.name, c.lat, c.lon) : null);
  const official = s?.officialUrl ? await checkUrl(s.officialUrl, c.name) : null;
  // an address at the business's OWN domain (not Gmail etc.) means that domain may carry its website:
  // check it — a live site there is its website, so it isn't a "no website" lead
  const emailFound = s?.email ?? null;
  for (const e of [c.email, emailFound?.email]) {
    const domain = (e ?? "").split("@")[1]?.toLowerCase();
    if (!domain || isFreeMail(domain) || isDirectoryHost(domain) || guessed.some((x) => hostOf(x.url) === domain)) continue;
    const site = await checkUrl(domain, c.name, 6000);
    if (site.ok && !site.parked) guessed.push({ ...site, nameMatch: true });
  }
  return {
    signals: {
      listed,
      google: g ? { found: g.found, website: g.website, check: gCheck, closed: g.closed, error: g.error } : null,
      search: s ? { error: s.error, official, social: s.social, directories: s.directories } : null,
      guessed,
      distinctive: nameTokens(c.name).length > 0,
    },
    google: g, search: s, phoneFound, emailFound,
    calls: { google: opts.google ? 1 : 0, search: useSearch ? (s?.calls ?? 1) : 0 },
    ...(g?.outage || s?.outage ? { outage: [g?.outage, s?.outage].filter((o): o is Outage => !!o) } : {}),
  };
}
