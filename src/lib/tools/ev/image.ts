import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { generateImage, ImageGenError, type Aspect } from "@/lib/ev/image";

/**
 * EV's image generator. Turns a visual brief into a REAL image (via the
 * configured Gemini/OpenAI image model), stores the bytes, and returns a public
 * URL that ev_instagram can publish. Never fakes an image — if generation fails
 * or isn't configured, it says so honestly.
 */

const schema = z.object({
  prompt: z.string().min(3).max(2000).describe("Detailed visual description of the image to generate (subject, style, mood, colors, text overlay)."),
  aspect: z.enum(["square", "portrait", "landscape"]).optional().describe("Composition. square (default) and portrait suit Instagram feed."),
  niche: z.string().max(60).optional().describe("Target niche this visual is for, e.g. gyms, cafes."),
  contentId: z.string().optional().describe("EvContent id to attach this image URL to (so a prepared post carries its graphic)."),
});

type Input = z.infer<typeof schema>;

export const evImageTool: ToolDefinition<Input> = {
  name: "ev_image",
  description:
    "Generate a REAL marketing image for Infinity Web & Apps from a visual brief and return a public URL usable for " +
    "Instagram publishing. Use this when a post/ad/story needs an actual graphic. If image generation isn't configured, " +
    "it reports that honestly — it never fabricates an image.",
  schema,
  agentScope: "ev",
  activityLabel: "Generating marketing image",
  async execute(input, ctx) {
    ctx.activity("Generating image…");
    let result;
    try {
      result = await generateImage(input.prompt, (input.aspect ?? "square") as Aspect);
    } catch (err) {
      if (err instanceof ImageGenError) throw new ToolError(err.message);
      throw err;
    }

    const media = await getDb().evMedia.create({
      data: {
        userId: ctx.userId,
        mimeType: result.mimeType,
        data: result.bytes,
        prompt: input.prompt,
      },
      select: { id: true },
    });

    const url = `${env.appUrl.replace(/\/$/, "")}/api/ev/media/${media.id}`;

    // Optionally attach the image URL to a prepared content item.
    if (input.contentId) {
      const item = await getDb().evContent.findFirst({ where: { id: input.contentId, userId: ctx.userId } });
      if (item) {
        const meta = { ...((item.metadata as Record<string, unknown>) ?? {}), imageUrl: url, imageMediaId: media.id };
        await getDb().evContent.update({ where: { id: item.id }, data: { metadata: meta as object } });
      }
    }

    return {
      data: { url, mediaId: media.id, provider: result.provider, model: result.model, mimeType: result.mimeType, openUrl: url, label: "View image" },
      summary: `Generated a ${input.aspect ?? "square"} image (${result.provider}). Ready to review${input.contentId ? " and attached to the post" : ""}.`,
    };
  },
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Detailed visual description." },
      aspect: { type: "string", enum: ["square", "portrait", "landscape"] },
      niche: { type: "string" },
      contentId: { type: "string" },
    },
    required: ["prompt"],
  },
};
