import "server-only";
import { env } from "@/lib/env";
import { CHANNELS, type CategoryId } from "./topics";

/**
 * Official channels' latest videos and livestreams through the YouTube Data
 * API (key kept server-side). Live status is exactly what YouTube reports for
 * the video at the time of the check (`liveBroadcastContent`), with that time
 * stored — never guessed. No key → "not configured", and no videos are shown.
 * Quota-friendly: channel lookups are cached; each refresh costs ~2 units per
 * channel (uploads playlist + one batched videos call), not search (100 units).
 */

export interface Video {
  videoId: string; url: string; title: string; channel: string; channelId: string; category: CategoryId;
  publishedAt: string; description: string; thumbnail: string | null;
  live: "live" | "upcoming" | "none"; viewers: number | null; scheduledStart: string | null; actualStart: string | null;
  checkedAt: string;
}

const API = "https://www.googleapis.com/youtube/v3";
const channelCache = new Map<string, { at: number; id: string; uploads: string; title: string } | null>();

export function youtubeStatus() {
  return env.youtubeApiKey
    ? { configured: true as const, message: null }
    : { configured: false as const, message: "Live videos are off: add YOUTUBE_API_KEY (YouTube Data API v3, server-side) to JARVIS's environment and restart. Nothing is shown instead of real data." };
}

async function yt<T>(path: string, params: Record<string, string>, f: typeof fetch): Promise<T> {
  const q = new URLSearchParams({ ...params, key: env.youtubeApiKey });
  const r = await f(`${API}/${path}?${q}`, { signal: AbortSignal.timeout(15_000) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error(`YouTube ${path}: ${j.error?.message ?? `HTTP ${r.status}`}`);
  return j;
}

async function channel(handle: string, f: typeof fetch) {
  const hit = channelCache.get(handle);
  if (hit !== undefined && (hit === null || Date.now() - hit.at < 24 * 3600_000)) return hit;
  const j = await yt<{ items?: { id: string; snippet: { title: string }; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>("channels", { part: "id,snippet,contentDetails", forHandle: handle }, f);
  const c = j.items?.[0];
  const v = c ? { at: Date.now(), id: c.id, uploads: c.contentDetails.relatedPlaylists.uploads, title: c.snippet.title } : null;
  channelCache.set(handle, v);
  return v;
}

type VideoRes = { items?: { id: string; snippet: { title: string; description: string; publishedAt: string; channelTitle: string; channelId: string; liveBroadcastContent: string; thumbnails?: Record<string, { url: string }> }; liveStreamingDetails?: { concurrentViewers?: string; scheduledStartTime?: string; actualStartTime?: string; actualEndTime?: string } }[] };

export async function fetchOfficialVideos(o: { perChannel?: number; fetch?: typeof fetch; channels?: typeof CHANNELS } = {}): Promise<{ videos: Video[]; errors: string[] }> {
  if (!env.youtubeApiKey) return { videos: [], errors: [] };
  const f = o.fetch ?? fetch;
  const errors: string[] = [];
  const ids: { id: string; category: CategoryId }[] = [];
  for (const c of o.channels ?? CHANNELS) {
    try {
      const ch = await channel(c.handle, f);
      if (!ch) { errors.push(`${c.name}: channel ${c.handle} not found`); continue; }
      const pl = await yt<{ items?: { contentDetails: { videoId: string } }[] }>("playlistItems", { part: "contentDetails", playlistId: ch.uploads, maxResults: String(o.perChannel ?? 4) }, f);
      for (const it of pl.items ?? []) ids.push({ id: it.contentDetails.videoId, category: c.category });
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
  }
  const videos: Video[] = [];
  const checkedAt = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const j = await yt<VideoRes>("videos", { part: "snippet,liveStreamingDetails", id: chunk.map((x) => x.id).join(",") }, f);
      for (const v of j.items ?? []) {
        const s = v.snippet, l = v.liveStreamingDetails;
        const live = s.liveBroadcastContent === "live" ? "live" : s.liveBroadcastContent === "upcoming" ? "upcoming" : "none";
        videos.push({
          videoId: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, title: s.title, channel: s.channelTitle, channelId: s.channelId,
          category: chunk.find((x) => x.id === v.id)?.category ?? "software", publishedAt: s.publishedAt, description: (s.description ?? "").slice(0, 600),
          thumbnail: s.thumbnails?.high?.url ?? s.thumbnails?.medium?.url ?? s.thumbnails?.default?.url ?? null,
          live, viewers: live === "live" && l?.concurrentViewers ? Number(l.concurrentViewers) : null,
          scheduledStart: l?.scheduledStartTime ?? null, actualStart: l?.actualStartTime ?? null, checkedAt,
        });
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { videos, errors };
}
