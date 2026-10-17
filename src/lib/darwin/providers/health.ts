import "server-only";
import { env } from "@/lib/env";
import { PROVIDERS as SEARCH_PROVIDERS } from "../web-search";
import { fetchJson, ProviderHttpError, STATE_LABEL, type ProviderState } from "./http";

/**
 * DARWIN's provider health check. "Configured" (a key is set) is not the same
 * as "working" — so each check makes ONE small, real request with the key and
 * reports what actually happened: Ready, Authentication failed, Rate limited,
 * Quota exhausted, Billing required, Provider error, Unreachable or Not
 * configured. Key values never appear in a result.
 *
 * Each check costs at most one request (one Geoapify credit, one search, one
 * Google text search), so results are cached for a few minutes.
 */

export type ProviderRole = "discovery" | "verification" | "contact";

export interface ProviderHealth {
  id: string;
  label: string;
  role: ProviderRole;
  /** What DARWIN uses it for, in plain words. */
  purpose: string;
  /** The environment variable(s) that configure it — names only. */
  envVar: string;
  configured: boolean;
  state: ProviderState;
  stateLabel: string;
  /** What happened, in one line (no secrets). */
  detail: string;
  /** What to do about it, when something is wrong. */
  fix: string | null;
  checkedAt: string;
  latencyMs: number | null;
}

interface Check {
  id: string; label: string; role: ProviderRole; purpose: string; envVar: string;
  configured: () => boolean;
  /** Resolves with a one-line success detail; throws ProviderHttpError on failure. */
  probe: () => Promise<string>;
  fix: Partial<Record<ProviderState, string>>;
}

const FIX_COMMON: Partial<Record<ProviderState, string>> = {
  unreachable: "No answer from the provider. Check this PC's internet connection or firewall, then check again.",
  rate_limited: "Wait a minute and check again.",
};

export const CHECKS: Check[] = [
  {
    id: "geoapify", label: "Geoapify Places", role: "discovery", envVar: "GEOAPIFY_API_KEY",
    purpose: "Finds businesses by category and area (DARWIN's main lead source).",
    configured: () => env.geoapifyApiKey.length > 0,
    async probe() {
      // one geocode + one places page of 1 result: proves the key, the quota and the data
      const g = await fetchJson(`https://api.geoapify.com/v1/geocode/search?text=Bengaluru&limit=1&format=json&apiKey=${encodeURIComponent(env.geoapifyApiKey)}`, { provider: "Geoapify", attempts: 2, timeoutMs: 15_000 });
      const r = g?.results?.[0];
      if (typeof r?.lat !== "number") throw new ProviderHttpError("Geoapify: answered, but without a location for a known city", "provider_error", 200);
      const p = await fetchJson(`https://api.geoapify.com/v2/places?categories=sport.fitness&filter=circle:${r.lon},${r.lat},5000&limit=1&apiKey=${encodeURIComponent(env.geoapifyApiKey)}`, { provider: "Geoapify", attempts: 2, timeoutMs: 15_000 });
      const n = Array.isArray(p?.features) ? p.features.length : 0;
      return n ? "Key accepted — a test search returned a real business." : "Key accepted, but the test search returned no businesses.";
    },
    fix: { not_configured: "Get a free key at myprojects.geoapify.com (3,000 requests/day) and set GEOAPIFY_API_KEY in .env.local (this PC) or in Vercel's environment variables.", auth_failed: "The key was rejected. Copy it again from myprojects.geoapify.com → your project → API keys, and set GEOAPIFY_API_KEY.", quota_exhausted: "Today's free Geoapify requests are used up. They reset daily (UTC), or upgrade the plan.", billing_required: "Geoapify wants billing set up for this project (myprojects.geoapify.com)." },
  },
  {
    id: "google_places", label: "Google Places", role: "verification", envVar: "GOOGLE_PLACES_API_KEY",
    purpose: "Checks a business's Google profile: website, phone, open/closed.",
    configured: () => env.googlePlacesApiKey.length > 0,
    async probe() {
      const j = await fetchJson("https://places.googleapis.com/v1/places:searchText", {
        provider: "Google Places", attempts: 2, timeoutMs: 15_000,
        init: { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.googlePlacesApiKey, "X-Goog-FieldMask": "places.id" }, body: JSON.stringify({ textQuery: "gym in Bengaluru", pageSize: 1 }) },
      });
      return Array.isArray(j?.places) && j.places.length ? "Key accepted — a test search returned a place." : "Key accepted, but the test search returned no place.";
    },
    fix: { not_configured: "Optional. Enable 'Places API (New)' in Google Cloud, create an API key and set GOOGLE_PLACES_API_KEY. Google requires a billing account.", auth_failed: "Google refused the key: check it's correct and that 'Places API (New)' is enabled for its project, and that the key's restrictions allow this server.", billing_required: "Enable billing on the Google Cloud project that owns this key (console.cloud.google.com → Billing).", quota_exhausted: "This key's Places quota is used up — raise it in Google Cloud → Quotas." },
  },
  {
    id: "foursquare", label: "Foursquare Places", role: "contact", envVar: "FOURSQUARE_API_KEY",
    purpose: "Finds a phone number when the listing has none.",
    configured: () => env.foursquareApiKey.length > 0,
    async probe() {
      const params = new URLSearchParams({ query: "gym", ll: "12.9716,77.5946", radius: "3000", limit: "1" });
      const j = await fetchJson(`https://places-api.foursquare.com/places/search?${params}`, {
        provider: "Foursquare", attempts: 2, timeoutMs: 15_000,
        init: { headers: { authorization: `Bearer ${env.foursquareApiKey}`, "X-Places-Api-Version": env.foursquareApiVersion } },
      });
      return Array.isArray(j?.results) && j.results.length ? "Key accepted — a test search returned a place." : "Key accepted, but the test search returned no place.";
    },
    fix: { not_configured: "Optional. Create a Service API key at foursquare.com/developers and set FOURSQUARE_API_KEY.", auth_failed: "Foursquare refused the key — new accounts need a Service API key (not the legacy v3 key)." },
  },
  ...SEARCH_PROVIDERS.map((sp): Check => ({
    id: `search_${sp.id}`, label: sp.label, role: "verification",
    envVar: { searxng: "SEARXNG_URL", brave: "BRAVE_SEARCH_API_KEY", tavily: "SEARCH_API_KEY", serper: "SERPER_API_KEY" }[sp.id],
    purpose: "Web search: confirms a business has no website, finds missing phones/emails.",
    configured: sp.configured,
    async probe() {
      const o = await sp.run("Cult fit Indiranagar Bengaluru");
      if (o.ok) return `Answered a test search (${o.results.length} results).`;
      const state: ProviderState = o.outage.kind === "auth" ? "auth_failed" : o.outage.kind === "credits" ? "quota_exhausted" : o.outage.kind === "rate" ? "rate_limited" : "unreachable";
      throw new ProviderHttpError(o.outage.message, state, null);
    },
    fix: sp.id === "searxng"
      ? { not_configured: "Optional and free: run `npm run searxng` (needs Docker) — it sets SEARXNG_URL for you." }
      : { not_configured: `Optional. Set ${({ brave: "BRAVE_SEARCH_API_KEY", tavily: "SEARCH_API_KEY", serper: "SERPER_API_KEY" } as Record<string, string>)[sp.id]} for more verification searches.`, quota_exhausted: "This month's free searches are used up — DARWIN moves on to the next search provider." },
  })),
];

let cache: { at: number; results: ProviderHealth[] } | null = null;
const TTL_MS = 5 * 60_000;

async function runOne(c: Check): Promise<ProviderHealth> {
  const base = { id: c.id, label: c.label, role: c.role, purpose: c.purpose, envVar: c.envVar, configured: c.configured(), checkedAt: new Date().toISOString() };
  if (!base.configured) return { ...base, state: "not_configured", stateLabel: STATE_LABEL.not_configured, detail: `${c.envVar} isn't set.`, fix: c.fix.not_configured ?? null, latencyMs: null };
  const t0 = Date.now();
  try {
    const detail = await c.probe();
    return { ...base, state: "ready", stateLabel: STATE_LABEL.ready, detail, fix: null, latencyMs: Date.now() - t0 };
  } catch (e) {
    const state: ProviderState = e instanceof ProviderHttpError ? e.state : "provider_error";
    return { ...base, state, stateLabel: STATE_LABEL[state], detail: (e as Error).message.slice(0, 240), fix: c.fix[state] ?? FIX_COMMON[state] ?? null, latencyMs: Date.now() - t0 };
  }
}

/** Every provider's real state. Cached 5 minutes unless `fresh`. */
export async function providerHealth(opts: { fresh?: boolean; only?: string[]; checks?: Check[] } = {}): Promise<ProviderHealth[]> {
  const checks = (opts.checks ?? CHECKS).filter((c) => !opts.only || opts.only.includes(c.id));
  if (!opts.fresh && !opts.only && !opts.checks && cache && Date.now() - cache.at < TTL_MS) return cache.results;
  const results = await Promise.all(checks.map(runOne));
  if (!opts.only && !opts.checks) cache = { at: Date.now(), results };
  return results;
}

/** Can DARWIN discover leads right now? (Geoapify is the discovery source.) */
export function discoveryReady(h: ProviderHealth[]): boolean {
  return h.some((p) => p.role === "discovery" && p.state === "ready");
}
