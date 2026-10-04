/**
 * "Mute" — every agent (JARVIS, DARWIN, RUBIN, MIKE, EV, ULTRON) goes quiet
 * when you say it: replies still appear on screen but aren't spoken, and the
 * agent keeps LISTENING, so "unmute" brings the voice back. It's one setting
 * for the whole tab, so the agent you switch to stays quiet too.
 * (The mic button is different: it stops the agent hearing you.) Client-safe.
 */

const KEY = "jarvis.voice.silent";
const EVENT = "jarvis-voice-silent";

export function isVoiceSilent(): boolean {
  try { return typeof window !== "undefined" && sessionStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Turn every agent's voice off/on (tells every open agent screen). */
export function setVoiceSilent(on: boolean) {
  if (typeof window === "undefined") return;
  try { if (on) sessionStorage.setItem(KEY, "1"); else sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { silent: on } }));
}

/** Be told when the voice is muted / unmuted (anywhere in this tab). */
export function onVoiceSilent(fn: (silent: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = (e: Event) => fn(!!(e as CustomEvent<{ silent: boolean }>).detail?.silent);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

const NAMES = "jarvis|darwin|rubin|ruben|reuben|robin|mike|ultron|ev|eve|buddy";
const OBJ = `(?:yourself|your\\s+voice|the\\s+voice|voice|audio|sound|speech|${NAMES}|it|everything|all|everyone|please)`;

/**
 * "mute" / "mute yourself" / "Jarvis, mute" / "be quiet" / "stop talking" → "mute";
 * "unmute" / "speak again" / "you can talk now" → "unmute"; anything else → null.
 * "mute the mic" is the microphone, not the voice — left alone.
 */
export function muteIntent(text: string): "mute" | "unmute" | null {
  let t = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  // "hey Jarvis, …" / "Rubin …" / "… please"
  t = t.replace(new RegExp(`^(?:(?:hey|ok|okay)\\s+)?(?:${NAMES})\\s+`), "").replace(/^please\s+/, "").replace(/\s+(?:please|now|for now|for a while|thanks|thank you)$/, "").trim();
  if (/\b(mic|microphone)\b/.test(t)) return null;
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
  return m === "mute" ? "Muted — I'll reply on screen only and keep listening. Say “unmute” to hear me again." : "Unmuted — you'll hear me again.";
}
