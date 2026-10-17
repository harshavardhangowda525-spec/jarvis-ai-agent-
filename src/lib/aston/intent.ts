/**
 * Spoken/typed commands for ASTON (client-safe). The preview phrases only
 * count when JARVIS has just offered a preview or one is open — "yes" on its
 * own never opens anything otherwise.
 */
const LEAD = String.raw`^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)?(?:please\s+)?`;
const TAIL = String.raw`(?:\s+please)?[.!\s]*$`;

export function astonPreviewCommand(text: string, s: { offered: boolean; open: boolean }): "open" | "walk" | "close" | null {
  const t = text.trim().toLowerCase();
  if (!s.offered && !s.open) return null;
  if (s.open && new RegExp(`${LEAD}(?:close|hide|exit|dismiss)\\s+(?:the\\s+|this\\s+)?(?:preview|demo|website|site|app)${TAIL}`).test(t)) return "close";
  if (new RegExp(`${LEAD}(?:(?:yes|yeah|yep|sure|ok|okay|go ahead)[,!.\\s]+)?(?:(?:can you|could you)\\s+)?(?:walk me through(?: it| the (?:design|site|website|preview|app))?|give me (?:a|the) (?:tour|walkthrough|walk-through)|(?:start|do) (?:the |a )?(?:tour|walkthrough|walk-through)|guided (?:tour|walkthrough))${TAIL}`).test(t)) return "walk";
  if (!s.offered) return null;
  if (new RegExp(`${LEAD}(?:(?:yes|yeah|yep|sure|ok|okay|go ahead)[,!.\\s]*)?(?:(?:open|show)(?: me)? (?:it|that|the (?:preview|demo|website|site|app))(?: in a new tab)?)?${TAIL}`).test(t) && /\b(yes|yeah|yep|sure|ok|okay|go ahead|open|show)\b/.test(t)) return "open";
  return null;
}

export function isAstonActivation(low: string): boolean {
  const A = "(?:aston|austin|aston's)";
  return new RegExp(`^${A}[\\s!.,]*$|\\b(open|launch|activate|start|switch to|go to|bring up|talk to)\\s+${A}\\b(?!'s)(?!\\s+(?:teleprompter|demos?))|\\b${A}[,\\s]+(online|wake up|come online)\\b`).test(low.trim());
}

export function teleprompterCommand(low: string): boolean {
  return /\b(open|show|start|bring up|launch)\b.{0,20}\b(teleprompter|today'?s (marketing )?plan|daily (marketing )?plan|marketing plan)\b/.test(low) || /^(the )?teleprompter[.!\s]*$/.test(low.trim());
}
