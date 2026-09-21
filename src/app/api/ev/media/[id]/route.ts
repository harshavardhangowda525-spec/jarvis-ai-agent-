import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Serves an EV-generated image by id. This endpoint is intentionally PUBLIC and
 * unauthenticated: Instagram's Graph API fetches image_url server-side with no
 * cookies, so the bytes must be reachable without a session. The cuid id is an
 * unguessable capability token — only someone given the URL can fetch it, and no
 * listing endpoint exposes ids.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const media = await getDb()
    .evMedia.findUnique({ where: { id: params.id }, select: { data: true, mimeType: true } })
    .catch(() => null);

  if (!media) {
    return new Response("Not found", { status: 404 });
  }

  const body = Buffer.isBuffer(media.data) ? media.data : Buffer.from(media.data as Uint8Array);
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": media.mimeType || "image/png",
      "Content-Length": String(body.length),
      // Generated content is immutable once created.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
