"use strict";
/**
 * JARVIS 2.0 — the floating holographic assistant on your desktop.
 *
 * A real desktop window (Electron): a small transparent orb, anchored to the
 * bottom-right corner, above your other apps, that you can drag anywhere.
 * Click it (or Ctrl+Alt+J) for the compact chat. It shows JARVIS's /orb page,
 * so the brain, voice and every key stay on your JARVIS server; this process
 * only does what the page can't: control apps, windows and folders on this
 * computer, through the planner + executor (fixed OS calls, arguments as
 * data, native confirmations, pause and stop).
 */
const path = require("node:path");
const fs = require("node:fs");
const { execFile, spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, ipcMain, nativeImage, session, shell, dialog, desktopCapturer, systemPreferences, powerMonitor } = require("electron");
const L = require("./lib.cjs");
const { createExecutor } = require("./executor.cjs");

const QUIT = process.argv.includes("--quit");
process.on("uncaughtException", (e) => log(`error: ${e && e.stack || e}`));
process.on("unhandledRejection", (e) => log(`error (async): ${e && e.stack || e}`));
if (!app.requestSingleInstanceLock({ quit: QUIT })) { app.quit(); process.exit(0); }
if (QUIT) { console.log("JARVIS orb wasn't running."); app.quit(); process.exit(0); }
app.setAppUserModelId("ai.jarvis.orb");
if (process.env.JARVIS_ORB_USER_DATA) app.setPath("userData", process.env.JARVIS_ORB_USER_DATA);

// ---------------- log & settings ----------------
/** Every desktop action and its result, on this computer only (…/JARVIS Orb/jarvis-orb.log). */
function log(line) {
  try {
    const f = path.join(app.getPath("userData"), "jarvis-orb.log");
    if (fs.existsSync(f) && fs.statSync(f).size > 1024 * 1024) fs.renameSync(f, f + ".old");
    fs.appendFileSync(f, `${new Date().toISOString()} ${typeof line === "string" ? line : JSON.stringify(line)}\n`);
  } catch { /* logging must never break JARVIS */ }
  if (process.env.JARVIS_ORB_DEBUG) console.log("ORB:", typeof line === "string" ? line : JSON.stringify(line));
}
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");
let settings = L.readSettings(fs.existsSync(SETTINGS_FILE()) ? fs.readFileSync(SETTINGS_FILE(), "utf8") : "");
if (process.env.JARVIS_ORB_URL && /^https?:\/\//.test(process.env.JARVIS_ORB_URL)) settings.url = process.env.JARVIS_ORB_URL.replace(/\/+$/, "");
function save() { try { fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true }); fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2)); } catch (e) { log(`couldn't save settings: ${e.message}`); } }
const sameOrigin = (u) => { try { return new URL(u).origin === new URL(settings.url).origin; } catch { return false; } };

// ---------------- the OS, reached through fixed calls ----------------
let appsMod = null;
const appsModule = async () => (appsMod ||= await import(pathToFileURL(path.join(__dirname, "..", "..", "edith", "src", "apps.mjs")).href));
const run = (file, args, opts = {}) => new Promise((resolve) => {
  execFile(file, args, { timeout: 20_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ""), stderr: String(stderr || (err && err.message) || "") }));
});
const has = async (cmd) => (await run(process.platform === "win32" ? "where" : "which", [cmd])).ok;

/** Windows: win.ps1 with the action as JSON in an environment variable (never on the command line). */
async function winPs(a) {
  const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "win.ps1")], { env: { ...process.env, JARVIS_ORB_ARGS: JSON.stringify(a) } });
  const out = r.stdout.trim().replace(/^\uFEFF/, "");
  try { return JSON.parse(out.split(/\r?\n/).pop() || "null"); } catch { log(`powershell ${a.op}: ${r.stderr.slice(0, 300)}`); return { ok: false, error: (r.stderr || "Windows didn't answer").trim().slice(0, 200) }; }
}
/** Linux (when wmctrl is installed): the same operations through wmctrl / xdotool. */
let linuxWm = null;
async function linuxWin(a) {
  if (a.op === "list") {
    const r = await run("wmctrl", ["-lp"]);
    const act = (await run("xdotool", ["getactivewindow"])).stdout.trim();
    return r.stdout.split("\n").filter(Boolean).map((l) => { const m = l.match(/^(0x[0-9a-f]+)\s+\S+\s+(\d+)\s+\S+\s+(.*)$/i); return m ? { id: parseInt(m[1], 16), pid: +m[2], name: (m[4] || m[3]).split(" ").pop().toLowerCase(), title: m[3], active: act ? parseInt(act, 10) === parseInt(m[1], 16) : false } : null; }).filter((w) => w && !String(w.title).startsWith("JARVIS Orb"));
  }
  const id = `0x${Number(a.id).toString(16)}`;
  // wmctrl -b takes at most two properties per call
  const ops = { focus: [["-ia", id]], close: [["-ic", id]], minimize: [["-ir", id, "-b", "add,hidden"]], maximize: [["-ir", id, "-b", "add,maximized_vert,maximized_horz"]], restore: [["-ir", id, "-b", "remove,hidden"], ["-ir", id, "-b", "remove,maximized_vert,maximized_horz"], ["-ia", id]] };
  if (ops[a.op]) { let r = { ok: true, stderr: "" }; for (const args of ops[a.op]) { r = await run("wmctrl", args); if (!r.ok) break; } return { ok: r.ok, error: r.stderr.trim() }; }
  if (a.op === "keys") {
    if (!(await has("xdotool"))) return { ok: false, error: "xdotool isn't installed" };
    await run("wmctrl", ["-ia", id]);
    await new Promise((r) => setTimeout(r, 250));
    // only type if that window really is in front — never into whatever else has focus
    const front = parseInt((await run("xdotool", ["getactivewindow"])).stdout.trim(), 10);
    if (front !== Number(a.id)) return { ok: false, error: "That window didn't come to the front, so nothing was typed." };
    for (const st of L.xdoSteps(a.keys)) {
      const r = st.text !== undefined ? await run("xdotool", ["type", "--delay", "8", "--", st.text]) : await run("xdotool", ["key", "--", st.key]);
      if (!r.ok) return { ok: false, error: r.stderr.trim() };
    }
    return { ok: true };
  }
  if (a.op === "arrange") {
    const d = screen.getPrimaryDisplay().workArea, half = Math.floor(d.width / 2);
    // a maximised window ignores a new size — un-maximise both first
    for (const w of [a.left, a.right]) { const h = `0x${Number(w).toString(16)}`; await run("wmctrl", ["-ir", h, "-b", "remove,hidden"]); await run("wmctrl", ["-ir", h, "-b", "remove,maximized_vert,maximized_horz"]); }
    await new Promise((r) => setTimeout(r, 400)); // the window manager applies that asynchronously
    const l = await run("wmctrl", ["-ir", `0x${Number(a.left).toString(16)}`, "-e", `0,${d.x},${d.y},${half},${d.height}`]);
    const r = await run("wmctrl", ["-ir", `0x${Number(a.right).toString(16)}`, "-e", `0,${d.x + half},${d.y},${d.width - half},${d.height}`]);
    return { ok: l.ok && r.ok };
  }
  return { ok: false, error: "Not supported here" };
}
/** VS Code for "open my project" (a fixed program, the folder as its one argument). */
async function openInEditor(p) {
  if (!fs.existsSync(p)) return { ok: false };
  const tryExe = (exe) => new Promise((res) => { try { const c = spawn(exe, [p], { detached: true, stdio: "ignore" }); c.on("error", () => res(false)); c.unref(); setTimeout(() => res(true), 400); } catch { res(false); } });
  if (process.platform === "win32") {
    for (const exe of [path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"), path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft VS Code", "Code.exe")]) {
      if (fs.existsSync(exe) && (await tryExe(exe))) return { ok: true, editor: "VS Code" };
    }
    return { ok: false };
  }
  if (process.platform === "darwin") return fs.existsSync("/Applications/Visual Studio Code.app") && (await run("open", ["-a", "Visual Studio Code", p])).ok ? { ok: true, editor: "VS Code" } : { ok: false };
  return (await has("code")) && (await tryExe("code")) ? { ok: true, editor: "VS Code" } : { ok: false };
}
async function screenshot() {
  try {
    if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") !== "granted") return { ok: false, error: "allow Screen Recording for JARVIS in System Settings → Privacy & Security" };
    const d = screen.getPrimaryDisplay();
    const [src] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) } });
    if (!src) return { ok: false, error: "no screen to capture" };
    const dir = path.join(app.getPath("pictures"), "JARVIS Screenshots");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    fs.writeFileSync(file, src.thumbnail.toPNG());
    return { ok: true, path: file };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---------------- the orb window ----------------
let orb = null, auth = null, tray = null, mode = "orb", dragTimer = null, retryTimer = null, onJarvis = false;
const alive = () => !!orb && !orb.isDestroyed();
const send = (type, data) => { if (alive()) orb.webContents.send("orb:event", { type, ...(data || {}) }); };

function bounds() { return L.orbBounds(settings.anchor, screen.getAllDisplays(), screen.getPrimaryDisplay(), mode); }
function setMode(m) {
  mode = m === "popup" ? "popup" : "orb";
  if (!alive()) return;
  orb.setBounds(bounds());
  if (mode === "popup") { setInteractive(true); orb.focus(); }
  updateTray();
}
function setInteractive(on) { if (alive()) orb.setIgnoreMouseEvents(!on, { forward: true }); }
function setFloating(on) { settings.floating = !!on; save(); if (alive()) orb.setAlwaysOnTop(settings.floating, settings.floating ? "screen-saver" : "normal"); updateTray(); }

function createOrb() {
  orb = new BrowserWindow({
    ...bounds(), frame: false, transparent: true, backgroundColor: "#00000000", resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: settings.floating, show: false, title: "JARVIS Orb", icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  if (settings.floating) orb.setAlwaysOnTop(true, "screen-saver");
  orb.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  setInteractive(false);
  orb.once("ready-to-show", () => { if (alive() && !process.argv.includes("--hidden")) orb.showInactive(); });
  orb.on("closed", () => { orb = null; app.quit(); });
  orb.webContents.on("did-fail-load", (_e, code, _d, url, isMain) => { if (isMain && code !== -3 && sameOrigin(url)) offline(); });
  orb.webContents.on("did-navigate", (_e, url) => { onJarvis = sameOrigin(url); updateTray(); });
  orb.webContents.on("render-process-gone", () => setTimeout(load, 1000));
  // the orb never navigates away; sign-in opens in its own window, links in your browser
  orb.webContents.on("will-navigate", (e, url) => { if (sameOrigin(url) && new URL(url).pathname === "/orb") return; e.preventDefault(); openLink(url); });
  orb.webContents.setWindowOpenHandler(({ url }) => { openLink(url); return { action: "deny" }; });
  load();
}
function openLink(url) {
  if (sameOrigin(url) && /^\/(login|unlock|signup)/.test(new URL(url).pathname)) return openAuth(new URL(url).pathname + new URL(url).search);
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}
function load() {
  clearTimeout(retryTimer);
  if (!alive()) return;
  orb.loadURL(`${settings.url}/orb`).catch(() => {});
}
function offline() {
  onJarvis = false; updateTray();
  if (alive()) orb.loadFile(path.join(__dirname, "offline.html"), { query: { url: settings.url } }).catch(() => {});
  clearTimeout(retryTimer);
  retryTimer = setTimeout(load, 8000);
}
function openAuth(p) {
  if (auth && !auth.isDestroyed()) { auth.focus(); return; }
  auth = new BrowserWindow({ width: 460, height: 720, title: "Sign in to JARVIS", autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
  auth.loadURL(`${settings.url}${p.includes("next=") ? p : `${p}${p.includes("?") ? "&" : "?"}next=/orb`}`).catch(() => {});
  // back on /orb (or the dashboard) = signed in: close it and refresh the orb
  const done = (_e, url) => { if (auth && !auth.isDestroyed() && sameOrigin(url) && /^\/(orb|dashboard)/.test(new URL(url).pathname)) { auth.close(); load(); } };
  auth.webContents.on("did-navigate", done);
  auth.webContents.on("did-navigate-in-page", done); // the sign-in form moves on without a full page load
  auth.on("closed", () => { auth = null; });
}

function startDrag() {
  if (!alive() || dragTimer) return;
  const start = screen.getCursorScreenPoint(), b = orb.getBounds();
  dragTimer = setInterval(() => {
    if (!alive()) return stopDrag();
    const c = screen.getCursorScreenPoint();
    orb.setBounds({ ...b, x: b.x + c.x - start.x, y: b.y + c.y - start.y });
  }, 16);
}
function stopDrag() {
  clearInterval(dragTimer); dragTimer = null;
  if (!alive()) return;
  const b = orb.getBounds();
  settings.anchor = { right: b.x + b.width, bottom: b.y + b.height };
  save();
  orb.setBounds(bounds()); // snap back on screen
}

// ---------------- the hands ----------------
let paused = false;
const executor = createExecutor({
  platform: process.platform,
  homedir: () => app.getPath("home"),
  apps: {
    listApps: async (o) => (await appsModule()).listApps(o),
    findApp: (q, list) => appsMod.findApp(q, list), matchScore: (q, n) => appsMod.matchScore(q, n), normalizeName: (s) => appsMod.normalizeName(s),
    launch: async (a) => { const r = await (await appsModule()).openApp(a.name); return { ok: !!r.ok, error: r.ok ? null : r.message }; },
  },
  win: (a) => (process.platform === "win32" ? winPs(a) : linuxWin(a)),
  windowControl: () => linuxWm === true,
  listWindows: process.platform === "linux" ? async () => (linuxWm ? linuxWin({ op: "list" }) : []) : undefined,
  activate: process.platform === "darwin" ? async (name) => { const r = await run("osascript", ["-e", "on run argv", "-e", "tell application (item 1 of argv) to activate", "-e", "end run", name]); return { ok: r.ok, error: r.stderr.trim() }; } : undefined,
  selfPids: [process.pid],
  confirm: async (question, detail) => {
    const parent = alive() ? orb : undefined;
    const o = { type: "question", buttons: ["Yes, do it", "No"], defaultId: 1, cancelId: 1, noLink: true, title: "JARVIS", message: question, detail: detail || "" };
    const r = parent ? await dialog.showMessageBox(parent, o) : await dialog.showMessageBox(o);
    log({ confirm: question, answer: r.response === 0 ? "yes" : "no" });
    return r.response === 0;
  },
  exists: (p) => fs.existsSync(p), readdir: (p) => fs.readdirSync(p, { withFileTypes: true }), stat: (p) => fs.statSync(p), mkdir: (p) => fs.mkdirSync(p),
  openPath: (p) => shell.openPath(p), openExternal: (u) => shell.openExternal(u),
  safeWebUrl: (u) => appsMod ? appsMod.safeWebUrl(u) : (/^https?:\/\/[^\s]+$/.test(u) ? u : null),
  openInEditor, screenshot,
  settings: () => settings,
  log: (e) => log(e),
  onProgress: (p) => send("progress", { index: p.index, total: p.total, state: p.state, say: p.say || null, kind: p.step.kind, target: p.step.app || p.step.folder || p.step.query || p.step.name || p.step.site || null }),
});

async function askControl() {
  if (settings.control) return true;
  const r = await dialog.showMessageBox(alive() ? orb : undefined, {
    type: "question", buttons: ["Allow", "Not now"], defaultId: 0, cancelId: 1, noLink: true, title: "JARVIS",
    message: "Let JARVIS control apps on this computer?",
    detail: "JARVIS will open installed apps, switch, minimise, maximise and arrange their windows, open folders and websites, and search your folders by name when you ask.\n\nBefore it closes an app, types or presses keys that could send something, it always asks you here first. It never deletes files.\n\nYou can turn this off any time from the tray icon, and Ctrl+Alt+P pauses everything.",
  });
  settings.control = r.response === 0; save(); updateTray();
  if (settings.control && process.platform === "darwin" && !systemPreferences.isTrustedAccessibilityClient(false)) systemPreferences.isTrustedAccessibilityClient(true); // macOS shows its own prompt
  return settings.control;
}

const fromOrb = (e) => alive() && e.sender === orb.webContents && (sameOrigin(e.senderFrame?.url || "") || String(e.senderFrame?.url || "").startsWith("file:"));
ipcMain.handle("orb:run", async (e, text, ctx) => {
  if (!fromOrb(e)) return { handled: false };
  const t = String(text || "").slice(0, 1000);
  log({ heard: t });
  const P = require("./planner.cjs");
  const pl = P.plan(t, ctx || {});
  if (!pl) return { handled: false };
  if (pl.steps && !["stop", "pause", "resume"].includes(pl.steps[0].kind) && !(await askControl())) return { handled: true, reply: "Desktop control is off — allow it from the tray icon when you want me to work with your apps.", results: [] };
  await appsModule().catch(() => null);
  const r = await executor.run(t, ctx || {});
  paused = executor.isPaused(); updateTray();
  return r;
});
ipcMain.handle("orb:apps", async (e) => (fromOrb(e) ? executor.apps().catch(() => []) : []));
ipcMain.handle("orb:open-app", async (e, name) => {
  if (!fromOrb(e)) return { ok: false };
  if (executor.isPaused()) return { ok: false, say: "Automation is paused." };
  if (!(await askControl())) return { ok: false, say: "Desktop control is off." };
  await appsModule();
  const r = await executor.step({ kind: "open_app", app: String(name).slice(0, 80) });
  log({ action: "open_app", target: name, ok: r.ok, say: r.say });
  return r;
});
ipcMain.on("orb:stop", (e) => { if (fromOrb(e)) { executor.stop(); log({ action: "stop (button)" }); } });
ipcMain.on("orb:pause", (e, on) => { if (fromOrb(e)) { executor.setPaused(!!on); paused = !!on; updateTray(); send("paused", { paused }); } });
ipcMain.handle("orb:state", (e) => (fromOrb(e) ? { paused: executor.isPaused(), control: settings.control, platform: process.platform, floating: settings.floating, shortcuts: SHORTCUTS } : null));
ipcMain.handle("orb:settings:get", (e) => (fromOrb(e) ? { projects: settings.projects, sites: settings.sites, searchRoots: settings.searchRoots, projectsRoot: settings.projectsRoot, wakePhrase: settings.wakePhrase, voiceMode: settings.voiceMode, volume: settings.volume, rate: settings.rate, micId: settings.micId, language: settings.language, floating: settings.floating } : null));
ipcMain.handle("orb:settings:set", (e, patch) => {
  if (!fromOrb(e) || !patch || typeof patch !== "object") return null;
  const next = L.readSettings(JSON.stringify({ ...settings, ...patch, url: settings.url, anchor: settings.anchor, control: settings.control }));
  settings = { ...next, url: settings.url, anchor: settings.anchor, control: settings.control };
  save();
  if ("floating" in patch) setFloating(!!patch.floating);
  return true;
});
ipcMain.on("orb:mode", (e, m) => { if (fromOrb(e)) setMode(m); });
ipcMain.on("orb:interactive", (e, on) => { if (fromOrb(e) && !dragTimer) setInteractive(!!on); });
ipcMain.on("orb:drag", (e, on) => { if (fromOrb(e)) (on ? startDrag() : stopDrag()); });
ipcMain.on("orb:hide", (e) => { if (fromOrb(e)) { setMode("orb"); orb.hide(); updateTray(); } });
ipcMain.on("orb:quit", (e) => { if (fromOrb(e)) app.quit(); });
ipcMain.on("orb:retry", (e) => { if (fromOrb(e)) load(); });

// ---------------- tray & shortcuts ----------------
const SHORTCUTS = { chat: "CommandOrControl+Alt+J", talk: "CommandOrControl+Alt+Space", stop: "CommandOrControl+Alt+Backspace", pause: "CommandOrControl+Alt+P" };
function show() { if (!alive()) return false; if (!orb.isVisible()) orb.showInactive(); return true; }
function updateTray() {
  if (!tray) return;
  tray.setToolTip(`JARVIS${paused ? " — automation paused" : ""}${onJarvis ? "" : " — waiting for JARVIS"}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: alive() && orb.isVisible() ? "Hide the orb" : "Show the orb", click: () => { if (!alive()) return; if (orb.isVisible()) orb.hide(); else orb.showInactive(); updateTray(); } },
    { label: "Open chat", accelerator: SHORTCUTS.chat, click: () => { if (show()) { setMode("popup"); send("open"); } } },
    { label: "Move back to the bottom-right corner", click: () => { settings.anchor = null; save(); setMode(mode); } },
    { type: "separator" },
    { label: "Pause all automation", type: "checkbox", accelerator: SHORTCUTS.pause, checked: paused, click: (i) => { executor.setPaused(i.checked); paused = i.checked; send("paused", { paused }); updateTray(); } },
    { label: "Let JARVIS control apps on this computer", type: "checkbox", checked: settings.control === true, click: (i) => { settings.control = i.checked; save(); updateTray(); } },
    { label: "Keep the orb above other windows", type: "checkbox", checked: settings.floating, click: (i) => setFloating(i.checked) },
    { label: "Start with Windows / at login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ["--hidden"] }) },
    { label: "Open the activity log", click: () => shell.openPath(path.join(app.getPath("userData"), "jarvis-orb.log")) },
    { type: "separator" },
    { label: "Quit JARVIS orb", click: () => app.quit() },
  ]));
}
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const reg = (acc, fn) => { try { if (!globalShortcut.register(acc, fn)) log(`shortcut ${acc} is taken by another app`); } catch { log(`shortcut ${acc} couldn't be registered`); } };
  reg(SHORTCUTS.chat, () => { if (show()) { setMode(mode === "popup" ? "orb" : "popup"); send(mode === "popup" ? "open" : "close"); } });
  reg(SHORTCUTS.talk, () => { if (show()) send("ptt"); });
  reg(SHORTCUTS.stop, () => { executor.stop(); log({ action: "emergency stop (shortcut)" }); send("stop"); });
  reg(SHORTCUTS.pause, () => { paused = !executor.isPaused(); executor.setPaused(paused); send("paused", { paused }); updateTray(); });
}

/** Microphone for JARVIS's own page only (audio only); nothing else is granted. */
function lockPermissions() {
  const ok = (permission, origin, details) => sameOrigin(origin) && permission === "media" && (!details?.mediaTypes || details.mediaTypes.every((t) => t === "audio"));
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(ok(permission, details?.requestingUrl || wc.getURL(), details)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permission === "media" && sameOrigin(origin));
}

app.on("second-instance", (_e, _argv, _cwd, data) => {
  if (data && data.quit) { app.quit(); return; }
  if (show()) { setMode("popup"); send("open"); }
});
app.whenReady().then(async () => {
  if (process.platform === "darwin") { app.dock?.hide(); try { await systemPreferences.askForMediaAccess("microphone"); } catch { /* asked again on first use */ } }
  if (process.platform === "linux") linuxWm = (await has("wmctrl"));
  lockPermissions();
  createOrb();
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png")).isEmpty() ? nativeImage.createEmpty() : (() => { const i = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png")); i.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path.join(__dirname, "assets", "tray@2x.png")) }); return i; })());
    tray.on("click", () => { if (show()) { setMode(mode === "popup" ? "orb" : "popup"); send(mode === "popup" ? "open" : "close"); } });
  } catch (e) { log(`no tray icon here: ${e.message}`); }
  updateTray();
  registerShortcuts();
  const reclamp = () => setMode(mode);
  screen.on("display-added", reclamp); screen.on("display-removed", reclamp); screen.on("display-metrics-changed", reclamp);
  powerMonitor.on("resume", () => (onJarvis ? send("refresh") : load()));
  log(`started on ${process.platform}; JARVIS: ${settings.url}; desktop control: ${settings.control ? "on" : "not allowed yet"}${process.platform === "linux" ? `; window control: ${linuxWm ? "wmctrl" : "not available (install wmctrl)"}` : ""}`);
  console.log(`JARVIS orb is running (bottom-right of your screen, icon in the tray). JARVIS: ${settings.url}`);
}).catch((e) => { dialog.showErrorBox("JARVIS orb couldn't start", String(e?.message || e)); app.quit(); });
app.on("window-all-closed", () => {});
app.on("will-quit", () => globalShortcut.unregisterAll());
