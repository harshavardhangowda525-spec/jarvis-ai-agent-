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
 *   npm run rubin -- --quit          close RUBEN completely
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

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
/**
 * Settings RUBEN's own backend needs (DATABASE_URL, GROQ_API_KEY, ELEVENLABS_API_KEY …), read from
 * .env then .env.local. They're handed to the RUBEN process only — never written anywhere.
 * @param {string[]} texts
 */
export function parseEnvFiles(texts) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const text of texts) {
    for (const line of String(text || "").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, "");
      out[m[1]] = v;
    }
  }
  return out;
}

function readEnvLocal() {
  try { return fs.readFileSync(path.join(ROOT, ".env.local"), "utf8"); } catch { return ""; }
}

function electronBinary() {
  try { return createRequire(path.join(APP, "package.json"))("electron"); } catch { return null; }
}

/** Close RUBEN: ask the running copy to quit, then make sure only RUBEN's own Electron is gone (not VS Code, Discord …). */
/** Stop any RUBEN still running — only RUBEN's own Electron (matched by its exact path), never VS Code, Discord … */
function stopLeftovers(bin) {
  if (process.platform !== "win32" || !bin) return 0;
  const ps = `$p = @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:RUBIN_BIN }); $p | Stop-Process -Force -ErrorAction SilentlyContinue; $p.Count`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", env: { ...process.env, RUBIN_BIN: bin }, windowsHide: true });
  return Number(String(r.stdout || "0").trim()) || 0;
}

function quitRuben(bin) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (bin && fs.existsSync(bin)) spawnSync(bin, [APP, "--quit"], { cwd: APP, stdio: "ignore", timeout: 15_000, env });
  const left = () => stopLeftovers(bin);
  spawnSync(process.execPath, ["-e", "setTimeout(()=>{},2500)"]); // give it a moment to close by itself
  const forced = left();
  console.log(forced ? "RUBEN closed (it had to be stopped)." : "RUBEN closed.");
}

async function main() {
  if (args.includes("--quit")) { quitRuben(electronBinary()); return; }
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
  // an older RUBEN still running (or stuck on an error box) would take over this start — close it first
  const stopped = stopLeftovers(bin);
  if (stopped) { console.log(`Closed the RUBEN that was already running (${stopped} process${stopped === 1 ? "" : "es"}).`); spawnSync(process.execPath, ["-e", "setTimeout(()=>{},1500)"]); }
  const version = (() => { try { return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(); } catch { return ""; } })();
  if (version) console.log(`RUBEN version: ${version}`);
  const fg = args.includes("--foreground");
  const cloud = cloudUrl();
  const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { return ""; } };
  const fileEnv = parseEnvFiles([read(".env"), read(".env.local")]);
  const withJarvis = args.includes("--with-jarvis");
  if (!withJarvis) {
    if (!fileEnv.DATABASE_URL && !process.env.DATABASE_URL) {
      console.error("RUBEN needs DATABASE_URL (your CRM database) in .env.local — the same one JARVIS uses.");
      process.exit(1);
    }
    // RUBEN's own screen + backend, built from the JARVIS source (only when it changed)
    try { const { buildStandalone } = await import(pathToFileURL(path.join(APP, "build.mjs")).href); await buildStandalone(); }
    catch (e) { console.error(`RUBEN: building its screen/backend failed: ${e.message}`); process.exit(1); }
  }
  const env = { ...fileEnv, ...process.env, RUBIN_JARVIS_URL: url, ...(cloud ? { RUBIN_CLOUD_URL: cloud } : {}), ...(withJarvis ? { RUBIN_MODE: "jarvis" } : {}) };
  delete env.ELECTRON_RUN_AS_NODE; // would start Electron as plain Node
  const child = spawn(bin, [APP], { cwd: APP, env, stdio: fg ? "inherit" : "ignore", detached: !fg, windowsHide: false });
  if (fg) { child.on("exit", (c) => process.exit(c ?? 0)); return; }
  child.unref();
  console.log(`RUBEN is starting — the island appears at the top of your screen and its icon in the system tray (right-click → Quit).`);
  if (withJarvis) console.log(`Using JARVIS at ${url} for the CRM.`);
  else console.log("RUBEN runs on its own — JARVIS doesn't need to be running. (Your CRM database: DATABASE_URL in .env.local.)");
  console.log(`Shortcuts: Ctrl+Shift+Space opens/closes the CRM · Ctrl+Shift+R talk · right-click the island to talk`);
  console.log(`To close RUBEN completely: npm run rubin -- --quit  (or right-click its tray icon → Quit RUBEN)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
