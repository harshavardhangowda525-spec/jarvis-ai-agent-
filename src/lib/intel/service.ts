import "server-only";
import type { IntelItem } from "@prisma/client";
import { getDb } from "@/lib/db";
import type { ItemAnalysis } from "./analyze";
import { analyzePending } from "./analyze";
import { defaultAsk, briefingView } from "./briefing";
import { intelSettings, refreshIntel, REFRESH_EVERY_MS } from "./collect";
import { detectOpportunities, SCORE_RULE } from "./opportunities";
import { CATEGORIES, type CategoryId } from "./topics";
import { youtubeStatus } from "./youtube";

const db = () => getDb();
/** A video's live status is shown as live only while the last YouTube check is this recent. */
export const LIVE_FRESH_MS = 20 * 60_000;

export type Media = { videoId: string; channel: string; live: "live" | "upcoming" | "none"; viewers: number | null; thumbnail: string | null; scheduledStart: string | null; actualStart: string | null; checkedAt: string };

export function itemView(it: IntelItem, now = Date.now()) {
  const media = (it.media ?? null) as Media | null;
  const liveNow = !!media && media.live === "live" && now - Date.parse(media.checkedAt) < LIVE_FRESH_MS;
  return {
    id: it.id, url: it.url, title: it.title, summary: it.summary, publisher: it.publisher, publishedAt: it.publishedAt?.toISOString() ?? null, fetchedAt: it.fetchedAt.toISOString(),
    via: it.via, feed: it.feed, topic: it.topic, category: it.category, importance: it.importance, relevance: it.relevance,
    analysis: (it.analysis ?? null) as ItemAnalysis | null,
    media: media && { ...media, liveNow, stale: media.live === "live" && !liveNow },
  };
}
export type ItemView = ReturnType<typeof itemView>;

export interface FeedFilter { category?: CategoryId | "all"; topic?: string; q?: string; minRelevance?: number; days?: number }

export async function commandCenter(userId: string, f: FeedFilter = {}) {
  const now = new Date();
  const since = new Date(now.getTime() - (f.days ?? 7) * 86_400_000);
  const st = await intelSettings(userId);
  const all = await db().intelItem.findMany({ where: { userId, OR: [{ publishedAt: { gte: since } }, { publishedAt: null, fetchedAt: { gte: since } }] }, orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }], take: 600 });
  const news = all.filter((i) => i.via !== "youtube");
  const videos = all.filter((i) => i.via === "youtube").map((i) => itemView(i, now.getTime()));
  const q = f.q?.trim().toLowerCase();
  const filtered = news.filter((i) =>
    (!f.category || f.category === "all" || i.category === f.category) && (!f.topic || i.topic === f.topic) && (!f.minRelevance || (i.relevance ?? 0) >= f.minRelevance) &&
    (!q || `${i.title} ${i.summary ?? ""} ${i.publisher ?? ""}`.toLowerCase().includes(q)));
  const score = (i: IntelItem) => (i.importance ?? 0) * 2 + (i.relevance ?? 0) * 2 + (i.publishedAt ? Math.max(0, 3 - (now.getTime() - i.publishedAt.getTime()) / 86_400_000) : 0);
  const priority = [...filtered].sort((a, b) => score(b) - score(a)).slice(0, 40).map((i) => itemView(i, now.getTime()));
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
    radar, priority, videos: videos.sort((a, b) => Number(b.media?.liveNow) - Number(a.media?.liveNow) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, 24),
    opportunities: opps.map((o) => ({ id: o.id, title: o.title, score: o.score, status: o.status, detail: o.detail, evidence: o.evidence, updatedAt: o.updatedAt.toISOString() })),
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
