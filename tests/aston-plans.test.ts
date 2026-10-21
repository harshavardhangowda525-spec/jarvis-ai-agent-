import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planSchema, planSections, parseTime } from "@/lib/plans/schema";
import { chooseNiche, isDue, writePlan, NICHES, nicheOf } from "@/lib/plans/engine";
import { astonPreviewCommand, isAstonActivation, teleprompterCommand } from "@/lib/aston/intent";
import { extractJson, factsFromText, writeDraft } from "@/lib/aston/build";
import { walkSteps } from "@/lib/aston/service";
import { draftSchema, factsSchema } from "@/lib/aston/spec";
import { renderSite } from "@/lib/aston/render";

const planJson = fs.readFileSync(path.join(__dirname, "fixtures/aston-plan.json"), "utf8");
const cafeJson = fs.readFileSync(path.join(__dirname, "fixtures/aston-cafe.json"), "utf8");

describe("daily plan", () => {
  it("parses and lays out the nine teleprompter sections", () => {
    const p = planSchema.parse(JSON.parse(planJson));
    const s = planSections(p);
    expect(s.map((x) => x.id)).toEqual(["niche", "call", "instagram", "whatsapp", "followups", "content", "video", "caption", "checklist"]);
    expect(s[6].body).toContain("Scene 3 (5s)");
    expect(s[8].body).toContain("☐ [tracking] Log replies in the CRM");
  });

  it("picks a niche not used this week, favouring ones the CRM has leads for", () => {
    const crm = new Map([["cafes", { leads: 12 }], ["gyms", { leads: 30 }]]);
    expect(chooseNiche("2026-10-17", [], crm)).toBe("gyms");
    expect(chooseNiche("2026-10-17", ["gyms"], crm)).toBe("cafes");
    const n = chooseNiche("2026-10-17", ["gyms", "cafes"], crm);
    expect(NICHES).toContain(n);
    expect(["gyms", "cafes"]).not.toContain(n);
    expect(nicheOf("Fitness centre")).toBe("gyms");
    expect(nicheOf("Dental Clinic")).toBe("dental clinics");
  });

  it("is due from 35 minutes before the delivery time (India time)", () => {
    // 06:30 IST = 01:00 UTC
    expect(isDue(new Date("2026-10-17T01:00:00Z"), "07:00")).toBe(true);
    expect(isDue(new Date("2026-10-17T01:00:00Z"), "07:30")).toBe(false);
    expect(parseTime("7:05")).toBe(425);
    expect(parseTime("25:00")).toBeNull();
  });

  it("repairs one bad model reply, then gives up honestly", async () => {
    const replies = ["sure! here it is: {\"niche\": \"gyms\"}", "```json\n" + planJson + "\n```"];
    const p = await writePlan(async () => replies.shift()!, "gyms", { date: "2026-10-17", recent: [] });
    expect(p.niche).toBe("gyms");
    await expect(writePlan(async () => "no json at all", "gyms", { date: "2026-10-17", recent: [] })).rejects.toThrow(/didn't return a valid plan/);
  });
});

describe("ASTON", () => {
  it("extracts JSON from fenced or chatty replies", () => {
    expect(extractJson('Here you go: {"a": "b}c", "n": {"x": 1}} thanks')).toEqual({ a: "b}c", n: { x: 1 } });
    expect(() => extractJson('{"a": 1')).toThrow(/cut off/);
  });

  it("takes contact details only from what was literally given", () => {
    const f = factsFromText("Cafe in Indiranagar. Phone 98450 12345, email hello@brewbloom.in, instagram: @brewbloom. Open Mon-Sun 8 am - 10 pm.");
    expect(f.phone).toBe("98450 12345");
    expect(f.email).toBe("hello@brewbloom.in");
    expect(f.instagram).toBe("@brewbloom");
    expect(f.hours).toEqual([{ days: "Mon-Sun", time: "8 am – 10 pm" }]);
    expect(factsFromText("A cafe in Indiranagar")).toEqual({ phone: undefined, email: undefined, instagram: undefined, hours: [] });
  });

  it("writes a draft (with one repair round)", async () => {
    const replies = ['{"kind":"website"}', cafeJson];
    const r = await writeDraft(async () => replies.shift()!, "Build a cafe site");
    expect(r.repaired).toBe(true);
    expect(r.draft.businessName).toBe("Brew & Bloom Café");
  });

  it("walkthrough steps follow the real sections, with ASTON's notes", () => {
    const d = draftSchema.parse(JSON.parse(cafeJson));
    const spec = { ...d, facts: factsSchema.parse({}) };
    const steps = walkSteps(spec, renderSite(spec).sections);
    expect(steps.map((s) => s.id)).toEqual(["top", "about", "menu", "gallery", "faq", "hours", "cta", "contact"]);
    expect(steps[2].say).toBe("The menu uses tabs so it stays short on a phone.");
    expect(steps[3].say).toMatch(/placeholders/);
  });

  it("only opens a preview when one was offered (or is open)", () => {
    const off = { offered: false, open: false }, on = { offered: true, open: false };
    expect(astonPreviewCommand("yes open it", off)).toBeNull();
    expect(astonPreviewCommand("yes", on)).toBe("open");
    expect(astonPreviewCommand("Yes, open it in a new tab", on)).toBe("open");
    expect(astonPreviewCommand("show me the preview", on)).toBe("open");
    expect(astonPreviewCommand("walk me through it", on)).toBe("walk");
    expect(astonPreviewCommand("yes, walk me through the design", on)).toBe("walk");
    expect(astonPreviewCommand("give me a tour", { offered: false, open: true })).toBe("walk");
    expect(astonPreviewCommand("close the preview", { offered: false, open: true })).toBe("close");
    expect(astonPreviewCommand("what's the weather", on)).toBeNull();
    expect(astonPreviewCommand("open youtube", on)).toBeNull();
    expect(isAstonActivation("open aston")).toBe(true);
    expect(isAstonActivation("activate austin")).toBe(true);
    expect(isAstonActivation("open aston's teleprompter")).toBe(false);
    expect(teleprompterCommand("open aston's teleprompter")).toBe(true);
    expect(teleprompterCommand("show me today's plan")).toBe(true);
    expect(teleprompterCommand("open youtube")).toBe(false);
  });
});

describe("Jarvis → ASTON build commands", () => {
  it("sends build requests straight to ASTON with the user's words", async () => {
    const { buildCommand } = await import("@/lib/aston/intent");
    expect(buildCommand("Jarvis, build me a website for Brew & Bloom cafe in Indiranagar")).toEqual({ kind: "website", request: "build me a website for Brew & Bloom cafe in Indiranagar", needsDetails: false });
    expect(buildCommand("Create a premium website for a cafe")).toMatchObject({ kind: "website", needsDetails: false });
    expect(buildCommand("can you make an app demo for Iron Temple Gym")).toMatchObject({ kind: "app", needsDetails: false });
    expect(buildCommand("get aston to design a landing page for my salon")).toMatchObject({ kind: "website", needsDetails: false });
    expect(buildCommand("build a website")).toMatchObject({ needsDetails: true });
    expect(buildCommand("Jarvis, I want a website for my cafe Brew & Bloom")).toMatchObject({ kind: "website", needsDetails: false });
    expect(buildCommand("I need an app for Iron Temple Gym")).toMatchObject({ kind: "app", needsDetails: false });
    expect(buildCommand("i would like a landing page for my salon")).toMatchObject({ kind: "website" });
    expect(buildCommand("make me a website please")).toMatchObject({ needsDetails: true });
  });
  it("leaves questions and other requests alone", async () => {
    const { buildCommand } = await import("@/lib/aston/intent");
    for (const q of ["how do I build a website?", "what does a website cost", "make a note to call Ravi", "create a task for tomorrow", "open youtube", "change the website colours to dark", "find 50 gyms without a website"]) expect(buildCommand(q), q).toBeNull();
  });
});

describe("JARVIS → agent hand-off accepts how different brains fill it in", () => {
  it("tidies Claude-style arguments instead of failing", async () => {
    const { delegateTaskTool } = await import("@/lib/tools/jobs");
    const r = delegateTaskTool.schema.safeParse({
      agent: "ASTON", title: "Premium website for Brew & Bloom café in Indiranagar, Bengaluru — menu, gallery, reservations, contact and opening hours".repeat(2),
      request: "Create a premium website for a cafe", kind: "landing page", leadId: null, dependsOn: null,
      brief: {
        objective: "Build a premium cafe website", expectedOutcome: "A checked preview link",
        context: "Business: Brew & Bloom, Indiranagar\nPhone 98450 12345",
        requirements: ["Menu", "Gallery", "x".repeat(900)], constraints: "Don't publish anything",
        acceptance: "All checks pass; preview link works", outputFormat: "", approvals: null,
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.agent).toBe("aston");
    expect(r.data.kind).toBe("website");
    expect(r.data.title.length).toBeLessThanOrEqual(120);
    expect(r.data.brief.context).toEqual(["Business: Brew & Bloom, Indiranagar", "Phone 98450 12345"]);
    expect(r.data.brief.acceptance).toEqual(["All checks pass", "preview link works"]);
    expect(r.data.brief.requirements[2].length).toBe(400);
    expect(r.data.brief.approvals).toEqual([]);
    expect(r.data.leadId).toBeUndefined();
    expect(delegateTaskTool.schema.safeParse({ agent: "rubin", title: "Follow-ups", request: "x", brief: { objective: "Draft follow-ups", expectedOutcome: "Drafts ready", acceptance: ["done"] } }).success).toBe(true);
  });

  it("still refuses a hand-off with nothing to do", async () => {
    const { delegateTaskTool } = await import("@/lib/tools/jobs");
    const r = delegateTaskTool.schema.safeParse({ agent: "aston", title: "x", request: "", brief: { objective: "", expectedOutcome: "y", acceptance: [] } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join("."))).toEqual(expect.arrayContaining(["title", "brief.objective", "brief.acceptance"]));
  });
});
