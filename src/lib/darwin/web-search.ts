import "server-only";
import { env } from "@/lib/env";
import type { Outage } from "./daily/checks";

/**
 * DARWIN's web search, over several free providers. The search confirms that a
 * business has no website and finds missing phone numbers / emails — so the
 * more searches DARWIN can make, the more leads it can verify each day.
 *
 * Providers, in the order DARWIN uses them (each optional — set any you have):
 * - SearXNG (SEARXNG_URL): your own open-source metasearch — free and unlimited.
 * - Brave Search API (BRAVE_SEARCH_API_KEY): free plan, ~2,000 searches a month.
 * - Tavily (SEARCH_API_KEY): free plan, 1,000 a month (shared with JARVIS and MIKE).
 * - Serper (SERPER_API_KEY): Google results, 2,500 free searches on sign-up.
 *
 * Each provider with a monthly allowance is paced (today's share = what's left
 * ÷ days left), and when one runs out, rejects its key or is down, DARWIN moves
 * on to the next. Only when none can answer is the web search "down".
 */

export type ProviderId = "searxng" | "brave" | "tavily" | "serper";
export interface WebResult { url: string; title: string; content: string }
type Outcome = { ok: true; results: WebResult[] } | { ok: false; outage: Outage };

export interface Provider {
  id: ProviderId;
  label: string;
  configured: () => boolean;
  /** Free searches a month DARWIN may use (0 = unlimited / no pacing). */
  monthly: () => number;
  /** Space between calls (Brave's free plan allows 1 a second). */
  minIntervalMs: number;
  run: (query: string) => Promise<Outcome>;
}

const out = (label: string, kind: Outage["kind"], message: string): Outcome => ({ ok: false, outage: { service: "search", kind, message: `${label}: ${message}` } });
const failed = (label: string, e: unknown): Outcome =>
  out(label, "down", (e as Error)?.name === "TimeoutError" ? "timed out" : "unreachable");
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const PROVIDERS: Provider[] = [
  {
    id: "searxng",
    label: "SearXNG",
    configured: () => !!env.searxngUrl,
    monthly: () => 0,
    minIntervalMs: 0,
    async run(q) {
      try {
        const u = new URL("/search", env.searxngUrl.replace(/\/+$/, "") + "/");
        u.search = new URLSearchParams({ q, format: "json", language: "en-IN", safesearch: "0" }).toString();
        const res = await fetch(u, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
        if (res.status === 403) return out("SearXNG", "auth", "refused JSON results — enable the json format (search → formats) in its settings.yml");
        if (res.status === 429) return out("SearXNG", "rate", "rate limit reached");
        if (!res.ok) return out("SearXNG", res.status >= 500 ? "down" : "auth", `HTTP ${res.status}`);
        const j = (await res.json()) as { results?: { url?: string; title?: string; content?: string }[]; unresponsive_engines?: unknown[] };
        // no results because its engines didn't answer (blocked, captcha, offline) isn't "nothing found" —
        // treating it as an empty search would make every business look website-less
        const silent = Array.isArray(j.unresponsive_engines) ? j.unresponsive_engines.length : 0;
        if (!(j.results ?? []).length && silent > 0) return out("SearXNG", "rate", `its search engines didn't answer (${silent} unresponsive) — no results to trust`);
        return { ok: true, results: (j.results ?? []).slice(0, 10).map((r) => ({ url: str(r.url), title: str(r.title), content: str(r.content) })) };
      } catch (e) { return failed("SearXNG", e); }
    },
  },
  {
    id: "brave",
    label: "Brave Search",
    configured: () => !!env.braveSearchApiKey,
    monthly: () => env.darwinBraveMonthly,
    minIntervalMs: 1100,
    async run(q) {
      try {
        const u = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, count: "10", country: "in", search_lang: "en" })}`;
        const res = await fetch(u, { headers: { accept: "application/json", "X-Subscription-Token": env.braveSearchApiKey }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status === 401 || res.status === 403) return out("Brave Search", "auth", `rejected the key (HTTP ${res.status}) — check BRAVE_SEARCH_API_KEY`);
          if (res.status === 402 || (res.status === 429 && /quota/i.test(body))) return out("Brave Search", "credits", "this month's free searches are used up");
          if (res.status === 429) return out("Brave Search", "rate", "rate limit reached");
          return out("Brave Search", res.status >= 500 ? "down" : "auth", `HTTP ${res.status}`);
        }
        const j = (await res.json()) as { web?: { results?: { url?: string; title?: string; description?: string; extra_snippets?: string[] }[] } };
        return { ok: true, results: (j.web?.results ?? []).map((r) => ({ url: str(r.url), title: str(r.title), content: [str(r.description), ...(r.extra_snippets ?? [])].join(" ") })) };
      } catch (e) { return failed("Brave Search", e); }
    },
  },
  {
    id: "tavily",
    label: "Tavily",
    configured: () => !!env.searchApiKey,
    monthly: () => env.darwinSearchMonthlyCredits,
    minIntervalMs: 0,
    async run(q) {
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: env.searchApiKey, query: q, max_results: 8, search_depth: "basic", include_answer: false }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          if (res.status === 432 || res.status === 433) return out("Tavily", "credits", `its plan's credits are used up (HTTP ${res.status}) — they renew with your Tavily plan`);
          if (res.status === 401 || res.status === 403) return out("Tavily", "auth", `rejected the key (HTTP ${res.status}) — check SEARCH_API_KEY`);
          if (res.status === 429) return out("Tavily", "rate", "rate limit reached");
          return out("Tavily", res.status >= 500 ? "down" : "auth", `HTTP ${res.status}`);
        }
        const j = (await res.json()) as { results?: { url?: string; title?: string; content?: string }[] };
        return { ok: true, results: (j.results ?? []).map((r) => ({ url: str(r.url), title: str(r.title), content: str(r.content) })) };
      } catch (e) { return failed("Tavily", e); }
    },
  },
  {
    id: "serper",
    label: "Serper",
    configured: () => !!env.serperApiKey,
    monthly: () => env.darwinSerperMonthly,
    minIntervalMs: 0,
    async run(q) {
      try {
        const res = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-KEY": env.serperApiKey },
          body: JSON.stringify({ q, gl: "in", hl: "en", num: 10 }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (/credit/i.test(body)) return out("Serper", "credits", "its free searches are used up");
          if (res.status === 401 || res.status === 403) return out("Serper", "auth", `rejected the key (HTTP ${res.status}) — check SERPER_API_KEY`);
          if (res.status === 429) return out("Serper", "rate", "rate limit reached");
          return out("Serper", res.status >= 500 ? "down" : "auth", `HTTP ${res.status}`);
        }
        const j = (await res.json()) as {
          organic?: { link?: string; title?: string; snippet?: string }[];
          knowledgeGraph?: { title?: string; website?: string; description?: string; phoneNumber?: string; address?: string };
        };
        const kg = j.knowledgeGraph;
        const results: WebResult[] = (j.organic ?? []).map((r) => ({ url: str(r.link), title: str(r.title), content: str(r.snippet) }));
        // Google's knowledge panel for the business: its website (if any) and phone
        if (kg?.title) results.unshift({ url: str(kg.website), title: str(kg.title), content: [kg.description, kg.phoneNumber, kg.address].filter(Boolean).join(" · ") });
        return { ok: true, results };
      } catch (e) { return failed("Serper", e); }
    },
  },
];

export const configuredProviders = (all = PROVIDERS) => all.filter((p) => p.configured());
export const searchConfigured = () => configuredProviders().length > 0;

const nextSlot = new Map<ProviderId, number>();
async function spaced(p: Provider) {
  if (!p.minIntervalMs) return;
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(p.id) ?? 0);
  nextSlot.set(p.id, at + p.minIntervalMs);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export type PoolAnswer =
  | { ok: true; results: WebResult[]; provider: ProviderId; calls: number }
  | { ok: false; outage: Outage; calls: number };

/**
 * One tick's worth of searching: today's remaining share per provider, which
 * providers stopped working, and how many searches each made (to save).
 */
export class SearchPool {
  readonly used: Partial<Record<ProviderId, number>> = {};
  readonly down = new Map<ProviderId, Outage>();
  private inflight: Partial<Record<ProviderId, number>> = {};

  constructor(
    private providers: Provider[] = configuredProviders(),
    /** Searches each provider may still make today (missing = unlimited). */
    private remaining: Partial<Record<ProviderId, number>> = {},
    private onDown?: (o: Outage) => void,
  ) {}

  private left(p: Provider) {
    const r = this.remaining[p.id];
    return r === undefined ? Infinity : r - (this.used[p.id] ?? 0) - (this.inflight[p.id] ?? 0);
  }
  /** How many more searches can still be made today (Infinity with an unlimited provider). */
  capacity(): number {
    return this.providers.filter((p) => !this.down.has(p.id)).reduce((s, p) => s + Math.max(0, this.left(p)), 0);
  }
  get configured() { return this.providers.length > 0; }

  async search(query: string): Promise<PoolAnswer> {
    let calls = 0;
    const tried: Outage[] = [];
    for (const p of this.providers) {
      if (this.down.has(p.id) || this.left(p) <= 0) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        this.inflight[p.id] = (this.inflight[p.id] ?? 0) + 1;
        let r: Outcome;
        try {
          await spaced(p);
          r = await p.run(query);
        } finally {
          this.inflight[p.id]! -= 1;
        }
        calls++;
        this.used[p.id] = (this.used[p.id] ?? 0) + 1;
        if (r.ok) return { ok: true, results: r.results, provider: p.id, calls };
        // a rate limit gets one more try after a pause; anything else moves on to the next provider
        if (r.outage.kind === "rate" && attempt === 0) { await new Promise((res) => setTimeout(res, 1500)); continue; }
        this.down.set(p.id, r.outage);
        this.onDown?.(r.outage);
        tried.push(r.outage);
        break;
      }
    }
    if (!tried.length && this.providers.length) {
      return { ok: false, calls, outage: { service: "search", kind: "rate", message: "Today's share of the free web searches is used" } };
    }
    // none could answer: "credits" when every one is out for the month / rejects its key, else a pause
    const allHard = this.providers.every((p) => { const o = this.down.get(p.id); return o && (o.kind === "credits" || o.kind === "auth"); });
    const outage: Outage = { service: "search", kind: allHard ? "credits" : "rate", message: tried.length ? tried.map((o) => o.message).join("; ") : "No web search is configured" };
    return { ok: false, outage, calls };
  }
}

/** Today's remaining share per provider: (monthly − used before today) ÷ days left, minus what today already used. */
export function dailyShares(
  providers: Provider[],
  usedThisMonthBeforeToday: Partial<Record<ProviderId, number>>,
  usedToday: Partial<Record<ProviderId, number>>,
  date: string,
): Partial<Record<ProviderId, number>> {
  const [y, m, d] = date.split("-").map(Number);
  const daysLeft = Math.max(1, new Date(Date.UTC(y, m, 0)).getUTCDate() - d + 1);
  const out: Partial<Record<ProviderId, number>> = {};
  for (const p of providers) {
    const monthly = p.monthly();
    if (!monthly) continue; // unlimited
    const share = Math.max(0, Math.floor((monthly - (usedThisMonthBeforeToday[p.id] ?? 0)) / daysLeft));
    out[p.id] = Math.max(0, share - (usedToday[p.id] ?? 0));
  }
  return out;
}
