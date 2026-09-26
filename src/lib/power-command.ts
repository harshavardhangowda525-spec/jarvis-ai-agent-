/**
 * "JARVIS, shut down my laptop" — recognise laptop power commands. Only the
 * laptop / computer / PC wording counts, so "shut down EV" or "power down"
 * (JARVIS's own sleep) never turn the machine off. Client-safe.
 */
export type PowerIntent =
  | { kind: "shutdown"; delaySec: number }
  | { kind: "cancel" };

const DEVICE = "(?:my\\s+|the\\s+|this\\s+)?(?:laptop|computer|pc|system|machine|device|notebook)";
const SHUTDOWN_RE = new RegExp(`\\b(?:shut\\s*(?:it\\s*)?down|switch\\s*off|turn\\s*off|power\\s*off|power\\s*down)\\s+${DEVICE}\\b|\\b${DEVICE}\\s+(?:shut\\s*down|off)\\b|\\bshut\\s*down\\s+${DEVICE}\\b`, "i");
const CANCEL_RE = /\b(cancel|abort|stop|halt|don'?t)\b.{0,20}\b(shut\s*down|shutdown|power\s*off|turning off)\b|\b(shut\s*down|shutdown)\b.{0,10}\b(cancel(led)?|abort(ed)?)\b/i;

/** Default wait before powering off — always long enough to say "cancel shutdown". */
export const DEFAULT_SHUTDOWN_DELAY = 30;

export function parsePowerIntent(text: string): PowerIntent | null {
  const s = text.trim();
  if (CANCEL_RE.test(s)) return { kind: "cancel" };
  if (!SHUTDOWN_RE.test(s)) return null;
  const m = s.match(/\b(?:in|after)\s+(\d{1,3})\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i);
  let delaySec = DEFAULT_SHUTDOWN_DELAY;
  if (m) {
    const n = parseInt(m[1], 10), u = m[2].toLowerCase();
    delaySec = u.startsWith("h") ? n * 3600 : u.startsWith("m") ? n * 60 : n;
  }
  return { kind: "shutdown", delaySec: Math.min(3600, Math.max(10, delaySec)) };
}

/** A spoken yes / no to "Shut down your laptop?". null = neither (a new command). */
export function parseConfirmation(text: string): boolean | null {
  const s = text.trim().toLowerCase().replace(/[.!?,]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(jarvis\s+)/, "");
  if (/^(yes|yeah|yep|yup|sure|confirm(ed)?|do it|go ahead|affirmative|ok(ay)?( do it| go ahead)?|shut it down|yes shut( it)? down|please do)\b/.test(s)) return true;
  if (/^(no|nope|nah|cancel|don'?t|do not|stop|never ?mind|abort|wait)\b/.test(s)) return false;
  return null;
}

/** "in 45 seconds" / "in 5 minutes" for speech. */
export function spokenDelay(sec: number) {
  if (sec % 3600 === 0) return `${sec / 3600} hour${sec === 3600 ? "" : "s"}`;
  if (sec >= 120 && sec % 60 === 0) return `${sec / 60} minutes`;
  if (sec === 60) return "1 minute";
  return `${sec} seconds`;
}
