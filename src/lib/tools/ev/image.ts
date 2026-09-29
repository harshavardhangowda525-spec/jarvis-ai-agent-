import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { generateImage, ImageGenError, type Aspect } from "@/lib/ev/image";
import { isConfigured as magicHourReady, createImage as mhCreateImage, MagicHourError } from "@/lib/ev/magichour";
import { finishMagicHour } from "@/lib/ev/render";

/**
 * EV's image generator. Produces a REAL image and returns a public URL usable
 * for Instagram publishing. EV makes images with Magic Hour (EV_MEDIA_PROVIDER,
 * default "magichour"); with "auto", Gemini/OpenAI are the backup when Magic
 * Hour isn't connected. Never fabricates an image.
 *
 * Magic Hour is async, so this waits briefly and, if it isn't done in time,
 * returns a projectId — call again with action "check" to fetch the result.
 */

const schema = z.object({
  action: z.enum(["generate", "check"]).optional().describe("generate (default) or check a pending Magic Hour job."),
  prompt: z.string().max(2000).optional().describe("Detailed visual description (subject, style, mood, colors, text overlay)."),
  aspect: z.enum(["square", "portrait", "landscape"]).optional().describe("Composition. square (default) and portrait suit Instagram feed."),
  provider: z.enum(["auto", "magichour", "gemini", "openai"]).optional().describe("Image engine. EV uses Magic Hour; only change this if the user asks for another engine."),
  niche: z.string().max(60).optional(),
  contentId: z.string().optional().describe("EvContent id to attach this image URL to."),
  projectId: z.string().optional().describe("Magic Hour project id (for action 'check')."),
});

type Input = z.infer<typeof schema>;

async function attach(userId: string, contentId: string | undefined, url: string, mediaId: string) {
  if (!contentId) return;
  const item = await getDb().evContent.findFirst({ where: { id: contentId, userId } });
  if (item) {
    const meta = { ...((item.metadata as Record<string, unknown>) ?? {}), imageUrl: url, imageMediaId: mediaId };
    await getDb().evContent.update({ where: { id: item.id }, data: { metadata: meta as object } });
  }
}

/** Wait briefly; ready → stored + shown, still rendering → the app keeps checking and shows it by itself. */
async function finishImage(userId: string, projectId: string, contentId: string | undefined, label: string, budgetMs: number, aspect: Aspect) {
  const st = await finishMagicHour(userId, "image", projectId, { budgetMs, label });
  if (st.status === "failed") throw new ToolError(st.error);
  if (st.status === "rendering") {
    return {
      data: { projectId, status: st.stage, ready: false, provider: "magichour", pendingMedia: { kind: "image", projectId, label: label.slice(0, 80) } },
      summary: "The image is still rendering on Magic Hour — it will appear here by itself when it's done.",
    };
  }
  if (st.mediaId) await attach(userId, contentId, st.url, st.mediaId);
  return {
    data: { url: st.url, mediaId: st.mediaId, provider: "magichour", openUrl: st.url, label: "View image", ...(st.mediaId ? { toAnimate: { tool: "ev_video", contentImageId: st.mediaId } } : {}) },
    summary: `Generated a ${aspect} image (Magic Hour). Ready to review${contentId ? " and attached to the post" : ""}.`,
  };
}

export const evImageTool: ToolDefinition<Input> = {
  name: "ev_image",
  description:
    "Generate a REAL marketing image for Infinity Web & Apps with Magic Hour and return a public URL for review/publishing. " +
    "Magic Hour is async: if it isn't ready quickly you get a projectId — call again with " +
    "action 'check' and that projectId to fetch it. Never fabricates an image.",
  schema,
  agentScope: "ev",
  activityLabel: "Generating marketing image",
  async execute(input, ctx) {
    const aspect = (input.aspect ?? "square") as Aspect;
    // EV makes images with Magic Hour. Only in "auto" mode may another engine stand in.
    const onlyMagicHour = env.evMediaProvider === "magichour";
    const useMagicHour = onlyMagicHour || input.provider === "magichour" ||
      (input.provider !== "gemini" && input.provider !== "openai" && magicHourReady());
    if (useMagicHour && !magicHourReady()) {
      throw new ToolError("EV makes images with Magic Hour, and it isn't connected yet. Add MAGICHOUR_API_KEY (magichour.ai → Developer → API key) to your environment and redeploy / restart — then ask again.");
    }

    // ---- Magic Hour: check a pending job ----
    if (input.action === "check") {
      if (!input.projectId) throw new ToolError("Provide the Magic Hour projectId to check.");
      ctx.activity("Checking Magic Hour image…");
      return finishImage(ctx.userId, input.projectId, input.contentId, input.prompt ?? "EV image", 30_000, aspect);
    }

    if (!input.prompt || input.prompt.trim().length < 3) throw new ToolError("Provide a 'prompt' describing the image.");

    // ---- Magic Hour: generate ----
    if (useMagicHour) {
      try {
        ctx.activity("Generating image with Magic Hour…");
        const projectId = await mhCreateImage(input.prompt, aspect);
        return finishImage(ctx.userId, projectId, input.contentId, input.prompt, 30_000, aspect);
      } catch (err) {
        if (err instanceof MagicHourError) throw new ToolError(err.message);
        throw err;
      }
    }

    // ---- Gemini / OpenAI (synchronous) ----
    ctx.activity("Generating image…");
    let result;
    try {
      result = await generateImage(input.prompt, aspect);
    } catch (err) {
      if (err instanceof ImageGenError) throw new ToolError(err.message);
      throw err;
    }
    const media = await getDb().evMedia.create({
      data: { userId: ctx.userId, mimeType: result.mimeType, data: result.bytes, prompt: input.prompt },
      select: { id: true },
    });
    const url = `${env.appUrl.replace(/\/$/, "")}/api/ev/media/${media.id}`;
    await attach(ctx.userId, input.contentId, url, media.id);
    return {
      data: { url, mediaId: media.id, provider: result.provider, model: result.model, mimeType: result.mimeType, openUrl: url, label: "View image" },
      summary: `Generated a ${aspect} image (${result.provider}). Ready to review${input.contentId ? " and attached to the post" : ""}.`,
    };
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "check"] },
      prompt: { type: "string", description: "Detailed visual description." },
      aspect: { type: "string", enum: ["square", "portrait", "landscape"] },
      provider: { type: "string", enum: ["auto", "magichour", "gemini", "openai"] },
      niche: { type: "string" },
      contentId: { type: "string" },
      projectId: { type: "string" },
    },
    required: [],
  },
};
