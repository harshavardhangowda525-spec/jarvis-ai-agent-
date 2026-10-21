import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath } from "@/lib/ev/daily/reel";
import { MotionCodeError } from "./sandbox";

/**
 * Paints Claude's frames in a separate helper process (scripts/motion-render.mjs):
 * resvg turns each SVG frame into pixels with the bundled Inter font, ffmpeg
 * encodes an H.264 MP4. The vector renderer is native code that can crash on
 * an unusual frame — in its own process that's a reported error (which Claude
 * then gets to fix), never a crash of JARVIS.
 */

const FONTS = ["InterDisplay-ExtraBold.ttf", "Inter-Medium.ttf"].map((f) => path.join(process.cwd(), "assets", "fonts", f));
const WORKER = path.join(process.cwd(), "scripts", "motion-render.mjs");

export interface MotionCode { code: string; width: number; height: number; seconds: number }

type Job = { mode: "probe"; times: number[]; renderWidth: number } | { mode: "still"; t: number; renderWidth: number } | { mode: "video"; fps: number; renderWidth: number; outWidth: number; outHeight: number };

async function runWorker(m: MotionCode, job: Job, timeoutMs: number): Promise<{ result: Record<string, unknown>; file: Buffer | null }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ev-motion-"));
  const outFile = path.join(dir, job.mode === "video" ? "out.mp4" : "out.png");
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [WORKER], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let buf = "", lastT: number | null = null, result: Record<string, unknown> | null = null, stderr = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new MotionCodeError(`Rendering took longer than ${Math.round(timeoutMs / 1000)}s.`)); }, timeoutMs);
      child.stdout.on("data", (d) => {
        buf += d;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          try { const o = JSON.parse(line); if (o.type === "frame") lastT = o.t; else result = o; } catch { /* not ours */ }
        }
      });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("error", (e) => { clearTimeout(timer); reject(new MotionCodeError(`Couldn't start the renderer: ${e.message}`)); });
      child.on("close", async (code) => {
        clearTimeout(timer);
        if (result?.type === "error") return reject(new MotionCodeError(String(result.message)));
        if (code === 0 && result?.type === "done") {
          const file = job.mode === "probe" ? null : await fs.readFile(outFile).catch(() => null);
          return resolve({ result, file });
        }
        // the native renderer crashed on a frame
        const panic = /panicked at[^\n]*\n([^\n]+)/.exec(stderr)?.[1]?.trim();
        reject(new MotionCodeError(`The vector renderer crashed while drawing the frame at ${lastT != null ? `${lastT.toFixed(2)}s` : "the start"}${panic ? ` (${panic.slice(0, 120)})` : ""}. Keep every shape at least partly on the canvas (skip shapes that are fully off-screen), avoid zero-size or huge shapes, and keep gradients on visible shapes.`));
      });
      child.stdin.end(JSON.stringify({ ...m, ...job, outFile, fontFiles: FONTS, ffmpeg: ffmpegPath() }));
    });
  } finally {
    void fs.rm(dir, { recursive: true, force: true });
  }
}

/** Draw a few frames small — catches a renderer crash before the full render. */
export async function probeFrames(m: MotionCode, times: number[]) {
  await runWorker(m, { mode: "probe", times, renderWidth: 270 }, 60_000);
}

export async function renderStill(m: MotionCode, t: number, outWidth: number): Promise<{ png: Buffer; width: number; height: number }> {
  const { result, file } = await runWorker(m, { mode: "still", t, renderWidth: outWidth }, 60_000);
  if (!file || file.length < 1000) throw new MotionCodeError("The renderer produced an empty image.");
  return { png: file, width: Number(result.width), height: Number(result.height) };
}

export async function renderVideo(m: MotionCode, o: { fps: number; renderWidth: number; outWidth: number; outHeight: number; timeoutMs?: number }): Promise<{ mp4: Buffer; frames: number; distinct: number }> {
  const { result, file } = await runWorker(m, { mode: "video", ...o }, o.timeoutMs ?? 300_000);
  if (!file || file.length < 5_000) throw new MotionCodeError("ffmpeg produced an empty video.");
  return { mp4: file, frames: Number(result.frames), distinct: Number(result.distinct) };
}
