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

export type BuildCommand = { kind: "website" | "app"; request: string; needsDetails: boolean };

/**
 * "Jarvis, build me a website for Brew & Bloom café…", "create a landing page
 * for my gym", "get ASTON to make an app demo for Iron Temple" → straight to
 * ASTON with your own words (no AI round trip deciding who should do it).
 * Questions ("how do I build a website?", "what does a website cost?") and
 * changes to an existing demo are not build commands.
 */
export function buildCommand(text: string): BuildCommand | null {
  const t = text.trim();
  const low = t.toLowerCase();
  if (/^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)?(?:how|what|why|when|where|which|who|is|are|does|do|should|would)\b/.test(low) && !/^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)?(?:can|could|would|will) you\b/.test(low)) return null;
  const m = /^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)?(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:i (?:want|need|would like) (?:you )?(?:to )?|let'?s\s+|(?:ask|tell|get|have) aston to\s+|aston[,\s]+)?(?:build|create|make|design|develop|generate|do|prepare)\s+(?:me\s+|us\s+)?(?:a\s+|an\s+|the\s+|one\s+)?(?:new\s+|premium\s+|modern\s+|simple\s+|quick\s+|nice\s+|demo\s+)*(website|web ?site|site|landing page|web ?page|homepage|portfolio site|app|application|mobile app|app demo|web app)\b/.exec(low);
  if (!m) return null;
  const kind: BuildCommand["kind"] = /app|application/.test(m[1]) && !/web ?app/.test(m[1]) ? "app" : "website";
  // what's left after "build a website" — who it's for and what it needs
  const rest = low.slice(m.index + m[0].length).replace(/[^a-z0-9&@'+-]+/g, " ").replace(/\b(for|me|us|please|now|demo|a|an|the|my|of|to|with|and)\b/g, " ").trim();
  return { kind, request: t.replace(/^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)/i, "").trim(), needsDetails: rest.split(/\s+/).filter((w) => w.length > 1).length < 1 };
}
