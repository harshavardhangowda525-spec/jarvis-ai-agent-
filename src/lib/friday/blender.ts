import "server-only";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Plan, ViewId } from "./plan";

/**
 * Runs FRIDAY's Blender builder (scripts/friday/build.py) in the background —
 * Blender is a separate process, so JARVIS stays responsive while it models
 * and renders — and checks every output before anything is called done.
 */

export class BlenderMissing extends Error {}
export class BlenderFailed extends Error {}

const SCRIPT = () => path.join(process.cwd(), "scripts", "friday", "build.py");

/** Where Blender is on this computer (FRIDAY_BLENDER / BLENDER_PATH, PATH, then the usual install folders). */
export function findBlender(): string | null {
  for (const v of [process.env.FRIDAY_BLENDER, process.env.BLENDER_PATH]) if (v?.trim() && existsSync(v.trim())) return v.trim();
  const win = process.platform === "win32";
  const onPath = spawnSync(win ? "where blender" : "command -v blender", { shell: true, encoding: "utf8" });
  const first = onPath.status === 0 ? onPath.stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s && (!win || /\.exe$/i.test(s))) : undefined;
  if (first && existsSync(first)) return first;
  const candidates: string[] = [];
  const newestIn = (dir: string, pick: (d: string) => string) => {
    try {
      return readdirSync(dir).filter((n) => /blender/i.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((n) => pick(path.join(dir, n)));
    } catch { return []; }
  };
  if (win) {
    for (const pf of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "C:\\Program Files"].filter(Boolean) as string[]) {
      candidates.push(...newestIn(path.join(pf, "Blender Foundation"), (d) => path.join(d, "blender.exe")));
    }
    candidates.push("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe");
    if (process.env.LOCALAPPDATA) candidates.push(...newestIn(path.join(process.env.LOCALAPPDATA, "Programs"), (d) => path.join(d, "blender.exe")));
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Blender.app/Contents/MacOS/Blender", path.join(os.homedir(), "Applications/Blender.app/Contents/MacOS/Blender"));
  } else {
    candidates.push("/snap/bin/blender", "/usr/bin/blender", "/usr/local/bin/blender", ...newestIn("/opt", (d) => path.join(d, "blender")));
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function installHint(): string {
  if (process.platform === "win32") return "Install Blender from blender.org/download (or run: winget install BlenderFoundation.Blender), then restart JARVIS. If it's installed somewhere unusual, add FRIDAY_BLENDER=<full path to blender.exe> to .env.local.";
  if (process.platform === "darwin") return "Install Blender from blender.org/download (drag it to Applications), then restart JARVIS — or set FRIDAY_BLENDER to its path.";
  return "Install Blender (blender.org/download, or your package manager / snap), then restart JARVIS — or set FRIDAY_BLENDER to its path.";
}

export interface RenderSettings { engine: "cycles" | "eevee"; width: number; height: number; samples: number; gpu: boolean; lightScale?: number }

export function renderSettings(o: Partial<RenderSettings> = {}): RenderSettings {
  const scale = Math.min(1, Math.max(0.25, Number(process.env.FRIDAY_RENDER_SCALE) || 1));
  return {
    engine: (o.engine ?? (process.env.FRIDAY_RENDER_ENGINE === "eevee" ? "eevee" : "cycles")),
    width: Math.round((o.width ?? 1600) * scale), height: Math.round((o.height ?? 1200) * scale),
    samples: o.samples ?? (Number(process.env.FRIDAY_RENDER_SAMPLES) || 64), gpu: o.gpu ?? process.env.FRIDAY_GPU !== "0",
    lightScale: o.lightScale,
  };
}

export interface BuildJob {
  plan: Plan; outDir: string; views: ViewId[]; render: RenderSettings;
  exports: ("glb" | "gltf" | "stl")[]; saveBlend: boolean;
}
export interface Progress { stage: string; text: string; done: number | null; total: number | null; view?: string }
export interface BlenderResult {
  ok: true; blender: string; engine: string; device: string;
  components: { id: string; name: string; group: string; material: string; polygons: number; internal: boolean; conceptual: boolean; bbox_mm: number[][] }[];
  size_mm: number[]; center_mm: number[]; exploded: boolean; detail: string;
  files: Record<string, string>; renders: { view: ViewId; file: string; seconds: number; width: number; height: number; camera: Record<string, unknown> }[];
  warnings: string[];
}

/** Run one Blender job. Resolves only with outputs that exist and check out. */
export async function runBlender(job: BuildJob, o: { onProgress?: (p: Progress) => void; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<BlenderResult> {
  const blender = findBlender();
  if (!blender) throw new BlenderMissing(`Blender isn't installed on this computer, so Friday can't model or render yet. ${installHint()}`);
  await fs.mkdir(job.outDir, { recursive: true });
  const jobFile = path.join(job.outDir, "job.json");
  await fs.writeFile(jobFile, JSON.stringify(job));
  await fs.rm(path.join(job.outDir, "result.json"), { force: true });

  const lastErr: string[] = [];
  let reported: string | null = null;
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(blender, ["-b", "--factory-startup", "--python-exit-code", "4", "--python", SCRIPT(), "--", jobFile], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { child.kill(); reject(new BlenderFailed(`Blender took longer than ${Math.round((o.timeoutMs ?? 1_800_000) / 60000)} minutes and was stopped.`)); }, o.timeoutMs ?? 1_800_000);
    const abort = () => { child.kill(); reject(new BlenderFailed("Cancelled.")); };
    o.signal?.addEventListener("abort", abort);
    let buf = "";
    const onLine = (line: string) => {
      const m = /FRIDAY:(\{.*\})\s*$/.exec(line);
      if (m) {
        try {
          const p = JSON.parse(m[1]) as Progress;
          if (p.stage === "error") reported = p.text;
          else o.onProgress?.(p);
        } catch { /* partial line */ }
      } else if (/error|traceback|exception/i.test(line) && !/CUEW|HIPEW|initialization failed/i.test(line)) {
        lastErr.push(line.trim()); if (lastErr.length > 8) lastErr.shift();
      }
    };
    const feed = (d: Buffer) => { buf += d; let i: number; while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (e) => { clearTimeout(timer); reject(new BlenderFailed(`Couldn't start Blender (${blender}): ${e.message}`)); });
    child.on("close", (c) => { clearTimeout(timer); o.signal?.removeEventListener("abort", abort); if (buf) onLine(buf); resolve(c); });
  });
  if (reported) throw new BlenderFailed(reported);
  const resultFile = path.join(job.outDir, "result.json");
  if (code !== 0 || !existsSync(resultFile)) {
    throw new BlenderFailed(`Blender stopped before finishing (exit ${code ?? "killed"})${lastErr.length ? `: ${lastErr.slice(-3).join(" · ").slice(0, 400)}` : ""}.`);
  }
  const result = JSON.parse(await fs.readFile(resultFile, "utf8")) as BlenderResult;
  await verifyOutputs(job, result);
  return result;
}

/** Every file Blender said it wrote must exist and be real (renders: a decodable, non-blank image of the right size). */
export async function verifyOutputs(job: BuildJob, r: BlenderResult) {
  const problems: string[] = [];
  const minSize: Record<string, number> = { blend: 10_000, glb: 1_000, gltf: 200, stl: 500 };
  for (const [kind, f] of Object.entries(r.files)) {
    const st = await fs.stat(f).catch(() => null);
    if (!st || st.size < (minSize[kind] ?? 1)) problems.push(`${kind.toUpperCase()} file missing or empty`);
    else if (kind === "glb" && (await fs.readFile(f)).subarray(0, 4).toString() !== "glTF") problems.push("GLB file isn't a valid glTF binary");
  }
  if (job.saveBlend && !r.files.blend) problems.push("the Blender project wasn't saved");
  for (const e of job.exports) if (!r.files[e]) problems.push(`${e.toUpperCase()} export missing`);
  for (const v of job.views) {
    const rr = r.renders.find((x) => x.view === v);
    if (!rr) { problems.push(`${v} render missing`); continue; }
    try {
      const img = sharp(rr.file);
      const meta = await img.metadata();
      const stats = await img.stats();
      if (meta.width !== job.render.width || meta.height !== job.render.height) problems.push(`${v} render is ${meta.width}×${meta.height}, expected ${job.render.width}×${job.render.height}`);
      if (Math.max(...stats.channels.slice(0, 3).map((c) => c.stdev)) < 2) problems.push(`${v} render is blank`);
    } catch { problems.push(`${v} render isn't a valid image`); }
  }
  if (problems.length) throw new BlenderFailed(`Blender finished but the output didn't check out: ${problems.join("; ")}.`);
}
