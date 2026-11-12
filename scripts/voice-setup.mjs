/**
 * JARVIS's own voice — the one-time download `npm run local` does (about 150 MB):
 * - Piper (open-source neural text-to-speech) for this PC's system
 * - an English and a Hindi Piper voice
 * - transformers.js, which runs Meta's MMS Kannada voice (that model downloads on first use)
 * Everything lands in tools/voice (git-ignored). Anything already there is skipped.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PIPER_RELEASE = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2";
const VOICES = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
/** Same voices as src/lib/voice/local-tts.ts (PIPER_VOICES). */
export const VOICE_FILES = [
  "en/en_GB/alan/medium/en_GB-alan-medium",
  "hi/hi_IN/priyamvada/medium/hi_IN-priyamvada-medium",
];
export const TRANSFORMERS_VERSION = "3.8.1";

/** Can this Piper build read the voice? (newer voices use multi-letter sounds it rejects: "is not a single codepoint"). Pure (tested). */
export function voiceFits(configJson) {
  try { return Object.keys(JSON.parse(configJson).phoneme_id_map ?? {}).every((k) => [...k].length === 1); } catch { return false; }
}

/** Which Piper build this PC needs, or null. Pure (tested). */
export function piperAsset(platform = process.platform, arch = process.arch) {
  if (platform === "win32") return arch === "x64" || arch === "arm64" ? "piper_windows_amd64.zip" : null;
  if (platform === "linux") return arch === "x64" ? "piper_linux_x86_64.tar.gz" : arch === "arm64" ? "piper_linux_aarch64.tar.gz" : arch === "arm" ? "piper_linux_armv7l.tar.gz" : null;
  if (platform === "darwin") return arch === "arm64" ? "piper_macos_aarch64.tar.gz" : "piper_macos_x64.tar.gz";
  return null;
}

async function download(url, file, say) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return true;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15 * 60_000) }).catch((e) => ({ ok: false, status: e.message }));
  if (!r.ok || !r.body) { say(`  ! Couldn't download ${path.basename(file)} (${r.status}).`); return false; }
  const part = `${file}.part`;
  const out = fs.createWriteStream(part);
  const total = Number(r.headers.get("content-length")) || 0;
  let got = 0, shown = 0;
  for await (const chunk of r.body) {
    out.write(chunk); got += chunk.length;
    if (total && got - shown > total / 4) { shown = got; say(`    ${path.basename(file)}: ${Math.round((got / total) * 100)}%`); }
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  fs.renameSync(part, file);
  return true;
}

/** Make sure JARVIS's own voice is on this PC. Returns what's ready. */
export async function ensureVoice(root, say = console.log) {
  const dir = path.join(root, "tools", "voice");
  const exe = path.join(dir, "piper", process.platform === "win32" ? "piper.exe" : "piper");
  const ready = { piper: fs.existsSync(exe), voices: 0, kannada: fs.existsSync(path.join(dir, "node_modules", "@huggingface", "transformers", "package.json")) };
  const need = !ready.piper || VOICE_FILES.some((v) => !fs.existsSync(path.join(dir, "models", `${path.basename(v)}.onnx`))) || !ready.kannada;
  if (!need) return { ...ready, voices: VOICE_FILES.length };
  say("  Setting up JARVIS's own voice (free, on this PC — one time, about 150 MB)…");

  // 1. Piper
  if (!ready.piper) {
    const asset = piperAsset();
    if (!asset) say(`  ! JARVIS's voice engine has no build for this computer (${process.platform}/${process.arch}).`);
    else {
      const archive = path.join(dir, asset);
      if (await download(`${PIPER_RELEASE}/${asset}`, archive, say)) {
        // Windows 10+ ships tar, which also opens .zip files
        const r = spawnSync("tar", ["-xf", archive, "-C", dir], { stdio: "inherit" });
        if (r.status === 0 && fs.existsSync(exe)) {
          if (process.platform !== "win32") fs.chmodSync(exe, 0o755);
          fs.rmSync(archive, { force: true });
          ready.piper = true;
        } else say("  ! Couldn't unpack the voice engine — delete tools/voice and run npm run local again.");
      }
    }
  }
  // 2. the English and Hindi voices
  for (const v of VOICE_FILES) {
    const name = path.basename(v);
    const ok = (await download(`${VOICES}/${v}.onnx`, path.join(dir, "models", `${name}.onnx`), say)) && (await download(`${VOICES}/${v}.onnx.json`, path.join(dir, "models", `${name}.onnx.json`), say));
    if (ok && !voiceFits(fs.readFileSync(path.join(dir, "models", `${name}.onnx.json`), "utf8"))) {
      say(`  ! The voice ${name} is newer than JARVIS's voice program — skipped.`);
      fs.rmSync(path.join(dir, "models", `${name}.onnx`), { force: true });
      continue;
    }
    if (ok) ready.voices++;
  }
  // 3. Kannada: transformers.js in its own folder (kept out of JARVIS's main packages)
  if (!ready.kannada) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "jarvis-voice", private: true, dependencies: { "@huggingface/transformers": TRANSFORMERS_VERSION } }, null, 2));
    const r = spawnSync("npm install --no-audit --no-fund --omit=dev", { cwd: dir, stdio: "inherit", shell: true });
    ready.kannada = r.status === 0;
    if (!ready.kannada) say("  ! The Kannada voice couldn't be installed — English and Hindi still work.");
  }
  say(ready.piper && ready.voices === VOICE_FILES.length
    ? `  JARVIS's own voice is ready (English, Hindi${ready.kannada ? ", Kannada" : ""}).`
    : "  ! JARVIS's own voice isn't fully set up — see the messages above. It tries again next time.");
  return ready;
}
