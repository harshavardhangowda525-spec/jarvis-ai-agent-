import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { fetchFeed, splitPublisher, type FeedItem } from "./rss";
import { categorize, DEFAULT_TOPICS, FEEDS, type CategoryId, type Topic } from "./topics";
import { fetchOfficialVideos, youtubeStatus } from "./youtube";

/**
 * Gathers the external environment: real articles from publisher feeds,
 * Google News searches per topic, Tavily (when its key is set) and official
 * YouTube channels. Each item keeps its publisher, date and original link.
 * Results are cached in the database; a refresh within 15 minutes reuses them.
 */

const db = () => getDb();
export const REFRESH_EVERY_MS = 15 * 60_000;
const MAX_AGE_DAYS = 10;

export function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|ocid)/i.test(k)) url.searchParams.delete(k);
    url.hash = "";
    return url.toString();
  } catch { return u; }
}
export const urlHash = (u: string) => createHash("sha1").update(canonicalUrl(u)).digest("hex");

export async function intelSettings(userId: string) {
  const s = await db().intelSettings.findUnique({ where: { userId } });
  const saved = (s?.topics ?? null) as Topic[] | null;
  // keep the user's on/off and custom topics; add any new default topics
  const topics = saved?.length ? [...saved, ...DEFAULT_TOPICS.filter((d) => !saved.some((t) => t.id === d.id))] : DEFAULT_TOPICS;
  return { userId, topics, dailyEnabled: s?.dailyEnabled ?? true, weeklyEnabled: s?.weeklyEnabled ?? true, notifyEmail: s?.notifyEmail ?? false, notifyWhatsapp: s?.notifyWhatsapp ?? false, lastRefreshAt: s?.lastRefreshAt ?? null, lastRefresh: (s?.lastRefresh ?? null) as RefreshReport | null };
}

export interface SourceRun { name: string; kind: "rss" | "google_news" | "tavily" | "youtube"; ok: boolean; count: number; error?: string }
export interface RefreshReport { at: string; sources: SourceRun[]; added: number; youtube: { configured: boolean; message: string | null; videos: number; live: number; errors: string[] }; tavily: boolean; note?: string }

type Candidate = { url: string; title: string; summary: string | null; publisher: string | null; publishedAt: Date | null; via: string; feed: string; topic: string | null; category: CategoryId };

async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]); } }));
  return out;
}

async function tavilyNews(t: Topic, f: typeof fetch): Promise<FeedItem[]> {
  const r = await f("https://api.tavily.com/search", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ api_key: env.searchApiKey, query: t.query, topic: "news", days: 7, max_results: 6, include_answer: false }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { results?: { title: string; url: string; content?: string; published_date?: string }[] };
  return (j.results ?? []).map((x) => ({ title: x.title, link: x.url, summary: x.content?.slice(0, 700) ?? null, publishedAt: x.published_date ? new Date(x.published_date) : null, publisher: (() => { try { return new URL(x.url).hostname.replace(/^www\./, ""); } catch { return null; } })() }));
}

export async function refreshIntel(userId: string, o: { force?: boolean; fetch?: typeof fetch; now?: Date; youtube?: boolean } = {}): Promise<RefreshReport> {
  const now = o.now ?? new Date();
  const st = await intelSettings(userId);
  if (!o.force && st.lastRefreshAt && now.getTime() - st.lastRefreshAt.getTime() < REFRESH_EVERY_MS && st.lastRefresh) return { ...st.lastRefresh, note: "cached" };
  const f = o.fetch ?? fetch;
  const topics = st.topics.filter((t) => t.on);
  const sources: SourceRun[] = [];
  const cands: Candidate[] = [];
  const push = (items: FeedItem[], via: string, feed: string, topic: Topic | null, fallback: CategoryId) => {
    for (const it of items) {
      const { title, publisher } = via === "google_news" ? splitPublisher(it.title, it.publisher) : { title: it.title, publisher: it.publisher };
      // Google News "summaries" are just the headline and publisher again — no summary is better than a fake one
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const summary = it.summary && !norm(it.summary).startsWith(norm(title).slice(0, 40)) ? it.summary : null;
      cands.push({ url: it.link, title, summary, publisher, publishedAt: it.publishedAt, via, feed, topic: topic?.id ?? null, category: topic ? topic.category : categorize(`${title} ${it.summary ?? ""}`, fallback) });
    }
  };

  const jobs: (() => Promise<void>)[] = [
    ...FEEDS.map((fd) => async () => {
      try { const items = await fetchFeed(fd.url, fd.name, f); push(items, "rss", fd.name, null, fd.category); sources.push({ name: fd.name, kind: "rss", ok: true, count: items.length }); }
      catch (e) { sources.push({ name: fd.name, kind: "rss", ok: false, count: 0, error: (e as Error).message }); }
    }),
    ...topics.map((t) => async () => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${t.query} when:7d`)}&hl=en-IN&gl=IN&ceid=IN:en`;
      try { const items = (await fetchFeed(url, null, f)).slice(0, 12); push(items, "google_news", `Google News: ${t.label}`, t, t.category); sources.push({ name: `Google News · ${t.label}`, kind: "google_news", ok: true, count: items.length }); }
      catch (e) { sources.push({ name: `Google News · ${t.label}`, kind: "google_news", ok: false, count: 0, error: (e as Error).message }); }
    }),
    ...(env.searchApiKey ? topics.map((t) => async () => {
      try { const items = await tavilyNews(t, f); push(items, "tavily", `Tavily: ${t.label}`, t, t.category); sources.push({ name: `Tavily · ${t.label}`, kind: "tavily", ok: true, count: items.length }); }
      catch (e) { sources.push({ name: `Tavily · ${t.label}`, kind: "tavily", ok: false, count: 0, error: (e as Error).message }); }
    }) : []),
  ];
  await pool(jobs, 6, (j) => j());

  const cutoff = now.getTime() - MAX_AGE_DAYS * 86_400_000;
  const seen = new Set<string>();
  const rows: Prisma.IntelItemCreateManyInput[] = [];
  for (const c of cands) {
    if (c.publishedAt && (c.publishedAt.getTime() < cutoff || c.publishedAt.getTime() > now.getTime() + 3600_000)) continue;
    const h = urlHash(c.url);
    if (seen.has(h)) continue;
    seen.add(h);
    rows.push({ userId, urlHash: h, url: canonicalUrl(c.url), title: c.title.slice(0, 400), summary: c.summary, publisher: c.publisher?.slice(0, 120) ?? null, publishedAt: c.publishedAt, via: c.via, feed: c.feed, topic: c.topic, category: c.category });
  }
  const before = await db().intelItem.count({ where: { userId } });
  if (rows.length) await db().intelItem.createMany({ data: rows, skipDuplicates: true });

  // official videos — live status re-checked on every refresh
  const yt = youtubeStatus();
  let ytReport: RefreshReport["youtube"] = { configured: yt.configured, message: yt.message, videos: 0, live: 0, errors: [] };
  if (yt.configured && o.youtube !== false) {
    const { videos, errors } = await fetchOfficialVideos({ fetch: f });
    for (const v of videos) {
      const h = urlHash(v.url);
      const media = { videoId: v.videoId, channel: v.channel, channelId: v.channelId, live: v.live, viewers: v.viewers, thumbnail: v.thumbnail, scheduledStart: v.scheduledStart, actualStart: v.actualStart, checkedAt: v.checkedAt } as Prisma.InputJsonValue;
      await db().intelItem.upsert({
        where: { userId_urlHash: { userId, urlHash: h } },
        create: { userId, urlHash: h, url: v.url, title: v.title.slice(0, 400), summary: v.description || null, publisher: v.channel, publishedAt: new Date(v.publishedAt), via: "youtube", feed: `YouTube: ${v.channel}`, category: v.category, media },
        update: { media, title: v.title.slice(0, 400) },
      });
    }
    // a video not returned this time keeps its last check time, so the UI shows its live status as stale rather than live
    ytReport = { ...ytReport, videos: videos.length, live: videos.filter((v) => v.live === "live").length, errors: errors.slice(0, 6) };
    sources.push({ name: "YouTube official channels", kind: "youtube", ok: errors.length < videos.length + 1, count: videos.length, error: errors[0] });
  }
  const after = await db().intelItem.count({ where: { userId } });

  // keep 30 days
  await db().intelItem.deleteMany({ where: { userId, fetchedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });

  const report: RefreshReport = { at: now.toISOString(), sources: sources.sort((a, b) => a.name.localeCompare(b.name)), added: after - before, youtube: ytReport, tavily: !!env.searchApiKey };
  await db().intelSettings.upsert({ where: { userId }, create: { userId, lastRefreshAt: now, lastRefresh: report as unknown as Prisma.InputJsonValue }, update: { lastRefreshAt: now, lastRefresh: report as unknown as Prisma.InputJsonValue } });
  return report;
}
