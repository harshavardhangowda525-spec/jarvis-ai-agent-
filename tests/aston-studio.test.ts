import { describe, it, expect } from "vitest";
import { FileStreamParser, safeSitePath } from "@/lib/aston/studio/files";
import { projectSpecSchema, plannedFiles } from "@/lib/aston/studio/spec";
import { suggestStyle, STYLES } from "@/lib/aston/studio/styles";
import { highlight } from "@/components/aston/highlight";
import { formsRuntime } from "@/lib/aston/studio/forms-runtime";

const spec = {
  name: "Maison Ivory", summary: "A personal brand site.", audience: "Clients", style: "editorial_luxury",
  pages: [{ file: "index.html", title: "Home", nav: "Home", purpose: "Intro", sections: [{ id: "hero", purpose: "Oversized headline" }] }, { file: "Story.html", title: "Story", nav: "Story", purpose: "Narrative", sections: [] }, { file: "contact.html", title: "Contact", nav: "Contact", purpose: "Enquiry", sections: [] }],
  design: { colors: { bg: "#efe9e1", text: "#1c1b19", accent: "#8a7f72" }, fonts: { display: { family: "Cormorant Garamond", weights: [400] }, body: { family: "Inter" } }, typeScale: "x", spacing: "x", grid: "x", breakpoints: "x", motion: "x", imageTreatment: "x", states: "x" },
  forms: [{ id: "Enquiry", kind: "enquiry", page: "contact.html", fields: [{ name: "Full Name", label: "Full name", type: "text", required: true }, { name: "email", label: "Email", type: "EMAIL", required: true }] }],
  assets: [{ file: "assets/portrait.svg", description: "Portrait" }],
};

describe("ASTON studio: the plan", () => {
  it("accepts a real plan and tidies names", () => {
    const r = projectSpecSchema.safeParse(spec);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.pages[1].file).toBe("story.html");
    expect(r.data.forms[0].id).toBe("enquiry");
    expect(r.data.forms[0].fields[0].name).toBe("full_name");
    expect(r.data.forms[0].fields[1].type).toBe("email");
    expect(plannedFiles(r.data)).toEqual(["css/styles.css", "js/main.js", "assets/portrait.svg", "index.html", "story.html", "contact.html"]);
  });
  it("refuses no homepage, unsafe paths and a form on a page that doesn't exist", () => {
    // the exact plan that failed for the user: envVars written with "NAME" instead of "name"
    const withEnv = projectSpecSchema.safeParse({ ...spec, envVars: [{ NAME: "Payment gateway key", why: "online payments" }, { NAME: "MAPS_API_KEY", why: "map" }] });
    expect(withEnv.success).toBe(true);
    expect(withEnv.success && withEnv.data.envVars).toEqual([{ name: "PAYMENT_GATEWAY_KEY", why: "online payments" }, { name: "MAPS_API_KEY", why: "map" }]);
    expect(projectSpecSchema.safeParse({ ...spec, pages: spec.pages.slice(1) }).success).toBe(false);
    expect(projectSpecSchema.safeParse({ ...spec, pages: [...spec.pages, { ...spec.pages[0], file: "../evil.html" }] }).success).toBe(false);
    expect(projectSpecSchema.safeParse({ ...spec, forms: [{ ...spec.forms[0], page: "nope.html" }] }).success).toBe(false);
  });
  it("13 design directions; the brief picks one (and editorial isn't the default)", () => {
    expect(STYLES).toHaveLength(13);
    expect(suggestStyle("a premium gym website with membership plans").id).toBe("fitness");
    expect(suggestStyle("a clinic website with appointment booking").id).toBe("healthcare");
    expect(suggestStyle("a luxury personal-brand website, editorial, inspired by a magazine").id).toBe("editorial_luxury");
    expect(suggestStyle("a website for my accounting firm").id).toBe("corporate");
  });
});

describe("ASTON studio: code arrives as it's written", () => {
  it("splits streamed files at any chunk boundary", () => {
    const text = "Here you go.\n<<<FILE css/styles.css>>>\n:root{--a:#000}\nbody{margin:0}\n<<<END>>>\n<<<FILE index.html>>>\n<!doctype html>\n<html><body><h1>Hi</h1></body></html>\n<<<END>>>\n";
    for (const size of [1, 3, 7, 50, 1000]) {
      const p = new FileStreamParser();
      const evs = [];
      for (let i = 0; i < text.length; i += size) evs.push(...p.push(text.slice(i, i + size)));
      evs.push(...p.end());
      expect(evs.filter((e) => e.type === "open").map((e) => e.path), `chunk ${size}`).toEqual(["css/styles.css", "index.html"]);
      expect(p.files.get("css/styles.css")).toBe(":root{--a:#000}\nbody{margin:0}");
      expect(p.files.get("index.html")).toBe("<!doctype html>\n<html><body><h1>Hi</h1></body></html>");
      const deltas = evs.filter((e) => e.type === "delta" && e.path === "index.html").map((e) => (e as { text: string }).text).join("");
      expect(deltas).toBe(p.files.get("index.html"));
    }
  });
  it("a page cut off mid-way isn't saved as if it were whole", () => {
    const p = new FileStreamParser();
    p.push("<<<FILE about.html>>>\n<!doctype html><html><body><h1>Half");
    expect(p.end()).toEqual([]);
    expect(p.files.has("about.html")).toBe(false);
  });
  it("only writes inside the site", () => {
    expect(safeSitePath("css/styles.css")).toBe("css/styles.css");
    expect(safeSitePath("../../etc/passwd")).toBeNull();
    expect(safeSitePath("/index.html")).toBe("index.html");
    expect(safeSitePath("_aston/forms.js")).toBeNull();
    expect(safeSitePath("a/b/c.html")).toBeNull();
    expect(safeSitePath("run.exe")).toBeNull();
  });
  it("the code view escapes everything (a site's code can't become JARVIS markup)", () => {
    const h = highlight('<script>alert("x")</script><img src=x onerror=alert(1)>', "index.html");
    expect(h).not.toMatch(/<script>|<img/);
    expect(h).toContain("&lt;script");
  });
  it("the forms script posts to the handler it's given", () => {
    const js = formsRuntime("https://jarvis.example.com/api/aston/forms/tok123");
    expect(js).toContain('"https://jarvis.example.com/api/aston/forms/tok123"');
    expect(js).toContain('form[data-aston-form]');
  });
});

import { buildCommand } from "@/lib/aston/intent";
describe("'JARVIS, build …' reaches ASTON however it's phrased", () => {
  it("descriptive phrasings are build commands", () => {
    for (const s of [
      "JARVIS, build a premium personal-brand website inspired by the reference video.",
      "Create a high-end website for a luxury real estate company.",
      "Build a complete website for this clinic with appointment booking.",
      "Create a premium gym website with membership plans and a working enquiry form.",
      "Build a website for my client using these requirements",
      "I want a dark cinematic website for my film studio",
    ]) expect(buildCommand(s)?.kind, s).toBe("website");
  });
  it("questions and edits aren't", () => {
    for (const s of ["how do I build a website?", "what does a website cost?", "Open the website you just created and improve its animations.", "Make the typography more editorial", "Fix the mobile layout and test every button."]) expect(buildCommand(s), s).toBeNull();
  });
});

describe("plan env vars never block a build", () => {
  it("accepts NAME / key / strings, normalises, and drops nameless entries", async () => {
    const { envVarList } = await import("@/lib/aston/studio/spec");
    expect(envVarList([{ NAME: "stripe secret key", why: "payments" }, { key: "MAPS_API_KEY" }, "resend-api-key", { why: "no name" }, { name: "STRIPE_SECRET_KEY" }])).toEqual([
      { name: "STRIPE_SECRET_KEY", why: "payments" },
      { name: "MAPS_API_KEY", why: "" },
      { name: "RESEND_API_KEY", why: "" },
    ]);
    expect(envVarList(undefined)).toEqual([]);
  });
});
