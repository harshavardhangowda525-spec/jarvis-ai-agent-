import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Serves an EV-generated image or video by id. This endpoint is intentionally
 * PUBLIC and unauthenticated: Instagram's Graph API fetches image_url /
 * video_url server-side with no cookies, so the bytes must be reachable without
 * a session. The cuid id is an unguessable capability token — only someone given
 * the URL can fetch it, and no listing endpoint exposes ids. Byte ranges are
 * supported so videos stream and seek (Safari requires it).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const media = await getDb()
    .evMedia.findUnique({ where: { id: params.id }, select: { data: true, mimeType: true } })
    .catch(() => null);

  if (!media) {
    return new Response("Not found", { status: 404 });
  }

  const body = Buffer.isBuffer(media.data) ? media.data : Buffer.from(media.data as Uint8Array);
  const headers: Record<string, string> = {
    "Content-Type": media.mimeType || "image/png",
    "Accept-Ranges": "bytes",
    // Generated content is immutable once created.
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = body.length;
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    start = Math.max(0, start);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    const chunk = body.subarray(start, end + 1);
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(chunk.length) },
    });
  }
  return new Response(new Uint8Array(body), { status: 200, headers: { ...headers, "Content-Length": String(body.length) } });
}
