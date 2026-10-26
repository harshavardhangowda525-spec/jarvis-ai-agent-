#!/usr/bin/env node
/**
 * npm run orb — start JARVIS 2.0, the floating holographic orb, on this computer.
 *
 * Installs the desktop app's one dependency (Electron) the first time, then
 * starts it in the background: the orb sits in the bottom-right corner above
 * your other apps and its icon appears in the system tray (Quit is there).
 * JARVIS itself must be running (npm run local) — the orb shows "JARVIS offline"
 * and keeps retrying until it answers.
 *
 *   npm run orb                         JARVIS at http://localhost:3000 (or JARVIS_LOCAL_PORT)
 *   npm run orb -- --url http://192.168.1.20:3000
 *   npm run orb -- --foreground         keep it attached to this terminal (see its log)
 *   npm run orb -- --quit               close the orb completely
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "desktop", "jarvis-orb");
const args = process.argv.slice(2);

/** @param {string[]} argv @param {Record<string, string | undefined>} env */
export function orbUrl(argv = args, env = process.env) {
  const i = argv.indexOf("--url");
  const raw = (i >= 0 ? argv[i + 1] : undefined) || env.JARVIS_ORB_URL || `http://localhost:${env.JARVIS_LOCAL_PORT || 3000}`;
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`"${raw}" isn't a JARVIS address — use something like http://localhost:3000`);
  return u.origin;
}

const electronBinary = () => { try { return createRequire(path.join(APP, "package.json"))("electron"); } catch { return null; } };

function main() {
  let bin = electronBinary();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // would start Electron as plain Node
  if (args.includes("--quit")) {
    if (bin && fs.existsSync(bin)) spawnSync(bin, [APP, "--quit"], { cwd: APP, stdio: "inherit", timeout: 15_000, env });
    console.log("JARVIS orb closed.");
    return;
  }
  let url;
  try { url = orbUrl(); } catch (e) { console.error(e.message); process.exit(1); }
  if (!bin || !fs.existsSync(bin)) {
    console.log("JARVIS orb: installing the desktop app (Electron, one time — about 100 MB)…");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const r = spawnSync(npm, ["install", "--no-audit", "--no-fund"], { cwd: APP, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) { console.error("Installing Electron failed — check your internet connection and run `npm run orb` again."); process.exit(1); }
    bin = electronBinary();
    if (!bin || !fs.existsSync(bin)) spawnSync(process.execPath, [path.join(APP, "node_modules", "electron", "install.js")], { cwd: APP, stdio: "inherit" });
    bin = electronBinary();
    if (!bin || !fs.existsSync(bin)) { console.error("Electron didn't install correctly. Delete desktop/jarvis-orb/node_modules and try again."); process.exit(1); }
  }
  const fg = args.includes("--foreground");
  const child = spawn(bin, [APP], { cwd: APP, env: { ...env, JARVIS_ORB_URL: url, ...(fg ? { JARVIS_ORB_DEBUG: "1" } : {}) }, stdio: fg ? "inherit" : "ignore", detached: !fg, windowsHide: false });
  if (fg) { child.on("exit", (c) => process.exit(c ?? 0)); return; }
  child.unref();
  console.log(`JARVIS orb is starting — bottom-right of your screen, icon in the system tray. JARVIS: ${url}`);
  console.log("Click the orb (or Ctrl+Alt+J) to chat · Ctrl+Alt+Space to talk · Ctrl+Alt+Backspace stops · Ctrl+Alt+P pauses all automation");
  console.log("To close it completely: npm run orb -- --quit  (or right-click the tray icon → Quit)");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
