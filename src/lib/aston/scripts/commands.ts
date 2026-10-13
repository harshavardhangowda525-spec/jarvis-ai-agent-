/**
 * Teleprompter voice commands (pure). While a script is on screen you are
 * reading it aloud, so ONLY sentences that start with "ASTON" count as
 * commands — anything else (your pitch, the client) is ignored and nothing
 * spoken is ever written into the script.
 */
import { stripWake } from "./format";

export type TeleAction =
  | "start" | "pause" | "resume" | "faster" | "slower" | "bigger" | "smaller"
  | "restart" | "next" | "repeat" | "edit" | "close" | "fullscreen" | "stop";

const RULES: [TeleAction, RegExp][] = [
  ["close", /\b(close|exit|quit|dismiss)\b|\b(stop|end)\b.*\b(teleprompter|prompter)\b/],
  ["restart", /\b(restart|start over|start again|play again|from the (top|beginning)|go to the (top|beginning)|rewind)\b/],
  ["next", /\b(next (section|part|bit)|skip (ahead|section|this)|move on)\b/],
  ["repeat", /\b(repeat|previous (section|part)|go back|last section|back a section|again)\b/],
  ["faster", /\b(faster|speed up|quicker|increase (the )?speed)\b/],
  ["slower", /\b(slower|slow down|decrease (the )?speed|reduce (the )?speed)\b/],
  ["bigger", /\b(bigger|larger|increase (the )?(text|font)( size)?|zoom in|text up)\b/],
  ["smaller", /\b(smaller|decrease (the )?(text|font)( size)?|reduce (the )?(text|font)|zoom out|text down)\b/],
  ["edit", /\b(edit|change|modify)\b.*\b(script|text)?\b|^edit\b/],
  ["fullscreen", /\b(full ?screen|focus mode|reading mode)\b/],
  ["stop", /^stop$|^stop (it|reading|the script|playback)$/],
  ["pause", /\b(pause|hold( on)?|wait|freeze|stop scrolling)\b/],
  ["resume", /\b(resume|continue|carry on|keep going|unpause)\b/],
  ["start", /\b(start|begin|go|play|roll)\b/],
];

/**
 * Without "ASTON" first, only these exact, whole-sentence phrases count — a
 * sentence from your pitch ("can I pause you there?") never matches one.
 */
const BARE: Record<string, TeleAction> = {
  "pause": "pause", "pause scrolling": "pause", "stop scrolling": "pause",
  "resume": "resume", "resume scrolling": "resume", "continue scrolling": "resume",
  "start scrolling": "start", "start the teleprompter": "start", "start teleprompter": "start",
  "scroll faster": "faster", "scroll slower": "slower",
  "increase text size": "bigger", "decrease text size": "smaller",
  "next section": "next", "go to the next section": "next",
  "previous section": "repeat", "repeat this section": "repeat", "repeat the section": "repeat", "repeat the last section": "repeat",
  "restart the script": "restart", "close teleprompter": "close", "close the teleprompter": "close",
};
const norm = (s: string) => s.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();

/**
 * Turn a recognised utterance into a teleprompter action, or null.
 * With "ASTON" first, short commands are understood flexibly; without it,
 * only the exact phrases above count (unless `requireWake` is false).
 */
export function parseCommand(utterance: string, requireWake = true): TeleAction | null {
  const { text, woke } = stripWake(utterance);
  if (!woke && requireWake) return BARE[norm(text)] ?? null;
  const t = norm(text);
  if (!t || t.split(" ").length > 8) return null; // a command is short; a long sentence is speech
  for (const [action, re] of RULES) if (re.test(t)) return action;
  return null;
}

/** Speed levels 1–10 → pixels per second, relative to the line height. */
export const speedPx = (level: number, fontPx: number, lineHeight: number) => Math.max(1, level) * fontPx * lineHeight * 0.075;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
