#!/usr/bin/env node
/**
 * What's filling the disk? READ-ONLY — deletes nothing. Lists the biggest folders in your user folder,
 * the biggest single files, and caches that are safe to clear, so you can decide what to delete.
 *   node scripts/find-space.mjs            (your user folder)
 *   node scripts/find-space.mjs D:\        (any folder)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.argv[2] || os.homedir();
const GB = 1024 ** 3, MB = 1024 ** 2;
const fmt = (b) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.round(b / MB)} MB`);
const big = [];
let scanned = 0, lastTick = Date.now();

function size(dir, depth = 0) {
  let total = 0, entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isSymbolicLink()) continue; // junctions / links: not real space
      if (e.isDirectory()) total += size(p, depth + 1);
      else if (e.isFile()) {
        const s = fs.statSync(p).size; total += s; scanned++;
        if (s > 500 * MB) big.push([s, p]);
      }
    } catch { /* locked / no access */ }
    if (Date.now() - lastTick > 3000) { lastTick = Date.now(); process.stdout.write(`  …scanned ${scanned.toLocaleString()} files\r`); }
  }
  return total;
}

console.log(`Scanning ${root} (read-only, nothing is deleted)…\n`);
const tops = [];
for (const e of fs.readdirSync(root, { withFileTypes: true })) {
  if (!e.isDirectory() || e.isSymbolicLink()) continue;
  const p = path.join(root, e.name);
  tops.push([size(p), p]);
}
tops.sort((a, b) => b[0] - a[0]);
console.log("\nBiggest folders:");
for (const [s, p] of tops.slice(0, 15)) if (s > 200 * MB) console.log(`  ${fmt(s).padStart(9)}  ${p}`);

big.sort((a, b) => b[0] - a[0]);
console.log("\nBiggest single files (over 500 MB) — old videos, ISOs, installers, backups are usually safe to delete or move:");
for (const [s, p] of big.slice(0, 25)) console.log(`  ${fmt(s).padStart(9)}  ${p}`);
if (!big.length) console.log("  (none)");

const local = process.env.LOCALAPPDATA || path.join(root, "AppData", "Local");
const caches = [
  ["Windows temp files (safe to clear)", process.env.TEMP || path.join(local, "Temp")],
  ["npm download cache (safe; re-downloads if needed)", path.join(local, "npm-cache")],
  ["Chrome cache (safe; sites just load once more)", path.join(local, "Google", "Chrome", "User Data", "Default", "Cache")],
  ["Edge cache (safe)", path.join(local, "Microsoft", "Edge", "User Data", "Default", "Cache")],
  ["pip cache (safe)", path.join(local, "pip", "Cache")],
  ["Old JARVIS orb leftovers (safe)", path.join(root, "jarvis-ai-agent-", "desktop", "jarvis-orb")],
  ["Ollama AI models (only if you don't use local Ollama)", path.join(root, ".ollama", "models")],
];
console.log("\nCaches and leftovers:");
for (const [label, p] of caches) { if (fs.existsSync(p)) { const s = size(p); if (s > 50 * MB) console.log(`  ${fmt(s).padStart(9)}  ${label}\n             ${p}`); } }

console.log(`
Biggest wins that are always safe:
  1. Settings → System → Storage → Temporary files → tick everything EXCEPT "Downloads" → Remove files.
  2. Start → type "Disk Cleanup" → C: → "Clean up system files" → tick "Windows Update Cleanup" → OK  (often 5–20 GB).
  3. Empty the Recycle Bin.
  4. clean-jarvis.cmd  (JARVIS's own caches).
Then look at the lists above: delete what you don't need (Downloads, old videos, installers), or move it to a USB drive.`);
