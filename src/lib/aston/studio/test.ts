import "server-only";
import http from "node:http";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AstonProject } from "@prisma/client";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { getDb } from "@/lib/db";
import { SITE_CSP } from "./csp";
import { formsRuntime } from "./forms-runtime";
import { FormError, submitForm } from "./forms";
import { siteDir, versionDir } from "./store";
import type { FormSpec, ProjectSpec } from "./spec";

/**
 * ASTON's browser tests. The site is served exactly as the preview serves it
 * (same sandbox rules, the real form handler and database) and driven in a real
 * browser — Microsoft Edge or Google Chrome already on the PC. Every result is
 * something the browser actually observed.
 */

export type Check = { id: string; page?: string; viewport?: string; status: "pass" | "fail" | "warn"; detail: string };
export interface TestReport {
  at: string; browser: string; ms: number; passed: number; failed: number; warnings: number;
  checks: Check[]; screenshots: { page: string; viewport: string; file: string }[];
}
export class BrowserMissing extends Error {}

const VIEWPORTS = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "tablet", width: 834, height: 1112 },
  { id: "mobile", width: 390, height: 844 },
] as const;

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

/** The site, served like the preview, on a private local port. */
async function serve(root: string, token: string) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.startsWith("/api/aston/forms/")) {
      if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
      let body = ""; for await (const c of req) body += c;
      try {
        const r = await submitForm(token, JSON.parse(body || "{}"));
        res.writeHead(200, { "Content-Type": "application/json", ...CORS }); return res.end(JSON.stringify(r));
      } catch (e) {
        const status = e instanceof FormError ? e.status : 500;
        res.writeHead(status, { "Content-Type": "application/json", ...CORS }); return res.end(JSON.stringify({ ok: false, error: e instanceof FormError ? e.message : "Server error" }));
      }
    }
    if (url.pathname === "/_aston/forms.js") {
      const port = (server.address() as { port: number }).port;
      res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(formsRuntime(`http://127.0.0.1:${port}/api/aston/forms/${token}`));
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, rel.endsWith("/") ? `${rel}index.html` : rel);
    const ext = path.extname(file).toLowerCase();
    if (!file.startsWith(root + path.sep) || !TYPES[ext] || !existsSync(file)) { res.writeHead(404, { "Content-Type": "text/html" }); return res.end("<h1>Not found</h1>"); }
    res.writeHead(200, { "Content-Type": TYPES[ext], ...(ext === ".html" ? { "Content-Security-Policy": SITE_CSP } : {}) });
    res.end(await fs.readFile(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Edge or Chrome already installed (ASTON_BROWSER = a path overrides). */
export async function launchBrowser(): Promise<{ browser: Browser; name: string }> {
  const { chromium } = await import("playwright-core");
  const custom = process.env.ASTON_BROWSER?.trim();
  const tries: { name: string; opts: Parameters<typeof chromium.launch>[0] }[] = [
    ...(custom ? [{ name: path.basename(custom), opts: { executablePath: custom } }] : []),
    { name: "Microsoft Edge", opts: { channel: "msedge" } },
    { name: "Google Chrome", opts: { channel: "chrome" } },
    ...["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].filter((p) => existsSync(p)).map((p) => ({ name: "Chromium", opts: { executablePath: p } })),
  ];
  const errors: string[] = [];
  for (const t of tries) {
    try { return { browser: await chromium.launch({ headless: true, ...t.opts }), name: t.name }; }
    catch (e) { errors.push(`${t.name}: ${String((e as Error).message).split("\n")[0]}`); }
  }
  throw new BrowserMissing(`ASTON couldn't open a browser to test the site. Install Microsoft Edge or Google Chrome${os.platform() === "win32" ? " (Edge is normally already on Windows)" : ""}, or set ASTON_BROWSER to a Chromium-based browser's path. (${errors.slice(0, 3).join(" · ")})`);
}

const sample = (f: FormSpec["fields"][number], options: string[]) => {
  switch (f.type) {
    case "email": return "aston-test@example.com";
    case "tel": return "+91 98450 00000";
    case "textarea": return "Automated test by ASTON — please ignore.";
    case "date": return "2099-12-30"; // far future: a test booking never takes a real visitor's slot
    case "time": return "10:30";
    case "number": return "2";
    case "select": return options.find((o) => o) ?? "";
    default: return "ASTON Test";
  }
};

export async function testSite(project: AstonProject, n: number, spec: ProjectSpec, o: { onCheck?: (c: Check) => void; signal?: AbortSignal } = {}): Promise<TestReport> {
  const t0 = Date.now();
  const root = siteDir(project, n);
  const shots = path.join(versionDir(project, n), "tests");
  await fs.mkdir(shots, { recursive: true });
  const checks: Check[] = [];
  const add = (c: Check) => { checks.push(c); o.onCheck?.(c); };
  const screenshots: TestReport["screenshots"] = [];
  const srv = await serve(root, project.previewToken);
  const { browser, name } = await launchBrowser();
  const pages = spec.pages.map((p) => p.file);
  const siteFiles = new Set(pages);
  const ids = new Map<string, Set<string>>();
  const anchors = new Map<string, string[]>();
  try {
    // ── each page at each size ───────────────────────────────────────────────
    for (const vp of VIEWPORTS) {
      if (o.signal?.aborted) throw new Error("Cancelled.");
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      for (const file of pages) {
        const page = await ctx.newPage();
        const errs: string[] = [];
        const bad: string[] = [];
        page.on("pageerror", (e) => errs.push(e.message));
        page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
        page.on("requestfailed", (r) => bad.push(`${r.url()} (${r.failure()?.errorText ?? "failed"})`));
        page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.url()} (HTTP ${r.status()})`); });
        const res = await page.goto(`${srv.base}/${file}`, { waitUntil: "load", timeout: 30_000 }).catch((e) => { errs.push(`load failed: ${(e as Error).message}`); return null; });
        const where = { page: file, viewport: vp.id };
        if (!res || res.status() !== 200) { add({ id: "load", ...where, status: "fail", detail: `${file} didn't load (${res ? `HTTP ${res.status()}` : "no response"}).` }); await page.close(); continue; }
        await page.evaluate(() => document.fonts?.ready).catch(() => {});
        // scroll through like a visitor: scroll reveals and lazy images happen, then back to the top
        await scrollThrough(page);
        if (vp.id !== "tablet") {
          const stuck = await page.evaluate(() => [...document.querySelectorAll("main [data-reveal], main h1, main h2, main p, main img")].filter((e) => {
            const s = getComputedStyle(e); return e.getBoundingClientRect().height > 0 && (Number(s.opacity) < 0.95 || s.visibility === "hidden");
          }).slice(0, 4).map((e) => (e.textContent ?? "").trim().slice(0, 40) || e.tagName.toLowerCase()));
          add({ id: "scroll-reveal", ...where, status: stuck.length ? "fail" : "pass", detail: stuck.length ? `${file} at ${vp.width}px: after scrolling through, content is still hidden: "${stuck.join('", "')}".` : `${file} at ${vp.width}px: all content appears when scrolled to.` });
        }
        if (vp.id === "desktop") {
          // structure, images, fonts, links — once per page
          const info = await page.evaluate(() => {
            const imgs = [...document.images].map((i) => ({ src: i.getAttribute("src") ?? "", ok: i.complete && i.naturalWidth > 0, alt: i.hasAttribute("alt") }));
            const links = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "");
            return {
              title: document.title.trim(), lang: document.documentElement.lang, h1: document.querySelectorAll("h1").length,
              viewport: !!document.querySelector('meta[name="viewport"]'), main: !!document.querySelector("main#main, main"), skip: !!document.querySelector('a[href="#main"]'),
              imgs, links, ids: [...document.querySelectorAll("[id]")].map((e) => e.id),
              fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "")),
            };
          });
          ids.set(file, new Set(info.ids));
          const problems = [!info.title && "no <title>", !info.lang && "no lang on <html>", info.h1 !== 1 && `${info.h1} <h1> elements (should be 1)`, !info.viewport && "no viewport meta", !info.main && "no <main>", !info.skip && "no skip link"].filter(Boolean);
          add({ id: "structure", page: file, status: problems.length ? "fail" : "pass", detail: problems.length ? `${file}: ${problems.join(", ")}.` : `${file}: title, language, one h1, viewport, main and skip link present.` });
          const broken = info.imgs.filter((i) => !i.ok);
          add({ id: "images", page: file, status: broken.length ? "fail" : "pass", detail: broken.length ? `${file}: images didn't load: ${broken.map((i) => i.src).slice(0, 5).join(", ")}.` : `${file}: ${info.imgs.length} image(s) loaded.` });
          const noAlt = info.imgs.filter((i) => !i.alt);
          if (noAlt.length) add({ id: "alt", page: file, status: "fail", detail: `${file}: images without alt text: ${noAlt.map((i) => i.src).slice(0, 5).join(", ")}.` });
          const want = [spec.design.fonts.display.family, spec.design.fonts.body.family];
          const missing = want.filter((f) => !info.fonts.some((l) => l.toLowerCase() === f.toLowerCase()));
          add({ id: "fonts", page: file, status: missing.length ? "warn" : "pass", detail: missing.length ? `${file}: font(s) not loaded: ${missing.join(", ")} (no internet, or not linked).` : `${file}: ${want.join(" + ")} loaded.` });
          const dead = info.links.filter((h) => h === "#" || h === "" || /^javascript:/i.test(h));
          const internal = info.links.filter((h) => !/^(https?:|mailto:|tel:|#|\/\/)/i.test(h) && h).map((h) => h.split("#")[0].split("?")[0]).filter(Boolean);
          const missingPages = [...new Set(internal.filter((h) => /\.html$/.test(h) && !siteFiles.has(h.replace(/^\.\//, ""))))];
          const nonPage = [...new Set(internal.filter((h) => !/\.html$/.test(h)))];
          for (const h of nonPage) { const r = await page.request.get(`${srv.base}/${h.replace(/^\.\//, "")}`).catch(() => null); if (!r || r.status() >= 400) missingPages.push(h); }
          const linkProblems = [...dead.map((h) => `dead link "${h || "(empty)"}"`), ...missingPages.map((h) => `link to missing ${h}`)];
          add({ id: "links", page: file, status: linkProblems.length ? "fail" : "pass", detail: linkProblems.length ? `${file}: ${linkProblems.slice(0, 6).join("; ")}.` : `${file}: ${info.links.length} link(s) point somewhere real.` });
          anchors.set(file, info.links.filter((h) => h.includes("#") && h !== "#" && !/^(https?:|\/\/)/i.test(h)));
        }
        // no sideways scrolling
        const overflow = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          if (document.documentElement.scrollWidth <= w + 1) return null;
          const wide = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > w + 1 || r.left < -1); })
            .slice(0, 4).map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${e.className && typeof e.className === "string" ? `.${e.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}`);
          return { by: document.documentElement.scrollWidth - w, wide };
        });
        add({ id: "overflow", ...where, status: overflow ? "fail" : "pass", detail: overflow ? `${file} at ${vp.width}px scrolls sideways by ${overflow.by}px (too wide: ${overflow.wide.join(", ") || "unknown"}).` : `${file} fits ${vp.width}px.` });
        if (vp.id !== "tablet") {
          const shot = path.join(shots, `${file.replace(/\.html$/, "")}-${vp.id}.png`);
          await page.screenshot({ path: shot, fullPage: true, timeout: 30_000 }).then(() => screenshots.push({ page: file, viewport: vp.id, file: path.relative(versionDir(project, n), shot).split(path.sep).join("/") })).catch(() => {});
        }
        // navigation behaviour
        if (vp.id === "mobile" && file === "index.html") await mobileNav(page, add);
        if (vp.id === "desktop" && file === "index.html") {
          const navOk = await page.evaluate(() => { const n = document.querySelector("#site-nav, header nav"); if (!n) return false; const r = n.getBoundingClientRect(); return r.height > 0 && getComputedStyle(n).visibility !== "hidden"; });
          add({ id: "nav-desktop", page: file, viewport: "desktop", status: navOk ? "pass" : "fail", detail: navOk ? "Navigation is visible on desktop." : "Navigation isn't visible on desktop." });
          await keyboard(page, add);
          for (const p2 of pages.filter((p) => p !== file)) {
            const link = page.locator(`#site-nav a[href$="${p2}"], header nav a[href$="${p2}"]`).first();
            if (!(await link.count())) { add({ id: "nav-link", page: file, status: "fail", detail: `The navigation has no link to ${p2}.` }); continue; }
            await Promise.all([page.waitForURL(new RegExp(`${p2.replace(".", "\\.")}$`), { timeout: 8000 }), link.click()]).then(() => add({ id: "nav-link", page: file, status: "pass", detail: `Navigation → ${p2} works.` }))
              .catch(() => add({ id: "nav-link", page: file, status: "fail", detail: `Clicking the navigation link to ${p2} didn't open it.` }));
            await page.goto(`${srv.base}/${file}`, { waitUntil: "load" });
          }
        }
        if (vp.id === "desktop") await buttons(page, file, add);
        add({ id: "js-errors", ...where, status: errs.length ? "fail" : "pass", detail: errs.length ? `${file}: JavaScript/console errors: ${[...new Set(errs)].slice(0, 3).join(" | ").slice(0, 400)}` : `${file}: no JavaScript errors.` });
        const ownBad = bad.filter((b) => b.startsWith(srv.base));
        const extBad = bad.filter((b) => !b.startsWith(srv.base));
        if (ownBad.length) add({ id: "requests", ...where, status: "fail", detail: `${file}: failed requests: ${[...new Set(ownBad)].slice(0, 4).join(", ").replaceAll(srv.base, "")}.` });
        if (extBad.length && vp.id === "desktop") add({ id: "requests-external", page: file, status: "warn", detail: `${file}: external requests failed (fonts/images from the internet): ${[...new Set(extBad)].slice(0, 3).join(", ")}.` });
        await page.close();
      }
      await ctx.close();
    }
    // in-page links (#id) point at something that exists
    for (const [file, hs] of anchors) for (const h of hs) {
      const [f, id] = h.split("#");
      const target = (f || file).replace(/^\.\//, "");
      if (id && ids.has(target) && !ids.get(target)!.has(id)) add({ id: "anchor", page: file, status: "fail", detail: `${file}: link "${h}" points to #${id}, which isn't on ${target}.` });
    }
    // ── forms really work ────────────────────────────────────────────────────
    for (const form of spec.forms) await formCheck(browser, srv.base, project, form, add);
    // ── reduced motion: everything visible without animation ──────────────
    const rm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    for (const file of pages) {
      const page = await rm.newPage();
      await page.goto(`${srv.base}/${file}`, { waitUntil: "load" }).catch(() => {});
      await page.waitForTimeout(300);
      const hidden = await page.evaluate(() => [...document.querySelectorAll("main h1, main h2, main p, [data-reveal]")].filter((e) => {
        const s = getComputedStyle(e); return e.getBoundingClientRect().height > 0 && (Number(s.opacity) < 0.95 || s.visibility === "hidden");
      }).slice(0, 4).map((e) => (e.textContent ?? "").trim().slice(0, 40)));
      add({ id: "reduced-motion", page: file, status: hidden.length ? "fail" : "pass", detail: hidden.length ? `${file}: with reduced motion on, content stays hidden: "${hidden.join('", "')}".` : `${file}: all content visible with reduced motion.` });
      await page.close();
    }
    await rm.close();
  } finally {
    await browser.close().catch(() => {});
    await srv.close();
    await getDb().astonSubmission.deleteMany({ where: { projectId: project.id, test: true } }).catch(() => {});
  }
  const report: TestReport = {
    at: new Date().toISOString(), browser: name, ms: Date.now() - t0, checks, screenshots,
    passed: checks.filter((c) => c.status === "pass").length, failed: checks.filter((c) => c.status === "fail").length, warnings: checks.filter((c) => c.status === "warn").length,
  };
  await fs.writeFile(path.join(shots, "report.json"), JSON.stringify(report, null, 1));
  return report;
}

/** Scroll down the page in viewport steps (triggers IntersectionObserver reveals and lazy images), then back to the top. */
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(innerHeight * 0.7));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 300));
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 3000); }))));
    await new Promise((r) => setTimeout(r, 900)); // let the last reveals finish
    scrollTo(0, 0);
  }).catch(() => {});
  await page.waitForTimeout(300);
}

async function mobileNav(page: Page, add: (c: Check) => void) {
  const where = { page: "index.html", viewport: "mobile" };
  const toggle = page.locator("[data-nav-toggle], .nav-toggle, button[aria-controls='site-nav']").first();
  if (!(await toggle.count()) || !(await toggle.isVisible())) { add({ id: "mobile-menu", ...where, status: "fail", detail: "No visible menu button on mobile." }); return; }
  const navVisible = () => page.evaluate(() => { const n = document.querySelector("#site-nav"); if (!n) return false; const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return r.height >= 10 && s.visibility !== "hidden" && Number(s.opacity) > 0.5 && r.right > 0 && r.left < innerWidth; });
  await toggle.click();
  await page.waitForTimeout(500);
  const opened = (await toggle.getAttribute("aria-expanded")) === "true" && (await navVisible());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const closed = (await toggle.getAttribute("aria-expanded")) === "false";
  add({ id: "mobile-menu", ...where, status: opened && closed ? "pass" : "fail", detail: opened && closed ? "Mobile menu opens (aria-expanded=true, menu visible) and closes with Escape." : `Mobile menu: ${opened ? "opens" : "doesn't open visibly (aria-expanded/visibility)"}, ${closed ? "closes with Escape" : "doesn't close with Escape"}.` });
}

async function keyboard(page: Page, add: (c: Check) => void) {
  await page.keyboard.press("Tab");
  const f = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return null;
    const s = getComputedStyle(a);
    return { tag: a.tagName.toLowerCase(), text: (a.textContent ?? "").trim().slice(0, 30), visible: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== "none" || a.getBoundingClientRect().top >= 0 && /skip/i.test(a.className + a.textContent) };
  });
  add({ id: "keyboard", page: "index.html", status: f && f.visible ? "pass" : "fail", detail: f ? (f.visible ? `Tab reaches "${f.text}" with a visible focus style.` : `Tab reaches "${f.text}" but there's no visible focus style.`) : "Tab doesn't move focus into the page." });
}

/** Every visible button (except form submits and the menu toggle) must change something when clicked. */
async function buttons(page: Page, file: string, add: (c: Check) => void) {
  const list = await page.evaluate(() => [...document.querySelectorAll("button")].map((b, i) => ({ i, text: (b.textContent ?? b.getAttribute("aria-label") ?? "").trim().slice(0, 40), skip: b.type === "submit" && !!b.form || b.hasAttribute("data-nav-toggle") || b.classList.contains("nav-toggle"), visible: b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== "hidden" })));
  for (const b of list.filter((x) => !x.skip && x.visible).slice(0, 12)) {
    const before = page.url();
    const changed = await page.evaluate((i) => new Promise<boolean>((resolve) => {
      const btn = document.querySelectorAll("button")[i] as HTMLButtonElement;
      let n = 0;
      const mo = new MutationObserver((m) => { n += m.length; });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      btn.click();
      setTimeout(() => { mo.disconnect(); resolve(n > 0); }, 600);
    }), b.i).catch(() => true); // navigated away = it did something
    const ok = changed || page.url() !== before;
    add({ id: "button", page: file, status: ok ? "pass" : "fail", detail: ok ? `Button "${b.text}" works.` : `Button "${b.text}" on ${file} does nothing when clicked.` });
    if (page.url() !== before) await page.goBack().catch(() => {});
  }
}

async function formCheck(browser: Browser, base: string, project: AstonProject, form: FormSpec, add: (c: Check) => void) {
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const where = { page: form.page };
  try {
    await page.goto(`${base}/${form.page}`, { waitUntil: "load" });
    const sel = `form[data-aston-form="${form.id}"]`;
    if (!(await page.locator(sel).count())) { add({ id: `form-${form.id}`, ...where, status: "fail", detail: `The ${form.id} form (data-aston-form="${form.id}") isn't on ${form.page}.` }); return; }
    const missing: string[] = [];
    for (const f of form.fields) if (!(await page.locator(`${sel} [name="${f.name}"]`).count())) missing.push(f.name);
    if (missing.length) { add({ id: `form-${form.id}-fields`, ...where, status: "fail", detail: `The ${form.id} form is missing fields: ${missing.join(", ")}.` }); return; }
    let posted = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/aston/forms/")) posted++; });
    // 1) empty → the browser stops it and says why
    await page.locator(`${sel} [type="submit"], ${sel} button:not([type="button"])`).first().click();
    await page.waitForTimeout(600);
    const invalid = await page.evaluate((s) => { const f = document.querySelector(s)!; return { flagged: !!f.querySelector('[aria-invalid="true"]'), status: (f.querySelector("[data-form-status]")?.textContent ?? "").trim() }; }, sel);
    const needs = form.fields.some((f) => f.required);
    add({ id: `form-${form.id}-validation`, ...where, status: !needs || (posted === 0 && invalid.flagged) ? "pass" : "fail", detail: !needs ? `${form.id}: no required fields.` : posted === 0 && invalid.flagged ? `${form.id}: empty submit is stopped and the fields are flagged ("${invalid.status}").` : `${form.id}: an empty form ${posted ? "was sent anyway" : "wasn't flagged as invalid"}.` });
    // 2) valid → really saved
    const fill = async () => {
      for (const f of form.fields) {
        const el = page.locator(`${sel} [name="${f.name}"]`).first();
        if (f.type === "checkbox") { await el.check().catch(() => {}); continue; }
        if (f.type === "select") { const opts = await el.locator("option").evaluateAll((os) => os.map((x) => (x as HTMLOptionElement).value)); await el.selectOption(sample(f, opts.filter(Boolean))).catch(() => {}); continue; }
        const min = await el.getAttribute("min");
        await el.fill(f.type === "date" && min && min > "2099-12-30" ? min : sample(f, [])).catch(() => {});
      }
      await page.evaluate(([s, key]) => { const f = document.querySelector(s)!; let t = f.querySelector('input[name="_aston_test"]') as HTMLInputElement | null; if (!t) { t = document.createElement("input"); t.type = "hidden"; t.name = "_aston_test"; f.appendChild(t); } t.value = key; }, [sel, project.testKey] as const);
    };
    await fill();
    const before = await getDb().astonSubmission.count({ where: { projectId: project.id, form: form.id, test: true } });
    const resp = page.waitForResponse((r) => r.url().includes("/api/aston/forms/"), { timeout: 15_000 }).catch(() => null);
    await page.locator(`${sel} [type="submit"], ${sel} button:not([type="button"])`).first().click();
    const r = await resp;
    await page.waitForTimeout(500);
    const shown = await page.evaluate((s) => { const st = document.querySelector(`${s} [data-form-status]`) ?? document.querySelector("[data-form-status]"); return { text: (st?.textContent ?? "").trim(), state: document.querySelector(s)?.getAttribute("data-state") ?? "" }; }, sel);
    const saved = (await getDb().astonSubmission.count({ where: { projectId: project.id, form: form.id, test: true } })) > before;
    const ok = !!r && r.status() === 200 && saved && shown.state === "success" && !!shown.text;
    add({ id: `form-${form.id}-submit`, ...where, status: ok ? "pass" : "fail", detail: ok ? `${form.id}: a valid submission was saved by the handler and the visitor saw "${shown.text}".` : `${form.id}: valid submission — ${r ? `server answered ${r.status()}` : "nothing was sent"}, ${saved ? "saved" : "not saved"}, visitor saw "${shown.text || "nothing"}".` });
    // 3) a booking can't take a slot twice
    if (form.kind === "booking" && ok) {
      await fill();
      const resp2 = page.waitForResponse((x) => x.url().includes("/api/aston/forms/"), { timeout: 15_000 }).catch(() => null);
      await page.locator(`${sel} [type="submit"], ${sel} button:not([type="button"])`).first().click();
      const r2 = await resp2;
      await page.waitForTimeout(500);
      const text = await page.evaluate((s) => (document.querySelector(`${s} [data-form-status]`)?.textContent ?? "").trim(), sel);
      add({ id: `form-${form.id}-slot`, ...where, status: r2?.status() === 409 && /booked/i.test(text) ? "pass" : "fail", detail: r2?.status() === 409 ? `${form.id}: booking the same slot again is refused ("${text}").` : `${form.id}: the same slot could be booked twice (server answered ${r2?.status() ?? "nothing"}).` });
    }
  } catch (e) {
    add({ id: `form-${form.id}`, ...where, status: "fail", detail: `${form.id}: the form test couldn't run: ${(e as Error).message.split("\n")[0]}` });
  } finally {
    await ctx.close();
  }
}

/** Failed checks as lines for the fixer. */
export const failures = (r: TestReport) => r.checks.filter((c) => c.status === "fail").map((c) => c.detail);
