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
 * WhatsApp calls by sight: Windows can't see inside WhatsApp's window (it's a web page), so JARVIS opens the
 * chat, takes a screenshot, asks its vision AI where the voice-call button is, and clicks it — like a person.
 * Pure over `ops` (the laptop's hands) and `look` (the vision AI on JARVIS's server). Tested.
 */
export function waDriver({ ops, look, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const shot = async () => {
    const s = await ops({ op: "screenshot" });
    return s?.ok && s.data ? { image: `data:image/jpeg;base64,${s.data}`, screen: { w: s.w, h: s.h }, factor: Number(s.factor) || 1 } : { error: s?.error || "no screenshot" };
  };
  const click = (p, s) => ops({ op: "input", kind: "click", x: Math.round(p.x * s.factor), y: Math.round(p.y * s.factor) });
  const CALL_BTN = "the voice call button — a phone handset icon — in the top-right of the open WhatsApp chat's header (NOT the video camera icon)";
  const CONFIRM = "a button that starts the voice call in a WhatsApp dialog or menu (e.g. 'Voice call', 'Call', 'Start call'), if one is showing";
  const CALLING = "Is a WhatsApp voice call being placed or in progress on this screen — a 'Calling…' / 'Ringing…' screen, or a call window with a red end-call button?";
  const END_BTN = "the red end-call (hang up) button of the WhatsApp call";
  return {
    async dial(to) {
      const o = await ops({ op: "wa-open", to });
      if (!o?.ok) return o;
      await sleep(2500);
      let clicked = 0;
      for (let round = 0; round < 6; round++) {
        const s = await shot();
        if (s.error) return { ok: false, error: `I couldn't see the screen: ${s.error}` };
        if (clicked) {
          const st = await look({ image: s.image, screen: s.screen, question: CALLING });
          if (st.answer === true) return { ok: true };
          const c = await look({ image: s.image, screen: s.screen, find: CONFIRM });
          if (c.found) { await click(c, s); await sleep(2500); continue; }
        }
        if (clicked >= 2) { await sleep(2000); continue; }
        const f = await look({ image: s.image, screen: s.screen, find: CALL_BTN });
        if (!f.found) {
          if (clicked) { await sleep(2000); continue; }
          return { ok: false, error: `I opened the chat in WhatsApp but couldn't spot its voice-call button on the screen${f.note ? ` (I see: ${f.note})` : ""}. Is this number on WhatsApp?` };
        }
        await click(f, s); clicked++;
        await sleep(3000);
      }
      return clicked ? { ok: false, error: "I clicked WhatsApp's call button but no call started." } : { ok: false, error: "I couldn't start the WhatsApp call." };
    },
    /** Windows can't see WhatsApp's call screen, so "unknown" — the conversation itself tells when it's over. */
    async state() { return { ok: false, error: "can't tell" }; },
    async hangup() {
      const s = await shot();
      if (s.error) return { ok: false, error: s.error };
      const f = await look({ image: s.image, screen: s.screen, find: END_BTN });
      if (!f.found) return { ok: true, pressed: false };
      await click(f, s);
      return { ok: true, pressed: true };
    },
  };
}

/**
 * Phone controls for the calling page (Phone Link or WhatsApp Desktop). Pure over `runPs` (tested).
 * @param {{ platform?: string, runPs?: (a: Record<string, unknown>) => Promise<any>, sim?: boolean, via?: () => string, wa?: { dial: (to: string) => Promise<any>, state: () => Promise<any>, hangup: () => Promise<any> } | null }} [o]
 */
export function phoneBridge({ platform = process.platform, runPs = runWinPs, sim = false, via = () => "phonelink", wa = null } = {}) {
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
    if (v === "whatsapp" && wa && op === "state") return wa.state();
    if (v === "whatsapp" && wa && op === "hangup") return wa.hangup();
    if (op === "state") return runPs({ op: "phone-state", via: v });
    if (op === "hangup") return runPs({ op: "phone-hangup", via: v });
    if (op === "working") return { ok: true }; // the calling window shows what's happening itself
    if (op === "dial") {
      const n = String(arg || "").replace(/[^\d+]/g, "");
      if (!/^\+?\d{8,15}$/.test(n)) return { ok: false, error: "That number isn't dialable." };
      log.info(`[calls] dialling ${n.slice(0, -4).replace(/\d/g, "•")}${n.slice(-4)} (${v === "whatsapp" ? "WhatsApp" : "Phone Link"})`);
      if (v === "whatsapp" && wa) return wa.dial(n);
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
    const wa = waDriver({ ops: runWinPs, look: (b) => this.look(b) });
    this.phone = phone ?? phoneBridge({ runPs: runWinPs, sim: process.env.OPERATOR_CALLS_SIM === "1", via: () => this.via, wa });
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

  /** Ask JARVIS's vision AI about the screen (laptop key). */
  async look(body) {
    const link = readLink();
    if (!link) return { found: false, answer: null, note: "not connected" };
    try {
      const r = await this.fetch(`${link.url}/api/desktop/look`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${link.token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { log.warn(`[calls] look failed: ${j?.error ?? r.status}`); return { found: false, answer: null, note: j?.error ?? `JARVIS answered ${r.status}` }; }
      return j.data;
    } catch (e) { return { found: false, answer: null, note: e.message }; }
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
      if (String(op) === "front") { await this.toFront(); return { ok: true }; }
      return this.phone(String(op), arg == null ? null : String(arg));
    });
    this.ctx.on("close", () => { this.ctx = null; this.page = null; });
    this.page = this.ctx.pages()[0] || (await this.ctx.newPage());
    this.page.on("close", () => { void this.phone("hangup").catch(() => {}); });
    await this.page.goto(`${link.url}/calls/live?auto=1`, { waitUntil: "domcontentloaded" }).catch((e) => this.warn(`[calls] ${e.message}`));
    await this.dock().catch(() => {});
  }

  /** Keep the Calls window on the right side of the screen (next to WhatsApp / Phone Link). */
  async dock() {
    if (!this.isOpen() || !this.ctx?.newCDPSession) return;
    const s = await this.page.evaluate(() => ({ w: screen.availWidth, h: screen.availHeight, x: screen.availLeft || 0, y: screen.availTop || 0 }));
    const width = Math.min(520, Math.round(s.w * 0.36));
    const cs = await this.ctx.newCDPSession(this.page);
    const { windowId } = await cs.send("Browser.getWindowForTarget");
    await cs.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await cs.send("Browser.setWindowBounds", { windowId, bounds: { left: s.x + s.w - width, top: s.y, width, height: s.h } });
    await cs.detach().catch(() => {});
  }

  /** A call started: show the Calls window (live conversation) in front, on the right. */
  async toFront() {
    if (!this.isOpen()) return;
    await this.dock().catch(() => {});
    await this.page.bringToFront().catch(() => {});
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
