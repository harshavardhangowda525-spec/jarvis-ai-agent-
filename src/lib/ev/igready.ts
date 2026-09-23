import "server-only";
import sharp from "sharp";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Instagram only accepts JPEG image posts with an aspect ratio between 4:5
 * (portrait) and 1.91:1 (landscape), up to 1440px wide. AI generators often
 * return PNG/WebP or tall 9:16 images, which Instagram rejects. This converts
 * the image to a compliant JPEG — padding (never cropping) with the image's own
 * dominant colour — stores it, and returns its public URL.
 */
const MIN_RATIO = 4 / 5;   // tallest allowed (width / height)
const MAX_RATIO = 1.91;    // widest allowed
const MAX_WIDTH = 1440;

export class IgImageError extends Error {}

/** Read the source image: straight from the DB for our own media, else fetch it. */
async function loadBytes(imageUrl: string): Promise<Buffer> {
  const own = imageUrl.match(/\/api\/ev\/media\/([A-Za-z0-9_-]+)/);
  if (own) {
    const m = await getDb().evMedia.findUnique({ where: { id: own[1] }, select: { data: true } }).catch(() => null);
    if (m?.data) return Buffer.isBuffer(m.data) ? m.data : Buffer.from(m.data as Uint8Array);
  }
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res || !res.ok) throw new IgImageError("Couldn't load the image to publish.");
  return Buffer.from(await res.arrayBuffer());
}

export interface IgReadyResult { url: string; converted: boolean; note?: string }

export async function prepareImageForInstagram(userId: string, imageUrl: string): Promise<IgReadyResult> {
  const input = await loadBytes(imageUrl);
  let meta: sharp.Metadata;
  try { meta = await sharp(input).metadata(); } catch { throw new IgImageError("That file isn't a readable image."); }
  const w = meta.width ?? 0, h = meta.height ?? 0;
  if (!w || !h) throw new IgImageError("That image has no size information.");

  const ratio = w / h;
  const needsRatio = ratio < MIN_RATIO || ratio > MAX_RATIO;
  const needsFormat = meta.format !== "jpeg";
  const needsSize = w > MAX_WIDTH;
  if (!needsRatio && !needsFormat && !needsSize) return { url: imageUrl, converted: false };

  // Target canvas: pad the short side so the ratio lands inside Instagram's range.
  let cw = w, ch = h;
  if (ratio < MIN_RATIO) cw = Math.round(h * MIN_RATIO);      // too tall → widen
  else if (ratio > MAX_RATIO) ch = Math.round(w / MAX_RATIO); // too wide → heighten
  const scale = Math.min(1, MAX_WIDTH / cw);
  cw = Math.round(cw * scale); ch = Math.round(ch * scale);

  const { dominant } = await sharp(input).stats();
  const jpeg = await sharp(input)
    .rotate() // respect EXIF orientation
    .resize({ width: cw, height: ch, fit: "contain", background: { r: dominant.r, g: dominant.g, b: dominant.b, alpha: 1 } })
    .flatten({ background: { r: dominant.r, g: dominant.g, b: dominant.b } }) // no transparency in JPEG
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  const media = await getDb().evMedia.create({
    data: { userId, mimeType: "image/jpeg", data: jpeg, prompt: "Instagram-ready copy" },
    select: { id: true },
  });
  const notes = [
    needsFormat && `converted ${meta.format?.toUpperCase()} → JPEG`,
    needsRatio && `padded ${w}×${h} to fit Instagram's ${ratio < MIN_RATIO ? "4:5" : "1.91:1"} limit`,
    needsSize && !needsRatio && `resized to ${cw}px wide`,
  ].filter(Boolean).join(", ");
  return { url: `${env.appUrl.replace(/\/$/, "")}/api/ev/media/${media.id}`, converted: true, note: notes };
}
