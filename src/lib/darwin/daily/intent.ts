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
