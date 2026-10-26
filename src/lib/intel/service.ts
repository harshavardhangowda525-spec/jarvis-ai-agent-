import "server-only";
import type { IntelItem } from "@prisma/client";
import { getDb } from "@/lib/db";
import type { ItemAnalysis } from "./analyze";
import { analyzePending, similar } from "./analyze";
import { impactScore, sanitizeWeights } from "./impact";
import { placesIn } from "./places";
import { defaultAsk, briefingView } from "./briefing";
import { intelSettings, refreshIntel, REFRESH_EVERY_MS } from "./collect";
import { detectOpportunities, SCORE_RULE } from "./opportunities";
import { CATEGORIES, type CategoryId } from "./topics";
import { youtubeStatus } from "./youtube";

const db = () => getDb();
/** A video's live status is shown as live only while the last YouTube check is this recent. */
export const LIVE_FRESH_MS = 20 * 60_000;

export type Media = { videoId: string; channel: string; live: "live" | "upcoming" | "none"; viewers: number | null; thumbnail: string | null; scheduledStart: string | null; actualStart: string | null; checkedAt: string };

const OFFICIAL_FEEDS = new Set(["OpenAI News", "Google Blog", "GitHub Blog"]);

export function verificationOf(it: Pick<IntelItem, "via" | "feed" | "analysis" | "summary">) {
  const a = (it.analysis ?? null) as ItemAnalysis | null;
  if (it.via === "youtube" || OFFICIAL_FEEDS.has(it.feed ?? "")) return { level: "official" as const, label: "Official source" };
  if (a && a.confidence.publishers.length >= 2) return { level: "corroborated" as const, label: `Corroborated · ${a.confidence.publishers.length} publishers` };
  return { level: "single" as const, label: it.summary ? "Single source" : "Single source · headline only" };
}

export function itemView(it: IntelItem, now = Date.now()) {
  const media = (it.media ?? null) as Media | null;
  const liveNow = !!media && media.live === "live" && now - Date.parse(media.checkedAt) < LIVE_FRESH_MS;
  return {
    id: it.id, url: it.url, title: it.title, summary: it.summary, publisher: it.publisher, publishedAt: it.publishedAt?.toISOString() ?? null, fetchedAt: it.fetchedAt.toISOString(),
    via: it.via, feed: it.feed, topic: it.topic, category: it.category, importance: it.importance, relevance: it.relevance,
    analysis: (it.analysis ?? null) as ItemAnalysis | null,
    media: media && { ...media, liveNow, stale: media.live === "live" && !liveNow },
    saved: it.saved,
    verification: verificationOf(it),
    places: placesIn(`${it.title} ${it.summary ?? ""}`).map((p) => ({ id: p.id === "usa-cs" ? "usa" : p.id, name: p.name, level: p.level, lat: p.lat, lng: p.lng })),
  };
}
export type ItemView = ReturnType<typeof itemView>;

export interface FeedFilter { category?: CategoryId | "all"; topic?: string; q?: string; minRelevance?: number; days?: number; source?: string; saved?: boolean }

export async function commandCenter(userId: string, f: FeedFilter = {}) {
  const now = new Date();
  const since = new Date(now.getTime() - (f.days ?? 7) * 86_400_000);
  const st = await intelSettings(userId);
  const news = await db().intelItem.findMany({ where: { userId, via: { not: "youtube" }, OR: [{ publishedAt: { gte: since } }, { publishedAt: null, fetchedAt: { gte: since } }] }, orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }], take: 600 });
  // official channels post less often than news sites — show their latest videos from the last 60 days, separately from the news window
  const videos = (await db().intelItem.findMany({ where: { userId, via: "youtube", publishedAt: { gte: new Date(now.getTime() - 60 * 86_400_000) } }, orderBy: { publishedAt: "desc" }, take: 40 })).map((i) => itemView(i, now.getTime()));
  const q = f.q?.trim().toLowerCase();
  const savedOld = f.saved ? await db().intelItem.findMany({ where: { userId, saved: true, via: { not: "youtube" }, NOT: { id: { in: news.map((n) => n.id) } } }, take: 100 }) : [];
  const filtered = [...news, ...savedOld].filter((i) =>
    (!f.category || f.category === "all" || i.category === f.category) && (!f.topic || i.topic === f.topic) && (!f.minRelevance || (i.relevance ?? 0) >= f.minRelevance) &&
    (!f.source || i.publisher === f.source) && (!f.saved || i.saved) &&
    (!q || `${i.title} ${i.summary ?? ""} ${i.publisher ?? ""}`.toLowerCase().includes(q)));
  const weights = sanitizeWeights(st.weights);
  const impact = (i: IntelItem) => {
    const a = (i.analysis ?? null) as ItemAnalysis | null;
    return impactScore({ relevance: i.relevance, importance: i.importance, publishedAt: i.publishedAt?.toISOString() ?? null, fetchedAt: i.fetchedAt.toISOString(), confidence: a?.confidence.level ?? null, publishers: a?.confidence.publishers.length ?? 1, official: verificationOf(i).level === "official", hasSummary: !!i.summary }, weights, now.getTime());
  };
  const ranked = filtered.map((i) => ({ i, impact: impact(i) })).sort((a, b) => b.impact.score - a.impact.score);
  // duplicates: the same story from several publishers is shown once, with the others listed
  const groups: { i: IntelItem; impact: ReturnType<typeof impact>; also: { publisher: string | null; url: string; title: string }[] }[] = [];
  for (const r of ranked) {
    const g = groups.find((x) => similar(x.i.title, r.i.title));
    if (g) g.also.push({ publisher: r.i.publisher, url: r.i.url, title: r.i.title });
    else groups.push({ ...r, also: [] });
  }
  const priority = groups.slice(0, 60).map((g) => ({ ...itemView(g.i, now.getTime()), impact: g.impact, alsoReportedBy: g.also.slice(0, 6) }));
  const placeMap = new Map<string, { id: string; name: string; level: string; lat: number; lng: number; count: number; items: { id: string; title: string }[] }>();
  for (const it of priority) for (const pl of it.places) {
    const m = placeMap.get(pl.id) ?? { ...pl, count: 0, items: [] };
    m.count++; if (m.items.length < 5) m.items.push({ id: it.id, title: it.title });
    placeMap.set(pl.id, m);
  }
  const publishers = [...news.reduce((m, i) => (i.publisher ? m.set(i.publisher, (m.get(i.publisher) ?? 0) + 1) : m), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, count]) => ({ name, count }));
  // radar: counts per category in the last 24h vs the 6 days before (per-day rate) → "emerging" when clearly up
  const d1 = now.getTime() - 86_400_000;
  const radar = CATEGORIES.map((c) => {
    const inCat = news.filter((i) => i.category === c.id);
    const last24 = inCat.filter((i) => (i.publishedAt ?? i.fetchedAt).getTime() >= d1).length;
    const before = inCat.length - last24;
    const rate = before / Math.max(1, (f.days ?? 7) - 1);
    return { id: c.id, label: c.label, total: inCat.length, last24, perDayBefore: Math.round(rate * 10) / 10, emerging: last24 >= 3 && last24 >= rate * 1.8, analysed: inCat.filter((i) => i.analyzedAt).length };
  });
  const opps = await db().intelOpportunity.findMany({ where: { userId, status: { not: "dismissed" } }, orderBy: { score: "desc" }, take: 12 });
  const briefings = await db().intelBriefing.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 });
  return {
    now: now.toISOString(),
    status: {
      lastRefreshAt: st.lastRefreshAt?.toISOString() ?? null, nextRefreshAfter: st.lastRefreshAt ? new Date(st.lastRefreshAt.getTime() + REFRESH_EVERY_MS).toISOString() : null,
      report: st.lastRefresh, youtube: youtubeStatus(), counts: { news: news.length, analysed: news.filter((i) => i.analyzedAt).length, videos: videos.length, liveNow: videos.filter((v) => v.media?.liveNow).length },
    },
    topics: st.topics, settings: { dailyEnabled: st.dailyEnabled, weeklyEnabled: st.weeklyEnabled, notifyEmail: st.notifyEmail, notifyWhatsapp: st.notifyWhatsapp },
    weights, publishers, places: [...placeMap.values()].sort((a, b) => b.count - a.count),
    radar, priority, videos: videos.sort((a, b) => Number(b.media?.liveNow) - Number(a.media?.liveNow) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, 24),
    opportunities: opps.map((o) => ({ id: o.id, title: o.title, score: o.score, status: o.status, detail: o.detail, evidence: o.evidence, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString() })),
    scoreRule: SCORE_RULE,
    briefings: briefings.map((b) => ({ ...briefingView(b), content: undefined, sources: undefined })),
  };
}

/** Manual refresh: fetch sources, analyse what's new, update opportunities. */
export async function refreshNow(userId: string, o: { force?: boolean } = {}) {
  const report = await refreshIntel(userId, { force: o.force ?? true });
  const ai = await defaultAsk(userId);
  let analysis: { analyzed: number; failed: number; error?: string } | null = null;
  let opps: { created: number; note?: string } | null = null;
  if (ai) {
    analysis = await analyzePending(userId, ai.ask, { provider: ai.provider, limit: 24 });
    opps = await detectOpportunities(userId, ai.ask).catch((e) => ({ created: 0, note: (e as Error).message }));
  }
  return { report, analysis, opportunities: opps, ai: !!ai };
}
