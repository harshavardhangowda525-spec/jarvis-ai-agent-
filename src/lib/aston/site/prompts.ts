import { FONTS, SECTION_TYPES, type SitePlan, type SiteSection } from "./assemble";

/**
 * The design brief ASTON writes websites against. Each step is small enough
 * to stay inside Groq's free per-minute token budget.
 */

const QUALITY =
  "Design bar: a modern, premium, award-quality site — strong typographic hierarchy, generous whitespace, a clear visual rhythm, " +
  "tasteful gradients and depth, subtle motion, and excellent mobile layouts. Never generic, never cluttered.";

const HONESTY =
  "Use ONLY facts given in the brief. Never invent phone numbers, addresses, prices, awards, client names or statistics — " +
  "write a clear placeholder in [square brackets] instead (e.g. [Phone number]). Testimonials, if any, must be labelled \"Sample review\".";

export function planPrompt(brief: string) {
  return [
    {
      role: "system" as const,
      content:
        `You are ASTON's senior web designer at Infinity Web & Apps. Plan a one-page marketing website. ${QUALITY} ${HONESTY}\n` +
        "Reply with ONE JSON object only, no prose:\n" +
        `{"siteName": str, "tagline": str (<=90 chars), "industry": str, "tone": str, "mode": "dark"|"light",\n` +
        ` "palette": {"bg","surface","text","muted","primary","accent"} (6-digit hex; WCAG AA contrast between text and bg; a distinctive, on-brand palette),\n` +
        ` "fonts": {"heading": one of ${JSON.stringify(FONTS)}, "body": one of the same},\n` +
        ` "sections": [{"id": kebab-case, "type": one of ${JSON.stringify(SECTION_TYPES)}, "title": short nav label, "brief": 1-2 sentences of what it shows, specific to this business, "inNav": bool}],\n` +
        ` "cta": {"label": str, "target": "#<section id>"}}\n` +
        "6-8 sections: hero first, contact near the end, footer last.",
    },
    { role: "user" as const, content: `Brief: ${brief.slice(0, 2000)}` },
  ];
}

const planSummary = (plan: SitePlan, sections: SiteSection[]) =>
  JSON.stringify({ ...plan, sections: sections.map(({ id, type, title, brief }) => ({ id, type, title, brief })) });

export function cssPrompt(brief: string, plan: SitePlan, sections: SiteSection[]) {
  return [
    {
      role: "system" as const,
      content:
        `You are ASTON's senior front-end designer. Write the complete stylesheet (styles.css) for this website. ${QUALITY}\n` +
        "Start with a comment block exactly like `/* GUIDE\n.class — what it is\n... */` (max 25 lines) listing every reusable class you define, so other designers can use them.\n" +
        "Requirements:\n" +
        "- :root custom properties from the palette (--bg, --surface, --text, --muted, --primary, --accent) plus radii, shadows and spacing tokens; fonts via var(--font-heading)/var(--font-body) using the planned Google fonts (already linked — no @import).\n" +
        "- Base: box-sizing, smooth scroll, body, fluid type with clamp(), headings, links, selection colour, focus-visible outlines.\n" +
        "- Layout: .container (max 1200px), .section (vertical padding), .grid, .grid-2, .grid-3, .stack, .center.\n" +
        "- Components: .eyebrow, .lead, .btn, .btn-primary, .btn-ghost, .card, .glass, .badge, .icon (for inline SVG), .divider.\n" +
        "- Header (style exactly this markup): <header class=\"site-header\"><div class=\"container nav-bar\"><a class=\"brand\"></a><nav class=\"nav\"><a></a>…<a class=\"btn btn-primary nav-cta\"></a></nav><button class=\"nav-toggle\"><span></span><span></span></button></div></header>. Fixed, transparent at top; `.site-header.scrolled` gets a blurred translucent background. Under 900px the .nav becomes a full-screen overlay shown when `body.nav-open`; .nav-toggle is a 2-line burger that turns into an X.\n" +
        "- Motion: [data-reveal] starts hidden (opacity 0, translateY 24px) and `.is-visible` animates it in; [data-reveal=\"left\"|\"right\"|\"zoom\"] variants; staggering via style=\"--d:1..4\" (transition-delay calc). Respect prefers-reduced-motion.\n" +
        "- Rich backgrounds: gradient meshes / soft glows using the palette, a subtle noise or grid pattern via CSS only.\n" +
        "- Responsive at 900px and 600px.\n" +
        "Output CSS only — no explanations, no markdown fences.",
    },
    { role: "user" as const, content: `Brief: ${brief.slice(0, 1200)}\nPlan: ${planSummary(plan, sections)}` },
  ];
}

export function sectionPrompt(brief: string, plan: SitePlan, sections: SiteSection[], guide: string, s: SiteSection) {
  const wrapper = s.type === "footer"
    ? `<footer id="${s.id}" class="site-footer">…</footer>`
    : `<section id="${s.id}" class="section section-${s.type}">…</section>`;
  return [
    {
      role: "system" as const,
      content:
        `You are ASTON's senior web designer writing ONE part of a website. ${QUALITY} ${HONESTY}\n` +
        `Write only this element: ${wrapper}\n` +
        "- Use the stylesheet's classes from the GUIDE below. For anything section-specific, put a <style> block as the FIRST child, with every selector scoped under #" + s.id + ".\n" +
        "- Make it visually rich: layered layout, a strong visual (an inline SVG illustration, icon set or decorative shapes drawn in SVG/CSS gradients — NO <img>, NO external images, NO emoji).\n" +
        "- Real, specific, persuasive copy for this business (no lorem ipsum). Add data-reveal (and style=\"--d:N\" for stagger) to elements that should animate in.\n" +
        (s.type === "hero" ? "- The hero must be striking: big headline, supporting line, the primary CTA (" + JSON.stringify(plan.cta) + ") plus a secondary button, and a large decorative visual. Leave room at the top for the fixed header.\n" : "") +
        (s.type === "footer" ? "- Include brand, short description, nav links to the sections, contact placeholders, and © <span data-year></span> " + plan.siteName + ".\n" : "") +
        (s.type === "contact" ? "- A styled contact form (name, email/phone, message, submit) with action=\"#\" plus contact details (placeholders unless given).\n" : "") +
        "No <script>, no inline event handlers. Output HTML only — no markdown fences, no explanations.\n" +
        `GUIDE:\n${guide || "(use semantic classes: .container .grid-2 .grid-3 .card .btn .btn-primary .btn-ghost .eyebrow .lead)"}`,
    },
    {
      role: "user" as const,
      content: `Brief: ${brief.slice(0, 1000)}\nSite: ${JSON.stringify({ siteName: plan.siteName, tagline: plan.tagline, tone: plan.tone, mode: plan.mode, palette: plan.palette })}\n` +
        `All sections: ${sections.map((x) => `#${x.id} (${x.type}: ${x.title})`).join(", ")}\n` +
        `Write #${s.id} — ${s.type}: ${s.title}. ${s.brief}`,
    },
  ];
}

export function revisePickPrompt(instruction: string, sections: SiteSection[]) {
  return [
    {
      role: "system" as const,
      content:
        'Decide which single part of a website a change request applies to. Reply with JSON only: {"target": "css" | "<section id>"}. ' +
        'Use "css" for site-wide colours, fonts, spacing or overall style; otherwise the most relevant section id.',
    },
    { role: "user" as const, content: `Sections: ${sections.map((s) => `${s.id} (${s.type}: ${s.title})`).join(", ")}\nRequest: ${instruction.slice(0, 500)}` },
  ];
}

export function revisePrompt(instruction: string, kind: "css" | "section", current: string, plan: SitePlan, guide: string) {
  return [
    {
      role: "system" as const,
      content:
        `You are ASTON's senior web designer. Apply the owner's change to this ${kind === "css" ? "stylesheet" : "HTML section"} and return the COMPLETE updated ${kind === "css" ? "CSS (keep the GUIDE comment at the top)" : "element (same id and wrapper)"}. ` +
        `${QUALITY} ${HONESTY} ${kind === "section" ? "No <script>, no inline handlers, no <img>/external images. " : ""}Output code only — no fences, no explanations.` +
        (kind === "section" && guide ? `\nGUIDE:\n${guide}` : ""),
    },
    { role: "user" as const, content: `Site: ${plan.siteName}\nChange: ${instruction.slice(0, 800)}\nCurrent:\n${current.slice(0, 14_000)}` },
  ];
}
