/**
 * ASTON website builder — the pure parts (client-safe): plan validation,
 * cleaning model output, and assembling the finished single-file website.
 */
import { z } from "zod";

/** "build / make / create / design … website | landing page | site" → the website builder. */
export const WEBSITE_INTENT = /\b(build|make|create|design|generate|code)\b[\s\S]{0,60}\b(website|web site|webpage|web page|landing page|site)\b/i;

export const SECTION_TYPES = ["hero", "about", "services", "menu", "features", "gallery", "stats", "process", "testimonials", "pricing", "faq", "team", "cta", "contact", "footer"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

/** Google Fonts ASTON may use (all free; keeps the generated <link> valid). */
export const FONTS = [
  "Inter", "Manrope", "Plus Jakarta Sans", "DM Sans", "Outfit", "Sora", "Space Grotesk", "Poppins", "Bricolage Grotesque", "Syne",
  "Playfair Display", "Fraunces", "Cormorant Garamond", "DM Serif Display", "Lora", "Instrument Serif",
] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "section";

export const planSchema = z.object({
  siteName: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(140).default(""),
  industry: z.string().trim().max(60).default(""),
  tone: z.string().trim().max(80).default(""),
  mode: z.enum(["dark", "light"]).catch("dark"),
  palette: z.object({ bg: hex, surface: hex, text: hex, muted: hex, primary: hex, accent: hex }),
  fonts: z.object({ heading: z.string(), body: z.string() }),
  sections: z.array(z.object({
    id: z.string(),
    type: z.string(),
    title: z.string().trim().max(80),
    brief: z.string().trim().max(400).default(""),
    inNav: z.boolean().catch(true).default(true),
  })).min(3).max(10),
  cta: z.object({ label: z.string().trim().max(30), target: z.string().max(40) }).catch({ label: "Get in touch", target: "#contact" }),
});
export type SitePlan = z.infer<typeof planSchema>;

export interface SiteSection { id: string; type: SectionType; title: string; brief: string; inNav: boolean; html: string | null }

/** Pull the first JSON object out of model text (it may add a sentence or fences). */
export function extractJson(text: string): unknown {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("No JSON object in the reply.");
  return JSON.parse(text.slice(a, b + 1));
}

const fontOk = (f: string, fallback: string) => (FONTS as readonly string[]).find((x) => x.toLowerCase() === f.trim().toLowerCase()) ?? fallback;

/** Validate + normalise a plan: hero first, footer last, unique ids, known fonts, 4–9 sections. */
export function normalizePlan(raw: unknown): { plan: SitePlan; sections: SiteSection[] } {
  const p = planSchema.parse(raw);
  const plan: SitePlan = { ...p, fonts: { heading: fontOk(p.fonts.heading, "Sora"), body: fontOk(p.fonts.body, "Inter") } };
  const seen = new Set<string>();
  let list: SiteSection[] = p.sections.map((s) => {
    const type = ((SECTION_TYPES as readonly string[]).includes(s.type) ? s.type : "features") as SectionType;
    let id = kebab(s.id || s.title);
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    return { id, type, title: s.title, brief: s.brief, inNav: s.inNav, html: null };
  });
  const hero = list.find((s) => s.type === "hero") ?? { id: "home", type: "hero" as const, title: plan.siteName, brief: plan.tagline, inNav: false, html: null };
  const footer = list.find((s) => s.type === "footer") ?? { id: "footer", type: "footer" as const, title: "Footer", brief: "Brand, links, contact, copyright.", inNav: false, html: null };
  list = [hero, ...list.filter((s) => s !== hero && s !== footer && s.type !== "hero" && s.type !== "footer").slice(0, 7), footer];
  hero.inNav = false;
  footer.inNav = false;
  return { plan, sections: list };
}

/** Strip code fences / chatter around model output; keep only the code. */
export function stripFences(text: string): string {
  let t = text.trim();
  const fence = t.match(/```[a-zA-Z]*\n([\s\S]*?)(```|$)/);
  if (fence) t = fence[1];
  return t.trim();
}

/** Section HTML: no scripts, no inline handlers, no javascript: URLs, no external <link>/<iframe>/<base>. */
export function cleanHtml(text: string): string {
  let t = stripFences(text);
  const first = t.indexOf("<");
  if (first > 0) t = t.slice(first);
  return t
    .replace(/<script\b[\s\S]*?(<\/script>|$)/gi, "")
    .replace(/<(iframe|object|embed|base|link|meta)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
    .trim();
}

/** CSS: no @import (fonts are linked by ASTON), no </style> breakouts. */
export function cleanCss(text: string): string {
  return stripFences(text).replace(/@import[^;]*;/gi, "").replace(/<\/?style[^>]*>/gi, "").trim();
}

/** The reusable-class guide the stylesheet starts with (fed to each section prompt). */
export function extractGuide(css: string): string {
  const m = css.match(/\/\*\s*GUIDE([\s\S]*?)\*\//i);
  return (m ? m[1] : "").trim().slice(0, 2000);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** The small runtime every ASTON site ships with (no libraries). */
export const RUNTIME_JS = `(() => {
  const header = document.querySelector(".site-header");
  const onScroll = () => header && header.classList.toggle("scrolled", window.scrollY > 24);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  const toggle = document.querySelector(".nav-toggle");
  if (toggle) toggle.addEventListener("click", () => {
    const open = document.body.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll(".nav a").forEach((a) => a.addEventListener("click", () => document.body.classList.remove("nav-open")));
  const items = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  } else items.forEach((el) => el.classList.add("is-visible"));
  document.querySelectorAll("[data-year]").forEach((el) => { el.textContent = String(new Date().getFullYear()); });
})();`;

/** The header every site gets (the stylesheet is told to style exactly this markup). */
export function headerHtml(plan: SitePlan, sections: SiteSection[]): string {
  const links = sections.filter((s) => s.inNav).slice(0, 6).map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join("");
  return `<header class="site-header">
  <div class="container nav-bar">
    <a class="brand" href="#${sections[0]?.id ?? "top"}">${esc(plan.siteName)}</a>
    <nav class="nav" aria-label="Main">${links}<a class="btn btn-primary nav-cta" href="${esc(plan.cta.target || "#contact")}">${esc(plan.cta.label)}</a></nav>
    <button class="nav-toggle" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
  </div>
</header>`;
}

/** Assemble the single-file website from whatever is ready (used live and for the final file). */
export function assembleSite(o: { plan: SitePlan | null; css: string | null; sections: SiteSection[] | null; building?: boolean }): string {
  const plan = o.plan;
  const title = plan ? `${plan.siteName}${plan.tagline ? ` — ${plan.tagline}` : ""}` : "Building…";
  const fonts = plan ? [...new Set([plan.fonts.heading, plan.fonts.body])].map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700`).join("&") : "";
  const ready = (o.sections ?? []).filter((s) => s.html);
  const pending = (o.sections ?? []).find((s) => !s.html);
  const placeholder = o.building && pending
    ? `<div style="padding:72px 24px;text-align:center;opacity:.55;font:500 14px/1.4 system-ui,sans-serif;letter-spacing:.08em">ASTON is writing “${esc(pending.title)}”…</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${plan ? `<meta name="description" content="${esc(plan.tagline || plan.siteName)}">` : ""}
${fonts ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap" media="print" onload="this.media='all'">` : ""}
<noscript><style>[data-reveal]{opacity:1!important;transform:none!important}</style></noscript>
<style>
${o.css ?? (plan ? `:root{--bg:${plan.palette.bg};--text:${plan.palette.text}}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}` : "body{margin:0;background:#0b1020;color:#cbd5e1;font-family:system-ui,sans-serif}")}
</style>
${o.building ? "<style>/* live preview: show content immediately (the page reloads as ASTON writes) */[data-reveal]{opacity:1!important;transform:none!important;transition:none!important}</style>" : ""}
</head>
<body>
${plan && o.sections ? headerHtml(plan, o.sections) : ""}
<main>
${ready.map((s) => s.html).join("\n")}
${placeholder}
</main>
<script>
${RUNTIME_JS}
</script>
</body>
</html>`;
}
