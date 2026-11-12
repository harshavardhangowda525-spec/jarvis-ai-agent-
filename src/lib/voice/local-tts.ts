import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

/**
 * JARVIS's own voice — free, on this PC, no API key.
 *
 * - English and Hindi: Piper (open-source neural TTS, runs on the CPU) with the
 *   voices `npm run local` downloads into tools/voice.
 * - Kannada: Meta's MMS Kannada model, run by transformers.js (installed into
 *   tools/voice the same way; the model downloads on first use).
 *
 * Each Piper voice stays loaded in one long-running process (fast replies on
 * calls); if that ever misbehaves, a one-off run is used instead.
 */
export type VoiceLang = "en" | "hi" | "kn";

export const VOICE_DIR = process.env.JARVIS_VOICE_DIR || path.join(process.cwd(), "tools", "voice");
/** The Piper voices `npm run local` fetches (scripts/voice-setup.mjs keeps the same list). */
export const PIPER_VOICES: Record<"en" | "hi", string> = { en: "en_GB-cori-medium", hi: "hi_IN-priyamvada-medium" };
export const KANNADA_MODEL = "onnx-community/mms-tts-kan-ONNX";
// installed into tools/voice by npm run local, not part of JARVIS's own packages — kept out of the bundler's sight
const TRANSFORMERS = ["@huggingface", "transformers"].join("/");

const piperExe = () => path.join(VOICE_DIR, "piper", process.platform === "win32" ? "piper.exe" : "piper");
const modelPath = (lang: "en" | "hi") => path.join(VOICE_DIR, "models", `${PIPER_VOICES[lang]}.onnx`);

/** Which language a line is written in (by its script). Pure (tested). */
export function scriptLang(text: string): VoiceLang {
  const kn = (text.match(/[ಀ-೿]/g) ?? []).length;
  const hi = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  if (kn && kn >= hi) return "kn";
  if (hi) return "hi";
  return "en";
}

export function localVoiceStatus() {
  const piper = fs.existsSync(piperExe());
  let kannada = false;
  try { createRequire(path.join(VOICE_DIR, "package.json")).resolve(TRANSFORMERS); kannada = true; } catch { /* not installed */ }
  return { piper, en: piper && fs.existsSync(modelPath("en")), hi: piper && fs.existsSync(modelPath("hi")), kn: kannada };
}
export const localVoiceAvailable = (lang: VoiceLang = "en") => localVoiceStatus()[lang];

/** 16-bit mono PCM → a WAV file. Pure (tested). */
export function wavFromFloat32(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** What Piper is given: one line, no control characters (it reads line by line). Pure (tested). */
export function cleanForSpeech(text: string): string {
  return text.replace(/[*_`#>~|]+/g, " ").replace(/https?:\/\/\S+/g, "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
}

const tmp = () => path.join(os.tmpdir(), `jarvis-voice-${process.pid}-${randomBytes(6).toString("hex")}.wav`);
const readAndDrop = (f: string) => { const b = fs.readFileSync(f); fs.rm(f, { force: true }, () => {}); return b; };

/** One Piper voice kept loaded: JSON lines in, the path of each finished WAV out. */
class PiperWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private queue: { file: string; done: (ok: boolean) => void }[] = [];
  private buf = "";
  broken = false;
  constructor(private lang: "en" | "hi") {}

  private start() {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;
    const p = spawn(piperExe(), ["--model", modelPath(this.lang), "--json-input"], { cwd: path.dirname(piperExe()), windowsHide: true });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d: string) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        const job = this.queue[0];
        if (job && path.resolve(line) === path.resolve(job.file)) { this.queue.shift(); job.done(true); }
      }
    });
    p.stderr.on("data", () => { /* Piper logs to stderr */ });
    const fail = () => { this.proc = null; for (const j of this.queue.splice(0)) j.done(false); };
    p.on("exit", fail); p.on("error", () => { this.broken = true; fail(); });
    this.proc = p;
    return p;
  }

  speak(text: string, timeoutMs = 20_000): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const file = tmp();
      let settled = false;
      const t = setTimeout(() => { if (!settled) { settled = true; this.queue = this.queue.filter((j) => j.file !== file); this.broken = true; resolve(null); } }, timeoutMs);
      this.queue.push({ file, done: (ok) => {
        if (settled) return; settled = true; clearTimeout(t);
        try { resolve(ok && fs.existsSync(file) ? readAndDrop(file) : null); } catch { resolve(null); }
      } });
      try { this.start().stdin.write(`${JSON.stringify({ text, output_file: file })}\n`); }
      catch { this.broken = true; settled = true; clearTimeout(t); resolve(null); }
    });
  }
}

const workers: Partial<Record<"en" | "hi", PiperWorker>> = {};

/** A one-off Piper run (the fallback): text on stdin, one WAV out. */
function piperOnce(lang: "en" | "hi", text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const file = tmp();
    const p = spawn(piperExe(), ["--model", modelPath(lang), "--output_file", file], { cwd: path.dirname(piperExe()), windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { err += String(d); });
    const t = setTimeout(() => { p.kill(); reject(new Error("JARVIS's voice took too long.")); }, 30_000);
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("exit", (code) => {
      clearTimeout(t);
      if (code === 0 && fs.existsSync(file)) resolve(readAndDrop(file));
      else reject(new Error(`JARVIS's voice failed${err ? `: ${err.trim().split("\n").pop()?.slice(0, 200)}` : ""}.`));
    });
    p.stdin.end(`${text}\n`);
  });
}

let kannada: Promise<(text: string) => Promise<{ audio: Float32Array; sampling_rate: number }>> | null = null;
async function kannadaVoice() {
  kannada ??= (async () => {
    const req = createRequire(path.join(VOICE_DIR, "package.json"));
    const url = pathToFileURL(req.resolve(TRANSFORMERS)).href;
    const tf = (await import(/* webpackIgnore: true */ url)) as {
      env: { cacheDir: string; allowRemoteModels: boolean };
      pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<(t: string) => Promise<{ audio: Float32Array; sampling_rate: number }>>;
    };
    tf.env.cacheDir = path.join(VOICE_DIR, "hf-cache");
    return tf.pipeline("text-to-speech", KANNADA_MODEL, { dtype: "fp32" });
  })();
  try { return await kannada; } catch (e) { kannada = null; throw e; }
}

/** Speak a line in JARVIS's own voice → WAV. Throws if the voice isn't installed. */
export async function localTts(text: string, lang?: VoiceLang): Promise<Buffer> {
  const t = cleanForSpeech(text);
  if (!t) throw new Error("Nothing to say.");
  const l = lang ?? scriptLang(t);
  if (l === "kn") {
    if (!localVoiceAvailable("kn")) throw new Error("JARVIS's Kannada voice isn't installed yet — run npm run local once (it downloads it).");
    const out = await (await kannadaVoice())(t);
    return wavFromFloat32(out.audio, out.sampling_rate);
  }
  const voice: "en" | "hi" = l === "hi" && localVoiceAvailable("hi") ? "hi" : "en";
  if (!localVoiceAvailable(voice)) throw new Error("JARVIS's own voice isn't installed yet — run npm run local once (it downloads it).");
  const w = (workers[voice] ??= new PiperWorker(voice));
  if (!w.broken) { const b = await w.speak(t); if (b) return b; }
  return piperOnce(voice, t);
}
