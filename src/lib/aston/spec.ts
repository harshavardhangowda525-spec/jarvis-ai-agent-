/**
 * ASTON's site spec (client-safe). ASTON's model writes the CONTENT of a demo
 * — headlines, sections, menu, FAQ — as this JSON; the renderer turns it into
 * a complete, responsive, accessible page. Contact details are never taken
 * from the model: only verified facts (the brief or the CRM) are shown, and
 * anything missing is a clearly marked placeholder.
 */
import { z } from "zod";

export const PALETTES = {
  espresso: { bg: "#fbf7f2", surface: "#ffffff", ink: "#2b1d14", muted: "#6b5a4e", primary: "#7a4b2a", primaryInk: "#ffffff", accent: "#d9a46c", dark: "#1f140d" },
  ocean: { bg: "#f4f8fb", surface: "#ffffff", ink: "#0d2233", muted: "#4f6577", primary: "#0b6e99", primaryInk: "#ffffff", accent: "#38bdf8", dark: "#081a28" },
  forest: { bg: "#f5f8f3", surface: "#ffffff", ink: "#16261a", muted: "#536456", primary: "#2f6b3a", primaryInk: "#ffffff", accent: "#9fcf6b", dark: "#0f1d12" },
  midnight: { bg: "#0b0f1a", surface: "#131a2a", ink: "#eef2ff", muted: "#a5b0c8", primary: "#6a4bf0", primaryInk: "#ffffff", accent: "#22d3ee", dark: "#05070d" },
  blush: { bg: "#fdf6f7", surface: "#ffffff", ink: "#2d1a20", muted: "#6e5560", primary: "#b23a5e", primaryInk: "#ffffff", accent: "#f4a6b8", dark: "#22121a" },
  citrus: { bg: "#fffbf2", surface: "#ffffff", ink: "#24200f", muted: "#64593a", primary: "#b45309", primaryInk: "#ffffff", accent: "#facc15", dark: "#1c1708" },
  slate: { bg: "#f6f7f9", surface: "#ffffff", ink: "#111827", muted: "#525b6b", primary: "#1f2937", primaryInk: "#ffffff", accent: "#f97316", dark: "#0b0f17" },
  royal: { bg: "#f7f6fd", surface: "#ffffff", ink: "#1a1638", muted: "#5a5679", primary: "#3b2fb5", primaryInk: "#ffffff", accent: "#e0b44c", dark: "#100d26" },
  energy: { bg: "#0c0c0e", surface: "#17171b", ink: "#f5f5f5", muted: "#a3a3ad", primary: "#e11d48", primaryInk: "#ffffff", accent: "#facc15", dark: "#050506" },
} as const;
export type PaletteName = keyof typeof PALETTES;
export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];

export const FONTS = {
  modern: { head: "Manrope", body: "Inter", headStack: "'Manrope', system-ui, sans-serif", bodyStack: "'Inter', system-ui, sans-serif" },
  elegant: { head: "Playfair Display", body: "Lato", headStack: "'Playfair Display', Georgia, serif", bodyStack: "'Lato', system-ui, sans-serif" },
  friendly: { head: "Poppins", body: "Nunito", headStack: "'Poppins', system-ui, sans-serif", bodyStack: "'Nunito', system-ui, sans-serif" },
  bold: { head: "Bebas Neue", body: "Inter", headStack: "'Bebas Neue', Impact, sans-serif", bodyStack: "'Inter', system-ui, sans-serif" },
} as const;
export type FontName = keyof typeof FONTS;

const s = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

const cta = z.object({
  label: s(40),
  action: z.enum(["enquire", "call", "whatsapp", "book", "menu", "services", "directions"]).default("enquire"),
});

export const sectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("about"), title: s(80), body: s(900), highlights: z.array(s(60)).max(6).default([]) }),
  z.object({ type: z.literal("services"), title: s(80), intro: opt(300), items: z.array(z.object({ name: s(60), desc: s(240), price: opt(30) })).min(1).max(9) }),
  z.object({ type: z.literal("menu"), title: s(80), intro: opt(300), categories: z.array(z.object({ name: s(40), items: z.array(z.object({ name: s(60), desc: opt(160), price: opt(20) })).min(1).max(10) })).min(1).max(6) }),
  z.object({ type: z.literal("features"), title: s(80), items: z.array(z.object({ title: s(60), desc: s(200), icon: opt(4) })).min(2).max(8) }),
  z.object({ type: z.literal("gallery"), title: s(80), items: z.array(z.object({ caption: s(60), emoji: opt(4) })).min(3).max(8) }),
  z.object({ type: z.literal("pricing"), title: s(80), intro: opt(300), plans: z.array(z.object({ name: s(40), price: opt(30), period: opt(20), features: z.array(s(80)).max(8).default([]), featured: z.boolean().optional() })).min(1).max(4) }),
  z.object({ type: z.literal("process"), title: s(80), steps: z.array(z.object({ title: s(60), desc: s(200) })).min(2).max(6) }),
  z.object({ type: z.literal("faq"), title: s(80), items: z.array(z.object({ q: s(160), a: s(500) })).min(2).max(8) }),
  z.object({ type: z.literal("hours"), title: s(80) }),
  z.object({ type: z.literal("cta"), title: s(100), body: opt(300), button: cta }),
  z.object({ type: z.literal("contact"), title: s(80), body: opt(300), fields: z.array(z.enum(["name", "phone", "email", "date", "time", "guests", "service", "message"])).max(8).default(["name", "phone", "message"]) }),
]);
export type Section = z.infer<typeof sectionSchema>;
export type SectionType = Section["type"];

/** What the model writes. */
export const draftSchema = z.object({
  kind: z.enum(["website", "app"]).default("website"),
  businessName: s(80),
  niche: s(60),
  tagline: s(140),
  palette: z.enum(PALETTE_NAMES as [PaletteName, ...PaletteName[]]).catch("slate"),
  font: z.enum(["modern", "elegant", "friendly", "bold"]).catch("modern"),
  hero: z.object({ eyebrow: opt(60), headline: s(110), sub: s(300), primary: cta, secondary: cta.optional() }),
  sections: z.array(sectionSchema).min(3).max(10),
  /** A sentence per section for JARVIS's guided walkthrough (keyed by section type). */
  walkthrough: z.record(z.string(), z.string().trim().max(300)).default({}),
  /** What's assumed or still to be supplied (shown in the demo notes). */
  assumptions: z.array(s(200)).max(10).default([]),
});
export type Draft = z.infer<typeof draftSchema>;

/** Verified business facts — only these become contact details on the page. */
export const factsSchema = z.object({
  phone: opt(30), whatsapp: opt(30), email: opt(120), address: opt(240), city: opt(80), area: opt(80),
  mapsUrl: opt(500), instagram: opt(200), website: opt(300),
  hours: z.array(z.object({ days: s(40), time: s(60) })).max(8).default([]),
  /** Where the facts came from, e.g. "CRM lead #12", "your brief". */
  source: opt(120),
});
export type Facts = z.infer<typeof factsSchema>;

export interface SiteSpec extends Draft { facts: Facts }

/** Stable anchor id for a section (first of its type keeps the bare name). */
export function sectionIds(sections: Section[]): string[] {
  const seen = new Map<string, number>();
  return sections.map((sec) => {
    const n = (seen.get(sec.type) ?? 0) + 1;
    seen.set(sec.type, n);
    return n === 1 ? sec.type : `${sec.type}-${n}`;
  });
}
