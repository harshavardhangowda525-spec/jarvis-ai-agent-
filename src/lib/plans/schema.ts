/**
 * The daily marketing plan (client-safe): what the model writes, and the
 * teleprompter sections it's read in.
 */
import { z } from "zod";

export const PLAN_TZ = "Asia/Kolkata";

/**
 * Text that's too long is shortened at a sentence or word break rather than
 * thrown away — one wordy field (e.g. a long "format") must never sink a
 * whole plan. Only missing or empty text is an error.
 */
export function clipText(v: string, max: number): string {
  const t = v.replace(/\s+\n/g, "\n").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("\n"));
  if (sentence > max * 0.4) return cut.slice(0, sentence + 1).trim();
  const word = cut.lastIndexOf(" ");
  return `${(word > max * 0.6 ? cut.slice(0, word) : cut).trim()}…`;
}
const s = (max: number) => z.preprocess((v) => (typeof v === "string" ? clipText(v, max) : typeof v === "number" ? String(v) : v), z.string().min(1).max(max));
const opt = (max: number) => z.preprocess((v) => (v == null || v === "" ? undefined : typeof v === "string" ? clipText(v, max) : v), z.string().max(max).optional());
/** Lists keep their first `max` items instead of failing on one extra. */
const list = <T extends z.ZodTypeAny>(item: T, min: number, max: number) => z.preprocess((v) => (Array.isArray(v) ? v.slice(0, max) : v), z.array(item).min(min).max(max));
/** "5", "5s", "5 sec" → 5, kept within 1–30 s. */
const secs = z.preprocess((v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.min(30, Math.max(1, n)) : undefined;
}, z.number().optional());

export const planSchema = z.object({
  niche: s(60),
  opportunity: s(900),
  problems: list(s(240), 1, 6),
  services: list(z.object({ name: s(80), why: s(300) }), 1, 5),
  scripts: z.object({
    call: s(4000),
    instagram: s(1200),
    whatsapp: s(1200),
    followUps: list(z.object({ when: s(60), channel: s(40), text: s(800) }), 1, 4),
  }),
  content: z.object({ idea: s(1200), format: s(120) }),
  video: z.object({
    hook: s(240),
    scenes: list(z.object({ visual: s(300), onScreen: s(160), motion: opt(200), voiceOver: opt(400), seconds: secs }), 3, 10),
    caption: s(1200),
    cta: s(200),
  }),
  checklist: list(z.object({ task: s(200), block: z.enum(["prospecting", "outreach", "follow-ups", "content", "tracking"]).catch("prospecting") }), 3, 14),
  insight: s(500),
  assumptions: z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, 8) : v), z.array(s(240)).max(8)).default([]),
});
export type Plan = z.infer<typeof planSchema>;

export interface PromptSection { id: string; title: string; body: string }

/** The teleprompter's sections, in reading order. */
export function planSections(p: Plan): PromptSection[] {
  const dot = (xs: string[]) => xs.map((x) => `• ${x}`).join("\n");
  return [
    { id: "niche", title: `Today's niche — ${p.niche}`, body: `${p.opportunity}\n\nTheir likely problems:\n${dot(p.problems)}\n\nWhat to pitch:\n${p.services.map((v) => `• ${v.name} — ${v.why}`).join("\n")}\n\nToday's lesson: ${p.insight}${p.assumptions.length ? `\n\nAssumptions: ${p.assumptions.join(" ")}` : ""}` },
    { id: "call", title: "Phone-call script", body: p.scripts.call },
    { id: "instagram", title: "Instagram DM", body: p.scripts.instagram },
    { id: "whatsapp", title: "WhatsApp message", body: p.scripts.whatsapp },
    { id: "followups", title: "Follow-ups", body: p.scripts.followUps.map((f) => `${f.when} · ${f.channel}\n${f.text}`).join("\n\n") },
    { id: "content", title: "Content idea", body: `${p.content.format}\n\n${p.content.idea}` },
    { id: "video", title: "Video — scene by scene", body: `Hook: ${p.video.hook}\n\n${p.video.scenes.map((sc, i) => `Scene ${i + 1}${sc.seconds ? ` (${sc.seconds}s)` : ""}\nVisual: ${sc.visual}\nOn screen: ${sc.onScreen}${sc.motion ? `\nMotion: ${sc.motion}` : ""}${sc.voiceOver ? `\nVoice-over: ${sc.voiceOver}` : ""}`).join("\n\n")}` },
    { id: "caption", title: "Caption & CTA", body: `${p.video.caption}\n\nCTA: ${p.video.cta}` },
    { id: "checklist", title: "Today's checklist", body: p.checklist.map((c) => `☐ [${c.block}] ${c.task}`).join("\n") },
  ];
}

/** "HH:MM" → minutes after midnight, or null. */
export function parseTime(t: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
