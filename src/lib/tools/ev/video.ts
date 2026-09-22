import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { isConfigured as magicHourReady, createVideo, waitProject, MagicHourError } from "@/lib/ev/magichour";
import { storeRemoteMedia } from "@/lib/ev/media";

/**
 * EV's video generator (Magic Hour). Creates a REAL marketing video — text-to-
 * video from a prompt, or image-to-video from an image URL (e.g. one EV already
 * generated). Video rendering takes minutes, so this is async: 'generate' starts
 * the job and returns a projectId; 'check' fetches it when ready. Never fakes it.
 */

const schema = z.object({
  action: z.enum(["generate", "check"]).optional().describe("generate (default) starts a video; check fetches a pending one."),
  prompt: z.string().max(2000).optional().describe("What the video should show / its motion and vibe."),
  imageUrl: z.string().url().optional().describe("Optional starting image URL → image-to-video (else text-to-video)."),
  contentImageId: z.string().optional().describe("EvMedia id of an EV-generated image to animate (used to build the image URL)."),
  seconds: z.number().int().min(3).max(20).optional().describe("Video length in seconds (default 5)."),
  aspect: z.enum(["square", "portrait", "landscape"]).optional(),
  contentId: z.string().optional().describe("EvContent id to attach the finished video URL to."),
  projectId: z.string().optional().describe("Magic Hour project id (for action 'check')."),
});

type Input = z.infer<typeof schema>;

async function attach(userId: string, contentId: string | undefined, url: string, mediaId: string) {
  if (!contentId) return;
  const item = await getDb().evContent.findFirst({ where: { id: contentId, userId } });
  if (item) {
    const meta = { ...((item.metadata as Record<string, unknown>) ?? {}), videoUrl: url, videoMediaId: mediaId };
    await getDb().evContent.update({ where: { id: item.id }, data: { metadata: meta as object } });
  }
}

export const evVideoTool: ToolDefinition<Input> = {
  name: "ev_video",
  description:
    "Generate a REAL marketing video/reel for Infinity Web & Apps with Magic Hour. text-to-video from a prompt, or image-to-video " +
    "from an image URL. Async: 'generate' starts it and returns a projectId; call again with action 'check' + that projectId to " +
    "fetch the finished video. Requires Magic Hour to be connected; never fabricates a video.",
  schema,
  agentScope: "ev",
  activityLabel: "Generating marketing video",
  async execute(input, ctx) {
    if (!magicHourReady()) {
      throw new ToolError("Video generation needs Magic Hour. Add MAGICHOUR_API_KEY (magichour.ai → API) to enable EV video.");
    }

    // ---- check a pending job ----
    if (input.action === "check") {
      if (!input.projectId) throw new ToolError("Provide the Magic Hour projectId to check.");
      ctx.activity("Checking Magic Hour video…");
      try {
        const r = await waitProject("video", input.projectId, 40_000);
        if (!r.done) return { data: { status: r.status, projectId: r.projectId, ready: false }, summary: `Still rendering (${r.status}). Ask me to check again in a bit.` };
        if (!r.ok || !r.url) throw new ToolError(`Magic Hour video ${r.status}.`);
        const stored = await storeRemoteMedia(ctx.userId, r.url, "video", input.prompt ?? "EV video");
        await attach(ctx.userId, input.contentId, stored.url, stored.id);
        return { data: { url: stored.url, mediaId: stored.id, openUrl: stored.url, label: "View video" }, summary: "Video ready." };
      } catch (err) {
        if (err instanceof MagicHourError) throw new ToolError(err.message);
        throw err;
      }
    }

    if (!input.prompt || input.prompt.trim().length < 3) throw new ToolError("Provide a 'prompt' describing the video.");

    // Resolve a starting image URL if an EvMedia id was given.
    let imageUrl = input.imageUrl;
    if (!imageUrl && input.contentImageId) {
      const m = await getDb().evMedia.findFirst({ where: { id: input.contentImageId, userId: ctx.userId }, select: { id: true } });
      // Our media route is public, so Magic Hour can fetch it as the start frame.
      if (m) imageUrl = `${env.appUrl.replace(/\/$/, "")}/api/ev/media/${m.id}`;
    }

    try {
      ctx.activity("Starting video render on Magic Hour…");
      const projectId = await createVideo({ prompt: input.prompt, imageUrl, seconds: input.seconds, aspect: input.aspect });
      // Give it a short window; videos usually need longer → return projectId to check.
      const r = await waitProject("video", projectId, 40_000);
      if (!r.done) {
        return {
          data: { projectId, status: r.status, ready: false },
          summary: `Video is rendering on Magic Hour (project ${projectId}). This takes a few minutes — ask me to check it shortly.`,
        };
      }
      if (!r.ok || !r.url) throw new ToolError(`Magic Hour video ${r.status}.`);
      const stored = await storeRemoteMedia(ctx.userId, r.url, "video", input.prompt);
      await attach(ctx.userId, input.contentId, stored.url, stored.id);
      return { data: { url: stored.url, mediaId: stored.id, openUrl: stored.url, label: "View video" }, summary: "Video ready to review." };
    } catch (err) {
      if (err instanceof MagicHourError) throw new ToolError(err.message);
      throw err;
    }
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "check"] },
      prompt: { type: "string" },
      imageUrl: { type: "string" },
      contentImageId: { type: "string" },
      seconds: { type: "number" },
      aspect: { type: "string", enum: ["square", "portrait", "landscape"] },
      contentId: { type: "string" },
      projectId: { type: "string" },
    },
    required: [],
  },
};
