import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { log } from "../log.mjs";
import { readLink } from "../maps/finder.mjs";
import { createComputer } from "./computer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WIN_PS = path.join(__dirname, "win.ps1");
const OVERLAY_PS = path.join(__dirname, "overlay.ps1");

/**
 * JARVIS working on your laptop (no orb): asks JARVIS for laptop jobs ("open
 * Excel and…", "in Chrome, search…"), and does them step by step on the
 * screen with the "JARVIS is working" frame, a bar with Stop, ripples where it
 * clicks, and a Yes / No question before anything risky.
 */

/** One fixed Windows operation (win.ps1; the action goes in as data, never as script text). */
export function runWinPs(a) {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", WIN_PS],
      { env: { ...process.env, JARVIS_ORB_ARGS: JSON.stringify(a) }, timeout: 45_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = String(stdout || "").trim().replace(/^﻿/, "");
        try { resolve(JSON.parse(out.split(/\r?\n/).pop() || "null") ?? { ok: false, error: "Windows didn't answer." }); }
        catch { resolve({ ok: false, error: String(stderr || err?.message || "Windows didn't answer").trim().slice(0, 200) }); }
      });
  });
}

/** Overlay commands are one line each, tab separated: text can't break out of its field. Pure (tested). */
export const overlayLine = (...parts) => parts.map((p) => String(p ?? "").replace(/[\t\r\n]+/g, " ").slice(0, 300)).join("\t") + "\n";

/** The "JARVIS is working" frame + bar (Windows). Elsewhere: quiet no-ops, and risky steps are refused. */
export function createOverlay({ onStop = () => {}, platform = process.platform, spawnImpl = spawn } = {}) {
  let p = null, buf = "", n = 0;
  const waiting = new Map();
  const start = () => {
    if (platform !== "win32") return null;
    if (p && p.exitCode === null) return p;
    p = spawnImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", OVERLAY_PS], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const [ev, id, ans] = buf.slice(0, i).trim().split("\t"); buf = buf.slice(i + 1);
        if (ev === "stop") onStop?.();
        if (ev === "answer" && waiting.has(id)) { waiting.get(id)(ans === "yes"); waiting.delete(id); }
      }
    });
    p.stderr.on("data", (d) => log.warn(`[desktop] overlay: ${String(d).trim().slice(0, 200)}`));
    p.on("exit", () => { p = null; for (const r of waiting.values()) r(false); waiting.clear(); });
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
    close: () => { if (p) { try { p.stdin.write("exit\n"); } catch { /* gone */ } } },
  };
}

export class DesktopWorker {
  constructor({ pollMs = 3000, fetchImpl = fetch, ps = runWinPs, overlay = null, platform = process.platform } = {}) {
    this.pollMs = pollMs; this.fetch = fetchImpl; this.ps = ps; this.platform = platform; this.timer = null; this.busy = false; this.warned = "";
    this.overlay = overlay ?? createOverlay({ onStop: () => this.stop(), platform });
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
    if (!this.link) return;
    const { task } = await this.api("/api/desktop/tasks", { action: "next" });
    this.warned = "";
    if (!task) return;
    this.busy = true;
    log.info(`[desktop] job on ${os.hostname()}: ${task.goal}`);
    try { const r = await this.computer.run(task); log.info(`[desktop] ${r.status}: ${r.say}`); }
    finally { this.busy = false; }
  }
}
