import { z } from "zod";
import { EV_BUSINESS, EV_NICHES, EV_VOICE } from "@/lib/ev/config";

/**
 * The creative plan for a day's package: which niche / service / format to use
 * (rotated so nothing repeats), and the prompts + parser for EV's writing brain.
 * Pure — the pipeline supplies history and calls the model.
 */

/** What Infinity Web & Apps' clients come for (the audience's needs). */
export const DAILY_SERVICES = [
  "Business websites",
  "Mobile apps",
  "Business automation",
  "AI solutions for small businesses",
  "Online ordering",
  "Online booking & appointments",
  "Custom business software",
  "Website redesigns",
  "AI marketing",
  "Digital growth",
] as const;

/** Post formats EV rotates through. */
export const DAILY_FORMATS = [
  "Problem → solution",
  "Myth vs fact",
  "Before / after",
  "Quick tip",
  "Customer journey",
  "Behind the build",
  "Checklist",
  "Question hook",
  "Owner's day, fixed",
  "Mistake to avoid",
] as const;

export interface PriorPackage {
  date: string;
  niche: string | null;
  service: string | null;
  format: string | null;
  topic: string;
  hook: string | null;
  caption: string | null;
  creativeConcept: string | null;
  videoConcept: string | null;
  status: string;
}

/** Least-recently-used pick (never-used first, in list order), skipping `avoid`. */
export function leastRecent<T extends string>(options: readonly T[], used: (string | null)[], avoid: string[] = []): T {
  const lastIndex = (o: string) => used.findIndex((u) => (u ?? "").toLowerCase() === o.toLowerCase());
  const pool = options.filter((o) => !avoid.some((a) => a.toLowerCase() === o.toLowerCase()));
  const list = pool.length ? pool : [...options];
  // `used` is newest-first: -1 (never) beats everything, then the largest index (oldest)
  return [...list].sort((a, b) => {
    const ia = lastIndex(a), ib = lastIndex(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return -1;
    if (ib === -1) return 1;
    return ib - ia;
  })[0];
}

export interface PlanChoice { niche: string; service: string; format: string }

/** Rotate niche, service and format against what EV already made (newest first). */
export function chooseAngle(history: PriorPackage[], avoid: Partial<Record<keyof PlanChoice, string[]>> = {}): PlanChoice {
  return {
    niche: leastRecent(EV_NICHES, history.map((h) => h.niche), avoid.niche),
    service: leastRecent(DAILY_SERVICES, history.map((h) => h.service), avoid.service),
    format: leastRecent(DAILY_FORMATS, history.map((h) => h.format), avoid.format),
  };
}

const RULES = `Hard rules:
- Brand name exactly "${EV_BUSINESS.name}". Instagram ${EV_BUSINESS.instagram}. Phone ${EV_BUSINESS.phone}. Never any other name, handle, phone, address or website.
- Prices: only "websites from ${EV_BUSINESS.websiteFrom}" or "apps from ${EV_BUSINESS.appFrom}" if you mention price at all. No other numbers with ₹.
- NO invented facts: no statistics, percentages, "studies show", client counts, testimonials, ratings, awards, guarantees, "#1"/"best in", or client names.
- NO placeholders ([brackets], {braces}, "your business name", TBD, lorem).
- Speak to local business owners about THEIR problem, then how ${EV_BUSINESS.name} solves it. Specific, vivid, not generic.
- Voice: ${EV_VOICE.join(", ").toLowerCase()}.`;

export function planSystemPrompt(): string {
  return `You are EV, the in-house content strategist for ${EV_BUSINESS.name} (${EV_BUSINESS.tagline}). Every day you create ONE Instagram package — a feed post image and a 9:16 Reel — that makes local business owners want a website, app, automation, AI solution, online ordering/booking system, business software, a redesign or AI marketing from ${EV_BUSINESS.name}.

${RULES}

Reply with ONLY a JSON object, no markdown fences, no commentary.`;
}

export function planUserPrompt(o: { date: string; choice: PlanChoice; history: PriorPackage[]; instruction?: string | null; rejected?: PriorPackage | null }): string {
  const recent = o.history.slice(0, 20).map((h) =>
    `- ${h.date} [${h.niche ?? "?"} · ${h.service ?? "?"} · ${h.format ?? "?"}] topic: ${h.topic} | hook: ${h.hook ?? "-"} | visual: ${(h.creativeConcept ?? "-").slice(0, 90)} | video: ${(h.videoConcept ?? "-").slice(0, 90)}`,
  ).join("\n");
  return `Create the package for ${o.date}.
Target niche: ${o.choice.niche}
Service to feature: ${o.choice.service}
Format: ${o.choice.format}
${o.rejected ? `\nThe previous version was turned down (topic "${o.rejected.topic}", hook "${o.rejected.hook ?? ""}"). Make something clearly different.` : ""}${o.instruction ? `\nThe owner asked: "${o.instruction}"` : ""}

Recent content — do NOT repeat any topic, hook, visual idea, caption line or video idea from this list:
${recent || "(nothing yet — this is the first package)"}

Return JSON with exactly these keys:
{
  "topic": "one specific topic line (max 90 chars)",
  "angle": "the insight / pain point in one sentence",
  "contentType": "e.g. Educational Reel + post",
  "hook": "scroll-stopping first line shown in the Reel's first second (max 80 chars, no hashtags, no emoji spam)",
  "caption": "Instagram caption, 450–1200 chars, short paragraphs, starts with the hook idea, names ${EV_BUSINESS.name}, ends with the CTA and the phone ${EV_BUSINESS.phone}. NO hashtags in the caption.",
  "cta": "one-line call to action (max 60 chars)",
  "hashtags": ["10 to 15 relevant hashtags, each starting with #, no spaces"],
  "creativeConcept": "what the post image shows and why it stops the scroll (2–3 sentences)",
  "imagePrompt": "a detailed prompt for an image model: photographic or premium 3D scene for the ${o.choice.niche} niche, vertical 4:5, modern, cinematic lighting, brand colours deep navy with cyan-violet-magenta accents. NO text, letters, logos or words in the image.",
  "videoConcept": "the Reel's story in 2–3 sentences: hook → problem → solution → CTA",
  "beats": ["on-screen line 2 (max 55 chars)", "on-screen line 3 (max 55 chars)"]
}`;
}

const planSchema = z.object({
  topic: z.string().trim().min(8).max(140),
  angle: z.string().trim().min(8).max(400),
  contentType: z.string().trim().min(3).max(60),
  hook: z.string().trim().min(8).max(110),
  caption: z.string().trim().min(120).max(2000),
  cta: z.string().trim().min(4).max(90),
  hashtags: z.array(z.string().trim()).min(3).max(30),
  creativeConcept: z.string().trim().min(20).max(900),
  imagePrompt: z.string().trim().min(30).max(2000),
  videoConcept: z.string().trim().min(20).max(900),
  beats: z.array(z.string().trim().min(3).max(90)).min(1).max(3),
});
export type DailyPlan = z.infer<typeof planSchema>;

/** Pull the first JSON object out of a model reply. */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  if (start < 0) throw new Error("EV's writing brain didn't return JSON.");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("EV's writing brain returned incomplete JSON.");
}

/** Normalise hashtags: "#Tag", no spaces/punctuation, unique, max 15. */
export function cleanHashtags(tags: string[]): string[] {
  const out: string[] = [];
  // "#Booking app" is one tag the model spaced out; "#a #b" / "a, b" are several
  for (const raw of tags.flatMap((t) => t.split(/,|(?=#)/))) {
    const tag = raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (tag.length < 2) continue;
    const h = `#${tag}`;
    if (!out.some((o) => o.toLowerCase() === h.toLowerCase())) out.push(h);
  }
  return out.slice(0, 15);
}

/** Strip hashtags / stray markdown the model left in the caption. */
export function cleanCaption(c: string): string {
  return c.replace(/\*\*/g, "").replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function parsePlan(text: string): DailyPlan {
  const raw = extractJson(text) as Record<string, unknown>;
  const r = planSchema.safeParse(raw);
  if (!r.success) {
    const f = r.error.issues[0];
    throw new Error(`EV's plan was incomplete (${f.path.join(".") || "plan"}: ${f.message}).`);
  }
  const p = r.data;
  return {
    ...p,
    hook: p.hook.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, ""),
    caption: cleanCaption(p.caption),
    hashtags: cleanHashtags(p.hashtags),
    beats: p.beats.map((b) => b.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "")).slice(0, 2),
  };
}

/* ---------- revisions ---------- */

export type RevisionKind = "caption" | "tone" | "video";

export function revisionPrompt(kind: RevisionKind, cur: { topic: string; hook: string; caption: string; cta: string; hashtags: string[]; beats: string[]; videoConcept: string; creativeConcept: string }, instruction: string): string {
  const current = JSON.stringify({ topic: cur.topic, hook: cur.hook, caption: cur.caption, cta: cur.cta, hashtags: cur.hashtags, beats: cur.beats, videoConcept: cur.videoConcept, creativeConcept: cur.creativeConcept }, null, 1);
  const ask = kind === "caption"
    ? `Rewrite ONLY the caption (and hashtags if useful) — keep it about the same topic and image. Return {"caption": "...", "hashtags": ["#..."]}.`
    : kind === "tone"
      ? `Rewrite the hook, caption, CTA, on-screen beats and hashtags in the requested tone, same topic and image. Return {"hook": "...", "caption": "...", "cta": "...", "beats": ["...", "..."], "hashtags": ["#..."]}.`
      : `Write a NEW Reel for the same topic and hook: a different story and different on-screen lines. Return {"videoConcept": "...", "beats": ["...", "..."]}.`;
  return `Current package:\n${current}\n\nThe owner asked: "${instruction}"\n\n${ask}\nCaption rules: 450–1200 chars, names ${EV_BUSINESS.name}, ends with the CTA and ${EV_BUSINESS.phone}, no hashtags inside the caption. Hook max 80 chars. Beats max 55 chars each.`;
}

const revSchema = z.object({
  hook: z.string().trim().min(8).max(110).optional(),
  caption: z.string().trim().min(120).max(2000).optional(),
  cta: z.string().trim().min(4).max(90).optional(),
  hashtags: z.array(z.string()).min(3).max(30).optional(),
  beats: z.array(z.string().trim().min(3).max(90)).min(1).max(3).optional(),
  videoConcept: z.string().trim().min(20).max(900).optional(),
});
export type Revision = z.infer<typeof revSchema>;

export function parseRevision(kind: RevisionKind, text: string): Revision {
  const r = revSchema.safeParse(extractJson(text));
  if (!r.success) throw new Error(`EV's rewrite was invalid (${r.error.issues[0].path.join(".")}: ${r.error.issues[0].message}).`);
  const v = r.data;
  if (kind === "caption" && !v.caption) throw new Error("EV's rewrite had no caption.");
  if (kind === "tone" && !(v.caption && v.hook)) throw new Error("EV's rewrite missed the caption or hook.");
  if (kind === "video" && !(v.beats && v.videoConcept)) throw new Error("EV's new Reel plan was incomplete.");
  return {
    ...v,
    caption: v.caption ? cleanCaption(v.caption) : undefined,
    hashtags: v.hashtags ? cleanHashtags(v.hashtags) : undefined,
    beats: v.beats?.map((b) => b.replace(/\s+/g, " ")).slice(0, 2),
    hook: v.hook?.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, ""),
  };
}

/** A brand-style suffix for every image prompt (no text in the image — text is added in the Reel). */
export function imagePromptFor(plan: { imagePrompt: string }): string {
  return `${plan.imagePrompt.trim()} High-end commercial photography / 3D render quality, sharp focus, rich depth, deep navy and violet palette with cyan and magenta light accents. Absolutely no text, letters, numbers, watermarks or logos anywhere in the image.`;
}
