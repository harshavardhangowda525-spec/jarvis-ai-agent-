#!/usr/bin/env node
/**
 * npm run clean (or double-click clean-jarvis.cmd) — frees disk space JARVIS has piled up.
 * Only caches and leftovers that are safe to delete (they rebuild themselves or
 * aren't needed any more). Never touches: .env.local, your data/database, sign-ins
 * (browser cookies), JARVIS's voice, Ollama models, or your projects.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const APPDATA = process.env.APPDATA || path.join(os.homedir(), win ? "AppData/Roaming" : ".config");
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), win ? "AppData/Local" : ".cache");

/** Total bytes under a path (files only; never follows links). */
export function sizeOf(p) {
  let total = 0;
  const walk = (q) => {
    let st; try { st = fs.lstatSync(q); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) { total += st.size; return; }
    if (st.isDirectory()) { let names = []; try { names = fs.readdirSync(q); } catch { return; } for (const n of names) walk(path.join(q, n)); }
  };
  walk(p);
  return total;
}
export const mb = (b) => `${(b / 1024 / 1024).toFixed(b > 100 * 1024 * 1024 ? 0 : 1)} MB`;

/** What gets cleaned: fixed paths only (nothing from user input). Pure (tested). */
export function targets(root = ROOT, appdata = APPDATA, local = LOCAL) {
  const profile = path.join(root, "operator", "browser-data");
  const browserCaches = ["Default/Cache", "Default/Code Cache", "Default/GPUCache", "Default/Service Worker/CacheStorage", "Default/Service Worker/ScriptCache", "ShaderCache", "GrShaderCache", "GraphiteDawnCache", "Default/DawnGraphiteCache", "Default/DawnWebGPUCache"];
  const orbData = [path.join(appdata, "JARVIS Orb"), path.join(appdata, "jarvis-orb")];
  const orbCaches = ["Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "Service Worker/CacheStorage", "Service Worker/ScriptCache"];
  return [
    { label: "JARVIS build cache (rebuilds on the next update)", paths: [path.join(root, ".next", "cache"), path.join(root, "node_modules", ".cache")] },
    { label: "Operator browser cache (sign-ins kept)", paths: browserCaches.map((c) => path.join(profile, c)) },
    { label: "Old CAPTCHA screenshots", paths: [path.join(root, "operator", "screenshots")] },
    { label: "Orb app cache", paths: orbData.flatMap((d) => orbCaches.map((c) => path.join(d, c))) },
    { label: "Installer leftovers (VB-Cable, downloads)", paths: [path.join(root, "tools", "calls-audio", "vbcable"), path.join(root, "tools", "calls-audio", "vbcable.zip"), path.join(root, "tools", "calls-audio", "svv.zip")] },
    { label: "Unfinished voice downloads", paths: fs.existsSync(path.join(root, "tools", "voice")) ? fs.readdirSync(path.join(root, "tools", "voice")).filter((n) => /\.(zip|tar\.gz|part)$/.test(n)).map((n) => path.join(root, "tools", "voice", n)) : [] },
    { label: "Electron download cache", paths: [path.join(local, "electron", "Cache")] },
    { label: "Browser Playwright downloaded (JARVIS uses your Chrome / Edge)", paths: win ? [path.join(local, "ms-playwright")] : [] },
  ];
}

function main() {
  console.log("\nJARVIS clean-up — freeing space (only caches and leftovers)\n");
  let freed = 0;
  for (const t of targets()) {
    let got = 0;
    for (const p of t.paths) {
      if (!fs.existsSync(p)) continue;
      const s = sizeOf(p);
      try { fs.rmSync(p, { recursive: true, force: true }); got += s; } catch (e) { console.log(`  ! couldn't remove ${p}: ${e.message.split("\n")[0]} (close JARVIS / the orb and try again)`); }
    }
    if (got) { console.log(`  ✓ ${t.label}: ${mb(got)}`); freed += got; }
  }
  // npm's download cache (often 1–3 GB; packages re-download when needed)
  const npmCache = spawnSync("npm config get cache", { shell: true, encoding: "utf8" }).stdout?.trim();
  if (npmCache && fs.existsSync(npmCache)) {
    const before = sizeOf(npmCache);
    spawnSync("npm cache clean --force", { shell: true, stdio: "ignore" });
    const after = fs.existsSync(npmCache) ? sizeOf(npmCache) : 0;
    if (before - after > 0) { console.log(`  ✓ npm download cache: ${mb(before - after)}`); freed += before - after; }
  }
  // git history packed tighter
  if (fs.existsSync(path.join(ROOT, ".git"))) {
    const before = sizeOf(path.join(ROOT, ".git"));
    spawnSync("git gc --prune=now --quiet", { cwd: ROOT, shell: true, stdio: "ignore" });
    const after = sizeOf(path.join(ROOT, ".git"));
    if (before - after > 1024 * 1024) { console.log(`  ✓ Git history packed: ${mb(before - after)}`); freed += before - after; }
  }
  console.log(`\nFreed ${mb(freed)}.\n`);

  // big things it doesn't delete — your call
  const ollama = path.join(os.homedir(), ".ollama", "models");
  if (fs.existsSync(ollama)) {
    const s = sizeOf(ollama);
    if (s > 500 * 1024 * 1024) console.log(`  Ollama models use ${mb(s)}. JARVIS runs on Claude / Groq / Gemini, so if you don't use local models: run  ollama list  and  ollama rm <name>  (nothing here deletes them).`);
  }
  const dockerData = path.join(LOCAL, "Docker");
  if (win && fs.existsSync(dockerData)) console.log("  Docker Desktop is installed. If you don't use SearXNG, uninstalling Docker frees several GB and a lot of memory.");
  console.log("");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
