import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

/** Max bytes we persist in the DB for a generated asset (keeps videos sane). */
const MAX_STORE_BYTES = 18 * 1024 * 1024;

export interface StoredMedia {
  id: string;
  url: string;
  mimeType: string;
  kind: "image" | "video";
  stored: boolean;
  sourceUrl: string;
}

const guessMime = (url: string, kind: "image" | "video"): string => {
  const u = url.toLowerCase();
  if (u.includes(".mp4")) return "video/mp4";
  if (u.includes(".webm")) return "video/webm";
  if (u.includes(".mov")) return "video/quicktime";
  if (u.includes(".png")) return "image/png";
  if (u.includes(".jpg") || u.includes(".jpeg")) return "image/jpeg";
  if (u.includes(".webp")) return "image/webp";
  return kind === "video" ? "video/mp4" : "image/png";
};

/**
 * Download a generated asset from a provider URL and store it in EvMedia, so it
 * survives the provider's short-lived link and serves from our own /api/ev/media
 * route. If it's too large to store, we keep the provider URL directly.
 */
export async function storeRemoteMedia(
  userId: string,
  sourceUrl: string,
  kind: "image" | "video",
  prompt: string,
): Promise<StoredMedia> {
  let bytes: Buffer | null = null;
  let mimeType = guessMime(sourceUrl, kind);
  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(45_000) });
    if (res.ok) {
      const ct = res.headers.get("content-type");
      if (ct) mimeType = ct.split(";")[0].trim();
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 0 && buf.length <= MAX_STORE_BYTES) bytes = buf;
    }
  } catch {
    /* fall through — return the source URL */
  }

  if (!bytes) {
    // Too big or unreachable — hand back the provider URL (may expire).
    return { id: "", url: sourceUrl, mimeType, kind, stored: false, sourceUrl };
  }

  const media = await getDb().evMedia.create({
    data: { userId, mimeType, data: bytes, prompt: prompt.slice(0, 4000) },
    select: { id: true },
  });
  const base = env.appUrl.replace(/\/$/, "");
  const url = `${base}/api/ev/media/${media.id}${kind === "video" ? "?kind=video" : ""}`;
  return { id: media.id, url, mimeType, kind, stored: true, sourceUrl };
}
