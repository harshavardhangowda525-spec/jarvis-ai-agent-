import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
const H = vi.hoisted(() => {
  process.env.ASTON_OWNER_EMAIL = "aston-site-owner@example.com";
  process.env.GROQ_API_KEY = "gsk_site_test_key_000000000000000000000";
  process.env.ASTON_AI_MAX_RETRIES = "2";
  class UnauthorizedError extends Error {}
  return { user: null as null | { id: string; email: string }, UnauthorizedError };
});
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: H.UnauthorizedError,
  getCurrentUser: async () => H.user,
  requireUser: async () => { if (!H.user) throw new H.UnauthorizedError("Unauthorized"); return H.user; },
}));

import { getDb, isDbConfigured } from "@/lib/db";
import {
  normalizePlan, cleanHtml, cleanCss, extractGuide, extractJson, assembleSite, WEBSITE_INTENT, RUNTIME_JS, type SitePlan,
} from "@/lib/aston/site/assemble";
import { highlight } from "@/lib/aston/site/highlight";
import { groqStream, memoryStore, type GroqDeps } from "@/lib/aston/groq";

const PLAN = {
  siteName: "Brew Lab", tagline: "Slow coffee, fast mornings", industry: "café", tone: "warm, modern", mode: "dark",
  palette: { bg: "#120d0a", surface: "#1f1712", text: "#f5ede6", muted: "#b8a99c", primary: "#e8a25c", accent: "#7dd3c0" },
  fonts: { heading: "Fraunces", body: "Comic Sans" },
  sections: [
    { id: "Menu Board", type: "menu", title: "Menu", brief: "Coffee and bakes", inNav: true },
    { id: "home", type: "hero", title: "Home", brief: "Big welcome", inNav: true },
    { id: "story", type: "about", title: "Story", brief: "Roasting in Indiranagar" },
    { id: "story", type: "weird", title: "More", brief: "x" },
    { id: "visit", type: "contact", title: "Visit", brief: "Hours + map" },
  ],
  cta: { label: "Visit us", target: "#visit" },
};

describe("ASTON website builder · pure parts", () => {
  it("normalises a plan: hero first, footer added last, unique ids, known fonts", () => {
    const { plan, sections } = normalizePlan(PLAN);
    expect(sections[0]).toMatchObject({ id: "home", type: "hero", inNav: false });
    expect(sections.at(-1)).toMatchObject({ type: "footer", inNav: false });
    expect(sections.map((s) => s.id)).toEqual(["home", "menu-board", "story", "story-2", "visit", "footer"]);
    expect(sections.find((s) => s.id === "story-2")!.type).toBe("features");
    expect(plan.fonts).toEqual({ heading: "Fraunces", body: "Inter" });
    expect(sections.every((s) => s.html === null)).toBe(true);
    expect(() => normalizePlan({ ...PLAN, palette: { ...PLAN.palette, bg: "red" } })).toThrow();
  });

  it("extracts JSON from chatty replies", () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n``` hope it helps')).toEqual({ a: 1 });
    expect(() => extractJson("no json")).toThrow();
  });

  it("strips scripts, handlers, javascript: URLs and external embeds from section HTML", () => {
    const dirty = '```html\nHere you go:\n<section id="x" onclick="steal()"><script>alert(1)</script><a href="javascript:alert(1)">a</a><iframe src="https://evil"></iframe><img src=x onerror=alert(1)><style>#x{color:red}</style></section>\n```';
    const html = cleanHtml(dirty);
    expect(html.startsWith('<section id="x"')).toBe(true);
    expect(html).not.toMatch(/<script|onclick|onerror|javascript:|<iframe/i);
    expect(html).toContain("<style>#x{color:red}</style>");
    expect(cleanCss("```css\n@import url(https://evil.css);\n/* GUIDE\n.btn — button\n*/\n.btn{color:red}</style><script>\n```")).toBe("/* GUIDE\n.btn — button\n*/\n.btn{color:red}<script>");
    expect(extractGuide("/* GUIDE\n.btn — button\n.card — card\n*/ .btn{}")).toBe(".btn — button\n.card — card");
  });

  it("assembles one self-contained file: fonts, header, sections, runtime", () => {
    const { plan, sections } = normalizePlan(PLAN);
    const ready = sections.map((s, i) => (i < 2 ? { ...s, html: `<section id="${s.id}">${s.title}</section>` } : s));
    const html = assembleSite({ plan, css: ".x{}", sections: ready, building: true });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("family=Fraunces:wght@400;500;600;700&family=Inter");
    expect(html).toContain(`media="print" onload="this.media='all'"`); // fonts never block the first paint
    expect(html).toContain('<header class="site-header">');
    expect(html).toContain('<a href="#menu-board">Menu</a>');
    expect(html).toContain('<section id="home">Home</section>');
    expect(html).toContain("ASTON is writing “Story”…");
    expect(html).toContain(RUNTIME_JS);
    expect(assembleSite({ plan: { ...plan, siteName: "<b>x</b>" } as SitePlan, css: null, sections: null })).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("highlights code without losing a single character", () => {
    const samples: [string, Parameters<typeof highlight>[1]][] = [
      ['<section id="hero" class="a"><!-- c --><style>#hero .t{color:#fff;margin:2rem}</style><h1 data-reveal>Hi "there" > ok</h1></section>', "html"],
      ["/* GUIDE */\n:root{--bg:#120d0a}\n@media (max-width:900px){.nav{display:none}}\n.btn:hover{transform:translateY(-2px)}", "css"],
      ['{"siteName": "Brew Lab", "n": 3, "ok": true, "list": [1, null]}', "json"],
      [RUNTIME_JS, "js"],
    ];
    for (const [code, lang] of samples) {
      const toks = highlight(code, lang);
      expect(toks.map((t) => t.t).join("")).toBe(code);
      expect(toks.some((t) => t.c)).toBe(true);
    }
    expect(highlight('<a href="x">', "html").find((t) => t.c === "str")?.t).toBe('"x"');
    expect(highlight(".a{color:red}", "css").find((t) => t.c === "sel")?.t).toBe(".a");
  });

  it("recognises website requests", () => {
    for (const s of ["Build a website for Brew Lab café", "can you make me a landing page for a gym", "design a site for my bakery", "create a web page for an architect"]) expect(WEBSITE_INTENT.test(s)).toBe(true);
    for (const s of ["what needs my attention", "is the website down?", "check the site status"]) expect(WEBSITE_INTENT.test(s)).toBe(false);
  });
});

describe("ASTON · Groq streaming rails", () => {
  const gen = async function* (parts: string[], failAfter?: number) {
    let i = 0;
    for (const p of parts) { if (failAfter !== undefined && i === failAfter) throw Object.assign(new Error("socket hang up"), {}); i++; yield p; }
  };
  it("streams deltas and retries only before the first token", async () => {
    let calls = 0;
    const deps: Partial<GroqDeps> = {
      store: memoryStore(), sleep: async () => {}, now: () => Date.now(),
      stream: async () => { calls++; if (calls === 1) throw Object.assign(new Error("Service Unavailable"), { status: 503 }); return { headers: {}, deltas: gen(["<sec", "tion>"]) }; },
    };
    const seen: string[] = [];
    expect(await groqStream({ messages: [{ role: "user", content: "x" }] }, (d) => seen.push(d), { deps })).toBe("<section>");
    expect(seen).toEqual(["<sec", "tion>"]);
    expect(calls).toBe(2);

    let calls2 = 0;
    const store = memoryStore();
    const deps2: Partial<GroqDeps> = { store, sleep: async () => {}, now: () => Date.now(), stream: async () => { calls2++; return { headers: {}, deltas: gen(["a", "b", "c"], 2) }; } };
    const out: string[] = [];
    await expect(groqStream({ messages: [{ role: "user", content: "x" }] }, (d) => out.push(d), { deps: deps2 })).rejects.toMatchObject({ reason: "outage" });
    expect(calls2).toBe(1); // output had started → no retry (no duplicated code on screen)
    expect(out).toEqual(["a", "b"]);
  });
});

const d = isDbConfigured ? describe : describe.skip;
const OWNER = "aston-site-owner@example.com";

/** A fake Groq that writes plausible output for each kind of builder prompt. */
function fakeGroq(o: { rateLimitOnCall?: number } = {}): Partial<GroqDeps> & { calls: number } {
  const f = {
    calls: 0,
    store: memoryStore(),
    sleep: async () => {},
    now: () => Date.now(),
    async stream(body: { messages: { role: string; content: unknown }[] }) {
      f.calls++;
      if (o.rateLimitOnCall === f.calls) throw Object.assign(new Error("Rate limit reached on tokens per minute (TPM)"), { status: 429, headers: { "retry-after": "20" } });
      const sys = String(body.messages[0].content), user = String(body.messages[1].content);
      let text: string;
      if (sys.includes("Plan a one-page")) text = "Here is the plan:\n" + JSON.stringify(PLAN);
      else if (sys.includes("complete stylesheet") || sys.includes("stylesheet and return")) text = "```css\n/* GUIDE\n.btn — button\n.card — card\n*/\n:root{--bg:#120d0a;--text:#f5ede6}\nbody{background:var(--bg);color:var(--text);font-family:var(--font-body)}\n.btn{padding:12px 20px;border-radius:999px}\n.card{border-radius:20px;padding:24px}\n" + ".pad{padding:1px}\n".repeat(10) + "```";
      else {
        const id = (user.match(/Write #([\w-]+)/) ?? sys.match(/#([\w-]+)/))?.[1] ?? "x";
        const tag = /footer/i.test(user.split("Write #")[1] ?? "") || id === "footer" ? "footer" : "section";
        text = `<${tag} id="${id}" class="section"><h2 data-reveal>${id}</h2><script>alert(1)</script></${tag}>`;
      }
      const parts = text.match(/[\s\S]{1,40}/g) ?? [];
      return { headers: {}, deltas: (async function* () { for (const p of parts) yield p; })() };
    },
    async create() { return { headers: {}, data: { choices: [{ message: { content: '{"target":"home"}' } }] } as never }; },
  };
  return f as never;
}

d("ASTON website builder (database integration)", () => {
  let userId = "", otherId = "";
  let B: typeof import("@/lib/aston/site/builder");
  beforeAll(async () => {
    await getDb().user.deleteMany({ where: { email: { in: [OWNER, "aston-site-other@example.com"] } } });
    userId = (await getDb().user.create({ data: { email: OWNER, passwordHash: "x" } })).id;
    otherId = (await getDb().user.create({ data: { email: "aston-site-other@example.com", passwordHash: "x" } })).id;
    B = await import("@/lib/aston/site/builder");
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: { in: [userId, otherId] } } }).catch(() => {}); });
  beforeEach(async () => { await getDb().astonSite.deleteMany({ where: { userId } }); H.user = { id: userId, email: OWNER }; });

  const runAll = async (id: string, deps: Partial<GroqDeps>) => {
    const events: { t: string }[] = [];
    for (let i = 0; i < 20; i++) {
      const evs: { t: string }[] = [];
      await B.nextStep(userId, id, (e) => evs.push(e), deps);
      events.push(...evs);
      const last = evs.at(-1)!;
      if (last.t === "complete" || last.t === "error" || last.t === "wait") break;
    }
    return events;
  };

  it("builds a whole site step by step, streaming code, and saves a clean single file", async () => {
    const site = await B.createSite(userId, "A website for Brew Lab, a specialty café in Indiranagar. Warm and modern.");
    const groq = fakeGroq();
    const events = await runAll(site.id, groq);
    const steps = events.filter((e) => e.t === "step").map((e) => (e as unknown as { step: { kind: string; id?: string } }).step);
    expect(steps.map((s) => s.kind)).toEqual(["plan", "css", "section", "section", "section", "section", "section", "section"]);
    expect(steps.filter((s) => s.kind === "section").map((s) => s.id)).toEqual(["home", "menu-board", "story", "story-2", "visit", "footer"]);
    expect(events.filter((e) => e.t === "d").length).toBeGreaterThan(20);
    expect(events.at(-1)!.t).toBe("complete");
    const row = await B.getSite(userId, site.id);
    expect(row).toMatchObject({ status: "done", title: "Brew Lab" });
    const html = B.siteHtml(row);
    expect(html).toContain('<section id="home"');
    expect(html).toContain('<footer id="footer"');
    expect(html).not.toContain("alert(1)"); // model-written scripts are removed
    expect(html).not.toContain("ASTON is writing");
    // done → another step is a no-op that reports completion
    const again: { t: string }[] = [];
    await B.nextStep(userId, site.id, (e) => again.push(e), groq);
    expect(again.map((e) => e.t)).toEqual(["complete"]);
  });

  it("pauses on Groq's per-minute limit and resumes from the saved step", async () => {
    const site = await B.createSite(userId, "Landing page for Peak Gym in Koramangala, bold and energetic.");
    const groq = fakeGroq({ rateLimitOnCall: 3 }); // plan ok, css ok, first section → 429
    let events = await runAll(site.id, groq);
    const wait = events.at(-1) as unknown as { t: string; until: string };
    expect(wait.t).toBe("wait");
    expect(Date.parse(wait.until)).toBeGreaterThan(Date.now());
    let row = await B.getSite(userId, site.id);
    expect(row.css).toBeTruthy();
    expect((row.sections as { html: string | null }[]).every((s) => !s.html)).toBe(true);
    expect(row.lockedUntil).toBeNull(); // the lock is released while paused
    // after the pause (fresh rate state), the build carries on where it stopped
    events = await runAll(site.id, { ...groq, store: memoryStore() });
    expect(events.at(-1)!.t).toBe("complete");
    row = await B.getSite(userId, site.id);
    expect(row.status).toBe("done");
  });

  it("one step at a time: a second runner is refused while a step is in progress", async () => {
    const site = await B.createSite(userId, "Website for an architecture studio in Pune.");
    await getDb().astonSite.update({ where: { id: site.id }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    const evs: { t: string; message?: string }[] = [];
    await B.nextStep(userId, site.id, (e) => evs.push(e as never), fakeGroq());
    expect(evs).toEqual([{ t: "error", message: "ASTON is already working on this website." }]);
  });

  it("revises a finished site live (picks the part, rewrites it)", async () => {
    const site = await B.createSite(userId, "A website for Brew Lab café.");
    await runAll(site.id, fakeGroq());
    const evs: { t: string }[] = [];
    await B.reviseSite(userId, site.id, "make the hero darker", (e) => evs.push(e), fakeGroq());
    expect(evs[0]).toMatchObject({ t: "step", step: { kind: "section", id: "home" } });
    expect(evs.at(-1)!.t).toBe("complete");
    expect((await B.getSite(userId, site.id)).revisions).toBe(1);
  });

  it("routes: owner only; the HTML is served sandboxed and downloadable", async () => {
    const site = await B.createSite(userId, "A website for Brew Lab café.");
    await runAll(site.id, fakeGroq());
    const html = (await import("@/app/api/aston/sites/[id]/html/route")).GET;
    const list = (await import("@/app/api/aston/sites/route")).GET;
    H.user = { id: otherId, email: "aston-site-other@example.com" };
    expect((await html(new Request("http://x"), { params: { id: site.id } })).status).toBe(403);
    expect((await list()).status).toBe(403);
    H.user = null;
    expect((await list()).status).toBe(401);
    H.user = { id: userId, email: OWNER };
    const res = await html(new Request("http://x/api/aston/sites/x/html?download=1"), { params: { id: site.id } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="brew-lab.html"');
    expect(await res.text()).toContain("<!doctype html>");
    expect((await (await list()).json()).data[0]).toMatchObject({ id: site.id, status: "done" });
    const create = (await import("@/app/api/aston/sites/route")).POST;
    expect((await create(new Request("http://x", { method: "POST", body: JSON.stringify({ brief: "hi" }) }))).status).toBe(422);
  });
});
