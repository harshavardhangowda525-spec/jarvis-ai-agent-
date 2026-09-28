import "server-only";
import { getDb } from "@/lib/db";
import { isPrivateIp, resolveHost } from "@/lib/darwin/daily/checks";

/**
 * The picture a video should start from, however EV's brain referred to it:
 * an EV media id, EV's own media link (any host — localhost too), a bare id,
 * or a public image link. Returns the image's BYTES — Magic Hour gets them
 * uploaded, never a link it might not be able to read.
 */
export interface StartImage { bytes: Buffer; mimeType: string; source: "own" | "remote" | "latest"; mediaId?: string }

const MAX_BYTES = 20 * 1024 * 1024;
const LATEST_WINDOW_MS = 6 * 60 * 60_000;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

async function ownMedia(userId: string, id: string): Promise<StartImage | null> {
  const m = await getDb().evMedia.findFirst({ where: { id, userId }, select: { id: true, data: true, mimeType: true } });
  if (!m || m.mimeType.startsWith("video/")) return null;
  return { bytes: Buffer.isBuffer(m.data) ? m.data : Buffer.from(m.data as Uint8Array), mimeType: m.mimeType, source: "own", mediaId: m.id };
}

/** Download a public image link (http/https, public addresses only, redirects re-checked). */
export async function downloadPublicImage(raw: string, timeoutMs = 20_000): Promise<{ bytes: Buffer; mimeType: string } | null> {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const r = await resolveHost(url.hostname);
    if (r.state !== "ok" || r.ips.some(isPrivateIp)) return null;
    let res: Response;
    try { res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) }); } catch { return null; }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      try { url = new URL(res.headers.get("location")!, url); } catch { return null; }
      continue;
    }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type && !type.startsWith("image/") && type !== "application/octet-stream" && type !== "binary/octet-stream") { await res.body?.cancel().catch(() => {}); return null; }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) { await res.body?.cancel().catch(() => {}); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length <= MAX_BYTES ? { bytes: buf, mimeType: type || "application/octet-stream" } : null;
  }
  return null;
}

export async function resolveStartImage(
  userId: string,
  ref: { contentImageId?: string | null; imageUrl?: string | null },
  now = Date.now(),
): Promise<StartImage | null> {
  const raw = (ref.imageUrl ?? "").trim();
  // 1. EV's own image: by id, by its media link (whatever host it was built with), or a bare id
  const ids = [ref.contentImageId, raw.match(/\/api\/ev\/media\/([A-Za-z0-9_-]+)/)?.[1], ID.test(raw) ? raw : null]
    .filter((x): x is string => !!x && ID.test(x));
  for (const id of ids) {
    const m = await ownMedia(userId, id);
    if (m) return m;
  }
  // 2. a public image link
  if (/^https?:\/\//i.test(raw) && !/\/api\/ev\/media\//.test(raw)) {
    const d = await downloadPublicImage(raw);
    if (d) return { ...d, source: "remote" };
  }
  // 3. an image was clearly meant but can't be found as given → the one EV just made
  if (raw || ref.contentImageId) {
    const latest = await getDb().evMedia.findFirst({
      where: { userId, createdAt: { gte: new Date(now - LATEST_WINDOW_MS) }, NOT: { mimeType: { startsWith: "video/" } } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latest) {
      const m = await ownMedia(userId, latest.id);
      if (m) return { ...m, source: "latest" };
    }
  }
  return null;
}
