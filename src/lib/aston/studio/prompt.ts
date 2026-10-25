import { DARWIN_BUSINESS } from "@/lib/darwin/config";
import { STYLES, styleBrief, styleById } from "./styles";
import type { ProjectSpec } from "./spec";

/**
 * What ASTON's brain is told at each step of building a website. The brain
 * writes real code; these rules make that code work in JARVIS's preview, pass
 * the browser tests, and never invent facts about the business.
 */

export function planSystemPrompt() {
  return `You are ASTON, the website architect at ${DARWIN_BUSINESS.name}. You plan a real, multi-page website from a brief. Your plan is used to write the code, so it must be specific.

Reply with ONE JSON object only (no prose, no code fences):
{
  "name": "site/project name (usually the business name)",
  "client": "the client/business if given",
  "summary": "what the site is for, in 1–2 sentences",
  "audience": "who it's for",
  "personality": ["3–5 brand adjectives"],
  "style": one of ${JSON.stringify(STYLES.map((s) => s.id))},
  "pages": [{ "file": "index.html", "title": "page <title>", "nav": "Home", "purpose": "...", "sections": [{ "id": "hero", "purpose": "what this section says/does, with the actual headline idea" }] }],
  "design": {
    "colors": { "bg": "#hex", "surface": "#hex", "text": "#hex", "muted": "#hex", "accent": "#hex", "line": "#hex", "inverse": "#hex" },
    "fonts": { "display": { "family": "a Google Font", "weights": [400,600] }, "body": { "family": "a Google Font", "weights": [400,500] } },
    "typeScale": "e.g. display clamp(3.5rem, 11vw, 11rem) / h2 clamp(2rem,5vw,4.5rem) / body 1.0625rem, line-heights…",
    "spacing": "the spacing scale (e.g. 4px base: 4,8,12,16,24,32,48,64,96,128,192)",
    "grid": "columns, gutters, max width",
    "breakpoints": "e.g. 640 / 960 / 1280",
    "motion": "durations, easings and what animates",
    "imageTreatment": "how images are cropped/coloured",
    "states": "how loading, empty, success and error states look (forms)"
  },
  "forms": [{ "id": "enquiry", "kind": "enquiry|contact|booking|newsletter|waitlist", "page": "contact.html", "fields": [{ "name": "full_name", "label": "Full name", "type": "text|email|tel|textarea|select|date|time|number|checkbox", "required": true, "options": ["only for select"] }], "success": "the message shown after a real successful submission" }],
  "features": ["each interactive feature that must work, e.g. 'Mobile menu opens and closes', 'Menu filter by category'"],
  "assets": [{ "file": "assets/hero-portrait.svg", "description": "what ASTON will draw as SVG artwork" }],
  "facts": { "phone": "", "email": "", "address": "", "hours": "", "instagram": "", "whatsapp": "" },
  "placeholders": ["content the client must still supply"],
  "assumptions": ["decisions you made that the brief didn't specify"],
  "acceptance": ["checkable criteria, e.g. 'Booking form saves a booking and rejects a taken slot'"],
  "envVars": [{ "name": "UPPER_SNAKE_CASE, e.g. STRIPE_SECRET_KEY — only if a real integration needs a secret", "why": "..." }]
}

Rules:
- 2–6 pages normally (index.html required; flat file names like story.html, menu.html, contact.html). Each section's purpose names the real content idea.
- Choose the style that fits the brief. Never default to editorial luxury unless the brief asks for that kind of look or business.
- Facts (phone, email, address, hours, prices, names, reviews, awards, numbers) come ONLY from the brief. Anything else goes in placeholders and is shown on the site as an obvious placeholder.
- Forms only for what the brief needs (enquiry/booking/newsletter…); bookings have a date field (and a time field when times matter).
- Assets: 2–6 SVG artworks ASTON will draw (no photos are available) — portraits as abstract/silhouette artwork, textures, patterns, illustrations. They are placeholders until the client supplies real images.
- Payments, logins, maps, analytics need accounts/keys: describe them as integration boundaries in features/envVars, never as working.`;
}

export const FILE_FORMAT = `OUTPUT FORMAT (exactly this, nothing before/after/between files):
<<<FILE path/to/file.ext>>>
…the complete file…
<<<END>>>`;

export function codeSystemPrompt(spec: ProjectSpec) {
  const style = styleById(spec.style);
  return `You are ASTON, a senior front-end engineer and designer. You write a complete, production-quality static website (HTML, CSS, vanilla JavaScript, SVG) — real code that runs as-is.

${FILE_FORMAT}

TECHNICAL RULES (the site is tested automatically in a real browser — follow them exactly):
- Pages are flat files at the site root (index.html, story.html…). Shared CSS: css/styles.css. Shared JS: js/main.js. Artwork: assets/*.svg. Use RELATIVE links ("story.html", "css/styles.css") — never a leading "/".
- No external JavaScript, frameworks or CDNs (they are blocked). Google Fonts via <link> to fonts.googleapis.com is allowed. Images: the assets you draw, or https image URLs the brief supplied.
- Every page: <!doctype html>, <html lang="en">, <meta charset>, <meta name="viewport" content="width=device-width, initial-scale=1">, <title>, <meta name="description">, the Google Fonts link, <link rel="stylesheet" href="css/styles.css">, a skip link (<a class="skip-link" href="#main">Skip to content</a>), <header> with the site navigation, <main id="main">, <footer>, and <script src="js/main.js" defer></script> before </body>. Exactly one <h1> per page; headings in order.
- Navigation: <nav id="site-nav" aria-label="Main"> with links to EVERY page (aria-current="page" on the current one). Mobile toggle: <button class="nav-toggle" type="button" data-nav-toggle aria-controls="site-nav" aria-expanded="false">Menu</button>. js/main.js opens/closes it (aria-expanded true/false + a class on <body> or the nav), closes it on Escape and when a link is clicked. Below 768px the nav is hidden until opened; above, it's always visible and the toggle is hidden.
- Forms: <form data-aston-form="FORM_ID" novalidate> with a <label for> for every field, input names EXACTLY as in the plan, real types (email, tel, date, time…), required where the plan says, a hidden honeypot <input type="text" name="_gotcha" tabindex="-1" autocomplete="off" hidden>, a submit button, and <p data-form-status aria-live="polite"></p>. Pages with forms also load <script src="_aston/forms.js" defer></script> — that script validates, submits to the real handler and shows the real result. NEVER write your own submit handler or fake a success message.
- Every button does something real (toggle, filter, open/close, submit). Every link goes to an existing page, an existing #id, tel:/mailto: with a VERIFIED fact, or an external https URL from the brief. No "#" dead links.
- Motion: CSS transitions/keyframes + IntersectionObserver in js/main.js (add class "is-visible" to [data-reveal] elements). Content must be visible without JavaScript: hide [data-reveal] only under html.js (main.js adds "js" to <html> first thing). Under @media (prefers-reduced-motion: reduce): no transforms, no animations, everything visible immediately.
- Responsive from 360px to 1600px+: mobile-first CSS, clamp() type, images max-width:100%; height:auto; NOTHING may overflow horizontally at 360px (watch long words in giant headlines: use overflow-wrap:anywhere or smaller clamps on small screens).
- Accessibility: WCAG AA contrast, visible :focus-visible styles, alt text on images (decorative: alt=""), labelled controls, prefers-reduced-motion respected.
- Facts ONLY from the plan's "facts" and the brief. Missing contact details, prices, team names, reviews → a clearly marked placeholder like "[Phone number]" — never invented. Write original, specific, on-brand copy; no lorem ipsum.

${style ? styleBrief(style) : ""}

THE PLAN (follow it — pages, sections, design system, forms, features, assets):
${JSON.stringify(spec)}`;
}

/** Step 1a of the code: the artwork (SVG), written alongside the design system. */
export function assetsTask(spec: ProjectSpec) {
  return `Write ONLY the artwork now: ${spec.assets.map((a) => a.file).join(", ")}.
Each is a real, finished SVG composition in the design's palette (viewBox set, width/height attributes, a <title> saying it's placeholder artwork to replace with the client's image). Portrait artwork = abstract figure/silhouette compositions with tonal depth (gradients/grain via SVG filters), not clip-art. Keep each under ~6 KB.
Artwork briefs: ${JSON.stringify(spec.assets)}`;
}

/** Step 1b: the design system (CSS) and the behaviour (JS). */
export function foundationTask(spec: ProjectSpec) {
  return `Write the shared foundation now: css/styles.css and js/main.js (the artwork is written separately: ${spec.assets.map((a) => a.file).join(", ") || "none"}).

- css/styles.css: the full design system as CSS custom properties (every colour, the fonts, the type scale, spacing, radii, motion tokens), base/reset, layout grid, header/nav (incl. the mobile toggle behaviour), buttons, links, forms (fields, labels, .field-error, [data-form-status] with data-state loading/success/error styles, aria-invalid), every section/component the plan's pages need (name classes after the components), [data-reveal] animations, the footer, responsive rules, the reduced-motion block, and .skip-link.
- js/main.js: add "js" to <html>; mobile nav (open/close/Escape/link click, aria-expanded); IntersectionObserver reveals; any interactive features from the plan (filters, tabs, accordions, carousels…) written generically by data attributes so pages can use them; a subtle page-transition fade if the style calls for it (never blocking navigation). No errors if a page lacks an element.
Write the files in that order.`;
}

/** Step 2: one page at a time, using the foundation that now exists. */
export function pageTask(spec: ProjectSpec, file: string, css: string) {
  const page = spec.pages.find((p) => p.file === file)!;
  const forms = spec.forms.filter((f) => f.page === file);
  return `Write ${file} now — the complete page.
Page: ${JSON.stringify(page)}
${forms.length ? `Forms on this page (ids and field names exactly): ${JSON.stringify(forms)}` : "This page has no forms."}
Navigation links (all pages): ${spec.pages.map((p) => `${p.nav} → ${p.file}`).join(", ")}

Use the classes and components defined in css/styles.css (below) and the data attributes js/main.js handles. Only add a small <style> block for something truly page-specific.

css/styles.css:
${css.slice(0, 40_000)}`;
}

export function fixTask(failures: string[], files: Map<string, string>) {
  return `The site was tested in a real browser and these checks FAILED:
${failures.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Fix every failure at its cause. Write ONLY the files you change, each one complete, in the file format. Keep everything that works as it is.

Current files:
${[...files].map(([p, c]) => `<<<FILE ${p}>>>\n${c}\n<<<END>>>`).join("\n")}`;
}

export function changePlanTask(spec: ProjectSpec, change: string, files: string[]) {
  return `The website already exists. Change requested by the user:
"${change}"

Current plan:
${JSON.stringify(spec)}
Current files: ${files.join(", ")}

Reply with ONE JSON object only: { "summary": "what you'll change, one sentence", "spec": <the COMPLETE updated plan, same schema — e.g. add a page to pages for 'create a story page'>, "files": ["every file you'll create or rewrite, e.g. story.html, css/styles.css, and every page whose navigation must gain the new link"] }`;
}

export function changeCodeTask(change: string, summary: string, writeFiles: string[], files: Map<string, string>) {
  return `Change requested: "${change}"
Your plan for it: ${summary}
Write these files now, each one complete: ${writeFiles.join(", ")}.
Keep the existing design system, content and behaviour unless the change says otherwise; keep navigation consistent on every page.

Current files:
${[...files].map(([p, c]) => `<<<FILE ${p}>>>\n${c}\n<<<END>>>`).join("\n")}`;
}
