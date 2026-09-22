import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import {
  resolveIgCreds, igPublishImage, igCreateReel, igWaitContainer, igPublishContainer, IgError,
} from "@/lib/ev/instagram";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  imageUrl: z.string().url().optional(),
  videoUrl: z.string().url().optional(),
  containerId: z.string().optional(), // resume a Reel already uploaded
  caption: z.string().trim().min(1).max(2200),
  contentId: z.string().optional(),
});

/** External media must be publicly reachable over https for Instagram to fetch it. */
function isPublic(url: string): boolean {
  return /^https:\/\//i.test(url) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url);
}

/**
 * Deterministic EV → Instagram publish. Called directly by the EV "Publish"
 * button so posting never depends on the model chaining tool calls. Real Graph
 * API only — reports success solely when Instagram confirms a media id.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`ev-ig-publish:${user.id}`, 10, 60_000);
    if (!rl.allowed) return fail("Too many publish attempts — wait a moment.", 429);

    const body = schema.parse(await req.json());

    const creds = await resolveIgCreds(user.id);
    if (!creds) {
      return fail(
        "Instagram isn't connected. Add INSTAGRAM_ACCESS_TOKEN (a Business/Creator token; if it starts with 'IG' that's enough, otherwise also INSTAGRAM_BUSINESS_ID) and redeploy.",
        409,
      );
    }

    const markPublished = async (mediaId: string) => {
      if (!body.contentId) return;
      await getDb().evContent.updateMany({
        where: { id: body.contentId, userId: user.id },
        data: { status: "published", publishedAt: new Date(), externalId: mediaId },
      }).catch(() => {});
    };

    try {
      // ---- Reel (video) ----
      if (body.videoUrl || body.containerId) {
        if (body.videoUrl && !isPublic(body.videoUrl)) {
          return fail("The video URL isn't a public https URL Instagram can fetch. Set APP_URL to your public app URL and redeploy.", 422);
        }
        let containerId = body.containerId;
        if (!containerId) containerId = await igCreateReel(creds, body.videoUrl!, body.caption);
        const st = await igWaitContainer(creds, containerId, 45_000);
        if (st.error) return fail("Instagram couldn't process the Reel (must be MP4, 9:16, 3–90s).", 422);
        if (!st.ready) {
          return ok({ published: false, containerId, status: st.status, message: "Reel still processing — click Publish again in a moment to finish." });
        }
        const mediaId = await igPublishContainer(creds, containerId);
        await markPublished(mediaId);
        return ok({ published: true, mediaId, type: "reel" });
      }

      // ---- Image ----
      if (!body.imageUrl) return fail("Provide an imageUrl or videoUrl to publish.", 400);
      if (!isPublic(body.imageUrl)) {
        return fail("The image URL isn't a public https URL Instagram can fetch. Set APP_URL to your public app URL and redeploy.", 422);
      }
      const mediaId = await igPublishImage(creds, body.imageUrl, body.caption);
      await markPublished(mediaId);
      return ok({ published: true, mediaId, type: "image" });
    } catch (err) {
      if (err instanceof IgError) return fail(`Instagram: ${err.message}`, err.status && err.status >= 400 && err.status < 500 ? err.status : 502);
      throw err;
    }
  } catch (err) {
    return handleError(err);
  }
}
