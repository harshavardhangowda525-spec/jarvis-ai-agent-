#!/usr/bin/env node
/**
 * EV's motion-graphics renderer, in its own process: the vector renderer
 * (resvg, native code) can crash on an unusual frame, and a crash here must
 * never take JARVIS down with it. JARVIS sends one job as JSON on stdin; this
 * prints progress lines ({"type":"frame","t":…}) and one result line on stdout.
 *
 * Jobs: probe (draw a few frames small, to catch problems early), still (one
 * PNG) and video (all frames → H.264 MP4 via ffmpeg).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { compileMotion, MotionCodeError } from "../src/lib/ev/motion/sandbox-core.mjs";

const say = (o) => process.stdout.write(JSON.stringify(o) + "\n");
let input = "";
for await (const c of process.stdin) input += c;
const job = JSON.parse(input);

function paint(svg, width) {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { fontFiles: job.fontFiles, loadSystemFonts: false, defaultFontFamily: "Inter" } }).render();
}

/** One flat colour (or nearly) = a failed render, not a design. */
function looksBlank(rgba) {
  const step = Math.max(4, Math.floor(rgba.length / 4 / 4000)) * 4;
  let n = 0, sum = 0, sumSq = 0;
  const colours = new Set();
  for (let i = 0; i + 3 < rgba.length; i += step) {
    const l = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    sum += l; sumSq += l * l; n++;
    if (colours.size < 64) colours.add(((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4));
  }
  const sd = Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2));
  return sd < 3 || colours.size < 3;
}

const frameAt = (program, t, width) => {
  say({ type: "frame", t });
  const svg = program.frame(t);
  return paint(svg, width);
};

try {
  const program = compileMotion(job.code, { width: job.width, height: job.height, seconds: job.seconds });
  if (job.mode === "probe") {
    for (const t of job.times) frameAt(program, t, job.renderWidth);
    say({ type: "done" });
  } else if (job.mode === "still") {
    const img = frameAt(program, job.t, job.renderWidth);
    if (looksBlank(img.pixels)) throw new MotionCodeError(`The frame at ${job.t.toFixed(1)}s is blank (one flat colour).`);
    fs.writeFileSync(job.outFile, img.asPng());
    say({ type: "done", width: img.width, height: img.height });
  } else {
    const total = Math.round(job.seconds * job.fps);
    const ff = spawn(job.ffmpeg, [
      "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(job.fps), "-c:v", "png", "-i", "-",
      "-vf", `scale=${job.outWidth}:${job.outHeight}:flags=lanczos,format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", "-an", job.outFile,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", (d) => { err += d; });
    ff.stdin.on("error", () => {});
    const done = new Promise((resolve, reject) => {
      ff.on("error", (e) => reject(new MotionCodeError(e.code === "ENOENT" ? "ffmpeg isn't available on this server (install dependencies, or set FFMPEG_PATH)." : `Couldn't start ffmpeg: ${e.message}`)));
      ff.on("close", resolve);
    });
    const seen = new Set();
    for (let i = 0; i < total; i++) {
      const img = frameAt(program, i / job.fps, job.renderWidth);
      if (i === 0 && looksBlank(img.pixels)) throw new MotionCodeError("The first frame is blank (one flat colour).");
      const png = img.asPng();
      if (seen.size < 50) seen.add(createHash("sha1").update(png).digest("hex"));
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    const code = await done;
    if (code !== 0) throw new MotionCodeError(`ffmpeg failed (exit ${code}): ${err.trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    if (seen.size < 3) throw new MotionCodeError("The video doesn't move — every frame looks the same.");
    say({ type: "done", frames: total, distinct: seen.size });
  }
  process.exit(0);
} catch (e) {
  say({ type: "error", message: e instanceof MotionCodeError ? e.message : `Renderer error: ${String(e?.message ?? e).slice(0, 300)}` });
  process.exit(2);
}
