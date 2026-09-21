import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import {
  resolveIgCreds, igProfile, igMedia, igAccountInsights, igPublishImage, IgError,
} from "@/lib/ev/instagram";
import { getDb } from "@/lib/db";

/**
 * EV's Instagram tool. Reads profile / media / permitted insights, and can
 * publish an image post. Publishing is REAL (Graph API) and requiresConfirmation
 * — EV must have explicit user approval first, and only reports success when the
 * API confirms it. Tokens never reach the browser.
 */

const schema = z.object({
  action: z
    .enum(["status", "profile", "media", "insights", "publish_image"])
    .describe("status: is IG connected? profile/media/insights: read. publish_image: publish a real post (needs approval)."),
  limit: z.number().int().min(1).max(25).optional(),
  metrics: z.array(z.string().max(40)).max(10).optional().describe("Account insight metrics, e.g. reach, profile_views."),
  imageUrl: z.string().url().optional().describe("Public image URL to publish (publish_image)."),
  caption: z.string().max(2200).optional().describe("Caption for the published post."),
  contentId: z.string().optional().describe("EvContent id this publish fulfills (marks it published on success)."),
});

type Input = z.infer<typeof schema>;

export const evInstagramTool: ToolDefinition<Input> = {
  name: "ev_instagram",
  description:
    "Instagram for EV (Infinity Web & Apps). Read profile, recent media and permitted insights; publish an image post " +
    "(REAL Graph API call, only after the user approves). If Instagram isn't connected, it says so — never fake a publish " +
    "or invent metrics.",
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
          ctx.activity("Publishing to Instagram…");
          const mediaId = await igPublishImage(creds, input.imageUrl, input.caption);
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
      action: { type: "string", enum: ["status", "profile", "media", "insights", "publish_image"] },
      limit: { type: "number" },
      metrics: { type: "array", items: { type: "string" } },
      imageUrl: { type: "string" },
      caption: { type: "string" },
      contentId: { type: "string" },
    },
    required: ["action"],
  },
};
