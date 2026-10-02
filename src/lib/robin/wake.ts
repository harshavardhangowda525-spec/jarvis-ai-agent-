/**
 * RUBIN's name as speech recognition hears it ("Rubin", "Ruben", "Reuben",
 * "Rubin's") — and the old name "Robin" still works. Client-safe.
 */
export const ROBIN_NAME = "(?:rubin|rubins|rubin's|ruben|rubens|reuben|rueben|rubin|robin|robbin|robyn|robben|roben|robins|robin's)";
const NAME = ROBIN_NAME;

const ACTIVATE = new RegExp(
  `^(?:hey\\s+|ok(?:ay)?\\s+)?(?:jarvis[,\\s]+)?(?:please\\s+)?${NAME}[\\s!.,?]*$` + // just "Rubin"
  `|\\b(?:activate|launch|open|start|switch\\s+to|go\\s+to|bring\\s+up|wake\\s+up|call|summon|load\\s+up)\\s+(?:the\\s+)?${NAME}\\b` +
  `|\\b${NAME}[,\\s]+(?:online|wake\\s+up|come\\s+online|take\\s+over|activate)\\b`,
  "i",
);

/** "Rubin", "Activate Rubin", "Open Rubin", "Start Rubin" → true. */
export function isRobinActivation(text: string): boolean {
  const t = text.trim().replace(/[“”"]/g, "");
  if (!t || new RegExp(`\\bask\\s+${NAME}\\b`, "i").test(t)) return false; // "ask Rubin how many…" is a question for JARVIS to relay
  return ACTIVATE.test(t);
}

/** "Rubin, show me today's follow-ups" — a command addressed to Rubin (not just her name). */
export function robinCommand(text: string): string | null {
  const m = text.trim().match(new RegExp(`^(?:hey\\s+|ok(?:ay)?\\s+)?(?:jarvis[,\\s]+)?${NAME}[,!.:\\s]+(.{3,})$`, "i"));
  if (!m) return null;
  const rest = m[1].trim();
  return isRobinActivation(text) ? null : rest;
}

/** "Rubin, show me …" → "show me …". */
export function stripRobinWake(text: string): string {
  return text.trim().replace(new RegExp(`^(?:hey\\s+|ok(?:ay)?\\s+)?${NAME}[,!.:\\s]+`, "i"), "").trim();
}

/** "Close Rubin", "Deactivate Rubin", "Get me back to JARVIS". */
export function isRobinDeactivation(text: string): boolean {
  return new RegExp(
    `\\b(?:deactivate|close|exit|shut\\s?down|stand\\s?down|power\\s?down|dismiss)\\s+(?:the\\s+)?${NAME}\\b` +
    `|\\b${NAME}[,\\s]+(?:deactivate|stand\\s?down|off|shut\\s?down|close)\\b` +
    `|^(?:(?:get|take)\\s+me\\s+)?(?:back\\s+to|return\\s+to|go\\s+back\\s+to)\\s+jarvis\\b|^(?:open|go\\s+to)\\s+jarvis\\b`,
    "i",
  ).test(text.trim());
}
