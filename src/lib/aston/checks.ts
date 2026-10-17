/**
 * ASTON's checks on a built page — run on the real HTML before a preview is
 * offered. A build with a failed check is never presented as ready.
 * (The page's live layout is checked again in your browser during the
 * walkthrough: horizontal overflow and script errors are reported there.)
 */
import { Script } from "node:vm";
import { PALETTES, type PaletteName } from "./spec";

export type CheckStatus = "pass" | "fail" | "warn";
export interface Check { id: string; label: string; status: CheckStatus; detail?: string }
export interface CheckReport { passed: boolean; checks: Check[]; at: string }

const MAX_BYTES = 300_000;

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const attrs = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);
const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");

export function checkHtml(html: string, o: { palette?: PaletteName } = {}): CheckReport {
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail?: string, warnOnly = false) =>
    checks.push({ id, label, status: ok ? "pass" : warnOnly ? "warn" : "fail", ...(detail && !ok ? { detail } : {}) });

  // structure & metadata
  add("doctype", "HTML5 document", /^<!doctype html>/i.test(html.trim()));
  add("lang", "Page language set", /<html[^>]*\blang="[a-z-]+"/i.test(html));
  const title = /<title>([^<]{3,})<\/title>/i.exec(html)?.[1];
  add("title", "Page title", !!title);
  add("viewport", "Mobile viewport", /<meta[^>]+name="viewport"[^>]+width=device-width/i.test(html));
  add("description", "Meta description", /<meta[^>]+name="description"[^>]+content="[^"]{10,}"/i.test(html));
  const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
  add("h1", "Exactly one main heading", h1 === 1, `${h1} <h1> found`);

  // ids and navigation
  const ids = attrs(html, /\sid="([^"]+)"/g);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  add("ids", "Element ids are unique", !dup.length, `duplicate: ${[...new Set(dup)].join(", ")}`);
  const idSet = new Set(ids);
  const anchors = [...new Set([...attrs(html, /href="#([^"]*)"/g), ...attrs(html, /data-go="([^"]+)"/g), ...attrs(html, /aria-controls="([^"]+)"/g), ...attrs(html, /aria-labelledby="([^"]+)"/g)])];
  const broken = anchors.filter((a) => a && !idSet.has(a));
  add("anchors", "Every link and button target exists", !broken.length, `missing targets: ${broken.join(", ")}`);
  const empty = attrs(html, /href="(#?)"/g).length;
  add("empty-links", "No empty links", !empty, `${empty} empty link(s)`);

  // forms & controls
  const fieldIds = attrs(html, /<(?:input|textarea|select)[^>]*\sid="([^"]+)"/g);
  const labelled = new Set(attrs(html, /<label[^>]*\sfor="([^"]+)"/g));
  const unlabelled = fieldIds.filter((f) => !labelled.has(f));
  add("labels", "Every form field has a label", !unlabelled.length, `unlabelled: ${unlabelled.join(", ")}`);
  const blankButtons = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gi)].filter((m) => !/aria-label="[^"]+"/.test(m[1]) && !strip(m[2]).trim()).length;
  add("buttons", "Buttons have names", !blankButtons, `${blankButtons} button(s) without text`);
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].filter((m) => !/\balt="/.test(m[0])).length;
  add("alt", "Images have alt text", !imgs, `${imgs} image(s) without alt`);
  const forms = [...html.matchAll(/<form\b[^>]*>/gi)];
  add("forms", "Forms are demo-safe (nothing is sent)", forms.every((f) => /data-demo-form/.test(f[0]) && !/\baction=/.test(f[0])), "a form would submit somewhere");

  // links that leave the page
  const tels = attrs(html, /href="tel:([^"]*)"/g).filter((t) => t.replace(/\D/g, "").length < 8);
  add("tel", "Phone links are dialable", !tels.length, `bad: ${tels.join(", ")}`);
  const was = attrs(html, /href="https:\/\/wa\.me\/([^"]*)"/g).filter((t) => !/^\d{11,15}$/.test(t));
  add("whatsapp", "WhatsApp links are valid", !was.length, `bad: ${was.join(", ")}`);
  const insecure = attrs(html, /(?:href|src)="(http:\/\/[^"]+)"/g);
  add("https", "No insecure (http://) links", !insecure.length, insecure.slice(0, 3).join(", "));
  const extNoRel = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)].filter((m) => !/rel="[^"]*noopener/.test(m[0])).length;
  add("noopener", "External links open safely", !extNoRel, `${extNoRel} link(s) without rel=noopener`);

  // content sanity
  const text = strip(html);
  const junk = /\b(undefined|NaN|lorem ipsum|\[object Object\])\b|\{\{|\}\}|\bnull\b/i.exec(text);
  add("content", "No broken or filler text", !junk, junk ? `found "${junk[0]}"` : undefined);
  const scripts = attrs(html, /<script>([\s\S]*?)<\/script>/g);
  const badJs = scripts.map((s) => { try { new Script(s); return null; } catch (e) { return (e as Error).message; } }).filter(Boolean);
  add("js", "Scripts are valid JavaScript", !badJs.length, badJs.join("; "));
  add("motion", "Respects reduced-motion settings", /prefers-reduced-motion/.test(html));
  const bytes = Buffer.byteLength(html, "utf8");
  add("size", "Page is light (under 300 KB)", bytes <= MAX_BYTES, `${Math.round(bytes / 1024)} KB`);

  // colour contrast (WCAG AA) for the palette in use
  if (o.palette) {
    const p = PALETTES[o.palette];
    const pairs: [string, string, string, number][] = [
      ["text on background", p.ink, p.bg, 4.5], ["text on cards", p.ink, p.surface, 4.5],
      ["secondary text", p.muted, p.bg, 4.5], ["button text", p.primaryInk, p.primary, 4.5],
    ];
    const low = pairs.filter(([, a, b, min]) => contrast(a, b) < min).map(([n, a, b]) => `${n} ${contrast(a, b).toFixed(2)}:1`);
    add("contrast", "Colour contrast meets WCAG AA", !low.length, low.join(", "));
  }

  return { passed: checks.every((c) => c.status !== "fail"), checks, at: new Date().toISOString() };
}

/** Live checks the walkthrough reports from your browser (real layout at that width). */
export interface LiveReport { width: number; overflowX: boolean; errors: string[] }
