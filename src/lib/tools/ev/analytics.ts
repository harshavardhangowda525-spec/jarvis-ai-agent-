import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { getDb } from "@/lib/db";
import { resolveIgCreds, igProfile, igMedia, igAccountInsights } from "@/lib/ev/instagram";

/**
 * EV's marketing analytics. Aggregates ONLY data that actually exists: real
 * Instagram metrics (when connected) plus EV's own content-production stats. It
 * never invents missing analytics — unavailable data is reported as unavailable.
 */

const schema = z.object({
  scope: z
    .enum(["overview", "instagram", "content"])
    .describe("overview: everything available. instagram: live IG metrics. content: EV production stats.")
    .optional(),
});

type Input = z.infer<typeof schema>;

export const evAnalyticsTool: ToolDefinition<Input> = {
  name: "ev_analytics",
  description:
    "EV's marketing analytics for Infinity Web & Apps. Reports REAL Instagram metrics (reach, profile visits, " +
    "engagement, followers) when connected, plus EV's content-production stats. Clearly states when data is unavailable — " +
    "never invents numbers.",
  schema,
  agentScope: "ev",
  activityLabel: "Compiling EV analytics",
  async execute(input, ctx) {
    const scope = input.scope ?? "overview";
    const out: Record<string, unknown> = {};
    const unavailable: string[] = [];

    if (scope === "overview" || scope === "instagram") {
      const creds = await resolveIgCreds(ctx.userId);
      if (!creds) {
        unavailable.push("Instagram analytics (not connected)");
        out.instagram = { connected: false };
      } else {
        try {
          ctx.activity("Reading live Instagram metrics…");
          const [profile, media, insights] = await Promise.all([
            igProfile(creds).catch(() => null),
            igMedia(creds, 12).catch(() => []),
            igAccountInsights(creds, ["reach", "profile_views"]).catch(() => []),
          ]);
          const likes = (media as any[]).reduce((s, m) => s + (m.like_count ?? 0), 0);
          const comments = (media as any[]).reduce((s, m) => s + (m.comments_count ?? 0), 0);
          out.instagram = {
            connected: true,
            followers: (profile as any)?.followers_count ?? null,
            mediaCount: (profile as any)?.media_count ?? null,
            recentPosts: (media as any[]).length,
            recentLikes: likes,
            recentComments: comments,
            insights,
          };
          if (!(insights as any[]).length) unavailable.push("Instagram insights for this period");
        } catch {
          out.instagram = { connected: true, error: "Couldn't read Instagram metrics right now." };
          unavailable.push("Instagram analytics (temporary error)");
        }
      }
    }

    if (scope === "overview" || scope === "content") {
      const items = await getDb().evContent.findMany({
        where: { userId: ctx.userId },
        select: { kind: true, status: true, niche: true, createdAt: true },
        take: 1000,
      });
      const byStatus: Record<string, number> = {};
      const byNiche: Record<string, number> = {};
      let published = 0;
      const weekAgo = Date.now() - 7 * 86_400_000;
      let last7 = 0;
      for (const i of items) {
        byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
        if (i.niche) byNiche[i.niche] = (byNiche[i.niche] ?? 0) + 1;
        if (i.status === "published") published++;
        if (i.createdAt.getTime() >= weekAgo) last7++;
      }
      out.content = { total: items.length, published, createdLast7Days: last7, byStatus, topNiches: byNiche };
    }

    return {
      data: { ...out, unavailable },
      summary:
        unavailable.length && Object.keys(out).length === 0
          ? `No analytics available: ${unavailable.join("; ")}.`
          : `Analytics compiled${unavailable.length ? ` (unavailable: ${unavailable.join("; ")})` : ""}.`,
    };
  },
  inputSchema: {
    type: "object",
    properties: { scope: { type: "string", enum: ["overview", "instagram", "content"] } },
    required: [],
  },
};
