import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { log } from "../log.mjs";
import { readLink } from "../maps/finder.mjs";
import { createComputer } from "./computer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDS_CS = path.join(__dirname, "hands.cs");
const HANDS_DIR = path.resolve(__dirname, "../../.hands");

/**
 * JARVIS working on your laptop (no orb): asks JARVIS for laptop jobs ("open
 * Excel and…", "in Chrome, search…"), and does them step by step on the
 * screen with the "JARVIS is working" frame, a bar with Stop, ripples where it
 * clicks, and a Yes / No question before anything risky.
 */

/**
 * JARVIS's hands on Windows: hands.cs, built on this PC with Windows' own C#
 * compiler (csc.exe from .NET Framework 4, part of Windows) the first time —
 * and again only when the code changes. Antivirus software blocks a
 * PowerShell script that clicks, types and reads the screen, so this is a
 * normal small program instead (and much faster: it stays running).
 */
export function buildHands({ platform = process.platform, exec = execFileSync, env = process.env } = {}) {
  if (platform !== "win32") return null;
  const hash = createHash("sha1").update(fs.readFileSync(HANDS_CS)).digest("hex").slice(0, 10);
  const exe = path.join(HANDS_DIR, `jarvis-hands-${hash}.exe`);
  if (fs.existsSync(exe)) return exe;
  fs.mkdirSync(HANDS_DIR, { recursive: true });
  const win = env.WINDIR || env.SystemRoot || "C:\\Windows";
  const fw = ["Framework64", "Framework"].map((f) => path.join(win, "Microsoft.NET", f, "v4.0.30319")).find((d) => fs.existsSync(path.join(d, "csc.exe")));
  if (!fw) throw new Error("Windows' C# compiler (csc.exe, part of .NET Framework 4) wasn't found on this PC.");
  const csc = path.join(fw, "csc.exe");
  const base = ["/nologo", "/target:winexe", "/optimize+", `/out:${exe}`, "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll"];
  const uia = ["/define:UIA", ...["UIAutomationClient.dll", "UIAutomationTypes.dll", "WindowsBase.dll"].map((d) => `/r:${path.join(fw, "WPF", d)}`)];
  log.info("[hands] building JARVIS's hands for this PC (once)…");
  try { exec(csc, [...base, ...uia, HANDS_CS], { windowsHide: true, stdio: "pipe" }); }
  catch (e) {
    log.warn(`[hands] couldn't build with screen reading (${String(e.stdout || e.message).replace(/\s+/g, " ").slice(0, 500)}) — building without it`);
    exec(csc, [...base, HANDS_CS], { windowsHide: true, stdio: "pipe" });
  }
  for (const f of fs.readdirSync(HANDS_DIR)) if (f !== path.basename(exe) && f.endsWith(".exe")) { try { fs.rmSync(path.join(HANDS_DIR, f)); } catch { /* in use */ } }
  log.info("[hands] ready.");
  return exe;
}

/** Overlay commands are one line each, tab separated: text can't break out of its field. Pure (tested). */
export const overlayLine = (...parts) => parts.map((p) => String(p ?? "").replace(/[\t\r\n]+/g, " ").slice(0, 300)).join("\t") + "\n";

/** The "JARVIS is working" frame + bar (Windows). Elsewhere: quiet no-ops, and risky steps are refused. */
export function createOverlay({ onStop = () => {}, platform = process.platform, spawnImpl = spawn, build = buildHands } = {}) {
  let p = null, buf = "", n = 0, broken = null;
  const waiting = new Map(), shots = new Map(), ops = new Map();
  const start = () => {
    if (platform !== "win32") return null;
    if (p && p.exitCode === null) return p;
    let exe;
    try { exe = build(); broken = null; } catch (e) { broken = `JARVIS couldn't build its hands on this PC: ${String(e.stdout || e.message).replace(/\s+/g, " ").slice(0, 300)}`; log.warn(`[hands] ${broken}`); return null; }
    p = spawnImpl(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    p.on("error", (e) => { broken = `JARVIS's hands didn't start: ${e.message}`; log.warn(`[hands] ${broken}`); });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const parts = buf.slice(0, i).trim().split("\t"); buf = buf.slice(i + 1);
        const [ev, id, ans] = parts;
        if (ev === "stop") onStop?.();
        if (ev === "answer" && waiting.has(id)) { waiting.get(id)(ans === "yes"); waiting.delete(id); }
        if (ev === "res" && ops.has(id)) {
          const r = ops.get(id); ops.delete(id);
          let v; try { v = JSON.parse(parts.slice(2).join("\t")); } catch { v = { ok: false, error: "garbled answer from JARVIS's hands" }; }
          r(v);
        }
        if ((ev === "shot" || ev === "shoterr") && shots.has(id)) {
          const r = shots.get(id); shots.delete(id);
          r(ev === "shot" ? { ok: true, data: parts[5], w: Number(parts[2]), h: Number(parts[3]), factor: Number(parts[4]) } : { ok: false, error: parts[2] || "screenshot failed" });
        }
      }
    });
    p.stderr.on("data", (d) => log.warn(`[hands] ${String(d).trim().slice(0, 200)}`));
    p.on("exit", () => { p = null; for (const r of waiting.values()) r(false); waiting.clear(); for (const r of shots.values()) r({ ok: false, error: "the overlay closed" }); shots.clear(); for (const r of ops.values()) r({ ok: false, error: "JARVIS's hands closed" }); ops.clear(); });
    return p;
  };
  const send = (...parts) => { const q = start(); if (q) q.stdin.write(overlayLine(...parts)); };
  return {
    show: (text) => send("show", text || ""),
    hide: () => send("hide"),
    ripple: (x, y) => send("ripple", Math.round(x), Math.round(y)),
    /** Yes / No on the bar; no answer within 2 minutes = no. */
    ask: (question, detail) => new Promise((resolve) => {
      if (!start()) return resolve(false);
      const id = `q${++n}`;
      const t = setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); send("hide"); resolve(false); } }, 120_000);
      waiting.set(id, (v) => { clearTimeout(t); resolve(v); });
      send("ask", id, question, detail || "");
    }),
    /** One action (screenshot, input, uia, open-app, phone-…): the answer, or why not. */
    op: (a) => new Promise((resolve) => {
      if (!start()) return resolve({ ok: false, error: broken || "Laptop control works on Windows only." });
      const id = `o${++n}`;
      const t = setTimeout(() => { if (ops.has(id)) { ops.delete(id); resolve({ ok: false, error: `JARVIS's hands didn't answer (${a.op})` }); } }, a.op === "phone-dial" ? 30_000 : 20_000);
      ops.set(id, (v) => { clearTimeout(t); resolve(v); });
      try { p.stdin.write(`op\t${id}\t${JSON.stringify(a)}\n`); } catch (e) { ops.delete(id); clearTimeout(t); resolve({ ok: false, error: e.message }); }
    }),
    /** A screenshot taken by the overlay process (fast; no PowerShell start-up each step). */
    shot: () => new Promise((resolve) => {
      if (!start()) return resolve({ ok: false, error: "not on Windows" });
      const id = `s${++n}`;
      const t = setTimeout(() => { if (shots.has(id)) { shots.delete(id); resolve({ ok: false, error: "the overlay didn't send a screenshot within 15 s" }); } }, 15_000);
      shots.set(id, (v) => { clearTimeout(t); resolve(v); });
      send("shot", id);
    }),
    close: () => { if (p) { try { p.stdin.write("exit\n"); } catch { /* gone */ } } },
  };
}

// one hands process for everything on this laptop (laptop control and calls)
let shared = null;
const stopHandlers = new Set();
export function hands() { return (shared ??= createOverlay({ onStop: () => { for (const f of stopHandlers) f(); } })); }
export const onHandsStop = (f) => { stopHandlers.add(f); };
/** A Windows action, done by JARVIS's hands (kept under this name for the callers). */
export const runWinPs = (a) => hands().op(a);

export class DesktopWorker {
  constructor({ pollMs = 3000, fetchImpl = fetch, ps = runWinPs, overlay = null, platform = process.platform } = {}) {
    this.pollMs = pollMs; this.fetch = fetchImpl; this.ps = ps; this.platform = platform; this.timer = null; this.busy = false; this.warned = "";
    this.overlay = overlay ?? hands();
    if (!overlay) onHandsStop(() => this.stop());
    this.computer = createComputer({
      capture: () => this.capture(),
      elements: (f) => this.elements(f),
      act: (b) => this.api("/api/desktop/act", b),
      report: (id, b) => this.api("/api/desktop/tasks", { action: "report", id, ...b }),
      input: (a) => this.ps({ op: "input", ...a }),
      openApp: (name) => this.ps({ op: "open-app", app: String(name).slice(0, 80) }),
      confirm: (q, detail) => this.overlay.ask(q, detail),
      label: (t) => { if (t) this.overlay.show(t); else this.overlay.hide(); },
      ripple: (x, y) => this.overlay.ripple(x, y),
      onStep: (s) => log.info(`[desktop] ${s.n}. ${s.say} (${s.action})`),
    });
  }

  start() {
    if (this.platform !== "win32") { log.info("[desktop] Laptop control works on Windows — skipped here."); return; }
    const loop = async () => { await this.poll().catch((e) => this.warn(`[desktop] ${e.message}`)); this.timer = setTimeout(loop, this.pollMs); };
    this.timer = setTimeout(loop, 2500);
    log.info("[desktop] Laptop control is ready — ask JARVIS to open an app or do something on the screen.");
  }
  stopLoop() { clearTimeout(this.timer); this.overlay.close(); }
  /** Stop on the bar, Ctrl+Alt+Backspace, or JARVIS's Stop. */
  stop() { this.computer.stop(); }
  warn(m) { if (this.warned !== m) { this.warned = m; log.warn(m); } }

  async api(p, body) {
    const link = this.link ?? readLink();
    if (!link) throw new Error("This laptop isn't connected to JARVIS yet — press \"Connect this laptop\" in JARVIS → CRM.");
    const r = await this.fetch(`${link.url}${p}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${link.token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.error || `JARVIS answered ${r.status}`);
    return j.data;
  }

  async capture() {
    const r = await this.ps({ op: "screenshot" });
    if (!r?.ok || !r.data) return { ok: false, error: r?.error || "no screenshot" };
    return { ok: true, dataUrl: `data:image/jpeg;base64,${r.data}`, w: r.w, h: r.h, factor: Number(r.factor) || 1 };
  }

  /** Clickable things in the window in front, in screenshot pixels. */
  async elements(factor = 1) {
    const list = await this.ps({ op: "uia" });
    if (!Array.isArray(list)) return [];
    return list.map((e, i) => ({ id: i + 1, name: String(e.name || ""), role: String(e.role || ""), x: Math.round(e.x / factor), y: Math.round(e.y / factor), w: Math.round(e.w / factor), h: Math.round(e.h / factor), password: !!e.password }));
  }

  async poll() {
    if (this.busy || this.computer.busy()) return;
    this.link = readLink();
    if (!this.link) { this.warn("[desktop] This laptop isn't connected to JARVIS, so laptop jobs can't reach it — open JARVIS → CRM → Google Maps finder → \"Connect this laptop\"."); return; }
    const { task } = await this.api("/api/desktop/tasks", { action: "next" });
    this.warned = "";
    if (!task) return;
    this.busy = true;
    log.info(`[desktop] job on ${os.hostname()}: ${task.goal}`);
    try { const r = await this.computer.run(task); log.info(`[desktop] ${r.status}: ${r.say}`); }
    finally { this.busy = false; }
  }
}
