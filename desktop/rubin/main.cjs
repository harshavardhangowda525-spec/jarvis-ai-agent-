"use strict";
/**
 * RUBEN desktop — JARVIS's CRM assistant as a floating "Dynamic Island".
 *
 * A real desktop window (Electron), not a web page pretending: frameless,
 * transparent, always on top of other apps, in every workspace, out of the
 * taskbar, with a tray icon, global shortcuts and an optional start-at-login.
 * It shows JARVIS's /island page; everything the island knows comes from your
 * running JARVIS (npm run local) — RUBEN keeps no data and no passwords itself.
 * Your JARVIS sign-in lives in this app's own browser profile, like a browser.
 */
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, ipcMain, nativeImage, session, shell, net, powerMonitor, dialog } = require("electron");
const L = require("./lib.cjs");
/** RUBEN's own log (…\\RUBEN\\rubin.log): what it was asked to do on the PC and what happened. */
function log(...a) {
  try {
    const f = path.join(app.getPath("userData"), "rubin.log");
    if (fs.existsSync(f) && fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + ".old");
    fs.appendFileSync(f, `${new Date().toISOString()} ${a.join(" ")}\n`);
  } catch { /* logging must never break RUBEN */ }
  console.log("RUBEN:", ...a);
}
const PC = require("./pc.cjs");

/**
 * One RUBEN at a time. Starting it again normally just opens the CRM, but
 * after an update (git pull) the copy already running in the tray would
 * still run the old code. So the new start passes a fingerprint of the
 * code, and the running copy restarts itself when its code has changed.
 */
const CODE = L.codeFingerprint(["main.cjs", "pc.cjs", "preload.cjs", "lib.cjs", "offline.html"].map((f) => { try { return fs.readFileSync(path.join(__dirname, f)); } catch { return ""; } }));
// `npm run rubin -- --quit` (or `electron . --quit`) asks the running RUBEN to quit
const QUIT = process.argv.includes("--quit");
if (!app.requestSingleInstanceLock({ code: CODE, quit: QUIT })) { app.quit(); process.exit(0); }
if (QUIT) { console.log("RUBEN wasn't running."); app.quit(); process.exit(0); }
app.setAppUserModelId("ai.jarvis.ruben");

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
let settings = L.readSettings(fs.existsSync(SETTINGS_FILE) ? fs.readFileSync(SETTINGS_FILE, "utf8") : "");
// RUBIN_JARVIS_URL (set by `npm run rubin`) wins over the saved address
if (process.env.RUBIN_JARVIS_URL && L.isHttpUrl(process.env.RUBIN_JARVIS_URL)) settings.url = process.env.RUBIN_JARVIS_URL.replace(/\/+$/, "");
// your online JARVIS (from APP_URL in .env.local, passed by `npm run rubin`): used when this PC's isn't running
if (process.env.RUBIN_CLOUD_URL && L.isHttpUrl(process.env.RUBIN_CLOUD_URL)) settings.cloudUrl = process.env.RUBIN_CLOUD_URL.replace(/\/+$/, "");
/** The JARVIS the island is using right now: this PC's, or the online one. */
let activeUrl = settings.url;
const START_HIDDEN = process.argv.includes("--hidden");

function save() {
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { console.error("RUBEN: couldn't save settings:", e.message); }
}

let island = null, authWin = null, tray = null;
let isOpen = false, onJarvis = false, retryTimer = null, dragTimer = null, offlineTries = 0;

/** "up" = that JARVIS answers AND has RUBEN's island page (an older deployment doesn't). */
async function probe(u) {
  try {
    const r = await net.fetch(`${u}/island`, { signal: AbortSignal.timeout(10_000), redirect: "manual" });
    return r.status === 200 ? "up" : r.status === 404 ? "old" : "down";
  } catch { return "down"; }
}
let offlineWhy = "";
/** This PC's JARVIS if it answers, else the online one; null if neither does. */
async function chooseServer() {
  const [local, cloud] = await Promise.all([probe(settings.url), settings.cloudUrl ? probe(settings.cloudUrl) : Promise.resolve(null)]);
  offlineWhy = L.offlineReason(local, cloud);
  return L.pickServer(local === "up", cloud === "up", settings.url, settings.cloudUrl);
}
/** The island window if it still exists (it may have been closed with Alt+F4 or Task Manager). */
const alive = () => !!island && !island.isDestroyed();
const showIsland = () => { if (alive() && !island.isVisible()) island.showInactive(); return alive(); };
const send = (cmd) => { if (alive()) island.webContents.send("rubin:command", cmd); };

// ---------- the island window ----------
function createIsland() {
  const b = L.initialBounds(settings.pos, screen.getAllDisplays(), screen.getPrimaryDisplay());
  island = new BrowserWindow({
    ...b, frame: false, transparent: true, backgroundColor: "#00000000", resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false, title: "RUBEN",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  // above normal windows (and full-screen apps on macOS), on every desktop
  island.setAlwaysOnTop(true, "screen-saver");
  island.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  setInteractive(false);

  island.once("ready-to-show", () => { if (!START_HIDDEN && alive()) island.showInactive(); });
  island.on("closed", () => { island = null; log("island window closed — quitting"); app.quit(); });
  island.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 = navigation replaced, not a failure
    if (L.sameOrigin(url, activeUrl)) goOffline();
  });
  island.webContents.on("did-navigate", (_e, url) => { onJarvis = L.sameOrigin(url, activeUrl); if (onJarvis) offlineTries = 0; updateTray(); });
  island.webContents.on("render-process-gone", () => setTimeout(loadIsland, 1000));
  island.webContents.on("unresponsive", () => island.webContents.reload());
  // the island never navigates away; sign-in pages open in their own window
  island.webContents.on("will-navigate", (e, url) => {
    if (L.sameOrigin(url, activeUrl) && new URL(url).pathname === "/island") return;
    e.preventDefault();
    const p = L.sameOrigin(url, activeUrl) ? L.authPath(new URL(url).pathname) : null;
    if (p) openAuth(p);
  });
  island.webContents.setWindowOpenHandler(({ url }) => {
    const p = L.sameOrigin(url, activeUrl) ? L.authPath(new URL(url).pathname) : null;
    if (p) openAuth(p);
    // links open in your browser; "Draft Email" opens a draft in your mail app (you send it yourself)
    else if (/^https?:/.test(url) || /^mailto:[^\s]+$/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  loadIsland();
}

async function loadIsland() {
  clearTimeout(retryTimer);
  if (!island || island.isDestroyed()) return;
  const target = await chooseServer();
  if (!target) return goOffline();
  if (target !== activeUrl) console.log(`RUBEN: using ${target === settings.url ? "JARVIS on this PC" : "your online JARVIS"} (${target})`);
  activeUrl = target;
  island.loadURL(`${activeUrl}/island`).catch(() => { /* did-fail-load handles it */ });
}

/** JARVIS isn't answering: show the offline capsule and keep trying (5 s, backing off to 60 s). */
function goOffline() {
  if (!island || island.isDestroyed()) return;
  onJarvis = false;
  if (isOpen) setOpen(false);
  island.loadFile(path.join(__dirname, "offline.html"), { query: { why: offlineWhy || L.offlineReason("down", settings.cloudUrl ? "down" : null) } }).catch(() => {});
  updateTray();
  const wait = () => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(async () => {
      offlineTries++;
      if (await chooseServer()) void loadIsland(); else wait();
    }, Math.min(60_000, 5000 * 2 ** Math.min(offlineTries, 4)));
  };
  wait();
}

function setInteractive(on) {
  if (!island || island.isDestroyed()) return;
  // forward:true keeps hover events flowing to the page while clicks pass through
  island.setIgnoreMouseEvents(!on, { forward: true });
}

function setOpen(open) {
  if (!island || island.isDestroyed()) return;
  isOpen = open;
  const cur = island.getBounds();
  const d = screen.getDisplayMatching(cur);
  const b = L.resizeAround(cur, open, d.workArea);
  island.setBounds(b);
  if (open) { if (!island.isVisible()) island.showInactive(); island.focus(); setInteractive(true); }
  updateTray();
}

// drag: follow the pointer from the main process (exact under any DPI / across monitors)
function startDrag() {
  if (!island || dragTimer) return;
  const start = screen.getCursorScreenPoint(), from = island.getBounds();
  dragTimer = setInterval(() => {
    if (!island || island.isDestroyed()) return stopDrag();
    const c = screen.getCursorScreenPoint();
    const d = L.displayFor(screen.getAllDisplays(), c);
    island.setBounds(L.clampToWorkArea({ x: from.x + c.x - start.x, y: from.y + c.y - start.y, width: from.width, height: from.height }, d.workArea));
  }, 16);
}
function stopDrag() {
  clearInterval(dragTimer); dragTimer = null;
  if (!island || island.isDestroyed()) return;
  const b = island.getBounds();
  settings.pos = { x: b.x, y: b.y };
  save();
}

/** Screens plugged / unplugged / rescaled: keep the island on a screen that exists. */
function reclamp() {
  if (!island || island.isDestroyed()) return;
  const cur = island.getBounds();
  const onScreen = screen.getAllDisplays().some((d) => { const w = d.workArea; const cx = cur.x + cur.width / 2; return cx >= w.x && cx <= w.x + w.width && cur.y >= w.y - 10 && cur.y <= w.y + w.height; });
  island.setBounds(onScreen ? L.clampToWorkArea(cur, screen.getDisplayMatching(cur).workArea) : L.initialBounds(null, screen.getAllDisplays(), screen.getPrimaryDisplay(), cur.height));
}

// ---------- sign-in / unlock (a normal window; the island can't fit a login form) ----------
function openAuth(p) {
  const target = `${activeUrl}${p}?next=/island`;
  if (authWin && !authWin.isDestroyed()) { authWin.loadURL(target); authWin.show(); authWin.focus(); return; }
  authWin = new BrowserWindow({
    width: 520, height: 760, title: "Sign in — RUBEN", autoHideMenuBar: true, icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // JARVIS's sign-in finishes with a client-side route change, so watch both kinds of navigation
  const done = (_e, url) => { if (authWin && L.authFinished(url, activeUrl)) { authWin.close(); loadIsland(); } };
  authWin.webContents.on("did-navigate", done);
  authWin.webContents.on("did-navigate-in-page", done);
  authWin.webContents.on("will-navigate", (e, url) => { if (!L.sameOrigin(url, activeUrl)) { e.preventDefault(); void shell.openExternal(url); } });
  authWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  authWin.on("closed", () => { authWin = null; send("refresh"); });
  authWin.loadURL(target);
}

// ---------- tray ----------
function trayImage() {
  const img = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png"));
  const hi = nativeImage.createFromPath(path.join(__dirname, "assets", "tray@2x.png"));
  if (!hi.isEmpty()) img.addRepresentation({ scaleFactor: 2, buffer: hi.toPNG() });
  return img;
}
function updateTray() {
  if (!tray) return;
  const visible = island && !island.isDestroyed() && island.isVisible();
  const where = activeUrl === settings.url ? "JARVIS on this PC" : "online JARVIS";
  tray.setToolTip(onJarvis ? `RUBEN — CRM assistant (${where})` : `RUBEN — waiting for JARVIS (${[settings.url, settings.cloudUrl].filter(Boolean).join(" or ")})`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: isOpen ? "Close CRM" : "Open CRM", click: () => { if (!isOpen) { if (showIsland()) { setOpen(true); send("open"); } } else send("close"); } },
    { label: "Talk to RUBEN", accelerator: settings.talkShortcut, click: () => { if (showIsland()) send("listen"); } },
    { label: visible ? "Hide the island" : "Show the island", click: () => { if (!alive()) return; if (visible) island.hide(); else island.showInactive(); updateTray(); } },
    { type: "separator" },
    { label: "Wake phrase (“Open CRM”, “Hey Ruben”)", type: "checkbox", checked: settings.wake, click: (i) => { settings.wake = i.checked; save(); send(i.checked ? "wake-on" : "wake-off"); } },
    { label: "Start RUBEN when I sign in", type: "checkbox", checked: settings.launchAtLogin, click: (i) => setLaunchAtLogin(i.checked) },
    { label: "Let RUBEN open and control apps", type: "checkbox", checked: settings.pcControl === true, click: (i) => { settings.pcControl = i.checked; save(); updateTray(); } },
    { type: "separator" },
    { label: "Sign in to JARVIS…", click: () => openAuth("/login") },
    { label: "Unlock JARVIS…", click: () => openAuth("/unlock") },
    { label: "Reconnect", click: () => loadIsland() },
    { label: `Using: ${where} — ${activeUrl}`, enabled: false },
    ...(settings.cloudUrl ? [{ label: `Online JARVIS: ${settings.cloudUrl}`, enabled: false }] : [{ label: "No online JARVIS set (APP_URL in .env.local)", enabled: false }]),
    { label: "Reset island position", click: () => { settings.pos = null; save(); if (alive()) island.setBounds(L.initialBounds(null, screen.getAllDisplays(), screen.getPrimaryDisplay(), island.getBounds().height)); } },
    { type: "separator" },
    { label: "Quit RUBEN", click: () => app.quit() },
  ]));
}

function setLaunchAtLogin(on) {
  settings.launchAtLogin = on;
  save();
  // unpackaged (npm run rubin): start Electron with this folder; packaged: just the app
  const opts = app.isPackaged ? { openAtLogin: on, args: ["--hidden"] } : { openAtLogin: on, path: process.execPath, args: [app.getAppPath(), "--hidden"] };
  try { app.setLoginItemSettings(opts); } catch (e) { console.error("RUBEN: launch at login isn't supported here:", e.message); }
  updateTray();
}

// ---------- shortcuts ----------
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const failed = [];
  const reg = (acc, fn) => { try { if (!globalShortcut.register(acc, fn)) failed.push(acc); } catch { failed.push(acc); } };
  reg(settings.shortcut, () => { if (showIsland()) send("toggle"); });
  reg(settings.talkShortcut, () => { if (showIsland()) send("listen"); });
  if (failed.length) console.warn(`RUBEN: another app already uses ${failed.join(", ")} — change it in ${SETTINGS_FILE}`);
}

// ---------- page ↔ desktop ----------
const fromIsland = (e) => alive() && e.sender === island.webContents;
ipcMain.on("rubin:open", (e, open) => { if (fromIsland(e)) setOpen(!!open); });
ipcMain.on("rubin:interactive", (e, on) => { if (fromIsland(e) && !dragTimer) setInteractive(!!on); });
ipcMain.on("rubin:drag", (e, on) => { if (!fromIsland(e)) return; if (on) startDrag(); else stopDrag(); });
ipcMain.on("rubin:auth", (e, p) => { if (fromIsland(e) && L.authPath(p)) openAuth(L.authPath(p)); });
ipcMain.on("rubin:retry", (e) => { if (fromIsland(e)) loadIsland(); });
ipcMain.on("rubin:quit", (e) => { if (fromIsland(e)) { log("quit from the island's settings"); app.quit(); } });
const pageSettings = () => ({ wake: settings.wake, voiceReplies: settings.voiceReplies, micId: settings.micId, launchAtLogin: settings.launchAtLogin,
  shortcut: settings.shortcut.replace("CommandOrControl", process.platform === "darwin" ? "Cmd" : "Ctrl"),
  talkShortcut: settings.talkShortcut.replace("CommandOrControl", process.platform === "darwin" ? "Cmd" : "Ctrl") });
ipcMain.handle("rubin:settings:get", (e) => (fromIsland(e) ? pageSettings() : null));
ipcMain.handle("rubin:settings:set", (e, patch) => {
  if (!fromIsland(e)) return null;
  const p = L.pagePatch(patch);
  const login = p.launchAtLogin;
  delete p.launchAtLogin;
  Object.assign(settings, p);
  save();
  if (typeof login === "boolean" && login !== settings.launchAtLogin) setLaunchAtLogin(login);
  updateTray();
  return pageSettings();
});

// ---------- apps on this PC ----------
// The page sends only the words you said or typed. RUBEN works out the action
// here and asks you itself, in a Windows dialog, before it closes an app,
// types or presses keys. The page can't answer that dialog.
let pcBusy = false;
/**
 * RUBEN's own question, attached to the island so it can't open hidden behind
 * other windows. No answer within a minute counts as Cancel.
 */
async function ask(opts) {
  const parent = alive() ? island : null;
  if (parent && !parent.isVisible()) parent.showInactive();
  const o = { noLink: true, ...opts, signal: AbortSignal.timeout(60_000) };
  try { return await (parent ? dialog.showMessageBox(parent, o) : dialog.showMessageBox(o)); }
  catch { return { response: opts.cancelId ?? 0 }; }
}
async function askConsent() {
  const r = await ask({
    type: "question", title: "RUBEN", buttons: ["Not now", "Allow"], defaultId: 1, cancelId: 0, noLink: true,
    message: "Let RUBEN open and control apps on this PC?",
    detail: "RUBEN will open installed apps and switch, minimise or maximise their windows when you ask. Before it closes an app, types or presses keys, it always asks you here first.\n\nYou can turn this off any time in RUBEN's tray menu.",
  });
  settings.pcControl = r.response === 1;
  save(); updateTray();
  return settings.pcControl;
}
ipcMain.handle("rubin:pc", async (e, text) => {
  if (!fromIsland(e) || !onJarvis || typeof text !== "string" || text.length > 600) return { handled: false };
  const cmd = PC.parsePcCommand(text);
  if (!cmd) return { handled: false };
  log(`pc: "${text.slice(0, 120)}" → ${cmd.kind}${cmd.app ? ` "${cmd.app}"` : ""}`);
  if (pcBusy) return { handled: true, ok: false, say: "One moment — I'm still on the last one." };
  pcBusy = true;
  try {
    if (settings.pcControl === false) return cmd.explicit ? { handled: true, ok: false, say: "App control is off — turn it on in RUBEN's tray menu." } : { handled: false };
    if (settings.pcControl == null && !(await askConsent())) return { handled: true, ok: false, say: "Okay — I won't control apps." };
    const plan = await PC.planPc(text, { selfPids: [process.pid, ...app.getAppMetrics().map((m) => m.pid)] });
    log(`pc:   ${plan.confirm ? `needs a yes — ${plan.confirm.question}` : plan.handled ? `${plan.ok ? "ok" : "failed"} — ${plan.say}` : `not an app — left to the CRM${plan.hint ? ` (${plan.hint})` : ""}`}`);
    if (!plan.confirm) return plan;
    const r = await ask({
      type: "warning", title: "RUBEN — please confirm", buttons: ["Cancel", "Yes, do it"], defaultId: 0, cancelId: 0, noLink: true,
      message: plan.confirm.question, detail: plan.confirm.detail || "",
    });
    if (r.response !== 1) return { handled: true, ok: true, say: "Okay — I didn't do it." };
    return { handled: true, ...(await PC.runConfirmed(plan.confirm)) };
  } catch (err) {
    log(`pc:   error — ${err?.stack || err}`);
    return { handled: true, ok: false, say: `That didn't work: ${String(err?.message || err).slice(0, 160)}` };
  } finally {
    pcBusy = false;
  }
});

// ---------- microphone & other permissions: JARVIS's own pages only, microphone only ----------
function lockPermissions() {
  const ok = (wc, permission, details) => {
    const origin = details?.requestingUrl || details?.securityOrigin || wc?.getURL() || "";
    if (!L.sameOrigin(origin, activeUrl)) return false;
    if (permission === "media") return !details?.mediaTypes || details.mediaTypes.every((t) => t === "audio");
    return permission === "clipboard-sanitized-write" || permission === "speaker-selection";
  };
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(ok(wc, permission, details)));
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details) => ok(wc, permission, { ...details, requestingUrl: origin }) || (permission === "media" && L.sameOrigin(origin, activeUrl)));
}

// ---------- lifecycle ----------
app.on("second-instance", (_e, _argv, _cwd, data) => {
  if (data && data.quit) { log("asked to quit (npm run rubin -- --quit)"); app.quit(); return; }
  if (data && data.code && data.code !== CODE) {
    log("updated code found — restarting to use it");
    app.relaunch();
    app.exit(0);
    return;
  }
  if (showIsland()) { setOpen(true); send("open"); }
});
app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.hide();
  lockPermissions();
  createIsland();
  tray = new Tray(trayImage());
  tray.on("click", () => { if (showIsland()) send("toggle"); });
  updateTray();
  registerShortcuts();
  if (settings.launchAtLogin !== app.getLoginItemSettings().openAtLogin) setLaunchAtLogin(settings.launchAtLogin);
  screen.on("display-added", reclamp);
  screen.on("display-removed", reclamp);
  screen.on("display-metrics-changed", reclamp);
  powerMonitor.on("resume", () => (onJarvis ? send("refresh") : loadIsland()));
  powerMonitor.on("unlock-screen", () => send("refresh"));
  log(`started (code ${CODE}), app control: ${settings.pcControl == null ? "not asked yet" : settings.pcControl ? "on" : "off"}`);
  console.log(`RUBEN is running — island on top, icon in the system tray. JARVIS: ${settings.url}${settings.cloudUrl ? `, online fallback: ${settings.cloudUrl}` : ""}`);
}).catch((e) => { dialog.showErrorBox("RUBEN couldn't start", String(e?.message || e)); app.quit(); });

// closing every window doesn't quit — RUBEN lives in the tray until you choose Quit
app.on("window-all-closed", () => {});
app.on("will-quit", () => globalShortcut.unregisterAll());
