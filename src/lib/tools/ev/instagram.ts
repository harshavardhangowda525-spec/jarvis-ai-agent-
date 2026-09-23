import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import {
  resolveIgCreds, igProfile, igMedia, igAccountInsights, igPublishImage,
  igCreateReel, igWaitContainer, igPublishContainer, IgError,
} from "@/lib/ev/instagram";
import { getDb } from "@/lib/db";
import { prepareImageForInstagram, IgImageError } from "@/lib/ev/igready";

/**
 * EV's Instagram tool. Reads profile / media / permitted insights, and can
 * publish an image post. Publishing is REAL (Graph API) and requiresConfirmation
 * — EV must have explicit user approval first, and only reports success when the
 * API confirms it. Tokens never reach the browser.
 */

const schema = z.object({
  action: z
    .enum(["status", "profile", "media", "insights", "publish_image", "publish_reel"])
    .describe("status: connected? profile/media/insights: read. publish_image: post an image. publish_reel: post a video Reel. Publishing needs approval."),
  limit: z.number().int().min(1).max(25).optional(),
  metrics: z.array(z.string().max(40)).max(10).optional().describe("Account insight metrics, e.g. reach, profile_views."),
  imageUrl: z.string().url().optional().describe("Public image URL to publish (publish_image)."),
  videoUrl: z.string().url().optional().describe("Public video URL to publish as a Reel (publish_reel)."),
  containerId: z.string().optional().describe("Resume a Reel whose container was already created (publish_reel)."),
  caption: z.string().max(2200).optional().describe("Caption for the published post/reel."),
  contentId: z.string().optional().describe("EvContent id this publish fulfills (marks it published on success)."),
});

type Input = z.infer<typeof schema>;

/** Instagram fetches media server-side, so the URL must be public https. */
function assertPublicUrl(url: string, what: string) {
  if (/^https:\/\//i.test(url) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)) return;
  throw new ToolError(
    `The ${what} isn't a public https URL (${url.slice(0, 40)}…). Instagram can't fetch it. Set APP_URL to your public https app URL (on Vercel it's auto-detected after a redeploy), then try again.`,
  );
}

export const evInstagramTool: ToolDefinition<Input> = {
  name: "ev_instagram",
  description:
    "Instagram for EV (Infinity Web & Apps). Read profile, recent media and permitted insights; publish an image post or a " +
    "video Reel (REAL Graph API calls, only after the user approves). Reels are async: publish_reel uploads the video, waits for " +
    "processing, and publishes — if it's still processing you get a containerId, call publish_reel again with it to finish. If " +
    "Instagram isn't connected, it says so — never fake a publish or invent metrics.",
  schema,
  agentScope: "ev",
  requiresConfirmation: true, // publishing is external; EV confirms before acting
  activityLabel: "Working with Instagram",
  async execute(input, ctx) {
    const creds = await resolveIgCreds(ctx.userId);
    if (input.action === "status" || !creds) {
      return {
        data: { connected: !!creds, source: creds?.source ?? null },
        summary: creds
          ? "Instagram is connected."
          : "Instagram isn't connected. Add INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ID (or connect Instagram in Settings). I can still prepare content meanwhile.",
      };
    }

    try {
      switch (input.action) {
        case "profile": {
          ctx.activity("Reading Instagram profile…");
          const p = await igProfile(creds);
          return { data: p, summary: `@${(p as any).username}: ${(p as any).followers_count ?? "?"} followers, ${(p as any).media_count ?? "?"} posts.` };
        }
        case "media": {
          ctx.activity("Reading recent Instagram media…");
          const media = await igMedia(creds, input.limit ?? 12);
          return { data: { count: media.length, media }, summary: `Fetched ${media.length} recent post(s).` };
        }
        case "insights": {
          ctx.activity("Reading Instagram insights…");
          const metrics = input.metrics?.length ? input.metrics : ["reach", "profile_views"];
          const data = await igAccountInsights(creds, metrics);
          return {
            data: { metrics, insights: data },
            summary: data.length ? `Insights for ${metrics.join(", ")}.` : "No insight data returned for that period.",
          };
        }
        case "publish_image": {
          if (!input.imageUrl) throw new ToolError("A public 'imageUrl' is required to publish.");
          if (!input.caption) throw new ToolError("A 'caption' is required to publish.");
          assertPublicUrl(input.imageUrl, "image URL");
          ctx.activity("Preparing image for Instagram…");
          let readyUrl: string;
          try { readyUrl = (await prepareImageForInstagram(ctx.userId, input.imageUrl)).url; }
          catch (e) { if (e instanceof IgImageError) throw new ToolError(e.message); throw e; }
          ctx.activity("Publishing to Instagram…");
          const mediaId = await igPublishImage(creds, readyUrl, input.caption);
          // Mark the source content as truly published only on confirmed success.
          if (input.contentId) {
            await getDb().evContent.updateMany({
              where: { id: input.contentId, userId: ctx.userId },
              data: { status: "published", publishedAt: new Date(), externalId: mediaId },
            }).catch(() => {});
          }
          return {
            data: { published: true, mediaId },
            summary: `✅ Published to Instagram (media id ${mediaId}).`,
          };
        }
        case "publish_reel": {
          // Resume a container that's already processing, or create a new one.
          let containerId = input.containerId;
          if (!containerId) {
            if (!input.videoUrl) throw new ToolError("A public 'videoUrl' is required to publish a Reel.");
            if (!input.caption) throw new ToolError("A 'caption' is required to publish a Reel.");
            assertPublicUrl(input.videoUrl, "video URL");
            ctx.activity("Uploading Reel to Instagram…");
            containerId = await igCreateReel(creds, input.videoUrl, input.caption);
          }
          ctx.activity("Waiting for Instagram to process the video…");
          const st = await igWaitContainer(creds, containerId, 40_000);
          if (st.error) throw new ToolError("Instagram couldn't process the Reel video (check format: MP4, 9:16, 3–90s).");
          if (!st.ready) {
            return {
              data: { published: false, containerId, status: st.status },
              summary: `Reel is still processing on Instagram (${st.status}). Ask me to finish publishing it in a moment — I'll resume with containerId ${containerId}.`,
            };
          }
          ctx.activity("Publishing the Reel…");
          const mediaId = await igPublishContainer(creds, containerId);
          if (input.contentId) {
            await getDb().evContent.updateMany({
              where: { id: input.contentId, userId: ctx.userId },
              data: { status: "published", publishedAt: new Date(), externalId: mediaId },
            }).catch(() => {});
          }
          return { data: { published: true, mediaId, type: "reel" }, summary: `✅ Published Reel to Instagram (media id ${mediaId}).` };
        }
      }
    } catch (err) {
      if (err instanceof IgError) throw new ToolError(`Instagram: ${err.message}`);
      throw err;
    }
    throw new ToolError("Unsupported Instagram action.");
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["status", "profile", "media", "insights", "publish_image", "publish_reel"] },
      limit: { type: "number" },
      metrics: { type: "array", items: { type: "string" } },
      imageUrl: { type: "string" },
      videoUrl: { type: "string" },
      containerId: { type: "string" },
      caption: { type: "string" },
      contentId: { type: "string" },
    },
    required: ["action"],
  },
};
