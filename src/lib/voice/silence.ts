/**
 * "Mute" — every agent (JARVIS, DARWIN, RUBIN, MIKE, EV, ULTRON) stops talking
 * AND stops listening when you say it: nothing you say is heard or acted on
 * until you unmute — by saying "Hey JARVIS" (the only phrase listened for while
 * muted), the mic button, the "MUTED" pill, typing "unmute", or an open palm. One setting for the whole tab (the
 * mic button is the same switch), so the agent you switch to stays muted too.
 * Client-safe.
 */

const KEY = "jarvis.voice.silent";
const EVENT = "jarvis-voice-silent";

export function isVoiceSilent(): boolean {
  try { return typeof window !== "undefined" && sessionStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Turn every agent's voice off/on (tells every open agent screen). `via` = "wake" when "Hey JARVIS" unmuted it. */
export function setVoiceSilent(on: boolean, via?: "wake") {
  if (typeof window === "undefined") return;
  try { if (on) sessionStorage.setItem(KEY, "1"); else sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
  if (via === "wake") lastWakeAt = Date.now();
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { silent: on, via } }));
}

let greetedAt = 0;
let lastWakeAt = 0;
/** After a "Hey JARVIS" unmute, only the first agent to ask says "I'm back." */
export function takeWakeGreeting(): boolean {
  if (greetedAt >= lastWakeAt) return false;
  greetedAt = lastWakeAt;
  return true;
}

/** Be told when the voice is muted / unmuted (anywhere in this tab). */
export function onVoiceSilent(fn: (silent: boolean, via?: "wake") => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = (e: Event) => { const d = (e as CustomEvent<{ silent: boolean; via?: "wake" }>).detail; fn(!!d?.silent, d?.via); };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

const NAMES = "jarvis|darwin|rubin|ruben|reuben|robin|mike|ultron|ev|eve|buddy";
const OBJ = `(?:yourself|your\\s+voice|the\\s+voice|voice|audio|sound|speech|the\\s+mic(?:rophone)?|my\\s+mic(?:rophone)?|mic(?:rophone)?|${NAMES}|it|everything|all|everyone|please)`;

/**
 * "mute" / "mute yourself" / "Jarvis, mute" / "be quiet" / "stop talking" → "mute";
 * "unmute" / "speak again" / "turn the mic on" → "unmute"; anything else → null.
 */
export function muteIntent(text: string): "mute" | "unmute" | null {
  let t = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  // "hey Jarvis, …" / "Rubin …" / "… please"
  t = t.replace(new RegExp(`^(?:(?:hey|ok|okay)\\s+)?(?:${NAMES})\\s+`), "").replace(/^please\s+/, "").replace(/\s+(?:please|now|for now|for a while|thanks|thank you)$/, "").trim();
  if (/^(?:turn|switch) (?:on )?(?:the |my )?mic(?:rophone)?(?: back)? on$|^(?:turn|switch) on (?:the |my )?mic(?:rophone)?$|^mic(?:rophone)? on$/.test(t)) return "unmute";
  if (/^(?:turn|switch) (?:off )?(?:the |my )?mic(?:rophone)? off$|^(?:turn|switch) off (?:the |my )?mic(?:rophone)?$|^mic(?:rophone)? off$|^stop listening$|^don't listen$|^do not listen$/.test(t)) return "mute";
  if (new RegExp(`^(?:un-?mute|unmute)(?:\\s+${OBJ})*$`).test(t)) return "unmute";
  if (/^(?:speak|talk)(?:\s+(?:again|to me|up))+$|^you can (?:speak|talk)(?:\s+(?:again|now))*$|^(?:voice|sound|audio) (?:back )?on$|^turn (?:your |the )?(?:voice|sound|audio) (?:back )?on$|^(?:end|stop|exit) (?:silent|quiet) mode$/.test(t)) return "unmute";
  if (new RegExp(`^mute(?:\\s+${OBJ})*$`).test(t)) return "mute";
  if (/^(?:be quiet|quiet|keep quiet|stay quiet|go quiet|go silent|silence|silent mode|quiet mode|shush|hush|shut up|stop talking|stop speaking|no more talking|don't speak|do not speak|don't talk|turn (?:your |the )?(?:voice|sound|audio) off|(?:voice|sound|audio) off)$/.test(t)) return "mute";
  return null;
}

/** Typed "mute" / "unmute" in any agent's box: applies it and returns what to show (null = not one). */
export function typedMute(text: string): string | null {
  const m = muteIntent(text);
  if (!m) return null;
  setVoiceSilent(m === "mute");
  return m === "mute" ? "Muted — I've stopped listening and talking. Say “Hey JARVIS” (or click the mic or the “MUTED” pill) to turn me back on." : "Unmuted — I'm listening again.";
}

/**
 * While muted, the only thing that's listened for: "Hey JARVIS" (or another
 * agent's name — "hey Rubin", "okay Darwin", "Jarvis wake up") or "unmute".
 * Everything else said while muted is thrown away.
 */
export function isUnmuteWake(text: string): boolean {
  const t = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  const NAME = "(?:jarvis|javis|jervis|travis|rubin|ruben|reuben|robin|darwin|mike|ultron|ultra on)";
  return new RegExp(`\\b(?:hey|hi|hello|ok|okay|yo)\\s+${NAME}\\b|\\b${NAME}\\s+(?:wake up|unmute|i'?m back|you there)\\b|\\bwake up\\s+${NAME}\\b|^(?:un-?mute|unmute)(?:\\s+\\w+)?$`).test(t);
}
