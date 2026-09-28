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

export function appsEnabled(env = process.env) {
  return !/^(off|0|false|no)$/i.test(String(env.ULTRON_APPS || "").trim());
}

/* ---------------- matching (pure — tested) ---------------- */

/** "Microsoft® Word 2019 (64-bit)" → "word" */
export function normalizeName(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/\((x64|x86|64-bit|32-bit|64 bit|32 bit|user|preview)\)/g, " ")
    .replace(/\b(microsoft|app|application|program|desktop|for windows|the|my)\b/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What people say → the app's usual name. */
export const ALIASES = {
  "vs code": "visual studio code", vscode: "visual studio code", code: "visual studio code", "v s code": "visual studio code",
  chrome: "google chrome", "google chrome browser": "google chrome", edge: "edge", firefox: "firefox",
  calc: "calculator", calculator: "calculator",
  cmd: "command prompt", "command line": "command prompt", terminal: "terminal", powershell: "windows powershell",
  "file explorer": "file explorer", explorer: "file explorer", files: "file explorer", "my computer": "file explorer", "this pc": "file explorer", "file manager": "file explorer",
  "task manager": "task manager", "control panel": "control panel",
  "windows settings": "settings", "pc settings": "settings", "system settings": "settings", "computer settings": "settings", "laptop settings": "settings",
  "snipping tool": "snipping tool", "screenshot tool": "snipping tool", "screen snip": "snipping tool",
  store: "store", "microsoft store": "store", "app store": "store",
  ppt: "powerpoint", "power point": "powerpoint", "ms word": "word", "ms excel": "excel", "ms teams": "teams",
  whatsapp: "whatsapp", "whats app": "whatsapp", "spotify music": "spotify", "vlc player": "vlc media player", vlc: "vlc media player",
  "sticky note": "sticky notes", alarms: "clock", alarm: "clock", "voice recorder": "sound recorder",
  "android studio": "android studio", "git bash": "git bash", obs: "obs studio",
};

// Uninstallers, readmes and web links in the Start menu are never what you meant.
const JUNK = /\b(uninstall|uninstaller|readme|read me|help|documentation|release notes|license|website|web site|manual|changelog|support)\b/;

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** How well an installed app's name matches what was asked (0 = not at all). */
export function matchScore(query, appName) {
  const q = normalizeName(ALIASES[normalizeName(query)] ?? query);
  const raw = normalizeName(query);
  const n = normalizeName(appName);
  if (!q || !n) return 0;
  if (JUNK.test(n) && !JUNK.test(q)) return 0;
  if (n === q || n === raw) return 100;
  const qt = q.split(" "), nt = n.split(" ");
  if (n.startsWith(q + " ")) return 92 - Math.min(10, nt.length - qt.length);
  if (qt.every((t) => nt.includes(t))) return 84 - Math.min(10, nt.length - qt.length);
  if (q.length >= 4 && nt.some((t) => t === q)) return 80;
  if (q.length >= 4 && n.includes(q)) return 70;
  const d = lev(q, n);
  if ((q.length >= 4 && d <= 1) || (q.length >= 7 && d <= 2)) return 62;
  return 0;
}

/** Best installed app for a request, or suggestions when nothing fits. */
export function findApp(query, apps) {
  const scored = apps.map((a) => ({ a, s: matchScore(query, a.name) })).filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.name.length - y.a.name.length);
  if (scored.length && scored[0].s >= 62) return { app: scored[0].a, score: scored[0].s };
  const q = normalizeName(query);
  const suggestions = apps
    .map((a) => ({ a, d: lev(q, normalizeName(a.name)) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(q.length / 3)) && !JUNK.test(normalizeName(x.a.name)))
    .sort((x, y) => x.d - y.d).slice(0, 3).map((x) => x.a.name);
  return { app: null, suggestions };
}

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
