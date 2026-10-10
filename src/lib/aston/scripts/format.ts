/**
 * ASTON teleprompter — the pure parts (client-safe): script kinds, spotting a
 * script request, the script structure, and the plain-text edit format.
 */
import { z } from "zod";

export const SCRIPT_KINDS = ["cold_call", "instagram_dm", "whatsapp", "zoom_demo", "follow_up", "objections", "benefits", "closing", "general"] as const;
export type ScriptKind = (typeof SCRIPT_KINDS)[number];

export const KIND_LABEL: Record<ScriptKind, string> = {
  cold_call: "Cold call",
  instagram_dm: "Instagram DM",
  whatsapp: "WhatsApp pitch",
  zoom_demo: "Zoom demo",
  follow_up: "Follow-up",
  objections: "Objection handling",
  benefits: "Website & app benefits",
  closing: "Closing the sale",
  general: "Sales pitch",
};

/** "create / prepare / generate / write … script | pitch", or "open teleprompter". */
export const SCRIPT_INTENT = /\b(script|pitch|pitching|teleprompter|talking points)\b/i;

const WAKE = /^\s*(?:hey\s+|ok(?:ay)?\s+)?(?:aston|austin|ashton|aston's|ast[ao]n)\b[\s,.:!-]*/i;

/** Remove a leading "ASTON," (and common mis-hearings) from an utterance. */
export function stripWake(text: string): { text: string; woke: boolean } {
  const m = text.match(WAKE);
  return m ? { text: text.slice(m[0].length).trim(), woke: true } : { text: text.trim(), woke: false };
}

/** Just open the teleprompter (no new script)? */
export function isOpenOnly(text: string): boolean {
  const t = stripWake(text).text.toLowerCase();
  return /\b(open|show|start|launch)\b.*\bteleprompter\b/.test(t) && !/\b(script|pitch)\b/.test(t);
}

/** Which kind of script is being asked for (fallback: a general sales pitch). */
export function detectKind(text: string): ScriptKind {
  const t = text.toLowerCase();
  if (/\b(objection|objections|pushback|too expensive|not interested)\b/.test(t)) return "objections";
  if (/\bfollow[- ]?up\b/.test(t)) return "follow_up";
  if (/\bclos(e|ing)\b/.test(t)) return "closing";
  if (/\binsta(gram)?\b|\bdm\b|\bdirect message/.test(t)) return "instagram_dm";
  if (/\bwhats ?app\b/.test(t)) return "whatsapp";
  if (/\bzoom\b|\bdemo\b|\bdemonstration\b|\bvideo call\b|\bgoogle meet\b/.test(t)) return "zoom_demo";
  if (/\b(benefit|benefits|explain|why (a|they need))\b/.test(t)) return "benefits";
  if (/\bcold[- ]?call|\bcall(ing)?\b|\bphone\b/.test(t)) return "cold_call";
  return "general";
}

export const lineSchema = z.object({ who: z.enum(["you", "client", "note"]).catch("you"), text: z.string().trim().min(1).max(1200) });
export const sectionSchema = z.object({ heading: z.string().trim().max(80).default(""), lines: z.array(lineSchema).max(80) });
export const scriptBodySchema = z.array(sectionSchema).min(1).max(20);
export type ScriptLine = z.infer<typeof lineSchema>;
export type ScriptSection = z.infer<typeof sectionSchema>;

export const detailsSchema = z.object({
  businessName: z.string().trim().max(80).optional(),
  industry: z.string().trim().max(60).optional(),
  service: z.string().trim().max(80).optional(),
  price: z.string().trim().max(40).optional(),
  offer: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(600).optional(),
});
export type ScriptDetails = z.infer<typeof detailsSchema>;

/** Keep only well-formed sections/lines; drop empty ones. */
export function normalizeSections(raw: unknown): ScriptSection[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: ScriptSection[] = [];
  for (const s of arr.slice(0, 20)) {
    const p = sectionSchema.safeParse(s);
    if (!p.success) continue;
    const lines = p.data.lines.filter((l) => l.text.trim());
    if (lines.length) out.push({ heading: p.data.heading, lines });
  }
  return out;
}

/**
 * The edit format (what you type in the editor):
 *   ## Heading
 *   A line you say. [Pause]
 *   > Client: what they might say
 *   [Wait for response]        ← a line that is only a direction
 */
export function toEditText(sections: ScriptSection[]): string {
  return sections
    .map((s) => [s.heading ? `## ${s.heading}` : "", ...s.lines.map((l) => (l.who === "client" ? `> Client: ${l.text}` : l.who === "note" ? `[${l.text.replace(/^\[|\]$/g, "")}]` : l.text))].filter(Boolean).join("\n"))
    .join("\n\n");
}

export function fromEditText(text: string): ScriptSection[] {
  const out: ScriptSection[] = [];
  let cur: ScriptSection | null = null;
  const push = (l: ScriptLine) => { if (!cur) { cur = { heading: "", lines: [] }; out.push(cur); } cur.lines.push(l); };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,3}\s*(.+)$/);
    if (h) { cur = { heading: h[1].trim().slice(0, 80), lines: [] }; out.push(cur); continue; }
    const c = line.match(/^>\s*(?:client|customer|them|prospect)?\s*:?\s*(.*)$/i);
    if (c) { if (c[1].trim()) push({ who: "client", text: c[1].trim().slice(0, 1200) }); continue; }
    if (/^\[[^\]]+\]$/.test(line)) { push({ who: "note", text: line.slice(1, -1).trim() }); continue; }
    push({ who: "you", text: line.slice(0, 1200) });
  }
  return out.filter((s) => s.lines.length || s.heading);
}

/** A bracketed stage direction ([Pause], [Smile], [Share screen]…) — as opposed to a fill-in like [Owner's name]. */
const DIRECTION = /^\[\s*(short |long |brief )?(pause|wait|smile|beat|breathe|slow(er)?( down)?|share( your)? screen|show|point|click|scroll|open|nod|laugh|listen|let them|optional|note|tone|emphasi[sz]e|if they|then|stop|look|warm|confident|friendly|calm|excited|lower|raise|speak|say)\b/i;
export const isDirection = (bracketed: string) => DIRECTION.test(bracketed);

/**
 * Split a "you" line into what you say, inline [directions] (not read aloud)
 * and [fill-ins] such as [Owner's name] (said — highlighted so you replace them).
 */
export function splitDirections(text: string): { t: string; dir: boolean; slot?: boolean }[] {
  return text.split(/(\[[^\]]{1,80}\])/).filter(Boolean).map((t) => {
    if (!/^\[[^\]]+\]$/.test(t)) return { t, dir: false };
    return isDirection(t) ? { t, dir: true } : { t, dir: false, slot: true };
  });
}

export const wordCount = (sections: ScriptSection[]) =>
  sections.reduce((n, s) => n + s.lines.filter((l) => l.who === "you").reduce((m, l) => m + splitDirections(l.text).filter((p) => !p.dir).map((p) => p.t).join("").split(/\s+/).filter(Boolean).length, 0), 0);
