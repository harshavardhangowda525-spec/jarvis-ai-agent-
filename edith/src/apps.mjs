/**
 * Desktop apps for JARVIS ("JARVIS, open Spotify") — the real installed app on
 * this computer, not a web page.
 *
 * Deliberately narrow: JARVIS can only LAUNCH an app that this computer itself
 * lists as installed (Windows Start menu via Get-StartApps — desktop and Store
 * apps; /Applications on macOS; .desktop entries on Linux). No paths, no
 * arguments, no shell: the launch is a fixed command with the app's own id.
 * Disable entirely with ULTRON_APPS=off.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "./log.mjs";
import { normalizeName, ALIASES, matchScore, findApp } from "./app-match.mjs";

export function appsEnabled(env = process.env) {
  return !/^(off|0|false|no)$/i.test(String(env.ULTRON_APPS || "").trim());
}

/* matching (pure — tested) lives in app-match.mjs, shared with the JARVIS page */
export { normalizeName, ALIASES, matchScore, findApp };

/* ---------------- discovery ---------------- */

const run = (file, args, timeout = 20_000) => new Promise((resolve) => {
  execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ ok: !err, stdout: String(stdout || ""), stderr: String(stderr || (err && err.message) || "") });
  });
});

// Always available on Windows even if missing from the Start-menu list.
const WINDOWS_SPECIAL = [
  { name: "File Explorer", launch: { file: "explorer.exe", args: [] } },
  { name: "Settings", launch: { file: "explorer.exe", args: ["ms-settings:"] } },
  { name: "Task Manager", launch: { file: "taskmgr.exe", args: [] } },
  { name: "Control Panel", launch: { file: "control.exe", args: [] } },
];

async function windowsApps() {
  const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress";
  const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps]);
  let list = [];
  if (r.ok && r.stdout.trim()) {
    try {
      const j = JSON.parse(r.stdout.trim().replace(/^\uFEFF/, ""));
      list = (Array.isArray(j) ? j : [j]).filter((x) => x && x.Name && x.AppID)
        .map((x) => ({ name: String(x.Name), launch: { file: "explorer.exe", args: [`shell:AppsFolder\\${x.AppID}`] } }));
    } catch (e) { log.warn(`Couldn't read the app list: ${e.message}`); }
  }
  if (!list.length) list = windowsShortcuts(); // older Windows without Get-StartApps
  const have = new Set(list.map((a) => normalizeName(a.name)));
  return [...list, ...WINDOWS_SPECIAL.filter((s) => !have.has(normalizeName(s.name)))];
}

function windowsShortcuts() {
  const roots = [
    path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs"),
  ];
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.lnk$/i.test(e.name)) out.push({ name: e.name.replace(/\.lnk$/i, ""), launch: { file: "explorer.exe", args: [p] } });
    }
  };
  roots.forEach((r) => walk(r, 0));
  return out;
}

function macApps() {
  const dirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities", path.join(os.homedir(), "Applications")];
  const out = [];
  for (const d of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(d); } catch { continue; }
    for (const e of entries) if (e.endsWith(".app")) out.push({ name: e.replace(/\.app$/, ""), launch: { file: "open", args: ["-a", path.join(d, e)] } });
  }
  return out;
}

/** A .desktop Exec= line → { file, args } (field codes like %U removed, quotes respected, no shell). */
export function parseExec(line) {
  const parts = [];
  let cur = "", q = false, had = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length) { cur += line[++i]; had = true; continue; }
    if (c === '"') { q = !q; had = true; continue; }
    if (!q && /\s/.test(c)) { if (had || cur) parts.push(cur); cur = ""; had = false; continue; }
    cur += c; had = true;
  }
  if (had || cur) parts.push(cur);
  const args = parts.filter((p) => !/^%[fFuUdDnNickvm]$/.test(p)).map((p) => p.replace(/%%/g, "%"));
  if (!args.length || /^(sh|bash|zsh|env)$/.test(path.basename(args[0])) && args.includes("-c")) return null; // shell wrappers aren't launched
  return { file: args[0], args: args.slice(1) };
}

function linuxApps() {
  const dirs = ["/usr/share/applications", "/usr/local/share/applications", path.join(os.homedir(), ".local/share/applications"), "/var/lib/flatpak/exports/share/applications"];
  const out = [];
  for (const d of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(d); } catch { continue; }
    for (const e of entries) {
      if (!e.endsWith(".desktop")) continue;
      let txt = "";
      try { txt = fs.readFileSync(path.join(d, e), "utf8"); } catch { continue; }
      if (/^NoDisplay=true/m.test(txt) || /^Hidden=true/m.test(txt) || /^Terminal=true/m.test(txt) || /^Type=(?!Application)/m.test(txt)) continue;
      const entry = txt.split(/^\[/m).find((sec) => sec.startsWith("Desktop Entry]")) ?? txt;
      const name = entry.match(/^Name=(.+)$/m)?.[1]?.trim();
      const exec = parseExec(entry.match(/^Exec=(.+)$/m)?.[1] ?? "");
      if (name && exec) out.push({ name, launch: exec });
    }
  }
  return out;
}

let cache = { at: 0, apps: [] };
const TTL = 10 * 60_000;

/** Installed apps (cached 10 min; `fresh` re-reads — e.g. after a miss). */
export async function listApps({ fresh = false } = {}) {
  if (!fresh && cache.apps.length && Date.now() - cache.at < TTL) return cache.apps;
  const apps = process.platform === "win32" ? await windowsApps() : process.platform === "darwin" ? macApps() : linuxApps();
  const seen = new Set();
  const uniq = apps.filter((a) => { const k = normalizeName(a.name); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  cache = { at: Date.now(), apps: uniq };
  return uniq;
}

/* ---------------- launching ---------------- */

function launch(app) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    try {
      // explorer.exe exits with code 1 even when the app launched — only a spawn error is a failure
      const child = spawn(app.launch.file, app.launch.args, { detached: true, stdio: "ignore", windowsHide: false });
      child.on("error", (e) => finish({ ok: false, error: e.message }));
      child.unref();
      setTimeout(() => finish({ ok: true }), 400);
    } catch (e) { finish({ ok: false, error: e.message }); }
  });
}

/** Open an installed app by (spoken) name. Resolves { ok, message, app?, suggestions? }. */
export async function openApp(name) {
  if (!appsEnabled()) return { ok: false, message: "Opening apps is turned off on this computer (ULTRON_APPS=off)." };
  const q = String(name || "").trim().slice(0, 80);
  if (!q) return { ok: false, message: "Which app should I open?" };
  let apps = await listApps();
  let hit = findApp(q, apps);
  if (!hit.app) { apps = await listApps({ fresh: true }); hit = findApp(q, apps); } // just installed?
  if (!hit.app) {
    return { ok: false, notFound: true, message: `I couldn't find "${q}" installed on this computer.`, suggestions: hit.suggestions };
  }
  const r = await launch(hit.app);
  if (!r.ok) return { ok: false, message: `${hit.app.name} didn't start: ${r.error}.`, app: hit.app.name };
  log.info(`Opened ${hit.app.name} (asked for "${q}").`);
  return { ok: true, message: `Opening ${hit.app.name}.`, app: hit.app.name };
}

/* ---------------- web links ---------------- */

/** Only plain web addresses: http(s), no credentials, sane length. Null otherwise. */
export function safeWebUrl(raw) {
  const s = String(raw || "").trim();
  if (!s || s.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || !u.hostname) return null;
  return u.href;
}

/**
 * Open a web link in this computer's default browser (a new tab in the window
 * you already have). Used when the browser's pop-up blocker stops the JARVIS
 * page from opening it itself — e.g. a voice command, which isn't a click.
 * No shell: the URL is one argument to the system's own URL opener.
 */
export async function openUrl(raw) {
  if (!appsEnabled()) return { ok: false, message: "Opening things on this computer is turned off (ULTRON_APPS=off)." };
  const url = safeWebUrl(raw);
  if (!url) return { ok: false, message: "That isn't a web address I can open." };
  const launchCmd = process.platform === "win32" ? { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
    : process.platform === "darwin" ? { file: "open", args: [url] }
    : { file: "xdg-open", args: [url] };
  const r = await launch({ launch: launchCmd });
  if (!r.ok) return { ok: false, message: `Your browser didn't open: ${r.error}.` };
  log.info(`Opened ${new URL(url).host} in the default browser.`);
  return { ok: true, message: "Opening it in your browser.", url };
}
