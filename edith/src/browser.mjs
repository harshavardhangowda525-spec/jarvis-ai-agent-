/**
 * JARVIS's live browser — a real Chrome/Edge on this computer, shown inside the
 * JARVIS page ("JARVIS, open YouTube" → YouTube working in a glass pop-up).
 *
 * Why: most big sites (YouTube, Gmail, Amazon, GitHub…) refuse to be shown in
 * another page's <iframe>. So ULTRON runs the site in its own browser here and
 * streams it to the pop-up as live frames; your clicks, scrolls and typing go
 * back to it. Nothing is proxied or rewritten — it's the real site in a real
 * browser, with its own profile (edith/.browser-profile) so logins stick.
 *
 * Guard: only your paired JARVIS page (allowed origin + pairing token) can drive
 * it, only http(s) addresses are opened, downloads are off, and camera / mic /
 * location permission requests are denied. Turn it off with ULTRON_BROWSER=off.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./log.mjs";
import { safeWebUrl } from "./apps.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function browserEnabled(env = process.env) {
  return !/^(off|0|false|no)$/i.test(String(env.ULTRON_BROWSER || "").trim());
}

/* ---------------- keys & input (pure — tested) ---------------- */

const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
/** {alt, ctrl, meta, shift} → the CDP modifier bitmask. */
export function modifierMask(m = {}) {
  return (m.alt ? MODS.alt : 0) | (m.ctrl ? MODS.ctrl : 0) | (m.meta ? MODS.meta : 0) | (m.shift ? MODS.shift : 0);
}

/** A browser KeyboardEvent (as sent by the pop-up) → CDP Input.dispatchKeyEvent params. */
export function keyEventParams(k) {
  const key = String(k.key || "");
  const modifiers = modifierMask(k);
  const code = Number(k.keyCode) || 0;
  let text = "";
  if (k.type === "down") {
    if (key === "Enter") text = "\r";
    else if (key.length === 1 && !k.ctrl && !k.meta) text = key;
  }
  return {
    type: k.type === "up" ? "keyUp" : text ? "keyDown" : "rawKeyDown",
    key, code: String(k.code || ""), text, unmodifiedText: text,
    windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
    autoRepeat: !!k.repeat, location: Number(k.location) || 0, modifiers,
  };
}

const BUTTONS = { left: 1, right: 2, middle: 4 };
/** A pointer event from the pop-up (viewport CSS px) → CDP Input.dispatchMouseEvent params. */
export function mouseEventParams(m, size) {
  const clamp = (v, max) => Math.max(0, Math.min(max - 1, Math.round(Number(v) || 0)));
  const x = clamp(m.x, size.width), y = clamp(m.y, size.height);
  const button = ["left", "right", "middle"].includes(m.button) ? m.button : "none";
  const base = { x, y, modifiers: modifierMask(m) };
  if (m.type === "wheel") return { ...base, type: "mouseWheel", deltaX: Number(m.dx) || 0, deltaY: Number(m.dy) || 0 };
  const buttons = m.type === "up" ? 0 : Number(m.buttons) || (m.type === "down" ? BUTTONS[button] || 0 : 0);
  return {
    ...base,
    type: m.type === "down" ? "mousePressed" : m.type === "up" ? "mouseReleased" : "mouseMoved",
    button: m.type === "move" ? (buttons & 1 ? "left" : "none") : button,
    buttons,
    clickCount: m.type === "move" ? 0 : Math.max(1, Math.min(3, Number(m.clicks) || 1)),
  };
}

/** Keep the view a sane size (CSS px). */
export function viewSize(w, h) {
  const n = (v, d, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || d)));
  return { width: n(w, 1100, 320, 2560), height: n(h, 700, 240, 1600) };
}

/* ---------------- the browser ---------------- */

/** Where Chrome / Edge live on Windows (per-user and machine-wide installs). */
function windowsBrowserPaths(env) {
  const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.ProgramW6432].filter(Boolean);
  const out = [];
  for (const r of roots) out.push({ label: "Google Chrome", id: "chrome", file: path.win32.join(r, "Google", "Chrome", "Application", "chrome.exe") });
  for (const r of roots) out.push({ label: "Microsoft Edge", id: "msedge", file: path.win32.join(r, "Microsoft", "Edge", "Application", "msedge.exe") });
  return out;
}

/**
 * Browsers to try, best first: ULTRON_BROWSER_PATH, then Chrome, then Edge
 * (always present on Windows 10/11), then a Linux Chromium, then Playwright's
 * own. Each gets its own profile folder (`id`) — Chrome and Edge must never
 * share one.
 */
export function launchCandidates({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const out = [];
  const exe = String(env.ULTRON_BROWSER_PATH || "").trim().replace(/^["']|["']$/g, "");
  if (exe) out.push({ label: exe, id: "custom", opts: { executablePath: exe } });
  if (platform === "win32") {
    // look for the real .exe first (Playwright's channel lookup misses some installs)
    const seen = new Set();
    for (const b of windowsBrowserPaths(env)) {
      if (seen.has(b.id) || !exists(b.file)) continue;
      seen.add(b.id);
      out.push({ label: b.label, id: b.id, opts: { executablePath: b.file } });
    }
    if (!seen.has("chrome")) out.push({ label: "Google Chrome", id: "chrome", opts: { channel: "chrome" } });
    if (!seen.has("msedge")) out.push({ label: "Microsoft Edge", id: "msedge", opts: { channel: "msedge" } });
  } else {
    out.push({ label: "Google Chrome", id: "chrome", opts: { channel: "chrome" } }, { label: "Microsoft Edge", id: "msedge", opts: { channel: "msedge" } });
  }
  if (platform === "linux") {
    for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/snap/bin/chromium"]) {
      if (exists(p)) out.push({ label: p, id: "chromium", opts: { executablePath: p } });
    }
  }
  out.push({ label: "Playwright Chromium", id: "chromium", opts: {} });
  return out;
}

/**
 * A browser left running from an earlier ULTRON that was killed hard (closing
 * the window on Windows, a crash) still holds our profile, and a new one can't
 * start with it. Stop only browsers started with OUR profile folder.
 * Resolves the number stopped.
 */
export function staleBrowserCommand(platform, dir) {
  if (platform === "win32") {
    // the folder goes in through an environment variable — no quoting games
    const ps = "$d=$env:JARVIS_BROWSER_PROFILE; $p=@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe' OR Name='chromium.exe' OR Name='headless_shell.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($d) }); foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count";
    return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", ps], env: { JARVIS_BROWSER_PROFILE: dir } };
  }
  return { file: "ps", args: ["-eo", "pid=,args="], env: {} };
}

export async function killStaleBrowsers(dir) {
  const { execFile } = await import("node:child_process");
  const cmd = staleBrowserCommand(process.platform, dir);
  const out = await new Promise((resolve) => execFile(cmd.file, cmd.args, { env: { ...process.env, ...cmd.env }, timeout: 20_000, windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout) => resolve(err ? "" : String(stdout))));
  if (process.platform === "win32") return Number(out.trim().split(/\s+/).pop()) || 0;
  let n = 0;
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m || !m[2].includes(`--user-data-dir=${dir}`) || Number(m[1]) === process.pid) continue;
    try { process.kill(Number(m[1]), "SIGKILL"); n++; } catch { /* gone */ }
  }
  return n;
}

// Sites in the live view never get your camera, mic, location, notifications…
// (headless there is no prompt to answer, so they'd hang — deny them outright).
const DENIED = ["geolocation", "camera", "microphone", "notifications", "midi", "clipboard-read", "display-capture", "local-fonts", "window-management", "idle-detection"];
async function denyPermissions(context) {
  try {
    const page = context.pages()[0] ?? await context.newPage();
    const cdp = await context.newCDPSession(page);
    for (const name of DENIED) await cdp.send("Browser.setPermission", { permission: { name }, setting: "denied" }).catch(() => {});
    await cdp.detach().catch(() => {});
  } catch (e) { log.warn(`Live browser: couldn't lock down permissions (${e.message}).`); }
}

let ctx = null;        // the persistent browser context
let launching = null;  // in-flight launch
let dpr = 1;
let sessions = 0;
let idleTimer = null;

async function getContext(wantDpr) {
  if (ctx) return ctx;
  if (launching) return launching;
  launching = (async () => {
    let chromium;
    try { ({ chromium } = await import("playwright-core")); }
    catch { throw new Error("The live browser needs one more package — restart with npm run local (it installs it), or run npm install in the edith folder."); }
    const root = path.resolve(process.env.ULTRON_BROWSER_PROFILE || path.join(__dirname, "..", ".browser-profile"));
    dpr = Math.max(1, Math.min(2, Number(wantDpr) || 1));
    const headed = /^(1|true|yes|on)$/i.test(String(process.env.ULTRON_BROWSER_HEADED || ""));
    const errors = [];
    const tryLaunch = async (c) => {
      const dir = path.join(root, c.id);
      fs.mkdirSync(dir, { recursive: true });
      return chromium.launchPersistentContext(dir, {
        ...c.opts,
        headless: !headed,
        viewport: { width: 1100, height: 700 },
        deviceScaleFactor: dpr,
        acceptDownloads: false,
        ignoreDefaultArgs: ["--enable-automation", "--mute-audio"],
        args: ["--disable-blink-features=AutomationControlled", "--autoplay-policy=no-user-gesture-required", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"],
      });
    };
    for (const c of launchCandidates()) {
      let context = null;
      try { context = await tryLaunch(c); }
      catch (e) {
        // an old browser still holding this profile? stop it and try once more
        const msg = String(e.message);
        const missing = /Executable doesn't exist|distribution '.*' is not found|ENOENT/i.test(msg);
        if (!missing) log.warn(`Live browser: ${c.label} didn't start — ${msg.split("\n")[0].slice(0, 200)}`);
        if (!missing && await killStaleBrowsers(path.join(root, c.id)) > 0) {
          log.warn("Live browser: stopped a leftover browser from an earlier run.");
          try { context = await tryLaunch(c); } catch (e2) { errors.push(`${c.label}: ${String(e2.message).split("\n")[0]}`); }
        } else errors.push(`${c.label}: ${msg.split("\n")[0]}`);
      }
      if (!context) continue;
      context.on("close", () => { if (ctx === context) ctx = null; });
      await denyPermissions(context);
      log.info(`Live browser ready (${c.label}).`);
      ctx = context;
      return context;
    }
    throw new Error(`I couldn't start a browser on this computer — install Google Chrome or Microsoft Edge (or set ULTRON_BROWSER_PATH). ${errors.slice(0, 2).join(" | ")}`);
  })();
  try { return await launching; } finally { launching = null; }
}

function holdBrowser() {
  sessions++;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}
function releaseBrowser() {
  sessions = Math.max(0, sessions - 1);
  if (sessions || idleTimer) return;
  // nobody's looking: close it after a while to give the memory back
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!sessions && ctx) { const c = ctx; ctx = null; c.close().catch(() => {}); log.info("Live browser closed (idle)."); }
  }, Number(process.env.ULTRON_BROWSER_IDLE_MS) || 10 * 60_000);
}

export async function closeBrowser() {
  const c = ctx; ctx = null;
  if (c) await c.close().catch(() => {});
}

/**
 * One pop-up ⇄ one tab. Text messages are JSON commands/state; binary messages
 * from here are JPEG frames of the page.
 */
export function handleBrowserSocket(socket) {
  let page = null, cdp = null, size = viewSize(), closed = false, busy = Promise.resolve();
  let lastCursor = "", cursorAt = 0, dialog = null;
  const pages = new Set();
  holdBrowser();

  const send = (obj) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj)); };
  const fail = (e) => send({ t: "error", message: String(e?.message || e).split("\n")[0].slice(0, 300) });

  async function state(loading = false) {
    if (!page || !cdp) return;
    let back = false, fwd = false;
    try { const h = await cdp.send("Page.getNavigationHistory"); back = h.currentIndex > 0; fwd = h.currentIndex < h.entries.length - 1; } catch { /* navigating */ }
    let title = "";
    try { title = await page.title(); } catch { /* navigating */ }
    send({ t: "state", url: page.url(), title, loading, canGoBack: back, canGoForward: fwd });
  }

  async function detach() {
    const c = cdp; cdp = null;
    if (c) { try { await c.send("Page.stopScreencast"); } catch { /* gone */ } try { await c.detach(); } catch { /* gone */ } }
  }

  async function screencast() {
    if (!cdp) return;
    try { await cdp.send("Page.stopScreencast"); } catch { /* not started */ }
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: Math.round(size.width * dpr), maxHeight: Math.round(size.height * dpr), everyNthFrame: 1 });
  }

  async function show(p) {
    await detach();
    page = p;
    if (!pages.has(p)) {
      pages.add(p);
      p.on("framenavigated", (f) => { if (p === page && f === p.mainFrame()) state(true); });
      p.on("load", () => { if (p === page) state(false); });
      p.on("domcontentloaded", () => { if (p === page) state(false); });
      // a link that opens a new window → show that one
      p.on("popup", (np) => { pages.add(np); busy = busy.then(() => show(np)).catch(fail); });
      p.on("close", () => {
        pages.delete(p);
        if (p !== page || closed) return;
        const next = [...pages].pop();
        if (next) busy = busy.then(() => show(next)).catch(fail);
        else { page = null; send({ t: "closed" }); }
      });
      // file pickers would open a native dialog on this PC — cancel them
      p.on("filechooser", (fc) => { fc.setFiles([]).catch(() => {}); send({ t: "notice", message: "Uploading files isn't supported in the live view — open the site in a new tab for that." }); });
      p.on("dialog", (d) => {
        if (p !== page) { d.dismiss().catch(() => {}); return; }
        if (d.type() === "beforeunload") { d.accept().catch(() => {}); return; }
        dialog = d;
        send({ t: "dialog", kind: d.type(), message: d.message().slice(0, 1000), value: d.defaultValue() });
      });
    }
    await p.setViewportSize(size).catch(() => {});
    cdp = await p.context().newCDPSession(p);
    const mine = cdp;
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      const ack = () => { if (cdp === mine) mine.send("Page.screencastFrameAck", { sessionId }).catch(() => {}); };
      // ack once the frame is on the wire — natural back-pressure for slow links
      if (socket.readyState === socket.OPEN && p === page) socket.send(Buffer.from(data, "base64"), { binary: true }, ack);
      else ack();
    });
    await screencast();
    await p.bringToFront().catch(() => {});
    await state(false);
  }

  async function open(rawUrl) {
    const url = safeWebUrl(rawUrl);
    if (!url) throw new Error("That isn't a web address I can open.");
    if (!page) {
      const c = await getContext(dpr);
      await show(await c.newPage()); // a fresh tab, so "back" never lands on a blank page
    }
    send({ t: "state", url, title: "", loading: true, canGoBack: false, canGoForward: false });
    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }); }
    catch (e) { if (!/interrupted|aborted/i.test(String(e.message))) throw new Error(`${new URL(url).host} didn't load: ${String(e.message).split("\n")[0]}`); }
    await state(false);
  }

  async function cursorAtPoint(x, y) {
    if (!page || Date.now() - cursorAt < 120) return;
    cursorAt = Date.now();
    try {
      const c = await page.evaluate(([cx, cy]) => { const el = document.elementFromPoint(cx, cy); return el ? getComputedStyle(el).cursor : "auto"; }, [x, y]);
      if (c !== lastCursor) { lastCursor = c; send({ t: "cursor", cursor: c }); }
    } catch { /* navigating */ }
  }

  async function handle(m) {
    switch (m.t) {
      case "open":
        size = viewSize(m.width, m.height);
        if (m.dpr) dpr = ctx ? dpr : Math.max(1, Math.min(2, Number(m.dpr)));
        return open(m.url);
      case "nav": return open(m.url);
      case "back": if (page) { await page.goBack({ timeout: 15_000 }).catch(() => {}); await state(false); } return;
      case "forward": if (page) { await page.goForward({ timeout: 15_000 }).catch(() => {}); await state(false); } return;
      case "reload": if (page) { await page.reload({ timeout: 30_000 }).catch(() => {}); await state(false); } return;
      case "stop": if (cdp) await cdp.send("Page.stopLoading").catch(() => {}); return;
      case "resize":
        size = viewSize(m.width, m.height);
        if (page) { await page.setViewportSize(size).catch(() => {}); await screencast().catch(() => {}); }
        return;
      case "mouse":
        if (!cdp) return;
        await cdp.send("Input.dispatchMouseEvent", mouseEventParams(m, size));
        if (m.type === "move") void cursorAtPoint(Math.round(m.x), Math.round(m.y));
        return;
      case "key": if (cdp) await cdp.send("Input.dispatchKeyEvent", keyEventParams(m)); return;
      case "text": if (cdp && typeof m.text === "string") await cdp.send("Input.insertText", { text: m.text.slice(0, 10_000) }); return;
      case "dialog":
        if (dialog) { const d = dialog; dialog = null; await (m.accept ? d.accept(typeof m.value === "string" ? m.value : undefined) : d.dismiss()).catch(() => {}); }
        return;
      default: return;
    }
  }

  socket.on("message", (raw, isBinary) => {
    if (isBinary) return;
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    // mouse moves and keys are applied in order; a slow navigation doesn't block input
    const quick = m.t === "mouse" || m.t === "key" || m.t === "text";
    const run = () => handle(m).catch(fail);
    if (quick) void run(); else busy = busy.then(run);
  });
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (dialog) { dialog.dismiss().catch(() => {}); dialog = null; }
    await detach();
    for (const p of pages) await p.close().catch(() => {});
    pages.clear();
    releaseBrowser();
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
  send({ t: "ready" });
}
