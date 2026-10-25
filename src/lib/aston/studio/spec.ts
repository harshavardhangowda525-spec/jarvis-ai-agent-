/**
 * ASTON's website project plan (client-safe): what the brain decides before
 * writing code — purpose, sitemap, design system, forms, assets, the verified
 * facts, and how the result will be judged. Validated before any file exists.
 */
import { z } from "zod";
import { STYLE_IDS } from "./styles";

const clip = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : v), z.string().min(1).max(max));
const opt = (max: number) => z.preprocess((v) => (v == null || v === "" ? undefined : typeof v === "string" ? v.trim().slice(0, max) : v), z.string().max(max).optional());
const list = <T extends z.ZodTypeAny>(item: T, max: number) => z.preprocess((v) => (Array.isArray(v) ? v.slice(0, max) : v == null ? [] : v), z.array(item).max(max));
const hex = z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().regex(/^#[0-9a-f]{3,8}$/i));
/** flat, safe file names: "index.html", "story.html" */
export const pageFile = z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/^\/+/, "") : v), z.string().regex(/^[a-z0-9][a-z0-9-]*\.html$/, "a flat file name like story.html"));
/** asset paths: "assets/hero.svg" */
export const assetPath = z.preprocess((v) => (typeof v === "string" ? v.trim().replace(/^\/+/, "") : v), z.string().regex(/^assets\/[a-z0-9][a-z0-9_-]*\.(svg|png|jpg|jpeg|webp)$/i, "assets/<name>.svg"));

export const fieldSchema = z.object({
  name: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") : v), z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)),
  label: clip(80),
  type: z.preprocess((v) => String(v ?? "text").toLowerCase(), z.enum(["text", "email", "tel", "textarea", "select", "date", "time", "number", "checkbox"]).catch("text")),
  required: z.boolean().default(false),
  options: list(clip(60), 20).optional(),
});

export const formSchema = z.object({
  id: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") : v), z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/)),
  kind: z.preprocess((v) => String(v ?? "enquiry").toLowerCase(), z.enum(["enquiry", "contact", "booking", "newsletter", "waitlist"]).catch("enquiry")),
  page: pageFile,
  fields: list(fieldSchema, 14).refine((f) => f.length > 0, "at least one field"),
  success: clip(200).default("Thanks — we've received it and will get back to you."),
});
export type FormSpec = z.infer<typeof formSchema>;

export const projectSpecSchema = z.object({
  name: clip(80),
  client: opt(120),
  summary: clip(600),
  audience: clip(300),
  personality: list(clip(40), 6).default([]),
  style: z.enum(STYLE_IDS),
  pages: list(z.object({
    file: pageFile,
    title: clip(80),
    nav: clip(30),
    purpose: clip(300),
    sections: list(z.object({ id: z.preprocess((v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, ""), z.string().min(1).max(40)), purpose: clip(400) }), 14),
  }), 8).refine((p) => p.some((x) => x.file === "index.html"), "a homepage (index.html) is required"),
  design: z.object({
    colors: z.record(z.string().max(30), hex).refine((c) => Object.keys(c).length >= 3, "at least 3 colours"),
    fonts: z.object({
      display: z.object({ family: clip(60), weights: list(z.coerce.number(), 6).default([400, 700]) }),
      body: z.object({ family: clip(60), weights: list(z.coerce.number(), 6).default([400, 600]) }),
    }),
    typeScale: clip(400),
    spacing: clip(300),
    grid: clip(300),
    breakpoints: clip(200),
    motion: clip(500),
    imageTreatment: clip(300),
    states: clip(400),
  }),
  forms: list(formSchema, 6).default([]),
  features: list(clip(200), 16).default([]),
  assets: list(z.object({ file: assetPath, description: clip(300) }), 12).default([]),
  facts: z.object({ phone: opt(40), email: opt(120), address: opt(240), hours: opt(240), instagram: opt(120), whatsapp: opt(40) }).default({}),
  placeholders: list(clip(200), 20).default([]),
  assumptions: list(clip(240), 16).default([]),
  acceptance: list(clip(240), 20).default([]),
  envVars: list(z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{1,60}$/), why: clip(200) }), 10).default([]),
}).superRefine((s, ctx) => {
  const files = new Set(s.pages.map((p) => p.file));
  if (files.size !== s.pages.length) ctx.addIssue({ code: "custom", path: ["pages"], message: "duplicate page files" });
  s.forms.forEach((f, i) => { if (!files.has(f.page)) ctx.addIssue({ code: "custom", path: ["forms", i, "page"], message: `form page ${f.page} isn't in pages` }); });
});
export type ProjectSpec = z.infer<typeof projectSpecSchema>;

/** The files a version is made of: the pages, the shared CSS/JS, and the assets. */
export function plannedFiles(s: ProjectSpec): string[] {
  return ["css/styles.css", "js/main.js", ...s.assets.map((a) => a.file), ...s.pages.map((p) => p.file)];
}

export const STATES = ["understanding", "planning", "designing", "coding", "running", "testing", "refining", "review", "deployed"] as const;
export type StudioState = (typeof STATES)[number] | "failed";
export const STATE_LABEL: Record<StudioState, string> = {
  understanding: "Understanding", planning: "Planning", designing: "Designing", coding: "Coding", running: "Running",
  testing: "Testing", refining: "Refining", review: "Ready for review", deployed: "Deployed", failed: "Failed",
};
