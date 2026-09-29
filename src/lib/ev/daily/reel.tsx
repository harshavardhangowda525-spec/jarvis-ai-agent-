import "server-only";
import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { EV_BUSINESS } from "@/lib/ev/config";

/**
 * EV's Reel renderer — turns the day's REAL creative (the generated image, or a
 * Magic Hour clip made from it) into a finished 9:16 Instagram Reel: the hook
 * lands in the first second, two short on-screen beats carry the message, and a
 * brand end card closes with the CTA. Text layers are rendered with Satori
 * + resvg using the bundled Inter font, then composited and encoded to H.264
 * MP4 by ffmpeg (the ffmpeg-static binary, or FFMPEG_PATH). Output is a real
 * video file — never a mock-up.
 */

export const REEL_W = 1080;
export const REEL_H = 1920;
export const REEL_FPS = 30;

export class ReelError extends Error {}

export interface ReelInput {
  /** The creative: image bytes (Ken-Burns motion) or a video clip to reframe. */
  base: { kind: "image" | "video"; bytes: Buffer };
  hook: string;
  /** Up to two short on-screen lines after the hook. */
  beats: string[];
  cta: string;
  seconds?: number;
  /** Motion style (accent palette + push-in / pull-out). */
  variant?: number;
}

export interface RenderedReel { bytes: Buffer; seconds: number; width: number; height: number; mimeType: "video/mp4" }

/** Where the ffmpeg binary lives: FFMPEG_PATH, else the ffmpeg-static package, else PATH. */
export function ffmpegPath(): string {
  const env = process.env.FFMPEG_PATH?.trim();
  if (env) return env;
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const local = path.join(process.cwd(), "node_modules", "ffmpeg-static", exe);
  return existsSync(local) ? local : "ffmpeg";
}

let fontCache: { bold: Buffer; medium: Buffer } | null = null;
async function fonts() {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "assets", "fonts");
  try {
    const [bold, medium] = await Promise.all([
      fs.readFile(path.join(dir, "InterDisplay-ExtraBold.ttf")),
      fs.readFile(path.join(dir, "Inter-Medium.ttf")),
    ]);
    fontCache = { bold, medium };
    return fontCache;
  } catch {
    throw new ReelError("The Reel fonts (assets/fonts) are missing from this deployment.");
  }
}

/** Scene timings (seconds) for a reel of the given length. */
export function reelTimeline(seconds: number, beats: number) {
  const total = Math.min(Math.max(seconds, 8), 20);
  const end = Math.max(total - 2.8, 5);         // end card starts
  const hookEnd = Math.min(3.2, end - 1);
  const n = Math.max(0, Math.min(beats, 2));
  const slot = n ? (end - hookEnd) / n : 0;
  return {
    total,
    hook: { from: 0, to: hookEnd },
    beats: Array.from({ length: n }, (_, i) => ({ from: hookEnd + i * slot, to: hookEnd + (i + 1) * slot })),
    end: { from: end, to: total },
  };
}

const INK = "#ffffff";
/** Motion styles — "change the video" moves to the next one. */
const ACCENTS = [
  "linear-gradient(90deg, #60e4ff, #a78bfa, #ff5cd6)",
  "linear-gradient(90deg, #ffd166, #ff7a59, #ff3d8b)",
  "linear-gradient(90deg, #5cffb0, #3ad1ff, #6b7bff)",
];

/**
 * One overlay frame → PNG: satori lays it out as SVG, resvg paints it.
 * (Not next/og: its loader builds its file paths with path.join on a file://
 * URL, which on Windows turns into "Invalid URL" before anything is drawn.)
 */
async function png(node: React.ReactElement): Promise<Buffer> {
  const f = await fonts();
  const svg = await satori(node, {
    width: REEL_W, height: REEL_H,
    fonts: [
      { name: "Inter", data: f.bold, weight: 800, style: "normal" },
      { name: "Inter", data: f.medium, weight: 500, style: "normal" },
    ],
  });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } }).render().asPng());
}

/** Bigger type for short lines, smaller for long ones. */
const hookSize = (t: string) => (t.length <= 28 ? 104 : t.length <= 48 ? 88 : t.length <= 72 ? 74 : 62);

function Chrome({ accent }: { accent: string }) {
  // top row only — Instagram's caption and buttons cover the bottom of a Reel
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", width: "100%", height: "100%", padding: "64px 60px", fontFamily: "Inter" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, backgroundImage: accent }} />
        <div style={{ display: "flex", color: INK, fontSize: 30, fontWeight: 800, letterSpacing: 6, textShadow: "0 2px 12px rgba(0,0,0,.6)" }}>
          {EV_BUSINESS.name.toUpperCase()}
        </div>
      </div>
      <div style={{ display: "flex", color: "rgba(255,255,255,.85)", fontSize: 30, fontWeight: 500, textShadow: "0 2px 12px rgba(0,0,0,.7)" }}>
        {EV_BUSINESS.instagram}
      </div>
    </div>
  );
}

function Hook({ text, accent }: { text: string; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", fontFamily: "Inter" }}>
      <div style={{ display: "flex", flexDirection: "column", padding: "190px 64px 90px", backgroundImage: "linear-gradient(180deg, rgba(4,3,14,.92) 0%, rgba(4,3,14,.72) 62%, rgba(4,3,14,0) 100%)" }}>
        <div style={{ display: "flex", color: INK, fontSize: hookSize(text), fontWeight: 800, lineHeight: 1.06, letterSpacing: -1.5 }}>{text}</div>
        <div style={{ display: "flex", marginTop: 34, width: 220, height: 10, borderRadius: 5, backgroundImage: accent }} />
      </div>
    </div>
  );
}

function Beat({ text, index, accent }: { text: string; index: number; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", width: "100%", height: "100%", padding: "0 56px 440px", fontFamily: "Inter" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 26, padding: "40px 44px", borderRadius: 40, background: "rgba(8,6,24,.78)", border: "2px solid rgba(255,255,255,.18)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 32, backgroundImage: accent, color: "#0a0620", fontSize: 34, fontWeight: 800, flexShrink: 0 }}>
          {String(index + 1)}
        </div>
        <div style={{ display: "flex", color: INK, fontSize: text.length > 60 ? 50 : 58, fontWeight: 800, lineHeight: 1.12 }}>{text}</div>
      </div>
    </div>
  );
}

function EndCard({ cta, accent }: { cta: string; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", padding: "0 70px", fontFamily: "Inter", textAlign: "center", backgroundImage: "radial-gradient(circle at 50% 42%, rgba(40,24,90,.96), rgba(4,3,14,.98) 70%)" }}>
      <div style={{ display: "flex", width: 120, height: 12, borderRadius: 6, backgroundImage: accent, marginBottom: 56 }} />
      <div style={{ display: "flex", color: INK, fontSize: 92, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2, textAlign: "center", justifyContent: "center" }}>{EV_BUSINESS.name}</div>
      <div style={{ display: "flex", marginTop: 22, color: "rgba(255,255,255,.7)", fontSize: 36, fontWeight: 500, letterSpacing: 4 }}>{EV_BUSINESS.tagline.toUpperCase()}</div>
      <div style={{ display: "flex", marginTop: 90, color: INK, fontSize: cta.length > 50 ? 54 : 64, fontWeight: 800, lineHeight: 1.12, textAlign: "center", justifyContent: "center" }}>{cta}</div>
      <div style={{ display: "flex", marginTop: 70, padding: "28px 56px", borderRadius: 60, backgroundImage: accent, color: "#0a0620", fontSize: 50, fontWeight: 800 }}>
        {`Call ${EV_BUSINESS.phone}`}
      </div>
      <div style={{ display: "flex", marginTop: 40, color: "rgba(255,255,255,.85)", fontSize: 40, fontWeight: 500 }}>{EV_BUSINESS.instagram}</div>
    </div>
  );
}

function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d.toString()).slice(-4000); });
    const t = setTimeout(() => { p.kill("SIGKILL"); reject(new ReelError("Rendering the Reel took too long and was stopped.")); }, timeoutMs);
    p.on("error", (e) => {
      clearTimeout(t);
      reject(new ReelError((e as NodeJS.ErrnoException).code === "ENOENT"
        ? "ffmpeg isn't available on this server (install dependencies, or set FFMPEG_PATH)."
        : `Couldn't start ffmpeg: ${e.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new ReelError(`ffmpeg failed (exit ${code}): ${err.trim().split("\n").slice(-2).join(" ").slice(0, 300)}`));
    });
  });
}

/** Render the Reel. Throws ReelError with the real reason when it can't. */
export async function renderReel(input: ReelInput, opts: { timeoutMs?: number } = {}): Promise<RenderedReel> {
  const hook = input.hook.trim();
  const beats = input.beats.map((b) => b.trim()).filter(Boolean).slice(0, 2);
  const cta = input.cta.trim() || "Let's build yours";
  if (!hook) throw new ReelError("The Reel needs an opening hook.");
  const tl = reelTimeline(input.seconds ?? 12, beats.length);
  const variant = Math.abs(Math.trunc(input.variant ?? 0));
  const accent = ACCENTS[variant % ACCENTS.length];
  const zoom = variant % 2 === 0 ? "1+0.09*on/F" : "1.09-0.09*on/F";

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ev-reel-"));
  try {
    const basePath = path.join(dir, input.base.kind === "image" ? "base.img" : "base.mp4");
    await fs.writeFile(basePath, input.base.bytes);
    const layers: { file: string; from: number; to: number }[] = [];
    const add = async (name: string, node: React.ReactElement, from: number, to: number) => {
      const file = path.join(dir, `${name}.png`);
      await fs.writeFile(file, await png(node));
      layers.push({ file, from, to });
    };
    await add("hook", <Hook text={hook} accent={accent} />, tl.hook.from, tl.hook.to);
    for (let i = 0; i < beats.length; i++) await add(`beat${i}`, <Beat text={beats[i]} index={i} accent={accent} />, tl.beats[i].from, tl.beats[i].to);
    await add("chrome", <Chrome accent={accent} />, 0, tl.end.from);
    await add("end", <EndCard cta={cta} accent={accent} />, tl.end.from, tl.total);

    const T = tl.total.toFixed(2);
    const frames = Math.round(tl.total * REEL_FPS);
    const args: string[] = ["-hide_banner", "-loglevel", "error", "-y"];
    let graph: string;
    if (input.base.kind === "image") {
      args.push("-i", basePath);
      // blurred, darkened fill behind the sharp creative, which slowly pushes in
      graph =
        `[0:v]scale=${REEL_W}:${REEL_H}:force_original_aspect_ratio=increase,crop=${REEL_W}:${REEL_H},boxblur=28:2,eq=brightness=-0.18,` +
        `loop=loop=${frames}:size=1:start=0,fps=${REEL_FPS},setpts=N/${REEL_FPS}/TB,trim=duration=${T}[bg];` +
        `[0:v]scale=${REEL_W * 2}:-2,zoompan=z='${zoom.replace("F", String(frames))}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${REEL_W}x${Math.round(REEL_W * 1.25)}:fps=${REEL_FPS},setsar=1[fg];` +
        `[bg][fg]overlay=0:(H-h)/2:shortest=1,format=yuv420p[v0]`;
    } else {
      args.push("-stream_loop", "-1", "-t", T, "-i", basePath);
      graph = `[0:v]scale=${REEL_W}:${REEL_H}:force_original_aspect_ratio=increase,crop=${REEL_W}:${REEL_H},fps=${REEL_FPS},setsar=1,format=yuv420p[v0]`;
    }
    layers.forEach((l) => args.push("-loop", "1", "-t", T, "-i", l.file));
    const fade = 0.35;
    let last = "v0";
    layers.forEach((l, i) => {
      const idx = i + 1;
      const inT = Math.max(0, l.from).toFixed(2);
      const outT = Math.max(l.from, l.to - fade).toFixed(2);
      const fades = l.from > 0 ? `fade=t=in:st=${inT}:d=${fade}:alpha=1,` : "";
      const fadeOut = l.to < tl.total ? `fade=t=out:st=${outT}:d=${fade}:alpha=1,` : "";
      graph += `;[${idx}:v]format=rgba,${fades}${fadeOut}setpts=PTS-STARTPTS[l${i}]`;
      graph += `;[${last}][l${i}]overlay=0:0:enable='between(t,${inT},${l.to.toFixed(2)})':shortest=1[v${idx}]`;
      last = `v${idx}`;
    });
    const audioIdx = layers.length + 1;
    args.push("-f", "lavfi", "-t", T, "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
    const out = path.join(dir, "reel.mp4");
    args.push(
      "-filter_complex", graph,
      "-map", `[${last}]`, "-map", `${audioIdx}:a`,
      "-t", T, "-r", String(REEL_FPS),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
      out,
    );
    await run(ffmpegPath(), args, opts.timeoutMs ?? 150_000);
    const bytes = await fs.readFile(out);
    if (bytes.length < 10_000) throw new ReelError("ffmpeg produced an empty Reel.");
    return { bytes, seconds: tl.total, width: REEL_W, height: REEL_H, mimeType: "video/mp4" };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Duration (s) and size of an MP4, read from its moov/mvhd + tkhd boxes (no ffprobe needed). */
export function probeMp4(buf: Buffer): { seconds: number; width: number; height: number } | null {
  const find = (start: number, end: number, type: string): { at: number; size: number } | null => {
    let i = start;
    while (i + 8 <= end) {
      let size = buf.readUInt32BE(i);
      const t = buf.toString("latin1", i + 4, i + 8);
      let header = 8;
      if (size === 1 && i + 16 <= end) { size = Number(buf.readBigUInt64BE(i + 8)); header = 16; }
      if (size === 0) size = end - i;
      if (size < header) return null;
      if (t === type) return { at: i + header, size: size - header };
      i += size;
    }
    return null;
  };
  try {
    const moov = find(0, buf.length, "moov");
    if (!moov) return null;
    const mvhd = find(moov.at, moov.at + moov.size, "mvhd");
    if (!mvhd) return null;
    const v = buf[mvhd.at];
    const timescale = v === 1 ? buf.readUInt32BE(mvhd.at + 20) : buf.readUInt32BE(mvhd.at + 12);
    const duration = v === 1 ? Number(buf.readBigUInt64BE(mvhd.at + 24)) : buf.readUInt32BE(mvhd.at + 16);
    let width = 0, height = 0;
    // first video track's tkhd with a non-zero size
    let i = moov.at;
    const end = moov.at + moov.size;
    while (i + 8 <= end) {
      const size = buf.readUInt32BE(i);
      if (size < 8) break;
      if (buf.toString("latin1", i + 4, i + 8) === "trak") {
        const tk = find(i + 8, i + size, "tkhd");
        if (tk) {
          const w = buf.readUInt32BE(tk.at + tk.size - 8) / 65536, h = buf.readUInt32BE(tk.at + tk.size - 4) / 65536;
          if (w && h) { width = Math.round(w); height = Math.round(h); break; }
        }
      }
      i += size;
    }
    if (!timescale) return null;
    return { seconds: duration / timescale, width, height };
  } catch {
    return null;
  }
}
