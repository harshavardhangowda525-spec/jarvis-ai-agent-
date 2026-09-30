/**
 * MIKE's name as speech recognition actually hears it. "Mike" very often comes
 * back as "mic", "Mick", "Myke" or "Mikey", so all of those wake/activate MIKE.
 * Microphone commands stay what they are: "turn on the mic", "unmute mic",
 * "mute mic", "start mic", "mic check" never activate MIKE.
 */
export const MIKE_NAME = "(?:mike|mic|mick|mik|myke|mikey|mykey|maik|mikes|mike's)";
const NAME = MIKE_NAME;
const MICROPHONE = /\b(turn (on|off)|switch (on|off)|unmute|mute|enable|disable|test|start|stop|check)\s+(the\s+|my\s+)?mic\b|\bmic\s+(check|test|on|off|volume|settings)\b|\bmicrophone\b/i;

const ACTIVATE = new RegExp(
  `^(?:hey\\s+|ok(?:ay)?\\s+)?(?:jarvis[,\\s]+)?(?:please\\s+)?${NAME}[\\s!.,]*$` + // just "Mike" / "Mic"
  `|\\b(?:activate|launch|open|start|switch\\s+to|go\\s+to|bring\\s+up|wake\\s+up|call|summon|load\\s+up)\\s+(?:the\\s+)?${NAME}\\b` +
  `|\\b${NAME}[,\\s]+(?:online|wake\\s+up|come\\s+online|take\\s+over|activate)\\b`,
  "i",
);

/** "Activate Mike", "activate mic", "open Mick", "Mike, come online" → true. Microphone commands → false. */
export function isMikeActivation(text: string): boolean {
  const t = text.trim().replace(/[“”"]/g, "");
  if (!t || MICROPHONE.test(t)) return false;
  return ACTIVATE.test(t);
}

/** "Mic, scan the market" → "scan the market" (the wake word, however it was heard). */
export function stripMikeWake(text: string): string {
  return text.trim().replace(new RegExp(`^(?:hey\\s+|ok(?:ay)?\\s+)?${NAME}[,!.\\s]+`, "i"), "").trim();
}

/** "Deactivate mic", "close Mike", "Mick, stand down", "back to JARVIS". */
export function isMikeDeactivation(text: string): boolean {
  const t = text.trim();
  return new RegExp(`\\b(?:deactivate|close|exit|shut\\s?down|stand\\s?down|power\\s?down)\\b.*\\b${NAME}\\b|\\b${NAME}[,\\s]+(?:deactivate|stand\\s?down|off|shut\\s?down)\\b|^(?:back\\s+to|open|return\\s+to|go\\s+to)\\s+jarvis\\b`, "i").test(t)
    && !MICROPHONE.test(t);
}
