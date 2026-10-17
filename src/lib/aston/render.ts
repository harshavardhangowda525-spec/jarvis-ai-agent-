/**
 * ASTON's renderer: a site spec → one complete, self-contained HTML page
 * (inline CSS + JS, web fonts with system fallbacks). Deterministic, so every
 * build is responsive, accessible and has working navigation whatever model
 * wrote the content — the model decides WHAT the site says, not whether the
 * menu button works.
 */
import { FONTS, PALETTES, sectionIds, type Facts, type Section, type SiteSpec } from "./spec";

const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const digits = (s?: string) => (s ?? "").replace(/[^\d+]/g, "");
/** wa.me wants the full international number without "+"; a 10-digit Indian number gets 91. */
export function waNumber(s?: string): string | null {
  const d = (s ?? "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
const safeHttp = (u?: string) => (u && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null);
export function instagramUrl(v?: string): string | null {
  if (!v) return null;
  const http = safeHttp(v);
  if (http) return /instagram\.com\//i.test(http) ? http : null;
  const handle = v.replace(/^@/, "").trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}/` : null;
}

const NAV_LABEL: Record<Section["type"], string> = {
  about: "About", services: "Services", menu: "Menu", features: "Why us", gallery: "Gallery", pricing: "Pricing",
  process: "How it works", faq: "FAQ", hours: "Hours", cta: "", contact: "Contact",
};

export interface Rendered { html: string; sections: { id: string; title: string; type: string }[]; placeholders: string[] }

export function renderSite(spec: SiteSpec, o: { year?: number; agency?: string } = {}): Rendered {
  return spec.kind === "app" ? renderApp(spec, o) : renderWebsite(spec, o);
}

/* ----------------------------------------------------------- shared bits */

function contactModel(f: Facts) {
  const placeholders: string[] = [];
  const phone = f.phone && digits(f.phone).replace(/\D/g, "").length >= 8 ? f.phone : undefined;
  if (!phone) placeholders.push("Phone number");
  const wa = waNumber(f.whatsapp ?? phone);
  const email = f.email && /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(f.email) ? f.email : undefined;
  if (!email) placeholders.push("Email address");
  if (!f.address) placeholders.push("Address");
  if (!f.hours.length) placeholders.push("Opening hours");
  const maps = safeHttp(f.mapsUrl) ?? (f.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.address)}` : null);
  return { phone, wa, email, address: f.address, maps, ig: instagramUrl(f.instagram), placeholders };
}

function ctaHref(action: string, c: ReturnType<typeof contactModel>, has: (t: string) => string | null): { href: string; ext: boolean } {
  switch (action) {
    case "call": return c.phone ? { href: `tel:${digits(c.phone)}`, ext: false } : { href: `#${has("contact") ?? "top"}`, ext: false };
    case "whatsapp": return c.wa ? { href: `https://wa.me/${c.wa}`, ext: true } : { href: `#${has("contact") ?? "top"}`, ext: false };
    case "directions": return c.maps ? { href: c.maps, ext: true } : { href: `#${has("contact") ?? "top"}`, ext: false };
    case "menu": return { href: `#${has("menu") ?? has("services") ?? has("contact") ?? "top"}`, ext: false };
    case "services": return { href: `#${has("services") ?? has("menu") ?? has("pricing") ?? has("contact") ?? "top"}`, ext: false };
    default: return { href: `#${has("contact") ?? "top"}`, ext: false };
  }
}
const link = (h: { href: string; ext: boolean }) => `href="${esc(h.href)}"${h.ext ? ' target="_blank" rel="noopener noreferrer"' : ""}`;
const ph = (label: string) => `<span class="ph" title="Placeholder — to be confirmed">${esc(label)}</span>`;

const FIELD: Record<string, { label: string; type: string; auto?: string; area?: boolean }> = {
  name: { label: "Your name", type: "text", auto: "name" },
  phone: { label: "Phone", type: "tel", auto: "tel" },
  email: { label: "Email", type: "email", auto: "email" },
  date: { label: "Preferred date", type: "date" },
  time: { label: "Preferred time", type: "time" },
  guests: { label: "Number of guests", type: "number" },
  service: { label: "What are you interested in?", type: "text" },
  message: { label: "Message", type: "text", area: true },
};
function formHtml(fields: string[], idp: string) {
  const fs = (fields.length ? fields : ["name", "phone", "message"]).filter((f, i, a) => FIELD[f] && a.indexOf(f) === i);
  const rows = fs.map((f) => {
    const d = FIELD[f];
    const id = `${idp}-${f}`;
    const req = f === "name" || f === "phone" ? " required" : "";
    const input = d.area
      ? `<textarea id="${id}" name="${f}" rows="4"${req}></textarea>`
      : `<input id="${id}" name="${f}" type="${d.type}"${d.auto ? ` autocomplete="${d.auto}"` : ""}${f === "guests" ? ' min="1" max="50"' : ""}${req}>`;
    return `<div class="field${d.area ? " wide" : ""}"><label for="${id}">${esc(d.label)}</label>${input}</div>`;
  }).join("");
  return `<form class="form" data-demo-form novalidate>${rows}<button class="btn primary wide" type="submit">Send enquiry</button><p class="form-note" role="status" aria-live="polite"></p></form>`;
}

function hoursHtml(f: Facts) {
  return f.hours.length
    ? `<table class="hours"><tbody>${f.hours.map((h) => `<tr><th scope="row">${esc(h.days)}</th><td>${esc(h.time)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">${ph("Opening hours — to be confirmed")}</p>`;
}

function contactList(c: ReturnType<typeof contactModel>) {
  const row = (icon: string, label: string, body: string) => `<li><span class="ci" aria-hidden="true">${icon}</span><span><small>${label}</small>${body}</span></li>`;
  return `<ul class="contact-list">${[
    row("☎", "Phone", c.phone ? `<a href="tel:${esc(digits(c.phone))}">${esc(c.phone)}</a>` : ph("Phone number to be added")),
    c.wa ? row("💬", "WhatsApp", `<a href="https://wa.me/${c.wa}" target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a>`) : "",
    row("✉", "Email", c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ph("Email to be added")),
    row("⌖", "Address", c.address ? `${esc(c.address)}${c.maps ? ` · <a href="${esc(c.maps)}" target="_blank" rel="noopener noreferrer">Directions</a>` : ""}` : ph("Address to be added")),
    c.ig ? row("◎", "Instagram", `<a href="${esc(c.ig)}" target="_blank" rel="noopener noreferrer">Follow us</a>`) : "",
  ].join("")}</ul>`;
}

function fontLink(spec: SiteSpec) {
  const f = FONTS[spec.font];
  const fam = (n: string, w: string) => `family=${n.replace(/ /g, "+")}:wght@${w}`;
  const q = `${fam(f.head, f.head === "Bebas Neue" ? "400" : "600;700;800")}&${fam(f.body, "400;600;700")}`;
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap">`;
}

function baseCss(spec: SiteSpec) {
  const p = PALETTES[spec.palette];
  const f = FONTS[spec.font];
  const dark = spec.palette === "midnight" || spec.palette === "energy";
  return `:root{--bg:${p.bg};--surface:${p.surface};--ink:${p.ink};--muted:${p.muted};--primary:${p.primary};--primary-ink:${p.primaryInk};--accent:${p.accent};--dark:${p.dark};--line:${dark ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.08)"};--head:${f.headStack};--body:${f.bodyStack};--r:18px;--shadow:0 10px 30px -12px rgba(0,0,0,${dark ? ".6" : ".18"})}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 var(--body);overflow-x:hidden}
img{max-width:100%}a{color:var(--primary)}${dark ? "a{color:var(--accent)}" : ""}h1,h2,h3{font-family:var(--head);line-height:1.12;margin:0 0 .5em;letter-spacing:${spec.font === "bold" ? ".02em" : "-.01em"}}
h2{font-size:clamp(1.8rem,4vw,2.6rem)}h3{font-size:1.15rem}p{margin:0 0 1em}.muted{color:var(--muted)}
.skip{position:absolute;left:-999px;top:8px;background:var(--primary);color:var(--primary-ink);padding:8px 14px;border-radius:8px;z-index:100}.skip:focus{left:8px}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.wrap{width:min(1120px,100% - 40px);margin-inline:auto}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;min-height:48px;padding:.75em 1.4em;border-radius:999px;font-weight:700;text-decoration:none;border:2px solid transparent;cursor:pointer;font:inherit;font-weight:700;transition:transform .2s,box-shadow .2s,background .2s}
.btn:hover{transform:translateY(-2px)}.btn.primary{background:var(--primary);color:var(--primary-ink);box-shadow:0 10px 24px -10px var(--primary)}.btn.ghost{border-color:currentColor;color:inherit;background:transparent}.btn.wide{width:100%}
.ph{display:inline-block;border:1.5px dashed var(--accent);border-radius:8px;padding:0 .45em;font-size:.92em;color:var(--muted);background:color-mix(in srgb,var(--accent) 10%,transparent)}
.reveal{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s ease}.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.reveal{opacity:1;transform:none;transition:none}.btn{transition:none}}
.form{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{display:flex;flex-direction:column;gap:6px}.field.wide,.form .btn,.form-note{grid-column:1/-1}
.field label{font-weight:600;font-size:.92rem}.field input,.field textarea{font:inherit;color:var(--ink);background:var(--bg);border:1.5px solid var(--line);border-radius:12px;padding:.75em .9em;min-height:48px}
.field input:focus,.field textarea:focus{border-color:var(--primary);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 25%,transparent)}
.field [aria-invalid=true]{border-color:#dc2626}.form-note{margin:0;font-weight:600;min-height:1.2em}
.hours{width:100%;border-collapse:collapse}.hours th,.hours td{padding:.7em 0;border-bottom:1px solid var(--line);text-align:left}.hours td{text-align:right;color:var(--muted)}
.contact-list{list-style:none;margin:0 0 1.5em;padding:0;display:grid;gap:14px}.contact-list li{display:flex;gap:12px;align-items:flex-start}.contact-list small{display:block;color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.08em}
.ci{width:40px;height:40px;flex:none;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--primary) 12%,transparent);color:var(--primary);font-size:1.1rem}
@media (max-width:640px){.form{grid-template-columns:1fr}}`;
}

const formJs = `document.querySelectorAll('[data-demo-form]').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var bad=null;f.querySelectorAll('[required]').forEach(function(i){var ok=i.value.trim()!=='';i.setAttribute('aria-invalid',ok?'false':'true');if(!ok&&!bad)bad=i});var n=f.querySelector('.form-note');if(bad){n.textContent='Please fill in the highlighted fields.';bad.focus();return}n.textContent='Thanks! This is a demo preview, so nothing was sent.';f.reset()})});`;

function demoNotes(spec: SiteSpec, placeholders: string[], agency: string) {
  const items = [...placeholders.map((p) => `${p}: placeholder — to be confirmed`), ...spec.assumptions];
  return `<details class="demo-notes"><summary>Demo preview by ${esc(agency)}</summary><p>This is a design preview for ${esc(spec.businessName)}, not the live website. Forms don't send anything.${spec.facts.source ? ` Business details from: ${esc(spec.facts.source)}.` : ""}</p>${items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}</details>`;
}

function monogram(name: string) {
  const w = name.replace(/[^\p{L}\p{N}\s&]/gu, "").split(/\s+/).filter((x) => x && !/^(the|and|&|of)$/i.test(x));
  return (w.slice(0, 2).map((x) => x[0]).join("") || name.slice(0, 1)).toUpperCase();
}

/* ------------------------------------------------------------- website */

function sectionBody(sec: Section, id: string, spec: SiteSpec, c: ReturnType<typeof contactModel>, has: (t: string) => string | null): string {
  switch (sec.type) {
    case "about":
      return `<div class="split"><div><h2>${esc(sec.title)}</h2>${sec.body.split(/\n{2,}/).map((p) => `<p class="lead">${esc(p)}</p>`).join("")}</div>${sec.highlights.length ? `<ul class="chips">${sec.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}</div>`;
    case "services":
      return `<header class="sec-head"><h2>${esc(sec.title)}</h2>${sec.intro ? `<p class="muted">${esc(sec.intro)}</p>` : ""}</header><div class="cards">${sec.items.map((it, i) => `<article class="card reveal"><span class="num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><h3>${esc(it.name)}</h3><p class="muted">${esc(it.desc)}</p>${it.price ? `<p class="price">${esc(it.price)}</p>` : ""}</article>`).join("")}</div>`;
    case "menu":
      return `<header class="sec-head"><h2>${esc(sec.title)}</h2>${sec.intro ? `<p class="muted">${esc(sec.intro)}</p>` : ""}</header>
<div class="tabs" role="tablist" aria-label="${esc(sec.title)}">${sec.categories.map((cat, i) => `<button role="tab" id="${id}-tab-${i}" aria-controls="${id}-panel-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(cat.name)}</button>`).join("")}</div>
${sec.categories.map((cat, i) => `<div class="menu-panel" role="tabpanel" id="${id}-panel-${i}" aria-labelledby="${id}-tab-${i}"${i ? " hidden" : ""}><ul class="menu-list">${cat.items.map((it) => `<li><div><strong>${esc(it.name)}</strong>${it.desc ? `<span class="muted">${esc(it.desc)}</span>` : ""}</div>${it.price ? `<span class="price">${esc(it.price)}</span>` : ""}</li>`).join("")}</ul></div>`).join("")}`;
    case "features":
      return `<header class="sec-head"><h2>${esc(sec.title)}</h2></header><div class="cards feat">${sec.items.map((it) => `<article class="card reveal"><span class="icon" aria-hidden="true">${esc(it.icon ?? "✦")}</span><h3>${esc(it.title)}</h3><p class="muted">${esc(it.desc)}</p></article>`).join("")}</div>`;
    case "gallery":
      return `<header class="sec-head"><h2>${esc(sec.title)}</h2><p class="muted">Photo placeholders — real photos of ${esc(spec.businessName)} go here.</p></header><div class="gallery">${sec.items.map((it, i) => `<figure class="tile reveal t${i % 4}"><span aria-hidden="true">${esc(it.emoji ?? "✦")}</span><figcaption>${esc(it.caption)}</figcaption></figure>`).join("")}</div>`;
    case "pricing":
      return `<header class="sec-head"><h2>${esc(sec.title)}</h2>${sec.intro ? `<p class="muted">${esc(sec.intro)}</p>` : ""}</header><div class="cards plans">${sec.plans.map((pl) => `<article class="card plan reveal${pl.featured ? " featured" : ""}">${pl.featured ? '<span class="badge">Popular</span>' : ""}<h3>${esc(pl.name)}</h3><p class="big">${pl.price ? `${esc(pl.price)}${pl.period ? `<small> / ${esc(pl.period)}</small>` : ""}` : ph("Price on request")}</p><ul class="ticks">${pl.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul><a class="btn ${pl.featured ? "primary" : "ghost"} wide" href="#${has("contact") ?? "top"}">Enquire</a></article>`).join("")}</div>`;
    case "process":
      return `<header class="sec-head"><h2>${esc(sec.title)}</h2></header><ol class="steps">${sec.steps.map((st) => `<li class="reveal"><h3>${esc(st.title)}</h3><p class="muted">${esc(st.desc)}</p></li>`).join("")}</ol>`;
    case "faq":
      return `<header class="sec-head"><h2>${esc(sec.title)}</h2></header><div class="faq">${sec.items.map((it) => `<details><summary>${esc(it.q)}</summary><p>${esc(it.a)}</p></details>`).join("")}</div>`;
    case "hours":
      return `<div class="split"><div><h2>${esc(sec.title)}</h2><p class="muted">${spec.facts.address ? esc(spec.facts.address) : ph("Address to be added")}</p>${c.maps ? `<a class="btn ghost" href="${esc(c.maps)}" target="_blank" rel="noopener noreferrer">Get directions</a>` : ""}</div><div class="card">${hoursHtml(spec.facts)}</div></div>`;
    case "cta": {
      const h = ctaHref(sec.button.action, c, has);
      return `<div class="cta-band"><div><h2>${esc(sec.title)}</h2>${sec.body ? `<p>${esc(sec.body)}</p>` : ""}</div><a class="btn primary" ${link(h)}>${esc(sec.button.label)}</a></div>`;
    }
    case "contact":
      return `<div class="split"><div><h2>${esc(sec.title)}</h2>${sec.body ? `<p class="muted">${esc(sec.body)}</p>` : ""}${contactList(c)}${!has("hours") ? `<h3>Opening hours</h3>${hoursHtml(spec.facts)}` : ""}</div><div class="card">${formHtml(sec.fields, id)}</div></div>`;
  }
}

function renderWebsite(spec: SiteSpec, o: { year?: number; agency?: string }): Rendered {
  const c = contactModel(spec.facts);
  const ids = sectionIds(spec.sections);
  const has = (t: string) => { const i = spec.sections.findIndex((s) => s.type === t); return i >= 0 ? ids[i] : null; };
  const nav = spec.sections.map((s, i) => ({ id: ids[i], label: NAV_LABEL[s.type], type: s.type })).filter((n, i, a) => n.label && a.findIndex((x) => x.type === n.type) === i).slice(0, 6);
  const agency = o.agency ?? "Infinity Web & Apps";
  const p1 = ctaHref(spec.hero.primary.action, c, has);
  const p2 = spec.hero.secondary ? ctaHref(spec.hero.secondary.action, c, has) : null;
  const chips = (spec.sections.find((s) => s.type === "about") as Extract<Section, { type: "about" }> | undefined)?.highlights.slice(0, 3)
    ?? (spec.sections.find((s) => s.type === "services") as Extract<Section, { type: "services" }> | undefined)?.items.slice(0, 3).map((i) => i.name) ?? [];
  const where = [spec.facts.area, spec.facts.city].filter(Boolean).join(", ");
  const title = `${spec.businessName} — ${spec.tagline}`.slice(0, 70);
  const sections = spec.sections.map((s, i) => ({ id: ids[i], type: s.type, title: s.title }));

  const css = baseCss(spec) + `
.top{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:16px;min-height:68px}.brand{display:flex;align-items:center;gap:10px;font:800 1.1rem var(--head);color:var(--ink);text-decoration:none;margin-right:auto;min-width:0}
.brand span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mono{width:38px;height:38px;flex:none;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;font:800 .95rem var(--head)}
.nav{display:flex;gap:4px;list-style:none;margin:0;padding:0}.nav a{display:block;padding:.55em .8em;border-radius:10px;color:var(--ink);text-decoration:none;font-weight:600;font-size:.95rem}.nav a:hover,.nav a.on{background:color-mix(in srgb,var(--primary) 10%,transparent);color:var(--primary)}
.menu-btn{display:none;width:48px;height:48px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-size:1.3rem;cursor:pointer}
.hero{position:relative;overflow:hidden;padding:clamp(56px,10vw,120px) 0 clamp(56px,8vw,96px)}
.hero::before,.hero::after{content:"";position:absolute;border-radius:50%;filter:blur(60px);opacity:.35;z-index:-1}.hero::before{width:520px;height:520px;background:var(--accent);top:-180px;right:-120px}.hero::after{width:420px;height:420px;background:var(--primary);bottom:-200px;left:-160px;opacity:.22}
.hero .wrap{display:grid;grid-template-columns:1.15fr .85fr;gap:48px;align-items:center}.eyebrow{display:inline-block;padding:.35em .9em;border-radius:999px;background:color-mix(in srgb,var(--primary) 12%,transparent);color:var(--primary);font-weight:700;font-size:.85rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:18px}
${spec.palette === "midnight" || spec.palette === "energy" ? ".eyebrow{color:var(--accent)}" : ""}
.hero h1{font-size:clamp(2.4rem,6vw,4.4rem);margin-bottom:.35em}.hero .sub{font-size:clamp(1.05rem,2vw,1.25rem);color:var(--muted);max-width:36em}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.facts{display:flex;flex-wrap:wrap;gap:18px;margin-top:28px;color:var(--muted);font-size:.95rem;padding:0;list-style:none}
.visual{position:relative;aspect-ratio:4/5;border-radius:28px;background:linear-gradient(150deg,var(--primary),var(--dark));box-shadow:var(--shadow);display:grid;place-items:center;overflow:hidden}
.visual::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 20%,color-mix(in srgb,var(--accent) 55%,transparent),transparent 55%)}
.visual .big-mono{font:800 clamp(4rem,10vw,7rem) var(--head);color:#fff;opacity:.95;z-index:1;letter-spacing:.04em}
.visual .glass{position:absolute;left:18px;right:18px;bottom:18px;z-index:2;padding:16px;border-radius:18px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff}
.visual .glass ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}.visual .glass li::before{content:"✓ ";color:var(--accent);font-weight:800}
section.sec{padding:clamp(64px,9vw,110px) 0;scroll-margin-top:68px}section.sec:nth-of-type(even){background:var(--surface)}
.sec-head{max-width:640px;margin-bottom:36px}.lead{font-size:1.1rem}.split{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start}
.chips{display:flex;flex-wrap:wrap;gap:10px;list-style:none;padding:0;margin:0;align-content:start}.chips li{padding:.65em 1.1em;border-radius:999px;background:var(--surface);border:1px solid var(--line);font-weight:600;box-shadow:var(--shadow)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:26px;box-shadow:var(--shadow)}
section.sec:nth-of-type(even) .card{background:var(--bg)}.num{font:800 .9rem var(--head);color:var(--primary);letter-spacing:.1em}.icon{font-size:1.8rem;display:block;margin-bottom:10px}
.price{font-weight:800;color:var(--primary);margin:0}.big{font:800 2rem var(--head);margin:.2em 0 .6em}.big small{font-size:.9rem;color:var(--muted)}
.plan{position:relative;display:flex;flex-direction:column}.plan .btn{margin-top:auto}.plan.featured{border:2px solid var(--primary)}.badge{position:absolute;top:-12px;right:20px;background:var(--primary);color:var(--primary-ink);padding:.2em .8em;border-radius:999px;font-size:.8rem;font-weight:700}
.ticks{list-style:none;padding:0;margin:0 0 20px;display:grid;gap:8px}.ticks li::before{content:"✓  ";color:var(--primary);font-weight:800}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}.tabs button{font:inherit;font-weight:700;min-height:44px;padding:.5em 1.1em;border-radius:999px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}.tabs button[aria-selected=true]{background:var(--primary);color:var(--primary-ink);border-color:var(--primary)}
.menu-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:4px 40px}.menu-list li{display:flex;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px dashed var(--line)}.menu-list strong{display:block}.menu-list .muted{font-size:.92rem}
.gallery{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.tile{margin:0;aspect-ratio:1;border-radius:var(--r);display:flex;flex-direction:column;justify-content:space-between;padding:18px;color:#fff;font-size:2.2rem;box-shadow:var(--shadow)}
.tile figcaption{font-size:.95rem;font-weight:700}.t0{background:linear-gradient(135deg,var(--primary),var(--dark))}.t1{background:linear-gradient(135deg,var(--accent),var(--primary))}.t2{background:linear-gradient(135deg,var(--dark),var(--primary))}.t3{background:linear-gradient(135deg,var(--primary),var(--accent))}
.tile:nth-child(1){grid-column:span 2;grid-row:span 2;aspect-ratio:auto}
.steps{list-style:none;counter-reset:s;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}.steps li{counter-increment:s;padding:24px;border-radius:var(--r);border:1px solid var(--line);background:var(--surface)}.steps li::before{content:counter(s);display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--primary);color:var(--primary-ink);font-weight:800;margin-bottom:14px}
.faq{display:grid;gap:12px;max-width:820px}.faq details{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:4px 20px}section.sec:nth-of-type(even) .faq details{background:var(--bg)}.faq summary{cursor:pointer;font-weight:700;padding:14px 0;list-style:none;display:flex;justify-content:space-between;gap:12px}.faq summary::after{content:"+";font-size:1.4rem;line-height:1;color:var(--primary)}.faq details[open] summary::after{content:"–"}
.cta-band{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:clamp(28px,5vw,56px);border-radius:28px;background:linear-gradient(135deg,var(--primary),var(--dark));color:#fff}.cta-band h2{color:#fff}.cta-band p{opacity:.85;margin:0}.cta-band .btn.primary{background:#fff;color:var(--dark);box-shadow:none;flex:none}
footer.foot{background:var(--dark);color:rgba(255,255,255,.75);padding:48px 0 32px;font-size:.95rem}footer.foot a{color:#fff}.foot .wrap{display:grid;gap:18px}.foot-top{display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;align-items:center}
.demo-notes{border:1px dashed rgba(255,255,255,.3);border-radius:12px;padding:10px 14px}.demo-notes summary{cursor:pointer;font-weight:700;color:#fff}.demo-notes p,.demo-notes ul{margin:.6em 0 0}
.wa-float{position:fixed;right:18px;bottom:18px;z-index:40;width:58px;height:58px;border-radius:50%;display:grid;place-items:center;background:#25d366;color:#fff;font-size:1.6rem;text-decoration:none;box-shadow:0 12px 28px -8px rgba(0,0,0,.4)}
@media (max-width:900px){.hero .wrap,.split{grid-template-columns:1fr}.visual{aspect-ratio:16/11;max-width:560px}.gallery{grid-template-columns:repeat(2,1fr)}.menu-list{grid-template-columns:1fr}}
@media (max-width:820px){.menu-btn{display:grid;place-items:center}.nav{position:absolute;left:0;right:0;top:100%;flex-direction:column;padding:12px 20px 20px;background:var(--bg);border-bottom:1px solid var(--line);box-shadow:var(--shadow);display:none}.nav.open{display:flex}.nav a{padding:.9em .8em}.top .cta{display:none}}
@media (max-width:640px){.cta-band{flex-direction:column;align-items:flex-start}.actions .btn{flex:1 1 100%}}`;

  const js = `(function(){var b=document.querySelector('.menu-btn'),n=document.getElementById('site-nav');if(b&&n){b.addEventListener('click',function(){var o=n.classList.toggle('open');b.setAttribute('aria-expanded',o?'true':'false');b.textContent=o?'✕':'☰'});n.addEventListener('click',function(e){if(e.target.closest('a')){n.classList.remove('open');b.setAttribute('aria-expanded','false');b.textContent='☰'}})}
document.querySelectorAll('[role=tablist]').forEach(function(l){var t=[].slice.call(l.querySelectorAll('[role=tab]'));function sel(x){t.forEach(function(y){var on=y===x;y.setAttribute('aria-selected',on?'true':'false');y.tabIndex=on?0:-1;document.getElementById(y.getAttribute('aria-controls')).hidden=!on})}t.forEach(function(x,i){x.addEventListener('click',function(){sel(x)});x.addEventListener('keydown',function(e){var k=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(k){var z=t[(i+k+t.length)%t.length];sel(z);z.focus()}})})});
${formJs}
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});document.querySelectorAll('.reveal').forEach(function(el){io.observe(el)});
var links={};document.querySelectorAll('.nav a').forEach(function(a){links[a.getAttribute('href').slice(1)]=a});var so=new IntersectionObserver(function(es){es.forEach(function(e){var a=links[e.target.id];if(a&&e.isIntersecting){Object.keys(links).forEach(function(k){links[k].classList.remove('on')});a.classList.add('on')}})},{rootMargin:'-45% 0px -50% 0px'});document.querySelectorAll('section[id]').forEach(function(s){so.observe(s)})}else{document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('in')})}
var y=document.getElementById('year');if(y)y.textContent=new Date().getFullYear()})();`;

  const body = `<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap"><a class="brand" href="#top" aria-label="${esc(spec.businessName)} home"><span class="mono" aria-hidden="true">${esc(monogram(spec.businessName))}</span><span>${esc(spec.businessName)}</span></a>
<button class="menu-btn" type="button" aria-controls="site-nav" aria-expanded="false" aria-label="Menu">☰</button>
<nav aria-label="Main"><ul class="nav" id="site-nav">${nav.map((n) => `<li><a href="#${n.id}">${esc(n.label)}</a></li>`).join("")}</ul></nav>
<a class="btn primary cta" ${link(p1)}>${esc(spec.hero.primary.label)}</a></div></header>
<main id="main">
<section class="hero" id="top" data-aston-section="top" data-aston-title="Homepage"><div class="wrap"><div>${spec.hero.eyebrow ? `<span class="eyebrow">${esc(spec.hero.eyebrow)}</span>` : ""}
<h1>${esc(spec.hero.headline)}</h1><p class="sub">${esc(spec.hero.sub)}</p>
<div class="actions"><a class="btn primary" ${link(p1)}>${esc(spec.hero.primary.label)}</a>${p2 && spec.hero.secondary ? `<a class="btn ghost" ${link(p2)}>${esc(spec.hero.secondary.label)}</a>` : ""}</div>
<ul class="facts">${where ? `<li>⌖ ${esc(where)}</li>` : ""}${spec.facts.hours[0] ? `<li>◷ ${esc(spec.facts.hours[0].days)} ${esc(spec.facts.hours[0].time)}</li>` : ""}${c.phone ? `<li>☎ <a href="tel:${esc(digits(c.phone))}">${esc(c.phone)}</a></li>` : ""}</ul></div>
<div class="visual" aria-hidden="true"><span class="big-mono">${esc(monogram(spec.businessName))}</span>${chips.length ? `<div class="glass"><ul>${chips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}</div></div></section>
${spec.sections.map((s, i) => `<section class="sec" id="${ids[i]}" data-aston-section="${ids[i]}" data-aston-title="${esc(s.title)}" aria-labelledby="${ids[i]}-h"><div class="wrap">${sectionBody(s, ids[i], spec, c, has).replace(/<h2>/, `<h2 id="${ids[i]}-h">`)}</div></section>`).join("\n")}
</main>
<footer class="foot"><div class="wrap"><div class="foot-top"><a class="brand" href="#top" style="color:#fff"><span class="mono" aria-hidden="true">${esc(monogram(spec.businessName))}</span><span>${esc(spec.businessName)}</span></a><span>© <span id="year">${o.year ?? new Date().getFullYear()}</span> ${esc(spec.businessName)}</span></div>
${demoNotes(spec, c.placeholders, agency)}</div></footer>
${c.wa ? `<a class="wa-float" href="https://wa.me/${c.wa}" target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp">💬</a>` : ""}`;

  return { html: doc(spec, title, css, body, js), sections: [{ id: "top", type: "hero", title: "Homepage" }, ...sections], placeholders: c.placeholders };
}

/* ----------------------------------------------------------------- app */

function renderApp(spec: SiteSpec, o: { year?: number; agency?: string }): Rendered {
  const c = contactModel(spec.facts);
  const agency = o.agency ?? "Infinity Web & Apps";
  const ids = sectionIds(spec.sections);
  const pick = (t: Section["type"]) => spec.sections.findIndex((s) => s.type === t);
  // tabs: Home, the main offer (menu/services/pricing), Book, Info
  const offerIdx = [pick("menu"), pick("services"), pick("pricing")].find((i) => i >= 0) ?? -1;
  const contactIdx = pick("contact");
  const screens: { id: string; title: string; tab: string; icon: string; html: string }[] = [];
  const has = (t: string) => { const i = pick(t as Section["type"]); return i >= 0 ? ids[i] : null; };
  const go = (id: string | null) => (id ? `href="#${id}" data-go="${id}"` : 'href="#home" data-go="home"');
  const homeExtras = spec.sections.filter((s, i) => i !== offerIdx && i !== contactIdx && ["about", "features", "gallery", "process"].includes(s.type));
  screens.push({
    id: "home", title: spec.businessName, tab: "Home", icon: "⌂",
    html: `<div class="hero-card"><span class="mono-lg" aria-hidden="true">${esc(monogram(spec.businessName))}</span>${spec.hero.eyebrow ? `<span class="eyebrow">${esc(spec.hero.eyebrow)}</span>` : ""}<h1>${esc(spec.hero.headline)}</h1><p>${esc(spec.hero.sub)}</p>
<a class="btn primary wide" ${go(spec.hero.primary.action === "menu" || spec.hero.primary.action === "services" ? (offerIdx >= 0 ? ids[offerIdx] : null) : contactIdx >= 0 ? ids[contactIdx] : null)}>${esc(spec.hero.primary.label)}</a></div>
<div class="quick">${c.phone ? `<a class="q" href="tel:${esc(digits(c.phone))}"><span>☎</span>Call</a>` : `<span class="q off"><span>☎</span>${ph("Phone")}</span>`}${c.wa ? `<a class="q" href="https://wa.me/${c.wa}" target="_blank" rel="noopener noreferrer"><span>💬</span>WhatsApp</a>` : ""}${c.maps ? `<a class="q" href="${esc(c.maps)}" target="_blank" rel="noopener noreferrer"><span>⌖</span>Directions</a>` : ""}<a class="q" ${go(contactIdx >= 0 ? ids[contactIdx] : "info")}><span>✎</span>Book</a></div>
${homeExtras.map((s) => appBlock(s, spec)).join("")}`,
  });
  if (offerIdx >= 0) {
    const s = spec.sections[offerIdx];
    screens.push({ id: ids[offerIdx], title: s.title, tab: s.type === "menu" ? "Menu" : s.type === "pricing" ? "Plans" : "Services", icon: s.type === "menu" ? "☰" : "✦", html: appBlock(s, spec) });
  }
  if (contactIdx >= 0) {
    const s = spec.sections[contactIdx] as Extract<Section, { type: "contact" }>;
    screens.push({ id: ids[contactIdx], title: s.title, tab: "Book", icon: "✎", html: `${s.body ? `<p class="muted">${esc(s.body)}</p>` : ""}<div class="block">${formHtml(s.fields, ids[contactIdx])}</div>` });
  }
  const faq = spec.sections.find((s) => s.type === "faq");
  screens.push({ id: "info", title: "Info", tab: "Info", icon: "ⓘ", html: `<div class="block"><h2>Opening hours</h2>${hoursHtml(spec.facts)}</div><div class="block"><h2>Contact</h2>${contactList(c)}</div>${faq ? appBlock(faq, spec) : ""}` });

  const css = baseCss(spec) + `
body{background:radial-gradient(circle at 20% 10%,color-mix(in srgb,var(--accent) 35%,var(--bg)),var(--bg) 55%);min-height:100vh}
.stage{display:grid;grid-template-columns:1fr auto;gap:56px;align-items:center;width:min(1080px,100% - 40px);margin:0 auto;padding:48px 0}
.pitch-title{font:800 clamp(2rem,4vw,3rem)/1.1 var(--head);margin:0 0 .4em}.pitch .tag{color:var(--muted);font-size:1.1rem}
.phone{width:390px;height:800px;border-radius:48px;background:var(--dark);padding:12px;box-shadow:0 40px 80px -30px rgba(0,0,0,.55)}
.screen-wrap{position:relative;height:100%;border-radius:38px;overflow:hidden;background:var(--bg);display:flex;flex-direction:column}
.bar{display:flex;align-items:center;gap:10px;padding:18px 18px 12px;font:800 1.05rem var(--head);border-bottom:1px solid var(--line);background:var(--surface)}
.bar .mono{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;font-size:.8rem}
.screens{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}.scr{padding:18px;display:grid;gap:16px}.scr[hidden]{display:none}
.hero-card{border-radius:24px;padding:22px;background:linear-gradient(150deg,var(--primary),var(--dark));color:#fff}.hero-card h1{font-size:1.7rem;color:#fff}.hero-card p{opacity:.88}.hero-card .eyebrow{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.85;margin-bottom:6px}
.hero-card .btn.primary{background:#fff;color:var(--dark);box-shadow:none}.mono-lg{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:rgba(255,255,255,.18);font:800 1.2rem var(--head);margin-bottom:14px}
.quick{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.q{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 4px;border-radius:16px;background:var(--surface);border:1px solid var(--line);text-decoration:none;color:var(--ink);font-weight:700;font-size:.8rem;text-align:center;min-height:48px}.q span:first-child{font-size:1.3rem;color:var(--primary)}.q.off .ph{font-size:.7rem}
.block{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:18px}.block h2{font-size:1.25rem}.block .form{grid-template-columns:1fr}
.row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px dashed var(--line)}.row:last-child{border-bottom:0}.row strong{display:block}.row .muted{font-size:.88rem}.price{font-weight:800;color:var(--primary);white-space:nowrap}
.pills{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}.pills button{flex:none;font:inherit;font-weight:700;font-size:.88rem;min-height:40px;padding:.4em 1em;border-radius:999px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink)}.pills button[aria-selected=true]{background:var(--primary);color:var(--primary-ink);border-color:var(--primary)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.tile{aspect-ratio:1;border-radius:16px;padding:12px;display:flex;flex-direction:column;justify-content:space-between;color:#fff;font-size:1.6rem;background:linear-gradient(135deg,var(--primary),var(--accent))}.tile:nth-child(even){background:linear-gradient(135deg,var(--dark),var(--primary))}.tile small{font-size:.8rem;font-weight:700}
.tabbar{display:flex;border-top:1px solid var(--line);background:var(--surface);padding:6px 6px 14px}.tabbar a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0;text-decoration:none;color:var(--muted);font-size:.72rem;font-weight:700;border-radius:12px;min-height:48px}.tabbar a span{font-size:1.2rem}.tabbar a[aria-current=page]{color:var(--primary);background:color-mix(in srgb,var(--primary) 10%,transparent)}
details.q2{border-bottom:1px solid var(--line);padding:10px 0}details.q2 summary{font-weight:700;cursor:pointer}
.notes{width:min(1080px,100% - 40px);margin:0 auto 40px;color:var(--muted);font-size:.9rem}.notes .demo-notes{border-color:var(--line)}.notes summary{color:var(--ink)}
@media (max-width:860px){.stage{grid-template-columns:1fr;padding:0;width:100%;gap:0}.pitch{display:none}.phone{width:100%;height:100vh;height:100dvh;border-radius:0;padding:0;box-shadow:none}.screen-wrap{border-radius:0}.notes{margin:16px auto}}`;

  const js = `(function(){var scr=[].slice.call(document.querySelectorAll('.scr')),tabs=[].slice.call(document.querySelectorAll('.tabbar a')),title=document.getElementById('bar-title'),box=document.querySelector('.screens');
function show(id){var t=scr.filter(function(s){return s.id===id})[0];if(!t)return false;scr.forEach(function(s){s.hidden=s!==t});tabs.forEach(function(a){if(a.dataset.go===id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});title.textContent=t.dataset.title;box.scrollTop=0;return true}
window.astonGoto=show;document.addEventListener('click',function(e){var a=e.target.closest('[data-go]');if(a){e.preventDefault();show(a.dataset.go)}});
document.querySelectorAll('[role=tablist]').forEach(function(l){var t=[].slice.call(l.querySelectorAll('[role=tab]'));t.forEach(function(x){x.addEventListener('click',function(){t.forEach(function(y){var on=y===x;y.setAttribute('aria-selected',on?'true':'false');document.getElementById(y.getAttribute('aria-controls')).hidden=!on})})})});
${formJs}})();`;

  const body = `<div class="stage"><div class="pitch"><span class="eyebrow">App demo</span><p class="pitch-title">${esc(spec.businessName)}</p><p class="tag">${esc(spec.tagline)}</p><p class="muted">An interactive preview of the ${esc(spec.businessName)} app. Tap through the screens on the phone.</p></div>
<div class="phone" role="application" aria-label="${esc(spec.businessName)} app preview"><div class="screen-wrap"><div class="bar"><span class="mono" aria-hidden="true">${esc(monogram(spec.businessName))}</span><span id="bar-title">${esc(spec.businessName)}</span></div>
<main class="screens" id="main">${screens.map((s, i) => `<section class="scr" id="${s.id}" data-title="${esc(s.title)}" data-aston-section="${s.id}" data-aston-title="${esc(s.tab)} screen"${i ? " hidden" : ""}>${s.html}</section>`).join("")}</main>
<nav class="tabbar" aria-label="App">${screens.map((s, i) => `<a href="#${s.id}" data-go="${s.id}"${i ? "" : ' aria-current="page"'}><span aria-hidden="true">${s.icon}</span>${esc(s.tab)}</a>`).join("")}</nav></div></div></div>
<div class="notes">${demoNotes(spec, c.placeholders, agency)}</div>`;
  void has;
  return {
    html: doc(spec, `${spec.businessName} app — ${spec.tagline}`.slice(0, 70), css, body, js),
    sections: screens.map((s) => ({ id: s.id, type: s.id === "home" ? "hero" : s.id === "info" ? "info" : spec.sections[ids.indexOf(s.id)]?.type ?? s.id, title: `${s.tab} screen` })),
    placeholders: c.placeholders,
  };
}

function appBlock(s: Section, spec: SiteSpec): string {
  switch (s.type) {
    case "menu":
      return `<div class="pills" role="tablist" aria-label="${esc(s.title)}">${s.categories.map((c, i) => `<button role="tab" id="am-tab-${i}" aria-controls="am-panel-${i}" aria-selected="${i === 0}">${esc(c.name)}</button>`).join("")}</div>
${s.categories.map((c, i) => `<div class="block" role="tabpanel" id="am-panel-${i}" aria-labelledby="am-tab-${i}"${i ? " hidden" : ""}>${c.items.map((it) => `<div class="row"><div><strong>${esc(it.name)}</strong>${it.desc ? `<span class="muted">${esc(it.desc)}</span>` : ""}</div>${it.price ? `<span class="price">${esc(it.price)}</span>` : ""}</div>`).join("")}</div>`).join("")}`;
    case "services":
      return `<div class="block"><h2>${esc(s.title)}</h2>${s.items.map((it) => `<div class="row"><div><strong>${esc(it.name)}</strong><span class="muted">${esc(it.desc)}</span></div>${it.price ? `<span class="price">${esc(it.price)}</span>` : ""}</div>`).join("")}</div>`;
    case "pricing":
      return s.plans.map((p) => `<div class="block"><h2>${esc(p.name)}</h2><p class="price">${p.price ? `${esc(p.price)}${p.period ? ` / ${esc(p.period)}` : ""}` : ph("Price on request")}</p>${p.features.map((f) => `<div class="row"><span>✓ ${esc(f)}</span></div>`).join("")}</div>`).join("");
    case "about":
      return `<div class="block"><h2>${esc(s.title)}</h2><p>${esc(s.body.split(/\n{2,}/)[0])}</p></div>`;
    case "features":
      return `<div class="block"><h2>${esc(s.title)}</h2>${s.items.map((it) => `<div class="row"><div><strong>${esc(it.icon ?? "✦")} ${esc(it.title)}</strong><span class="muted">${esc(it.desc)}</span></div></div>`).join("")}</div>`;
    case "gallery":
      return `<div class="block"><h2>${esc(s.title)}</h2><p class="muted">Photo placeholders — real photos of ${esc(spec.businessName)} go here.</p><div class="grid2">${s.items.slice(0, 4).map((it) => `<div class="tile"><span aria-hidden="true">${esc(it.emoji ?? "✦")}</span><small>${esc(it.caption)}</small></div>`).join("")}</div></div>`;
    case "process":
      return `<div class="block"><h2>${esc(s.title)}</h2>${s.steps.map((st, i) => `<div class="row"><div><strong>${i + 1}. ${esc(st.title)}</strong><span class="muted">${esc(st.desc)}</span></div></div>`).join("")}</div>`;
    case "faq":
      return `<div class="block"><h2>${esc(s.title)}</h2>${s.items.map((it) => `<details class="q2"><summary>${esc(it.q)}</summary><p>${esc(it.a)}</p></details>`).join("")}</div>`;
    default:
      return "";
  }
}

function doc(spec: SiteSpec, title: string, css: string, body: string, js: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`${spec.businessName} — ${spec.tagline}`.slice(0, 160))}">
<meta name="theme-color" content="${PALETTES[spec.palette].primary}">
<meta name="robots" content="noindex">
${fontLink(spec)}
<style>${css}</style>
</head>
<body>
${body}
<script>${js}</script>
</body>
</html>
`;
}
