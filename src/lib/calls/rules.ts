/**
 * Prospect calls — the rules, pure and tested. From the operating manual
 * (Part 6.2–6.5) plus JARVIS's own hard rules: it always says it's an AI, it
 * honours "don't call again" at once, and it never takes payment details.
 */
import { localParts } from "@/lib/prospects/rules";

export const MAX_ATTEMPTS = 3;
export const MAX_CALL_MS = 4 * 60_000;
export const MAX_TURNS = 16;

export interface CallRules { enabled: boolean; dailyCap: number; hoursFrom: string; hoursTo: string; days: number[] }

/** Inside the calling window (manual: 10 AM – 7 PM IST, Mon–Sat)? */
export function inCallingWindow(r: Pick<CallRules, "hoursFrom" | "hoursTo" | "days">, now: Date, tz: string): boolean {
  const l = localParts(now, tz);
  return r.days.includes(l.dow) && l.hhmm >= r.hoursFrom && l.hhmm < r.hoursTo;
}

export interface Eligibility { phone: string | null; doNotContact: boolean; status: string; attempts: number; calledToday: boolean }
/** Why a lead can't be called right now, or null when it can. */
export function cantCall(e: Eligibility): string | null {
  if (!e.phone || e.phone.replace(/\D/g, "").length < 8) return "no phone number";
  if (e.doNotContact) return "marked do-not-contact";
  if (e.status === "won" || e.status === "lost") return `already ${e.status}`;
  if (e.attempts >= MAX_ATTEMPTS) return `already tried ${MAX_ATTEMPTS} times`;
  if (e.calledToday) return "already called today";
  return null;
}

/** A number Phone Link can dial: +91XXXXXXXXXX for Indian mobiles, otherwise digits with an optional leading +. */
export function dialable(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[^\d+]/g, "");
  if (!s) return null;
  if (/^\+\d{8,15}$/.test(s)) return s;
  const d = s.replace(/\D/g, "");
  if (/^0?[6-9]\d{9}$/.test(d)) return `+91${d.slice(-10)}`; // Indian mobile
  if (/^0\d{9,11}$/.test(d)) return `+91${d.slice(1)}`; // Indian landline with STD code
  if (/^91[6-9]\d{9}$/.test(d)) return `+${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export interface Persona { callerName: string; company: string; ownerName: string; city: string; recordingNotice: boolean }

/** The opening line (manual 6.3 step 1). JARVIS says it's an AI assistant up front — always. */
export function openerText(p: Persona, businessName: string, contactPerson?: string | null): string {
  const who = contactPerson?.trim() || shortName(businessName);
  return `Hi, is this ${who}? Hi! This is ${p.callerName}, an AI assistant calling from ${p.company} here in ${p.city}, on behalf of ${p.ownerName}.` +
    `${p.recordingNotice ? " This call may be recorded for quality." : ""} Is this a good time for two minutes?`;
}

/** "Posh & Pixie | Premium Unisex Salon in HSR Layout" → "Posh & Pixie". */
export function shortName(name: string): string {
  return name.split(/\s+[|–—-]\s+|\s*\|\s*/)[0].replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 60) || name.slice(0, 60);
}

/** Operator recordings and voicemail — nobody to talk to. English, Hindi and Kannada phrasings. */
const MACHINE = /(the number you (have )?(dialled|dialed|are trying|are calling)|is (currently )?(not reachable|switched off|unreachable|busy|out of coverage)|not available right now|please try (again )?later|leave (a|your) message|after the (tone|beep)|voice ?mail|mailbox|subscriber you have|jis number par|abhi uplabdh nahi|vyast hai|band hai|ಸ್ವಿಚ್ ಆಫ್|ಲಭ್ಯವಿಲ್ಲ|ನೀವು ಕರೆ ಮಾಡಿದ)/i;
export const isMachine = (heard: string) => MACHINE.test(heard);

const DNC = /\b(don'?t|do not|never|stop) (ever )?(call|calling|ring|contact)(ing)? (me|us|this number|here|again)\b|\bremove (my|this|our) number\b|\bnot interested,? (and )?don'?t call\b|\bput (me|us) on (your )?(dnd|do not call)\b|\b(call|phone|fone) (mat|na) (karo|karna|kariye|kijiye|kare)\b|(फ़ोन|फोन|कॉल|काल) (मत|ना|न) (करो|करना|करें|कीजिए|करिए)|दोबारा (फ़ोन|फोन|कॉल) मत|(ಕಾಲ್|ಫೋನ್|ಕರೆ) ಮಾಡ(ಬೇಡಿ|ಬೇಡ)|\b(call|phone) madbedi\b/i;
export const saysDoNotCall = (heard: string) => DNC.test(heard);

const ASKS_AI = /\b(are you (a |an )?(bot|robot|ai|machine|computer|real( person)?|human)|is this (a |an )?(bot|robot|recording|ai|machine)|am i (talking|speaking) to (a |an )?(bot|robot|machine|computer|real person|human)|(kya )?(aap|tum) (robot|bot|machine|ai|insaan|insan) ho)\b|क्या (आप|तुम) (रोबोट|मशीन|एआई|इंसान)|(ನೀವು|ನೀನು) (ರೋಬೋಟ್|ಯಂತ್ರ|ಮನುಷ್ಯ)|\bneevu robot\b/i;
export const asksIfAi = (heard: string) => ASKS_AI.test(heard);

const CLAIMS_HUMAN = /\b(i'?m|i am) (a )?(real )?(human|person|not (a |an )?(bot|robot|ai|machine))\b|मैं (एक )?(इंसान|असली व्यक्ति) हूँ|मैं रोबोट नहीं|ನಾನು (ಒಬ್ಬ )?ಮನುಷ್ಯ|ನಾನು ರೋಬೋಟ್ ಅಲ್ಲ/i;
const PAYMENT = /\b(card number|cvv|otp|upi pin|bank (account|details)|pay (now|me|us)|send (the )?money|transfer)\b/i;

export const OUTCOMES = ["interested", "demo_booked", "callback", "not_interested", "do_not_call", "has_vendor", "wrong_number", "not_reachable", "called"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type Lang = "en" | "hi" | "kn";
export const LANGS: readonly Lang[] = ["en", "hi", "kn"];

/** Which language a line is in, from its script (Whisper writes Hindi in Devanagari, Kannada in Kannada script). Pure (tested). */
export function detectLang(text: string): Lang {
  const kn = (text.match(/[\u0C80-\u0CFF]/g) ?? []).length;
  const hi = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  if (kn && kn >= hi) return "kn";
  if (hi) return "hi";
  return "en";
}
/** Speech-to-text's language name or code → ours (null when it's none of the three). */
export function normLang(x: string | null | undefined): Lang | null {
  const v = (x ?? "").toLowerCase();
  return /^(en|english)/.test(v) ? "en" : /^(hi|hindi)/.test(v) ? "hi" : /^(kn|kannada)/.test(v) ? "kn" : null;
}

/** JARVIS's fixed lines on a call, in each language. */
export const LINES: Record<Lang, { dnc: string; hello: string; bye: string; aiYes: string; noPay: string; again: string; human: string; fillers: string[] }> = {
  en: {
    dnc: "Of course — I'll make sure we don't call you again. Sorry for the trouble, and have a good day!",
    hello: "Hello? Can you hear me?",
    bye: "I'll let you go now — thank you so much for your time! We'll follow up on WhatsApp. Have a great day!",
    aiYes: "Yes, I'm an AI assistant.", human: "I'm an AI assistant, to be honest — but I'm here to help.",
    noPay: "There's nothing to pay now — the demo is free. Harshavardhan will go through everything with you.",
    again: "Sorry, could you say that again?", fillers: ["Mm-hmm,", "Right,", "Okay,", "Sure,"],
  },
  hi: {
    dnc: "बिल्कुल — हम आपको दोबारा कॉल नहीं करेंगे। तकलीफ़ के लिए माफ़ी, आपका दिन शुभ हो!",
    hello: "हैलो? क्या आप मुझे सुन पा रहे हैं?",
    bye: "मैं आपका ज़्यादा समय नहीं लूँगी — बहुत धन्यवाद! हम WhatsApp पर आगे बात करेंगे। आपका दिन शुभ हो!",
    aiYes: "जी हाँ, मैं एक AI असिस्टेंट हूँ।", human: "सच कहूँ तो मैं एक AI असिस्टेंट हूँ — पर आपकी मदद के लिए हूँ।",
    noPay: "अभी कुछ भी भुगतान नहीं करना है — डेमो बिल्कुल फ़्री है। हर्षवर्धन आपको सब कुछ समझा देंगे।",
    again: "माफ़ कीजिए, क्या आप फिर से बोल सकते हैं?", fillers: ["हाँ जी,", "अच्छा,", "ठीक है,", "जी,"],
  },
  kn: {
    dnc: "ಖಂಡಿತ — ನಾವು ನಿಮಗೆ ಮತ್ತೆ ಕರೆ ಮಾಡುವುದಿಲ್ಲ. ತೊಂದರೆಗೆ ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ದಿನ ಶುಭವಾಗಲಿ!",
    hello: "ಹಲೋ? ನನ್ನ ಮಾತು ಕೇಳಿಸುತ್ತಿದೆಯೇ?",
    bye: "ನಿಮ್ಮ ಸಮಯಕ್ಕೆ ತುಂಬಾ ಧನ್ಯವಾದಗಳು! ನಾವು WhatsApp ನಲ್ಲಿ ಮುಂದುವರಿಸುತ್ತೇವೆ. ಶುಭ ದಿನ!",
    aiYes: "ಹೌದು, ನಾನು ಒಂದು AI ಸಹಾಯಕ.", human: "ನಿಜ ಹೇಳಬೇಕೆಂದರೆ ನಾನು ಒಂದು AI ಸಹಾಯಕ — ಆದರೆ ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ಇದ್ದೇನೆ.",
    noPay: "ಈಗ ಏನನ್ನೂ ಪಾವತಿಸಬೇಕಿಲ್ಲ — ಡೆಮೋ ಉಚಿತ. ಹರ್ಷವರ್ಧನ್ ಎಲ್ಲವನ್ನೂ ವಿವರಿಸುತ್ತಾರೆ.",
    again: "ಕ್ಷಮಿಸಿ, ಇನ್ನೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ?", fillers: ["ಹೌದು,", "ಸರಿ,", "ಓಕೆ,"],
  },
};

/** "Hello there. How are you? Good." → speakable chunks, so the first can play while the rest are made. Pure (tested). */
export function splitSentences(text: string): string[] {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?।…])\s+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) { if (out.length && out[out.length - 1].length < 18) out[out.length - 1] += ` ${p}`; else out.push(p); }
  return out.length ? out : text.trim() ? [text.trim()] : [];
}

export interface Turn { say: string; end: boolean; outcome: Outcome | null; callbackAt: string | null; notes: string | null; lang: Lang }

/** The brain's reply → a safe turn. Never claims to be human, never asks for payment, never too long. Pure (tested). */
export function parseTurn(raw: string, heard: string, heardLang: Lang = detectLang(heard)): Turn {
  let j: Record<string, unknown> = {};
  const m = raw.match(/\{[\s\S]*\}/);
  try { j = m ? JSON.parse(m[0]) : {}; } catch { j = {}; }
  let say = String(j.say ?? (m ? "" : raw)).replace(/\s+/g, " ").trim();
  const outcome = (OUTCOMES as readonly string[]).includes(String(j.outcome)) ? (j.outcome as Outcome) : null;
  let end = j.end === true || j.end === "true";
  const lang: Lang = (LANGS as readonly string[]).includes(String(j.lang)) ? (j.lang as Lang) : say ? detectLang(say) : heardLang;
  const L = LINES[lang];
  if (CLAIMS_HUMAN.test(say)) say = L.human;
  if (asksIfAi(heard) && !/\b(ai|artificial|assistant|automated|bot)\b|एआई|ಎಐ|असिस्टेंट|ಸಹಾಯಕ/i.test(say)) say = `${L.aiYes} ${say}`.trim();
  if (PAYMENT.test(say)) say = L.noPay;
  if (!say) { say = L.again; end = false; }
  if (say.length > 420) say = `${say.slice(0, 417).replace(/\s+\S*$/, "")}…`;
  const cb = typeof j.callbackAt === "string" && !Number.isNaN(Date.parse(j.callbackAt)) ? new Date(j.callbackAt).toISOString() : null;
  return { say, end, outcome, callbackAt: cb, notes: typeof j.notes === "string" ? j.notes.slice(0, 500) : null, lang };
}

/** How a call's outcome moves the lead in the CRM (manual 6.5 + 5.2). */
export function crmPatchFor(outcome: Outcome, o: { callbackAt?: Date | null; now?: Date } = {}): { status: string; lostReason?: string; nextAction?: string; nextActionAt?: Date; doNotContact?: boolean } {
  const now = o.now ?? new Date();
  const day = (n: number) => new Date(now.getTime() + n * 86_400_000);
  switch (outcome) {
    case "interested": return { status: "interested", nextAction: "Book a demo", nextActionAt: day(1) };
    case "demo_booked": return { status: "demo_booked", nextAction: "Confirm the demo time on WhatsApp", nextActionAt: o.callbackAt ?? day(1) };
    case "callback": return { status: "callback", nextAction: "Call back", nextActionAt: o.callbackAt ?? day(1) };
    case "not_interested": return { status: "lost", lostReason: "not_interested" };
    case "do_not_call": return { status: "lost", lostReason: "not_interested", doNotContact: true };
    case "has_vendor": return { status: "lost", lostReason: "has_vendor" };
    case "wrong_number": return { status: "lost", lostReason: "wrong_number" };
    case "not_reachable": return { status: "not_reachable" };
    default: return { status: "called" };
  }
}

/** Part 6 of the operating manual (call flow + objections), so the call brain follows the user's own playbook. */
export function manualCallSection(manual: string): string {
  const grab = (re: RegExp) => { const i = manual.search(re); if (i < 0) return ""; const rest = manual.slice(i + 1); const j = rest.search(/\n## PART /); return manual.slice(i, j < 0 ? undefined : i + 1 + j); };
  const calling = grab(/\n## PART \d+ — MODULE \d+: CALLING/i);
  const catalogue = grab(/\n### 3\.2 /) .split(/\n### 3\.4 /)[0];
  return [calling, catalogue].filter(Boolean).join("\n\n").slice(0, 12_000);
}
