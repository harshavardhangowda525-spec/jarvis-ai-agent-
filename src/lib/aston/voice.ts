/**
 * ASTON's spoken voice in the browser (free, on-device speech synthesis).
 * Prefers a British English voice when the device has one.
 */
import { isDirection } from "./scripts/format";

const VOICE_KEY = "aston.voice";

/** The voice the owner chose in Voice settings ("" = automatic). Saved in this browser only. */
export function preferredVoiceName(): string {
  try { return localStorage.getItem(VOICE_KEY) ?? ""; } catch { return ""; }
}
export function setPreferredVoiceName(name: string) {
  try { if (name) localStorage.setItem(VOICE_KEY, name); else localStorage.removeItem(VOICE_KEY); } catch { /* storage blocked */ }
}

/** English voices on this device, British first. */
export function englishVoices(): SpeechSynthesisVoice[] {
  const v = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  const rank = (x: SpeechSynthesisVoice) => (/en-GB/i.test(x.lang) ? 0 : /en-IN/i.test(x.lang) ? 1 : 2);
  return v.filter((x) => /^en/i.test(x.lang)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * The best automatic voice: on-device voices first (Microsoft George / Hazel / Ravi
 * on Windows, Daniel on Apple) — Chrome's online "Google" voices stream from
 * Google's servers and go silent when a firewall, antivirus or flaky network
 * blocks them. British English first, then Indian, then any English.
 */
export function bestVoice(voices: SpeechSynthesisVoice[], o: { localOnly?: boolean } = {}): SpeechSynthesisVoice | null {
  const en = voices.filter((x) => /^en/i.test(x.lang) && (!o.localOnly || x.localService));
  const score = (x: SpeechSynthesisVoice) =>
    (x.localService ? 0 : 100) +
    (/en-GB/i.test(x.lang) ? 0 : /en-IN/i.test(x.lang) ? 10 : 20) +
    (/\b(male|george|daniel|arthur|ravi|ryan|thomas)\b/i.test(x.name) && !/female/i.test(x.name) ? 0 : 1);
  return [...en].sort((a, b) => score(a) - score(b))[0] ?? null;
}

export function pickVoice(): SpeechSynthesisVoice | null {
  const v = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  const chosen = preferredVoiceName();
  const own = chosen ? v.find((x) => x.name === chosen) : undefined;
  if (own) return own;
  return bestVoice(v) ?? v[0] ?? null;
}

/** An on-device voice to fall back to when an online voice won't play. */
export function offlineVoice(): SpeechSynthesisVoice | null {
  const v = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  return bestVoice(v, { localOnly: true }) ?? v.find((x) => x.localService) ?? null;
}

export function voiceLabel(v: SpeechSynthesisVoice | null): string {
  if (!v) return "No voice available";
  if (/en-GB/i.test(v.lang)) return "British English";
  if (/en-IN/i.test(v.lang)) return "Indian English";
  if (/en-US/i.test(v.lang)) return "American English";
  return v.lang;
}

/** What ASTON says for a line: stage directions removed, [fill-ins] said without brackets. */
export function speakableText(text: string): string {
  return text
    .replace(/\[[^\]]{1,80}\]/g, (m) => (isDirection(m) ? " " : m.slice(1, -1)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * When ASTON itself last spoke. The teleprompter's microphone ignores what it
 * hears while ASTON is speaking (and briefly after), so its own voice can never
 * trigger a command.
 */
let selfSpeechUntil = 0;
export function markSelfSpeech(active: boolean) {
  if (active) selfSpeechUntil = Number.POSITIVE_INFINITY;
  else if (selfSpeechUntil === Number.POSITIVE_INFINITY) selfSpeechUntil = Date.now() + 900; // only a real end of speech leaves a tail
}
export function isSelfSpeaking(): boolean {
  const synth = typeof speechSynthesis !== "undefined" && (speechSynthesis.speaking || speechSynthesis.pending);
  return synth || Date.now() < selfSpeechUntil;
}
