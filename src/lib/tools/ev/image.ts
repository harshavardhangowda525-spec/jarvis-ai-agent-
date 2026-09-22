import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { generateImage, ImageGenError, type Aspect } from "@/lib/ev/image";
import { isConfigured as magicHourReady, createImage as mhCreateImage, waitProject, MagicHourError } from "@/lib/ev/magichour";
import { storeRemoteMedia } from "@/lib/ev/media";

/**
 * EV's image generator. Produces a REAL image and returns a public URL usable
 * for Instagram publishing. Prefers Magic Hour when configured (higher quality),
 * otherwise uses the Gemini/OpenAI image model. Never fabricates an image.
 *
 * Magic Hour is async, so this waits briefly and, if it isn't done in time,
 * returns a projectId — call again with action "check" to fetch the result.
 */

const schema = z.object({
  action: z.enum(["generate", "check"]).optional().describe("generate (default) or check a pending Magic Hour job."),
  prompt: z.string().max(2000).optional().describe("Detailed visual description (subject, style, mood, colors, text overlay)."),
  aspect: z.enum(["square", "portrait", "landscape"]).optional().describe("Composition. square (default) and portrait suit Instagram feed."),
  provider: z.enum(["auto", "magichour", "gemini", "openai"]).optional().describe("Image engine. auto prefers Magic Hour when connected."),
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

export const evImageTool: ToolDefinition<Input> = {
  name: "ev_image",
  description:
    "Generate a REAL marketing image for Infinity Web & Apps and return a public URL for review/publishing. Prefers Magic Hour " +
    "when connected, else Gemini/OpenAI. Magic Hour is async: if it isn't ready quickly you get a projectId — call again with " +
    "action 'check' and that projectId to fetch it. Never fabricates an image.",
  schema,
  agentScope: "ev",
  activityLabel: "Generating marketing image",
  async execute(input, ctx) {
    const aspect = (input.aspect ?? "square") as Aspect;
    const useMagicHour =
      input.provider === "magichour" || (input.provider !== "gemini" && input.provider !== "openai" && magicHourReady());

    // ---- Magic Hour: check a pending job ----
    if (input.action === "check") {
      if (!input.projectId) throw new ToolError("Provide the Magic Hour projectId to check.");
      ctx.activity("Checking Magic Hour image…");
      try {
        const r = await waitProject("image", input.projectId, 30_000);
        if (!r.done) return { data: { status: r.status, projectId: r.projectId, ready: false }, summary: `Still rendering (${r.status}). Ask me to check again shortly.` };
        if (!r.ok || !r.url) throw new ToolError(`Magic Hour image ${r.status}.`);
        const stored = await storeRemoteMedia(ctx.userId, r.url, "image", input.prompt ?? "EV image");
        await attach(ctx.userId, input.contentId, stored.url, stored.id);
        return { data: { url: stored.url, mediaId: stored.id, provider: "magichour", openUrl: stored.url, label: "View image" }, summary: "Image ready." };
      } catch (err) {
        if (err instanceof MagicHourError) throw new ToolError(err.message);
        throw err;
      }
    }

    if (!input.prompt || input.prompt.trim().length < 3) throw new ToolError("Provide a 'prompt' describing the image.");

    // ---- Magic Hour: generate ----
    if (useMagicHour) {
      try {
        ctx.activity("Generating image with Magic Hour…");
        const projectId = await mhCreateImage(input.prompt, aspect);
        const r = await waitProject("image", projectId, 30_000);
        if (!r.done) {
          return {
            data: { projectId, status: r.status, ready: false, provider: "magichour" },
            summary: `Image is rendering on Magic Hour (project ${projectId}). Ask me to check it in a moment.`,
          };
        }
        if (!r.ok || !r.url) throw new ToolError(`Magic Hour image ${r.status}.`);
        const stored = await storeRemoteMedia(ctx.userId, r.url, "image", input.prompt);
        await attach(ctx.userId, input.contentId, stored.url, stored.id);
        return {
          data: { url: stored.url, mediaId: stored.id, provider: "magichour", openUrl: stored.url, label: "View image" },
          summary: `Generated a ${aspect} image (Magic Hour). Ready to review${input.contentId ? " and attached to the post" : ""}.`,
        };
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
