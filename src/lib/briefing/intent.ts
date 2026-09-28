/**
 * Is this a plain "brief me" request (open the briefing), or a specific
 * question about the past that JARVIS should answer from the history?
 * Client-safe (pure).
 */
import { parseHistoryRange, type DayRange } from "@/lib/activity/dates";

const SPECIFIC = /\b(morning|afternoon|evening|night|problems?|errors?|issues?|bugs?|unfinished|left|pending|darwin|ev|ultron|humanoid|leads?|tasks?|clients?|decid|decision|why|how many|which|who|emails?|calls?|nios)\b/i;

export function briefingRequest(text: string, tz: string, now = Date.now()): DayRange | null {
  const t = text.trim();
  if (SPECIFIC.test(t.replace(/\b(yesterday'?s|summary|briefing|recap)\b/gi, ""))) return null;
  const r = parseHistoryRange(t, tz, now);
  if (!r) return null;
  // "what did I do" style or an explicit briefing ask
  return /\b(what (did|have) i (do|done|work(ed)? on|get done|accomplish)|what happened|briefing|summary|recap|activity|what was i (doing|working on)|my day)\b/i.test(t) ? r : null;
}
