import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { isConfigured as magicHourReady, createVideo, MagicHourError } from "@/lib/ev/magichour";
import { finishMagicHour, type VideoFallback } from "@/lib/ev/render";
import { resolveStartImage } from "@/lib/ev/start-image";

/**
 * EV's video generator (Magic Hour). Creates a REAL marketing video — text-to-
 * video from a prompt, or image-to-video from an image URL (e.g. one EV already
 * generated). Video rendering takes minutes, so this is async: 'generate' starts
 * the job and returns a projectId; 'check' fetches it when ready. Never fakes it.
 */

const schema = z.object({
  action: z.enum(["generate", "check"]).optional().describe("generate (default) starts a video; check fetches a pending one."),
  prompt: z.string().max(2000).optional().describe("What the video should show / its motion and vibe."),
  imageUrl: z.string().max(2000).optional().describe("Optional starting image (an EV image link or a public image URL) → image-to-video."),
  contentImageId: z.string().max(80).optional().describe("mediaId of an EV-generated image to animate (preferred — ev_image returns it)."),
  seconds: z.number().int().min(3).max(20).optional().describe("Video length in seconds (default 5; Magic Hour's default model allows up to 15)."),
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

/** Wait briefly for the render; ready → stored + shown, still rendering → the app keeps checking by itself. */
async function finish(userId: string, projectId: string, contentId: string | undefined, label: string, budgetMs: number, fallback?: VideoFallback, note?: string) {
  const st = await finishMagicHour(userId, "video", projectId, { budgetMs, label, fallback });
  if (st.status === "failed") throw new ToolError(st.error);
  if (st.status === "rendering") {
    const why = st.note ?? note;
    // after a restart from the description there's no picture left to fall back from
    const fb = st.stage === "restarted" ? undefined : fallback;
    return {
      data: { projectId: st.projectId, status: st.stage, ready: false, pendingMedia: { kind: "video", projectId: st.projectId, label: label.slice(0, 80), ...(fb ? { fallback: fb } : {}) } },
      summary: `${why ? `${why} ` : ""}The video is rendering on Magic Hour (usually a few minutes). It will appear here by itself as soon as it's done — no need to ask again.`,
    };
  }
  if (st.mediaId) await attach(userId, contentId, st.url, st.mediaId);
  return { data: { url: st.url, mediaId: st.mediaId, openUrl: st.url, label: "View video" }, summary: `${note ? `${note} ` : ""}Video ready to review.` };
}

export const evVideoTool: ToolDefinition<Input> = {
  name: "ev_video",
  description:
    "Generate a REAL marketing video/reel for Infinity Web & Apps with Magic Hour: text-to-video from a prompt, or image-to-video " +
    "from an EV image (contentImageId = its mediaId). Renders take minutes: if it isn't done at once the app keeps checking and shows " +
    "the video by itself when it's ready — just tell the user it's rendering. 'check' + projectId fetches it on request. Never fabricates a video.",
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
      return finish(ctx.userId, input.projectId, input.contentId, input.prompt ?? "EV video", 30_000);
    }

    if (!input.prompt || input.prompt.trim().length < 3) throw new ToolError("Provide a 'prompt' describing the video.");

    // The start frame, however it was referred to — its bytes are uploaded to
    // Magic Hour (never a link Magic Hour might not be able to read).
    let image: { bytes: Buffer; mimeType: string } | undefined;
    if (input.contentImageId || input.imageUrl) {
      const start = await resolveStartImage(ctx.userId, { contentImageId: input.contentImageId, imageUrl: input.imageUrl });
      if (!start) throw new ToolError("I couldn't find that image to animate. Generate one with ev_image first (then pass its mediaId as contentImageId), or ask for a text-to-video instead.");
      if (start.source === "latest") ctx.activity("Using the image EV just made as the first frame…");
      image = { bytes: start.bytes, mimeType: start.mimeType };
    }

    const fallback: VideoFallback | undefined = image ? { prompt: input.prompt, seconds: input.seconds, aspect: input.aspect } : undefined;
    try {
      ctx.activity("Starting video render on Magic Hour…");
      let note: string | undefined;
      let projectId: string;
      try {
        projectId = await createVideo({ prompt: input.prompt, image, seconds: input.seconds, aspect: input.aspect });
      } catch (err) {
        // Magic Hour wouldn't take the picture even after retrying → still make the video, from the description
        if (!(err instanceof MagicHourError && err.startImageRejected)) throw err;
        ctx.activity("Magic Hour won't take the picture — making the video from the description…");
        note = `Magic Hour wouldn't accept the picture as the first frame (${err.message.replace(/ \(image-to-video.*$/, "")}), so I'm making the video from its description instead.`;
        projectId = await createVideo({ prompt: input.prompt, seconds: input.seconds, aspect: input.aspect });
      }
      // A short wait here; a longer render is finished by the app in the background.
      return finish(ctx.userId, projectId, input.contentId, input.prompt, 35_000, note ? undefined : fallback, note);
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
