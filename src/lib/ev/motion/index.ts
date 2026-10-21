import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { CANVAS, claudeAsk, designMotion, type Aspect } from "./claude";
import { renderStill, renderVideo } from "./render";

export { ClaudeMotionUnavailable } from "./claude";
export { MotionCodeError } from "./sandbox";

/**
 * One EV creative, start to finish: EV's prompt → Claude's animation code →
 * a real PNG (image) or MP4 (video) stored with EV's media, ready to review.
 */
export async function makeMotion(userId: string, o: { prompt: string; aspect?: Aspect; kind: "image" | "video"; seconds?: number; onStep?: (s: string) => void }) {
  const aspect = o.aspect ?? (o.kind === "video" ? "portrait" : "square");
  const seconds = Math.min(15, Math.max(3, o.seconds ?? (o.kind === "video" ? 8 : 6)));
  const ask = await claudeAsk(userId);
  o.onStep?.("Claude is designing the motion graphic…");
  const { design, motion, repaired } = await designMotion(ask, { brief: o.prompt, aspect, seconds, video: o.kind === "video" });
  {
    const { w, h } = CANVAS[aspect];
    let bytes: Buffer, mimeType: string, width: number, height: number, extra: Record<string, unknown> = {};
    if (o.kind === "image") {
      o.onStep?.("Rendering the image…");
      const r = await renderStill(motion, design.still, w);
      bytes = r.png; mimeType = "image/png"; width = r.width; height = r.height;
    } else {
      o.onStep?.(`Rendering ${Math.round(design.seconds * 30)} frames…`);
      const renderWidth = Math.round(w * (2 / 3)); // painted at 2/3 size, scaled up sharply by ffmpeg
      const r = await renderVideo(motion, { fps: 30, renderWidth, outWidth: w, outHeight: h });
      bytes = r.mp4; mimeType = "video/mp4"; width = w; height = h; extra = { frames: r.frames };
    }
    const media = await getDb().evMedia.create({
      data: { userId, mimeType, data: bytes, prompt: `${design.title} — ${o.prompt}`.slice(0, 4000), width, height },
      select: { id: true },
    });
    const url = `${env.appUrl.replace(/\/$/, "")}/api/ev/media/${media.id}${o.kind === "video" ? "?kind=video" : ""}`;
    return { mediaId: media.id, url, bytes, mimeType, title: design.title, seconds: design.seconds, aspect, repaired, ...extra };
  }
}
