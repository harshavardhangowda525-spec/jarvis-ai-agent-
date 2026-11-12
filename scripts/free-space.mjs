#!/usr/bin/env node
/**
 * Free disk space SAFELY: only temp files, caches, Windows Update downloads, crash dumps, the Recycle Bin
 * and JARVIS's own leftovers. Never your documents, photos, videos, downloads or apps.
 *   node scripts/free-space.mjs            (run as administrator for the Windows folders)
 *   node scripts/free-space.mjs --deep     (also Windows' own component cleanup — slow, 10–30 min, often 5+ GB)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const home = os.homedir();
const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
const win = process.env.WINDIR || "C:\\Windows";
const drive = path.parse(home).root || "C:\\";
const GB = 1024 ** 3;
const free = () => { try { const s = fs.statfsSync(drive); return s.bavail * s.bsize; } catch { return NaN; } };
const fmt = (b) => `${(b / GB).toFixed(1)} GB`;

/** Delete what's inside a folder (the folder stays); files in use are skipped. */
function empty(dir) {
  let n = 0;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 1 }); n++; } catch { /* in use — skip */ }
  }
  return n;
}
const browserCaches = (base) => {
  const out = [];
  try {
    for (const prof of fs.readdirSync(base)) if (prof === "Default" || /^Profile \d+$/.test(prof)) for (const c of ["Cache", "Code Cache", "GPUCache", "Service Worker\\CacheStorage"]) out.push(path.join(base, prof, c));
  } catch { /* not installed */ }
  return out;
};

const targets = [
  ["Your temp files", process.env.TEMP || path.join(local, "Temp")],
  ["Windows temp files", path.join(win, "Temp")],
  ["Windows Update downloads (already installed)", path.join(win, "SoftwareDistribution", "Download")],
  ["Crash dumps", path.join(local, "CrashDumps")],
  ["Internet cache", path.join(local, "Microsoft", "Windows", "INetCache")],
  ["npm cache", path.join(local, "npm-cache")],
  ["pip cache", path.join(local, "pip", "Cache")],
  ["Yarn cache", path.join(local, "Yarn", "Cache")],
  ["JARVIS build cache", path.join(ROOT, ".next", "cache")],
  ["Old JARVIS orb leftovers", path.join(ROOT, "desktop", "jarvis-orb")],
  ...browserCaches(path.join(local, "Google", "Chrome", "User Data")).map((p) => ["Chrome cache", p]),
  ...browserCaches(path.join(local, "Microsoft", "Edge", "User Data")).map((p) => ["Edge cache", p]),
];

const start = free();
console.log(`Free space on ${drive} before: ${fmt(start)}\n`);
console.log("Tip: close Chrome and Edge first so their caches can be cleared.\n");
for (const [label, dir] of targets) {
  if (!fs.existsSync(dir)) continue;
  const before = free();
  empty(dir);
  if (label.startsWith("Old JARVIS")) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* in use */ } }
  const got = free() - before;
  console.log(`  ${label.padEnd(46)} ${got > 50 * 1024 ** 2 ? `+${fmt(got)}` : "done"}`);
}
try { execFileSync("powershell.exe", ["-NoProfile", "-Command", "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"], { stdio: "ignore", timeout: 120000 }); console.log("  Recycle Bin                                    emptied"); } catch { console.log("  Recycle Bin                                    (couldn't empty — do it by hand)"); }
if (process.argv.includes("--deep")) {
  console.log("\n  Windows component cleanup (DISM) — this can take 10–30 minutes, please wait…");
  try { execFileSync("dism.exe", ["/Online", "/Cleanup-Image", "/StartComponentCleanup"], { stdio: "inherit" }); } catch { console.log("  (needs administrator — right-click free-space.cmd → Run as administrator)"); }
}
const end = free();
console.log(`\nFree space now: ${fmt(end)}  (freed ${fmt(Math.max(0, end - start))})`);
console.log(`
To reach 100 GB free you'll most likely also need to remove big personal files — run find-space.cmd to see
the biggest folders and files (old videos, ISOs, installers, backups in Downloads), and delete or move them.
More safe space:  "powercfg -h off" (as administrator) removes the hibernation file (about the size of your RAM)
— your laptop then can't hibernate, but sleep still works.`);
