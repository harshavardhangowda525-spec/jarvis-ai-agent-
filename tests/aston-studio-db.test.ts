import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, isDbConfigured } from "@/lib/db";

/**
 * The whole studio pipeline with a scripted brain (no AI): plan → files → preview
 * → REAL browser tests (Chromium) → a fix round → a change → new version.
 * Skipped when there's no database or no browser.
 */
const browser = ["/opt/pw-browsers/chromium", process.env.ASTON_BROWSER ?? ""].some((p) => p && fs.existsSync(p));
const d = isDbConfigured && browser ? describe : describe.skip;

const plan = {
  name: "Iron Temple", client: "Iron Temple", summary: "A gym website.", audience: "Locals", personality: ["bold"], style: "fitness",
  pages: [
    { file: "index.html", title: "Iron Temple", nav: "Home", purpose: "Intro", sections: [{ id: "hero", purpose: "Train hard" }] },
    { file: "contact.html", title: "Book a trial", nav: "Trial", purpose: "Booking", sections: [{ id: "book", purpose: "Trial booking" }] },
  ],
  design: { colors: { bg: "#0b0b0b", text: "#f5f5f5", accent: "#c6ff00" }, fonts: { display: { family: "Oswald", weights: [700] }, body: { family: "Inter", weights: [400] } }, typeScale: "x", spacing: "x", grid: "x", breakpoints: "768", motion: "x", imageTreatment: "x", states: "x" },
  forms: [{ id: "trial", kind: "booking", page: "contact.html", fields: [{ name: "name", label: "Name", type: "text", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "date", label: "Date", type: "date", required: true }, { name: "time", label: "Time", type: "time", required: true }], success: "Your trial is booked." }],
  features: ["Mobile menu"], assets: [{ file: "assets/hero.svg", description: "Hero art" }], facts: { phone: "98450 44444" }, placeholders: ["Trainer photos"], assumptions: [], acceptance: [], envVars: [],
};

const css = `:root{--bg:#0b0b0b;--tx:#f5f5f5;--ac:#c6ff00}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:Inter,system-ui,sans-serif}
.skip-link{position:absolute;left:-999px}.skip-link:focus{left:8px;top:8px;background:#fff;color:#000;padding:8px}
a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid var(--ac);outline-offset:2px}
header{display:flex;justify-content:space-between;align-items:center;padding:16px}a{color:var(--ac)}
#site-nav ul{display:flex;gap:16px;list-style:none;margin:0;padding:0}.nav-toggle{display:none}
@media (max-width:767px){.nav-toggle{display:block}#site-nav{display:none}body.nav-open #site-nav{display:block}}
img{max-width:100%;height:auto}h1{font-size:clamp(2rem,8vw,5rem);overflow-wrap:anywhere}
.field-error{color:#f87171}[data-form-status][data-state=success]{color:var(--ac)}
[data-reveal]{transition:opacity .6s}html.js [data-reveal]:not(.is-visible){opacity:0}
@media (prefers-reduced-motion:reduce){html.js [data-reveal]:not(.is-visible){opacity:1}*{transition:none!important}}`;
const js = `document.documentElement.classList.add("js");
const t=document.querySelector("[data-nav-toggle]");
if(t){const set=o=>{t.setAttribute("aria-expanded",String(o));document.body.classList.toggle("nav-open",o)};t.addEventListener("click",()=>set(t.getAttribute("aria-expanded")!=="true"));document.addEventListener("keydown",e=>{if(e.key==="Escape")set(false)});}
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add("is-visible")}));document.querySelectorAll("[data-reveal]").forEach(el=>io.observe(el));`;
const page = (file: string, title: string, body: string, forms = false) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${title}"><link rel="stylesheet" href="css/styles.css"></head>
<body><a class="skip-link" href="#main">Skip to content</a>
<header><a href="index.html">IRON TEMPLE</a><button class="nav-toggle" type="button" data-nav-toggle aria-controls="site-nav" aria-expanded="false">Menu</button>
<nav id="site-nav" aria-label="Main"><ul><li><a href="index.html"${file === "index.html" ? ' aria-current="page"' : ""}>Home</a></li><li><a href="contact.html"${file === "contact.html" ? ' aria-current="page"' : ""}>Trial</a></li></ul></nav></header>
<main id="main">${body}</main><footer><a href="tel:9845044444">98450 44444</a></footer>
<script src="js/main.js" defer></script>${forms ? '<script src="_aston/forms.js" defer></script>' : ""}</body></html>`;
const index = (wide = false) => page("index.html", "Iron Temple", `<h1 data-reveal>Train at Iron Temple</h1><p data-reveal>Strength classes in Indiranagar.</p><img src="assets/hero.svg" alt="Abstract hero artwork" width="600" height="400">${wide ? '<div style="width:1200px">wide banner</div>' : ""}<p><a href="contact.html#book">Book a trial</a></p>`);
const contact = page("contact.html", "Book a trial", `<h1>Book a free trial</h1><section id="book"><form data-aston-form="trial" novalidate>
<label for="name">Name</label><input id="name" name="name" required><label for="email">Email</label><input id="email" name="email" type="email" required>
<label for="date">Date</label><input id="date" name="date" type="date" required><label for="time">Time</label><input id="time" name="time" type="time" required>
<input type="text" name="_gotcha" tabindex="-1" autocomplete="off" hidden><button type="submit">Book</button><p data-form-status aria-live="polite"></p></form></section>`, true);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400"><title>Placeholder artwork</title><rect width="600" height="400" fill="#c6ff00"/></svg>`;
const files = (fs2: Record<string, string>) => Object.entries(fs2).map(([p, c]) => `<<<FILE ${p}>>>\n${c}\n<<<END>>>`).join("\n");

d("ASTON studio pipeline with a real browser (integration)", () => {
  let userId = "";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aston-studio-"));
  let S: typeof import("@/lib/aston/studio/build");
  beforeAll(async () => {
    process.env.ASTON_PROJECTS_DIR = root;
    S = await import("@/lib/aston/studio/build");
    userId = (await getDb().user.create({ data: { email: `studio-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); fs.rmSync(root, { recursive: true, force: true }); });

  /** A brain that answers each step by what it's asked, streaming in small pieces. */
  const scripted = (route: (user: string) => string) => {
    const calls: string[] = [];
    const stream: import("@/lib/aston/studio/build").Stream = async (_s, user, onDelta) => {
      calls.push(user);
      const text = route(user);
      for (let i = 0; i < text.length; i += 37) onDelta(text.slice(i, i + 37));
      return text;
    };
    return { stream, calls };
  };

  let projectId = "";
  it("plans, writes, serves and browser-tests a site; a planted overflow bug is found and fixed", async () => {
    let fixPrompt = "";
    const { stream, calls } = scripted((u) => {
      if (u.startsWith("BRIEF")) return JSON.stringify(plan);
      if (u.startsWith("Write the shared foundation")) return files({ "css/styles.css": css, "js/main.js": js });
      if (u.startsWith("Write ONLY the artwork")) return files({ "assets/hero.svg": svg });
      if (u.startsWith("Write index.html")) return files({ "index.html": index(true) }); // with a planted overflow bug
      if (u.startsWith("Write contact.html")) return files({ "contact.html": contact });
      if (u.includes("checks FAILED")) { fixPrompt = u; return files({ "index.html": index(false) }); } // the fix round
      throw new Error(`unexpected prompt: ${u.slice(0, 80)}`);
    });
    const steps: string[] = [];
    const r = await S.runStudio(userId, { mode: "studio", action: "create", name: "Iron Temple" }, { brief: "A premium gym website for Iron Temple with a trial booking form. Phone 98450 44444.", stream, onStep: (t) => steps.push(t) });
    projectId = r.project.id;
    expect(r.report?.checks.filter((c) => c.status === "fail").map((c) => c.detail)).toEqual([]);
    expect(calls.length).toBe(6); // plan, foundation, artwork, 2 pages, 1 fix
    expect(fixPrompt).toMatch(/index\.html at 390px scrolls sideways/);
    const dir = path.join(root, r.project.slug, "versions", "v001");
    for (const f of ["site/index.html", "site/contact.html", "site/css/styles.css", "site/js/main.js", "site/assets/hero.svg", "plan.json", "tests/report.json"]) expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    expect(r.report).not.toBeNull();
    const rep = r.report!;
    const byId = (id: string) => rep.checks.filter((c) => c.id === id);
    expect(byId("overflow").every((c) => c.status === "pass")).toBe(true); // fixed in round 1
    expect(byId("mobile-menu")[0].status).toBe("pass");
    expect(byId("form-trial-submit")[0].status).toBe("pass");
    expect(byId("form-trial-slot")[0].status).toBe("pass");
    expect(byId("form-trial-validation")[0].status).toBe("pass");
    expect(byId("keyboard")[0].status).toBe("pass");
    expect(byId("nav-link").every((c) => c.status === "pass")).toBe(true);
    expect(byId("reduced-motion").every((c) => c.status === "pass")).toBe(true);
    expect(rep.failed).toBe(0);
    expect(rep.screenshots.map((s) => `${s.page}@${s.viewport}`).sort()).toEqual(["contact.html@desktop", "contact.html@mobile", "index.html@desktop", "index.html@mobile"]);
    expect(r.fixed).toBeGreaterThan(0);
    expect(steps.some((s) => /scrolls sideways/.test(s))).toBe(true);
    const p = await getDb().astonProject.findUnique({ where: { id: projectId } });
    expect(p?.state).toBe("review");
    expect(p?.currentVersion).toBe(1);
    expect(await getDb().astonSubmission.count({ where: { projectId, test: true } })).toBe(0); // test bookings cleaned up
    const meta = JSON.parse(fs.readFileSync(path.join(root, r.project.slug, "project_metadata.json"), "utf8"));
    expect(meta.state).toBe("review");
    expect(meta.tests.failed).toBe(0);
  }, 300_000);

  it("a change makes version 2 from version 1; version 1's files are untouched", async () => {
    const p = (await getDb().astonProject.findUnique({ where: { id: projectId } }))!;
    const before = fs.readFileSync(path.join(root, p.slug, "versions", "v001", "site", "index.html"), "utf8");
    const { stream } = scripted((u) => u.startsWith("The website already exists")
      ? JSON.stringify({ summary: "New hero headline", spec: plan, files: ["index.html"] })
      : files({ "index.html": index(false).replace("Train at Iron Temple", "Stronger every week") }));
    const r = await S.runStudio(userId, { mode: "studio", action: "change", projectId, change: "Change the hero headline" }, { brief: p.brief, stream });
    expect(r.version).toBe(2);
    expect(fs.readFileSync(path.join(root, p.slug, "versions", "v002", "site", "index.html"), "utf8")).toContain("Stronger every week");
    expect(fs.readFileSync(path.join(root, p.slug, "versions", "v002", "site", "contact.html"), "utf8")).toBe(contact); // copied, unchanged
    expect(fs.readFileSync(path.join(root, p.slug, "versions", "v001", "site", "index.html"), "utf8")).toBe(before);
    expect(r.report?.checks.filter((c) => c.status === "fail").map((c) => c.detail)).toEqual([]);
  }, 300_000);
});
