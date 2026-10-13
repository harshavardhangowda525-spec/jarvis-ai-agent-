#!/usr/bin/env node
/**
 * npm run rubin — start RUBEN, the floating CRM island, on this computer.
 *
 * Installs the desktop app's one dependency (Electron) the first time, then
 * starts it in the background: the island sits on top of your other apps and
 * RUBEN's icon appears in the system tray (Quit is there). JARVIS itself must be
 * running (npm run local) — or, when it isn't, RUBEN uses your online JARVIS
 * (APP_URL in .env.local). Until one answers, the island shows "JARVIS offline"
 * and keeps retrying.
 *
 *   npm run rubin                    JARVIS at http://localhost:3000 (or JARVIS_LOCAL_PORT)
 *   npm run rubin -- --url http://192.168.1.20:3000
 *   npm run rubin -- --foreground    keep it attached to this terminal (see its log)
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "desktop", "rubin");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

/** @param {string[]} argv @param {Record<string, string | undefined>} env */
export function jarvisUrl(argv = args, env = process.env) {
  const i = argv.indexOf("--url");
  const raw = (i >= 0 ? argv[i + 1] : undefined) || env.RUBIN_JARVIS_URL || `http://localhost:${env.JARVIS_LOCAL_PORT || 3000}`;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    return u.origin;
  } catch {
    throw new Error(`"${raw}" isn't a JARVIS address — use something like http://localhost:3000`);
  }
}

/**
 * Your online JARVIS (the deployed app, same database): --cloud-url, else
 * RUBIN_CLOUD_URL, else APP_URL from .env.local when it's a public https
 * address. RUBEN uses it whenever the JARVIS on this PC isn't running.
 * @param {string[]} argv @param {Record<string, string | undefined>} env @param {string} envFileText
 */
export function cloudUrl(argv = args, env = process.env, envFileText = readEnvLocal()) {
  const i = argv.indexOf("--cloud-url");
  const fromFile = /^\s*(?:export\s+)?APP_URL\s*=\s*["']?([^"'\s#]+)/m.exec(envFileText || "")?.[1];
  for (const raw of [i >= 0 ? argv[i + 1] : undefined, env.RUBIN_CLOUD_URL, fromFile]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname)) return u.origin;
    } catch { /* not a URL — try the next */ }
  }
  return null;
}
function readEnvLocal() {
  try { return fs.readFileSync(path.join(ROOT, ".env.local"), "utf8"); } catch { return ""; }
}

function electronBinary() {
  try { return createRequire(path.join(APP, "package.json"))("electron"); } catch { return null; }
}

function main() {
  let url;
  try { url = jarvisUrl(); } catch (e) { console.error(e.message); process.exit(1); }
  let bin = electronBinary();
  if (!bin || !fs.existsSync(bin)) {
    console.log("RUBEN: installing the desktop app (Electron, one time — about 100 MB)…");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const r = spawnSync(npm, ["install", "--no-audit", "--no-fund"], { cwd: APP, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) { console.error("RUBEN: installing Electron failed — check your internet connection and run `npm run rubin` again."); process.exit(1); }
    bin = electronBinary();
    // the Electron download runs in a postinstall step; finish it if it was interrupted
    if (!bin || !fs.existsSync(bin)) spawnSync(process.execPath, [path.join(APP, "node_modules", "electron", "install.js")], { cwd: APP, stdio: "inherit" });
    bin = electronBinary();
    if (!bin || !fs.existsSync(bin)) { console.error("RUBEN: Electron didn't install correctly. Delete desktop/rubin/node_modules and try again."); process.exit(1); }
  }
  const fg = args.includes("--foreground");
  const cloud = cloudUrl();
  const env = { ...process.env, RUBIN_JARVIS_URL: url, ...(cloud ? { RUBIN_CLOUD_URL: cloud } : {}) };
  delete env.ELECTRON_RUN_AS_NODE; // would start Electron as plain Node
  const child = spawn(bin, [APP], { cwd: APP, env, stdio: fg ? "inherit" : "ignore", detached: !fg, windowsHide: false });
  if (fg) { child.on("exit", (c) => process.exit(c ?? 0)); return; }
  child.unref();
  console.log(`RUBEN is starting — the island appears at the top of your screen and its icon in the system tray (right-click → Quit).`);
  console.log(`JARVIS address: ${url}${flag("--url") ? "" : "  (change with: npm run rubin -- --url http://host:port)"}`);
  console.log(cloud ? `When JARVIS isn't running on this PC, RUBEN uses your online JARVIS: ${cloud}` : `No online JARVIS found (APP_URL in .env.local) — RUBEN needs  npm run local  running.`);
  console.log(`Shortcuts: Ctrl+Shift+Space opens/closes the CRM · Ctrl+Shift+R talk · right-click the island to talk`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
