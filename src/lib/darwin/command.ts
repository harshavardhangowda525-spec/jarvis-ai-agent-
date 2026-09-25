import type { LeadFilter } from "./types";

/**
 * Parse a spoken/typed DARWIN lead command, e.g.
 *   "find 20 gyms in Bangalore without a website"
 *   "generate new leads"            (→ repeat the last search)
 *   "get me dentists near Koramangala with phone numbers"
 * Anything not said stays undefined so the caller can fall back to the last search.
 */
export interface LeadCommand { category?: string; location?: string; limit?: number; filter?: LeadFilter }

export const GENERATE_LEADS_RE =
  /\b(generate|find|get|discover|search|pull|fetch|give me|show me|need|scan for|look for)\b.*\b(leads?|business(es)?|gyms?|caf[eé]s?|salons?|shops?|stores?|restaurants?|clinics?|dentists?)\b|\b(find|get|discover|search|generate|pull|fetch|give me|show me|look for)\b.+\b(in|near|around)\s+\S|\bnew leads?\b|\bmore leads?\b|\blead gen(eration)?\b/i;

/** "Open these leads in Google Maps" / "show them on the map" — a map request, not a new search. */
export const MAP_REQUEST_RE = /\b(google\s*maps?|maps?|map view)\b/i;

const FILTER_PATTERNS: [RegExp, LeadFilter][] = [
  [/\b(without|no|don'?t have|do not have|lacking|missing)\s+(a\s+|any\s+)?(website|site|web ?presence)\b/i, "no_website"],
  [/\b(without|no)\s+(a\s+)?phone( numbers?)?\b|\bphone unavailable\b/i, "no_phone"],
  [/\b(with|having|that have|has)\s+(a\s+)?(website|site)\b/i, "has_website"],
  [/\b(with|having|that have|has)\s+(a\s+)?(phone|contact)( numbers?)?\b|\bphone available\b|\bcallable\b/i, "phone"],
];

const TAIL = /\s+(?:with|without|that|which|who|having|lacking|missing|and|no)\b.*$/i;
const FILLER = /^(?:leads?\s+)?(?:for|of)\s+|\b(please|now|today|for me|new|more|fresh|some|leads?)\b/gi;

export function parseLeadCommand(text: string): LeadCommand {
  const s = text.trim().replace(/[.!?]+$/, "");
  const out: LeadCommand = {};

  for (const [re, f] of FILTER_PATTERNS) if (re.test(s)) { out.filter = f; break; }

  const num = s.match(/\b(\d{1,3})\b/);
  if (num) out.limit = Math.min(Math.max(parseInt(num[1], 10), 1), 50);

  // "<verb> [me] [N] [new] <category> [leads] in|near|around <location> [with…]"
  const m = s.match(/\b(?:generate|find|get|discover|search(?: for)?|pull|fetch|give me|show me|need|scan for|look for)\s+(?:me\s+)?(?:\d{1,3}\s+)?(.*?)\s+(?:in|near|around|at|from)\s+(.+)$/i);
  if (m) {
    const cat = m[1].replace(FILLER, " ").replace(/\s+/g, " ").trim();
    if (cat && !/^(for|of)$/i.test(cat)) out.category = cat;
    const loc = m[2].replace(TAIL, "").replace(/\b(please|now|today|for me)\b/gi, "").trim().replace(/[,.]+$/, "");
    if (loc) out.location = loc;
  } else {
    // No location: "find more gyms" / "find cafes without website"
    const c = s.match(/\b(?:generate|find|get|discover|search(?: for)?|pull|fetch|give me|show me|look for)\s+(?:me\s+)?(?:\d{1,3}\s+)?(.*)$/i);
    const cat = c?.[1].replace(TAIL, "").replace(FILLER, " ").replace(/\s+/g, " ").trim();
    if (cat) out.category = cat;
  }
  return out;
}
