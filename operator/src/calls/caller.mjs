import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { log } from "../log.mjs";
import { readLink } from "../maps/finder.mjs";
import { runWinPs } from "../desktop/worker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

export const CALLS_PROFILE = path.join(ROOT, ".calls-profile");

/**
 * JARVIS's calls, run by JARVIS's own helper (no orb). When calling is
 * switched on (calls to you through the laptop, or calling leads), it opens a
 * small "JARVIS — Calls" window by itself, signed in with this laptop's JARVIS
 * key, which dials through Phone Link or WhatsApp Desktop, talks through the
 * virtual cable and listens to the speakers. Switched off → the window closes (never mid-call).
 *
 * The window is a separate browser profile that only ever loads JARVIS's own
 * pages: it is the only one allowed to use the microphone / hear the
 * speakers, so no website you browse can.
 */

/**
 * Phone controls for the calling page (Phone Link or WhatsApp Desktop). Pure over `runPs` (tested).
 * @param {{ platform?: string, runPs?: (a: Record<string, unknown>) => Promise<any>, sim?: boolean, via?: () => string }} [o]
 */
export function phoneBridge({ platform = process.platform, runPs = runWinPs, sim = false, via = () => "phonelink" } = {}) {
  let simInCall = false;
  return async (op, arg) => {
    if (sim) {
      if (op === "check") return { ok: true, installed: true, running: true, cable: true, simulated: true };
      if (op === "dial") { simInCall = true; return { ok: true, simulated: true }; }
      if (op === "hangup") { simInCall = false; return { ok: true, pressed: true }; }
      if (op === "state") return { ok: true, inCall: simInCall };
      if (op === "working") return { ok: true };
      return { ok: false, error: "Unknown phone action." };
    }
    if (platform !== "win32") return { ok: false, error: "Calls go through Phone Link or WhatsApp Desktop, which run on Windows only." };
    const v = via() === "whatsapp" ? "whatsapp" : "phonelink";
    if (op === "check") return runPs({ op: "phone-check", via: v });
    if (op === "state") return runPs({ op: "phone-state", via: v });
    if (op === "hangup") return runPs({ op: "phone-hangup", via: v });
    if (op === "working") return { ok: true }; // the calling window shows what's happening itself
    if (op === "dial") {
      const n = String(arg || "").replace(/[^\d+]/g, "");
      if (!/^\+?\d{8,15}$/.test(n)) return { ok: false, error: "That number isn't dialable." };
      log.info(`[calls] dialling ${n.slice(0, -4).replace(/\d/g, "•")}${n.slice(-4)} (${v === "whatsapp" ? "WhatsApp" : "Phone Link"})`);
      return runPs({ op: "phone-dial", to: n, via: v });
    }
    return { ok: false, error: "Unknown phone action." };
  };
}

/** Requests from the calling window: only JARVIS's own site; its API calls carry this laptop's key. Pure (tested). */
export function routeDecision(reqUrl, link, isNavigation) {
  let u;
  try { u = new URL(reqUrl); } catch { return { action: "abort" }; }
  if (u.protocol === "data:" || u.protocol === "blob:") return { action: "continue" };
  const origin = new URL(link.url).origin;
  if (u.origin !== origin) return { action: "abort", why: isNavigation ? "navigation away from JARVIS" : "outside JARVIS" };
  if (u.pathname.startsWith("/api/")) return { action: "continue", headers: { authorization: `Bearer ${link.token}` } };
  return { action: "continue" };
}

export class CallsWindow {
  constructor({ pollMs = 30_000, fetchImpl = fetch, phone = null, launch = launchCallsBrowser } = {}) {
    this.pollMs = pollMs; this.fetch = fetchImpl; this.launch = launch; this.via = "phonelink";
    this.phone = phone ?? phoneBridge({ runPs: runWinPs, sim: process.env.OPERATOR_CALLS_SIM === "1", via: () => this.via });
    this.ctx = null; this.page = null; this.timer = null; this.busy = false; this.warned = "";
  }

  start() {
    const loop = async () => { await this.poll().catch((e) => this.warn(`[calls] ${e.message}`)); this.timer = setTimeout(loop, this.pollMs); };
    this.timer = setTimeout(loop, 4000);
    log.info("[calls] JARVIS's calling is on standby — the calls window opens by itself when calling is switched on.");
  }
  stopLoop() { clearTimeout(this.timer); }
  warn(m) { if (this.warned !== m) { this.warned = m; log.warn(m); } }

  async wanted(link) {
    const r = await this.fetch(`${link.url}/api/calls/device`, { headers: { Authorization: `Bearer ${link.token}` }, signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => null);
    if (r.status === 401) throw new Error("This laptop isn't connected to JARVIS yet — press \"Connect this laptop\" in JARVIS → CRM.");
    if (!r.ok || !j?.ok) throw new Error(j?.error || `JARVIS answered ${r.status}`);
    return j.data;
  }

  isOpen() { return !!this.page && !this.page.isClosed(); }

  async poll() {
    if (this.busy) return;
    const link = readLink();
    if (!link) return;
    this.busy = true;
    try {
      const w = await this.wanted(link);
      this.warned = "";
      if (w.via) this.via = w.via;
      if (w.on && !this.isOpen()) await this.open(link);
      else if (!w.on && this.isOpen()) {
        const s = await this.phone("state").catch(() => null);
        if (!s?.inCall) await this.close("calling was switched off");
      }
    } finally { this.busy = false; }
  }

  async open(link) {
    await this.close();
    log.info("[calls] opening JARVIS's calls window");
    this.ctx = await this.launch();
    const origin = new URL(link.url).origin;
    await this.ctx.grantPermissions(["microphone"], { origin }).catch(() => {});
    await this.ctx.route("**/*", (route) => {
      const req = route.request();
      const d = routeDecision(req.url(), link, req.isNavigationRequest());
      if (d.action === "abort") return route.abort();
      return route.continue(d.headers ? { headers: { ...req.headers(), ...d.headers } } : undefined);
    });
    // the phone controls, only for JARVIS's own page
    await this.ctx.exposeBinding("__jarvisPhone", async (src, op, arg) => {
      try { if (new URL(src.frame.url()).origin !== origin) return { ok: false, error: "Not JARVIS." }; } catch { return { ok: false }; }
      return this.phone(String(op), arg == null ? null : String(arg));
    });
    this.ctx.on("close", () => { this.ctx = null; this.page = null; });
    this.page = this.ctx.pages()[0] || (await this.ctx.newPage());
    this.page.on("close", () => { void this.phone("hangup").catch(() => {}); });
    await this.page.goto(`${link.url}/calls/live?auto=1`, { waitUntil: "domcontentloaded" }).catch((e) => this.warn(`[calls] ${e.message}`));
  }

  async close(why) {
    if (why) log.info(`[calls] closing the calls window (${why})`);
    const c = this.ctx; this.ctx = null; this.page = null;
    if (c) await c.close().catch(() => {});
  }
}

/** A small window of its own (separate profile) that may hear the speakers and use the cable. */
export async function launchCallsBrowser() {
  const opts = {
    headless: false, viewport: null, ignoreDefaultArgs: ["--mute-audio", "--enable-automation"],
    args: [
      "--app=about:blank", "--window-size=480,780", "--window-position=40,40",
      "--autoplay-policy=no-user-gesture-required",
      // hearing the call: the speakers' sound, picked without a prompt (this profile only ever opens JARVIS)
      "--auto-select-desktop-capture-source=Entire screen", "--use-fake-ui-for-media-stream",
    ],
  };
  if (process.env.OPERATOR_CHROME_PATH) return chromium.launchPersistentContext(CALLS_PROFILE, { ...opts, executablePath: process.env.OPERATOR_CHROME_PATH });
  let last;
  for (const channel of ["chrome", "msedge", undefined]) {
    try { return await chromium.launchPersistentContext(CALLS_PROFILE, channel ? { ...opts, channel } : opts); } catch (e) { last = e; }
  }
  throw last;
}
