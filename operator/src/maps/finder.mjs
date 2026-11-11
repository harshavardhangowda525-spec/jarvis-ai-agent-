import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../log.mjs";
import { readListing, readFeed } from "./extract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
/** Written by JARVIS when you press "Connect this laptop" (same PC), or set JARVIS_URL + JARVIS_FINDER_TOKEN in operator/.env. */
export const LINK_FILE = path.join(ROOT, ".finder.json");
const SHOTS = path.join(ROOT, "screenshots");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Manual 4.4: random 3–8 s pauses between listings. */
export const pause = (min = 3000, max = 8000) => sleep(min + Math.random() * (max - min));
export const BLOCKED = /unusual traffic|not a robot|captcha|\/sorry\//i;

export function readLink(env = process.env) {
  if (env.JARVIS_URL && env.JARVIS_FINDER_TOKEN) return { url: env.JARVIS_URL.replace(/\/+$/, ""), token: env.JARVIS_FINDER_TOKEN.trim() };
  try { const j = JSON.parse(fs.readFileSync(LINK_FILE, "utf8")); if (j.url && j.token) return { url: String(j.url).replace(/\/+$/, ""), token: String(j.token) }; } catch { /* not connected yet */ }
  return null;
}

/**
 * The Google Maps lead finder. Asks JARVIS for the next search, runs it in the
 * operator's visible browser (with the "JARVIS is working" label), and sends
 * every listing back — JARVIS decides what goes in the CRM.
 *
 * Never solves or works around a CAPTCHA: it stops, saves a screenshot and
 * tells JARVIS ("blocked").
 */
/** Move a page's browser window (Chrome DevTools Protocol). */
export async function placeWindow(ctx, page, bounds) {
  const cs = await ctx.newCDPSession(page);
  const { windowId } = await cs.send("Browser.getWindowForTarget");
  await cs.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  await cs.send("Browser.setWindowBounds", { windowId, bounds });
  await cs.detach().catch(() => {});
}

export class MapsFinder {
  constructor({ mgr, pollMs = 20_000, fetchImpl = fetch, pauseFn = pause } = {}) {
    this.mgr = mgr; this.pollMs = pollMs; this.fetch = fetchImpl; this.pause = pauseFn;
    this.busy = false; this.timer = null; this.stopFlag = false; this.warned = false;
  }

  async call(link, body) {
    const r = await this.fetch(`${link.url}/api/prospects/finder/device`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${link.token}` },
      body: JSON.stringify({ device: `${os.hostname()} (${process.platform})`, ...body }), signal: AbortSignal.timeout(30_000),
    });
    const j = await r.json().catch(() => null);
    if (r.status === 401) throw Object.assign(new Error(j?.error || "Not paired"), { unpaired: true });
    if (!r.ok || !j?.ok) throw new Error(j?.error || `JARVIS answered ${r.status}`);
    return j.data;
  }

  start() {
    const loop = async () => { await this.poll().catch((e) => log.warn(`[maps] ${e.message}`)); this.timer = setTimeout(loop, this.pollMs); };
    this.timer = setTimeout(loop, 1500);
    log.info("[maps] Google Maps finder is on — waiting for searches from JARVIS.");
  }
  stopLoop() { clearTimeout(this.timer); }
  /** The Stop button on the page / JARVIS asked to stop. */
  stop() { this.stopFlag = true; }

  async poll() {
    if (this.busy) return;
    const link = readLink();
    if (!link) { if (!this.warned) { this.warned = true; log.info("[maps] Not connected to JARVIS yet — press \"Connect this laptop\" in JARVIS → CRM."); } return; }
    let next;
    try { next = await this.call(link, { action: "next" }); }
    catch (e) { if (e.unpaired) { if (!this.warned) { this.warned = true; log.warn("[maps] JARVIS says this laptop isn't connected — press \"Connect this laptop\" in JARVIS → CRM."); } return; } throw e; }
    this.warned = false;
    if (!next?.search) return;
    this.busy = true;
    try { await this.run(link, next.search); } finally { this.busy = false; }
  }

  async run(link, s) {
    this.stopFlag = false;
    const label = this.mgr.label;
    const status = (st, text, error) => this.call(link, { action: "status", searchId: s.id, status: st, text, error }).catch(() => ({}));
    log.info(`[maps] Searching Google Maps: ${s.query} (up to ${s.limit} new leads)`);
    let page;
    try {
      await this.mgr.launch();
      page = await this.mgr.context.newPage();
      await page.bringToFront().catch(() => {});
      await label.on(`Searching Google Maps: ${s.query}`);
      // Google Maps on the left half, JARVIS's live CRM on the right half
      if (process.env.OPERATOR_SIDE_BY_SIDE !== "off") await this.sideBySide(page, link).catch((e) => log.warn(`[maps] couldn't place the windows side by side: ${e.message}`));
      await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(s.query)}?hl=en`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await this.consent(page);
      if (await this.blocked(page)) return await this.block(page, s, status);

      // 1. the result list: scroll it until there are enough places (or it ends)
      const want = Math.min(120, s.limit * 4);
      const feed = await this.collect(page, want);
      if (await this.blocked(page)) return await this.block(page, s, status);
      if (!feed.length) { await status("done", "Google Maps found nothing for that search."); return; }
      const known = new Set((await this.call(link, { action: "known", searchId: s.id, placeIds: feed.map((f) => f.placeId).filter(Boolean) })).known ?? []);
      const todo = feed.filter((f) => !f.placeId || !known.has(f.placeId));
      await status("running", `${feed.length} places listed, ${todo.length} not in the CRM yet.`);

      // 2. open each listing like a person would, read it, hand it to JARVIS
      let i = 0;
      for (const f of todo) {
        if (this.stopFlag || this.mgr.stopped) { await status("stopped", "Stopped."); return; }
        i++;
        await label.on(`Google Maps (${i}/${todo.length}): ${f.name}`);
        await page.goto(f.href.includes("?") ? `${f.href}&hl=en` : `${f.href}?hl=en`, { waitUntil: "domcontentloaded", timeout: 45_000 });
        if (await this.blocked(page)) return await this.block(page, s, status);
        await page.waitForSelector('[role="main"] h1', { timeout: 20_000 }).catch(() => {});
        await label.fx(page, { type: "scan", on: true });
        await sleep(1200);
        const l = await page.evaluate(readListing).catch(() => null);
        await label.fx(page, { type: "scan", on: false });
        if (!l?.name) continue;
        if (l.reviews == null && f.reviews != null) l.reviews = f.reviews;
        if (l.rating == null && f.rating != null) l.rating = f.rating;
        l.mapsUrl = l.mapsUrl || f.href;
        const r = await this.call(link, { action: "listing", searchId: s.id, listing: l });
        log.info(`[maps]  ${r.added ? "+ added" : r.kept ? "= already in CRM" : "- skipped"}: ${l.name}${r.reason ? ` (${r.reason})` : ""}`);
        await label.fx(page, r.added ? { type: "added", name: l.name, score: r.score, detail: r.signal ?? undefined } : { type: r.kept ? "dup" : "skipped", name: l.name, detail: r.reason });
        if (r.stop) { await status("stopped", "Stopped."); return; }
        if (r.done) break;
        await this.pause();
      }
      await status("done", "Finished.");
    } catch (e) {
      log.error(`[maps] ${e.message}`);
      await status("failed", null, e.message.slice(0, 400));
    } finally {
      await label.off();
      await page?.close().catch(() => {});
      this.mgr.reset();
    }
  }

  /** Google Maps on the left half of the screen, JARVIS's live CRM window (opened once, reused) on the right. */
  async sideBySide(mapsPage, link) {
    const ctx = this.mgr.context;
    const scr = await mapsPage.evaluate(() => ({ w: screen.availWidth, h: screen.availHeight, l: screen.availLeft || 0, t: screen.availTop || 0 }));
    const half = Math.round(scr.w / 2);
    if (!this.livePage || this.livePage.isClosed()) {
      const opened = ctx.waitForEvent("page", { timeout: 15_000 });
      const cs = await ctx.newCDPSession(mapsPage);
      await cs.send("Target.createTarget", { url: `${link.url}/live/maps`, newWindow: true });
      this.livePage = await opened;
      await this.livePage.waitForLoadState("domcontentloaded").catch(() => {});
      // hand it the token by message (never in the address bar), until it says it has it
      for (let i = 0; i < 30; i++) {
        const got = await this.livePage.evaluate((t) => { window.postMessage({ jarvisLiveToken: t }, location.origin); try { return !!sessionStorage.getItem("jarvis-live-token"); } catch { return false; } }, link.token).catch(() => false);
        if (got) break;
        await sleep(500);
      }
    }
    await placeWindow(ctx, mapsPage, { left: scr.l, top: scr.t, width: half, height: scr.h });
    await placeWindow(ctx, this.livePage, { left: scr.l + half, top: scr.t, width: scr.w - half, height: scr.h });
    await mapsPage.bringToFront().catch(() => {});
  }

  /** Google's cookie screen (EU-style): choose "Reject all" (else "Accept all") so the search can load. */
  async consent(page) {
    if (!/consent\.google\./.test(page.url())) return;
    const b = page.getByRole("button", { name: /reject all/i }).or(page.getByRole("button", { name: /accept all/i })).first();
    await b.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  async blocked(page) {
    if (BLOCKED.test(page.url())) return true;
    const t = await page.evaluate(() => (document.body?.innerText || "").slice(0, 3000)).catch(() => "");
    return /unusual traffic from your computer|I'm not a robot/i.test(t) || !!(await page.$('iframe[src*="recaptcha"]').catch(() => null));
  }

  async block(page, s, status) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const file = path.join(SHOTS, `captcha-${Date.now()}.png`);
    await page.screenshot({ path: file }).catch(() => {});
    log.warn(`[maps] Google showed a CAPTCHA / unusual-traffic page — stopped (screenshot: ${file}).`);
    await status("blocked", "Stopped: Google asked for a CAPTCHA.", `Google showed a CAPTCHA / "unusual traffic" page. JARVIS stopped and didn't touch it. Screenshot on the laptop: ${file}. Try again later.`);
  }

  async collect(page, want) {
    await page.waitForSelector('div[role="feed"], [role="main"] h1', { timeout: 25_000 }).catch(() => {});
    // a single exact match opens the place directly
    if (!(await page.$('div[role="feed"]'))) {
      const l = await page.evaluate(readListing).catch(() => null);
      return l?.name ? [{ name: l.name, href: page.url(), placeId: null }] : [];
    }
    let items = [], same = 0;
    for (let round = 0; round < 40 && items.length < want; round++) {
      const before = items.length;
      items = await page.evaluate(readFeed);
      const end = await page.evaluate(() => /reached the end of the list/i.test(document.querySelector('div[role="feed"]')?.innerText || ""));
      if (end) break;
      same = items.length === before ? same + 1 : 0;
      if (same >= 3) break;
      await page.evaluate(() => { const f = document.querySelector('div[role="feed"]'); if (f) f.scrollBy(0, f.clientHeight * 0.9); });
      await sleep(1200 + Math.random() * 1200);
    }
    return items.slice(0, want);
  }
}
