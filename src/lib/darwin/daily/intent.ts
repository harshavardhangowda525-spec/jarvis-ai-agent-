/** "DARWIN report" / "daily report" / "how many leads did DARWIN find today". Pure. */
export function darwinDailyRequest(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(darwin'?s? (daily )?(report|lead search|results|progress|target)|daily (lead )?(report|target|lead search)|today'?s (leads|lead search|lead report|darwin report))\b/.test(t)
    || /\bhow many (new )?leads (did|has|have) darwin (find|found|got)\b/.test(t)
    || /\bhow many leads (today|did (we|you) find today)\b/.test(t);
}

/** A one-line progress sentence while the search is still running (numbers from the view). */
export function darwinProgressLine(v: { run: { status: string; verified: number; target: number; lastError: string | null } | null; startLabel: string; due: boolean }, spoken: string | null): string {
  if (spoken) return spoken;
  const r = v.run;
  if (!r) return v.due ? "DARWIN is about to start today's lead search." : `DARWIN starts today's lead search at ${v.startLabel}.`;
  if (r.status === "needs_setup") return `DARWIN's daily search needs setup: ${r.lastError ?? "add target locations in DARWIN."}`;
  return `DARWIN's daily search is still running — ${r.verified} of ${r.target} new no-website leads verified so far.`;
}

/**
 * "DARWIN, search for leads now" / "start the lead search" / "find more leads now" — run the
 * daily search right away (not a one-off search: no specific category or place named). Pure.
 */
export function darwinSearchNowRequest(text: string): boolean {
  const t = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!?]+$/, "");
  if (/\b(in|near|around)\s+(?!bangalore\b|bengaluru\b)[a-z]{3,}/.test(t)) return false; // a specific place → a one-off search
  return /\b(search|look|hunt|scan)\s+(for\s+)?(new\s+|more\s+|some\s+)?leads?\b.*\b(now|right now|immediately|again|asap)\b/.test(t)
    || /\b(find|get|generate|pull|bring)\s+(me\s+)?(new\s+|more\s+|some\s+)?leads?\s+(now|right now|immediately|again|asap)\b/.test(t)
    || /\b(start|run|kick off|begin|restart)\s+(the\s+|today'?s\s+|a\s+|your\s+)?(daily\s+)?(lead\s+)?search(ing)?\b(?!\s+for\s+(?!leads?\b)\w)/.test(t)
    || /\b(search|find leads)\s+(all of|every area of|across)\s+(bangalore|bengaluru)\b/.test(t);
}

/** What DARWIN says after "search for leads now" (numbers from the view). */
export function darwinSearchNowLine(v: { run: { status: string; verified: number; target: number; lastError: string | null } | null } | null): string {
  const r = v?.run;
  if (!r) return "I couldn't start the search just now — try again in a moment.";
  if (r.status === "needs_setup") return `I can't search yet: ${r.lastError ?? "the daily search needs setup."}`;
  if (r.status === "completed") return `Done — ${r.verified} verified no-website leads today, target reached.`;
  if (r.status === "partial") return `Search finished with ${r.verified} of ${r.target} verified leads today.${r.lastError ? ` ${r.lastError}` : ""}`;
  return `Searching now — ${r.verified} of ${r.target} verified so far. I'll keep going until I reach the target.`;
}
