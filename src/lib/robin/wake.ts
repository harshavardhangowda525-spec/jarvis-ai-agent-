/**
 * ROBIN's name as speech recognition hears it ("Robin", "Robbin", "Robyn",
 * "Roben", "Robin's"). Client-safe.
 */
export const ROBIN_NAME = "(?:robin|robbin|robyn|robben|roben|robins|robin's)";
const NAME = ROBIN_NAME;

const ACTIVATE = new RegExp(
  `^(?:hey\\s+|ok(?:ay)?\\s+)?(?:jarvis[,\\s]+)?(?:please\\s+)?${NAME}[\\s!.,?]*$` + // just "Robin"
  `|\\b(?:activate|launch|open|start|switch\\s+to|go\\s+to|bring\\s+up|wake\\s+up|call|summon|load\\s+up)\\s+(?:the\\s+)?${NAME}\\b` +
  `|\\b${NAME}[,\\s]+(?:online|wake\\s+up|come\\s+online|take\\s+over|activate)\\b`,
  "i",
);

/** "Robin", "Activate Robin", "Open Robin", "Start Robin" → true. */
export function isRobinActivation(text: string): boolean {
  const t = text.trim().replace(/[“”"]/g, "");
  if (!t || /\bask\s+robin\b/i.test(t)) return false; // "ask Robin how many…" is a question for JARVIS to relay
  return ACTIVATE.test(t);
}

/** "Robin, show me today's follow-ups" — a command addressed to Robin (not just her name). */
export function robinCommand(text: string): string | null {
  const m = text.trim().match(new RegExp(`^(?:hey\\s+|ok(?:ay)?\\s+)?(?:jarvis[,\\s]+)?${NAME}[,!.:\\s]+(.{3,})$`, "i"));
  if (!m) return null;
  const rest = m[1].trim();
  return isRobinActivation(text) ? null : rest;
}

/** "Robin, show me …" → "show me …". */
export function stripRobinWake(text: string): string {
  return text.trim().replace(new RegExp(`^(?:hey\\s+|ok(?:ay)?\\s+)?${NAME}[,!.:\\s]+`, "i"), "").trim();
}

/** "Close Robin", "Deactivate Robin", "Get me back to JARVIS". */
export function isRobinDeactivation(text: string): boolean {
  return new RegExp(
    `\\b(?:deactivate|close|exit|shut\\s?down|stand\\s?down|power\\s?down|dismiss)\\s+(?:the\\s+)?${NAME}\\b` +
    `|\\b${NAME}[,\\s]+(?:deactivate|stand\\s?down|off|shut\\s?down|close)\\b` +
    `|^(?:(?:get|take)\\s+me\\s+)?(?:back\\s+to|return\\s+to|go\\s+back\\s+to)\\s+jarvis\\b|^(?:open|go\\s+to)\\s+jarvis\\b`,
    "i",
  ).test(text.trim());
}
