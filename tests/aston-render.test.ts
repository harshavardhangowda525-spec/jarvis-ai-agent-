import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { draftSchema, factsSchema, PALETTES, PALETTE_NAMES, type SiteSpec } from "@/lib/aston/spec";
import { renderSite, waNumber, instagramUrl } from "@/lib/aston/render";
import { checkHtml, contrast } from "@/lib/aston/checks";

const draft = draftSchema.parse(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/aston-cafe.json"), "utf8")));
const spec = (facts: Record<string, unknown> = {}, over: Partial<SiteSpec> = {}): SiteSpec => ({ ...draft, facts: factsSchema.parse(facts), ...over });

describe("ASTON renderer + checks", () => {
  it("builds a website that passes every check, with placeholders for unknown contact details", () => {
    const r = renderSite(spec());
    const rep = checkHtml(r.html, { palette: "espresso" });
    expect(rep.checks.filter((c) => c.status !== "pass")).toEqual([]);
    expect(rep.passed).toBe(true);
    expect(r.placeholders).toEqual(["Phone number", "Email address", "Address", "Opening hours"]);
    expect(r.html).toContain("Phone number to be added");
    expect(r.html).not.toMatch(/tel:/);
    expect(r.sections.map((s) => s.id)).toEqual(["top", "about", "menu", "gallery", "faq", "hours", "cta", "contact"]);
  });

  it("uses verified facts for contact links", () => {
    const r = renderSite(spec({ phone: "98450 12345", address: "12 CMH Road, Indiranagar, Bengaluru", hours: [{ days: "Mon–Sun", time: "8 am – 10 pm" }], instagram: "@brewbloom", source: "CRM lead #4" }));
    expect(r.html).toContain('href="tel:9845012345"');
    expect(r.html).toContain("https://wa.me/919845012345");
    expect(r.html).toContain("https://www.instagram.com/brewbloom/");
    expect(r.html).toContain("CRM lead #4");
    expect(r.placeholders).toEqual(["Email address"]);
    expect(checkHtml(r.html, { palette: "espresso" }).passed).toBe(true);
  });

  it("escapes model text", () => {
    const r = renderSite(spec({}, { tagline: '<script>alert(1)</script>', businessName: 'A "B" <C>' }));
    expect(r.html).not.toContain("<script>alert(1)");
    expect(r.html).toContain("&lt;script&gt;");
    expect(checkHtml(r.html).passed).toBe(true);
  });

  it("builds an app demo with working screen navigation", () => {
    const r = renderSite(spec({ phone: "9845012345" }, { kind: "app" }));
    const rep = checkHtml(r.html, { palette: "espresso" });
    expect(rep.checks.filter((c) => c.status !== "pass")).toEqual([]);
    expect(r.sections.map((s) => s.id)).toEqual(["home", "menu", "contact", "info"]);
    expect(r.html).toContain("window.astonGoto");
  });

  it("catches broken pages", () => {
    const bad = renderSite(spec()).html.replace('id="menu"', 'id="nomenu"').replace("<script>", "<script>function(").replace("<h2", "<h1");
    const rep = checkHtml(bad);
    const failed = rep.checks.filter((c) => c.status === "fail").map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["anchors", "js", "h1"]));
    expect(rep.passed).toBe(false);
  });

  it("every palette meets AA contrast", () => {
    for (const n of PALETTE_NAMES) {
      const p = PALETTES[n];
      expect(contrast(p.ink, p.bg), n).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.muted, p.bg), n).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.primaryInk, p.primary), n).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("normalises WhatsApp and Instagram", () => {
    expect(waNumber("+91 98450-12345")).toBe("919845012345");
    expect(waNumber("12345")).toBeNull();
    expect(instagramUrl("javascript:alert(1)")).toBeNull();
    expect(instagramUrl("https://evil.com/x")).toBeNull();
  });
});
