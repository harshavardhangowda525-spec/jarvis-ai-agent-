import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { waitProject, createVideo, isUrlProblem, MagicHourError, type Aspect } from "@/lib/ev/magichour";
import { storeRemoteMedia } from "@/lib/ev/media";

/**
 * Finish a Magic Hour render: check the project and, once it's complete, store
 * the file in EV's media (once — asking again returns the same stored copy).
 * Used by EV's tools and by the console, which keeps checking a render in the
 * background so a video appears by itself when Magic Hour is done.
 */
export type RenderState =
  | { status: "ready"; kind: "image" | "video"; url: string; mediaId: string | null; projectId: string }
  | { status: "failed"; kind: "image" | "video"; error: string; projectId: string }
  | { status: "rendering"; kind: "image" | "video"; stage: string; projectId: string; note?: string };

/** What to make instead if Magic Hour can't read the start picture: the same video from its description. */
export interface VideoFallback { prompt: string; seconds?: number; aspect?: Aspect }

const tag = (projectId: string) => `mh:${projectId}`;
const mediaUrl = (id: string, kind: "image" | "video") => `${env.appUrl.replace(/\/$/, "")}/api/ev/media/${id}${kind === "video" ? "?kind=video" : ""}`;

/** An already-stored result for this render (so repeated checks never duplicate it). */
async function stored(userId: string, projectId: string, kind: "image" | "video") {
  const m = await getDb().evMedia.findFirst({ where: { userId, prompt: { startsWith: tag(projectId) } }, select: { id: true } });
  return m ? { url: mediaUrl(m.id, kind), mediaId: m.id } : null;
}

export async function finishMagicHour(
  userId: string,
  kind: "image" | "video",
  projectId: string,
  opts: { budgetMs?: number; label?: string; fallback?: VideoFallback } = {},
): Promise<RenderState> {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(projectId)) return { status: "failed", kind, projectId, error: "That isn't a Magic Hour project id." };
  const have = await stored(userId, projectId, kind);
  if (have) return { status: "ready", kind, projectId, ...have };
  let r;
  try { r = await waitProject(kind, projectId, opts.budgetMs ?? 8_000); }
  catch (e) {
    // A hiccup (network, Magic Hour busy/down) isn't a failed render — keep checking.
    const final = e instanceof MagicHourError && [400, 401, 402, 403, 404, 422].includes(e.status ?? 0);
    if (!final) return { status: "rendering", kind, projectId, stage: "waiting" };
    return { status: "failed", kind, projectId, error: (e as MagicHourError).message };
  }
  if (!r.done) return { status: "rendering", kind, projectId, stage: r.status };
  if (!r.ok || !r.url) {
    const why = r.error ?? r.status;
    // an image-to-video whose picture Magic Hour couldn't read ("invalid url"…) → the same video from its description, once
    if (kind === "video" && opts.fallback?.prompt && r.status === "error" && isUrlProblem(why)) {
      try {
        const id = await createVideo({ prompt: opts.fallback.prompt, seconds: opts.fallback.seconds, aspect: opts.fallback.aspect });
        return {
          status: "rendering", kind, projectId: id, stage: "restarted",
          note: `Magic Hour couldn't use the picture as the first frame (${why}), so I'm making the video from its description instead.`,
        };
      } catch (e) {
        return { status: "failed", kind, projectId, error: `Magic Hour couldn't make the video (${why}), and starting it again from the description failed too (${(e as Error).message}).` };
      }
    }
    return { status: "failed", kind, projectId, error: `Magic Hour couldn't make the ${kind} (${why}).` };
  }
  const again = await stored(userId, projectId, kind); // another check may have stored it meanwhile
  if (again) return { status: "ready", kind, projectId, ...again };
  const s = await storeRemoteMedia(userId, r.url, kind, `${tag(projectId)} · ${opts.label ?? `EV ${kind}`}`.slice(0, 4000));
  return { status: "ready", kind, projectId, url: s.url, mediaId: s.stored ? s.id : null };
}
