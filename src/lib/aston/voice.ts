/**
 * ASTON's spoken voice in the browser (free, on-device speech synthesis).
 * Prefers a British English voice when the device has one.
 */
import { isDirection } from "./scripts/format";

export function pickVoice(): SpeechSynthesisVoice | null {
  const v = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  return v.find((x) => /en-GB/i.test(x.lang) && /male|daniel|arthur|george/i.test(x.name)) ?? v.find((x) => /en-GB/i.test(x.lang)) ?? v.find((x) => /^en/i.test(x.lang)) ?? null;
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
