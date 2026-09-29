import { NextRequest } from "next/server";
import { recordActivity } from "@/lib/activity/record";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import {
  resolveIgCreds, igNotConnectedMessage, igPublishImage, igCreateReel, igWaitContainer, igPublishContainer, IgError,
} from "@/lib/ev/instagram";
import { publicBase, publicMediaUrl, NO_PUBLIC_URL } from "@/lib/public-url";
import { getDb } from "@/lib/db";
import { prepareImageForInstagram, IgImageError } from "@/lib/ev/igready";

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
      return fail(igNotConnectedMessage(), 409);
    }

    // Instagram downloads the media itself: EV's own media goes out from the public
    // address (this app's, or the one your deployed app saved when you're on the PC)
    const base = await publicBase(user.id);
    const videoUrl = body.videoUrl ? publicMediaUrl(body.videoUrl, base) : null;
    const imageUrl = body.imageUrl ? publicMediaUrl(body.imageUrl, base) : null;

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
        if (body.videoUrl && !videoUrl) return fail(NO_PUBLIC_URL, 422);
        let containerId = body.containerId;
        if (!containerId) containerId = await igCreateReel(creds, videoUrl!, body.caption);
        const st = await igWaitContainer(creds, containerId, 45_000);
        if (st.error) return fail(`Instagram couldn't process the Reel${st.detail ? `: ${st.detail}` : " (must be MP4, 9:16, 3–90s)"}.`, 422);
        if (!st.ready) {
          return ok({ published: false, containerId, status: st.status, message: "Reel still processing — click Publish again in a moment to finish." });
        }
        const mediaId = await igPublishContainer(creds, containerId);
        await markPublished(mediaId);
        await recordActivity(user.id, { category: "marketing", agent: "EV", source: "ev", project: "EV", action: "Published a reel to Instagram", result: String(body.caption ?? "").slice(0, 160) || null, status: "success", importance: 4, metadata: { mediaId } });
        return ok({ published: true, mediaId, type: "reel" });
      }

      // ---- Image ----
      if (!body.imageUrl) return fail("Provide an imageUrl or videoUrl to publish.", 400);
      if (!imageUrl) return fail(NO_PUBLIC_URL, 422);
      // Instagram only takes JPEG within 4:5–1.91:1 — convert/pad if needed.
      let ready;
      try { ready = await prepareImageForInstagram(user.id, imageUrl); }
      catch (e) { if (e instanceof IgImageError) return fail(e.message, 422); throw e; }
      const mediaId = await igPublishImage(creds, publicMediaUrl(ready.url, base) ?? ready.url, body.caption);
      await markPublished(mediaId);
      await recordActivity(user.id, { category: "marketing", agent: "EV", source: "ev", project: "EV", action: "Published a post to Instagram", result: String(body.caption ?? "").slice(0, 160) || null, status: "success", importance: 4, metadata: { mediaId } });
      return ok({ published: true, mediaId, type: "image", adjusted: ready.note ?? null });
    } catch (err) {
      if (err instanceof IgError) {
        await recordActivity(user.id, { category: "error", agent: "EV", source: "ev", project: "EV", action: "Instagram publish failed", result: err.message, status: "failed", importance: 4 });
        return fail(`Instagram: ${err.message}`, err.status && err.status >= 400 && err.status < 500 ? err.status : 502);
      }
      throw err;
    }
  } catch (err) {
    return handleError(err);
  }
}
