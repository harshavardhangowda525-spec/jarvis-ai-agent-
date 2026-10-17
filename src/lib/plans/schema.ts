/**
 * The daily marketing plan (client-safe): what the model writes, and the
 * teleprompter sections it's read in.
 */
import { z } from "zod";

export const PLAN_TZ = "Asia/Kolkata";

const s = (max: number) => z.string().trim().min(1).max(max);

export const planSchema = z.object({
  niche: s(60),
  opportunity: s(900),
  problems: z.array(s(240)).min(1).max(6),
  services: z.array(z.object({ name: s(80), why: s(300) })).min(1).max(5),
  scripts: z.object({
    call: s(2500),
    instagram: s(1200),
    whatsapp: s(1200),
    followUps: z.array(z.object({ when: s(60), channel: s(40), text: s(800) })).min(1).max(4),
  }),
  content: z.object({ idea: s(700), format: s(80) }),
  video: z.object({
    hook: s(240),
    scenes: z.array(z.object({ visual: s(300), onScreen: s(160), motion: z.string().trim().max(200).optional(), voiceOver: z.string().trim().max(400).optional(), seconds: z.coerce.number().min(1).max(30).optional() })).min(3).max(10),
    caption: s(1200),
    cta: s(200),
  }),
  checklist: z.array(z.object({ task: s(200), block: z.enum(["prospecting", "outreach", "follow-ups", "content", "tracking"]).catch("prospecting") })).min(3).max(14),
  insight: s(500),
  assumptions: z.array(s(240)).max(8).default([]),
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
