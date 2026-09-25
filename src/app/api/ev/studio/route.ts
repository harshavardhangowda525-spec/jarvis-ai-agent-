import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { resolveIgCreds, igProfile, igMedia } from "@/lib/ev/instagram";
import { brandDna, studioPipeline, type StudioData, type StudioInstagram, type StudioItem } from "@/lib/ev/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real data for the EV creative studio: the content pipeline counted from EV's
 * memory, the most recent pieces (the idea stream), the brand DNA, and live
 * Instagram numbers when an account is connected. Nothing is estimated — the
 * page's decorative motion is separate from everything returned here.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await getDb().evContent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, kind: true, status: true, title: true, niche: true, theme: true, hook: true, caption: true, body: true, metadata: true, createdAt: true },
    });

    const mediaOf = (m: unknown) => {
      const meta = (m ?? {}) as { imageUrl?: unknown; videoUrl?: unknown };
      const video = typeof meta.videoUrl === "string" ? meta.videoUrl : null;
      const image = typeof meta.imageUrl === "string" ? meta.imageUrl : null;
      return { url: video ?? image, isVideo: !!video };
    };
    const firstLine = (...v: (string | null)[]) =>
      (v.find((x) => x && x.trim()) ?? "").replace(/\*\*/g, "").trim().split("\n")[0].slice(0, 160);

    const pipeline = studioPipeline(rows.map((r) => ({ kind: r.kind, status: r.status, hasMedia: !!mediaOf(r.metadata).url })));
    const recent: StudioItem[] = rows
      .filter((r) => r.kind !== "note" && r.kind !== "outreach")
      .slice(0, 8)
      .map((r) => {
        const m = mediaOf(r.metadata);
        return {
          id: r.id, kind: r.kind, status: r.status,
          title: (r.title || firstLine(r.hook, r.caption, r.body) || r.kind).slice(0, 120),
          niche: r.niche, theme: r.theme,
          excerpt: firstLine(r.hook, r.caption, r.body),
          createdAt: r.createdAt.toISOString(),
          mediaUrl: m.url, isVideo: m.isVideo,
        };
      });
    const weekAgo = Date.now() - 7 * 86_400_000;

    const data: StudioData = {
      pipeline,
      recent,
      brand: brandDna(rows),
      instagram: await instagramNumbers(user.id),
      totals: { items: rows.length, last7Days: rows.filter((r) => r.createdAt.getTime() >= weekAgo).length },
    };
    return ok(data);
  } catch (err) {
    return handleError(err);
  }
}

/** Live Instagram numbers, or why there are none. Never waits more than 6s. */
async function instagramNumbers(userId: string): Promise<StudioInstagram> {
  const creds = await resolveIgCreds(userId);
  if (!creds) return { connected: false };
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000));
  try {
    const [profile, media] = await Promise.race([
      Promise.all([igProfile(creds), igMedia(creds, 12).catch(() => [])]),
      timeout,
    ]);
    const p = profile as { username?: string; followers_count?: number; media_count?: number };
    const list = media as { like_count?: number; comments_count?: number }[];
    return {
      connected: true,
      username: p.username ?? null,
      followers: typeof p.followers_count === "number" ? p.followers_count : null,
      mediaCount: typeof p.media_count === "number" ? p.media_count : null,
      recentPosts: list.length,
      recentLikes: list.reduce((s, m) => s + (m.like_count ?? 0), 0),
      recentComments: list.reduce((s, m) => s + (m.comments_count ?? 0), 0),
    };
  } catch {
    return { connected: true, error: "Couldn't read Instagram right now." };
  }
}
