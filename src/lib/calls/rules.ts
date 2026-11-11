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

const DNC = /\b(don'?t|do not|never|stop) (ever )?(call|calling|ring|contact)(ing)? (me|us|this number|here|again)\b|\bremove (my|this|our) number\b|\bnot interested,? (and )?don'?t call\b|\bput (me|us) on (your )?(dnd|do not call)\b/i;
export const saysDoNotCall = (heard: string) => DNC.test(heard);

const ASKS_AI = /\b(are you (a |an )?(bot|robot|ai|machine|computer|real( person)?|human)|is this (a |an )?(bot|robot|recording|ai|machine)|am i (talking|speaking) to (a |an )?(bot|robot|machine|computer|real person|human))\b/i;
export const asksIfAi = (heard: string) => ASKS_AI.test(heard);

const CLAIMS_HUMAN = /\b(i'?m|i am) (a )?(real )?(human|person|not (a |an )?(bot|robot|ai|machine))\b/i;
const PAYMENT = /\b(card number|cvv|otp|upi pin|bank (account|details)|pay (now|me|us)|send (the )?money|transfer)\b/i;

export const OUTCOMES = ["interested", "demo_booked", "callback", "not_interested", "do_not_call", "has_vendor", "wrong_number", "not_reachable", "called"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface Turn { say: string; end: boolean; outcome: Outcome | null; callbackAt: string | null; notes: string | null }

/** The brain's reply → a safe turn. Never claims to be human, never asks for payment, never too long. Pure (tested). */
export function parseTurn(raw: string, heard: string): Turn {
  let j: Record<string, unknown> = {};
  const m = raw.match(/\{[\s\S]*\}/);
  try { j = m ? JSON.parse(m[0]) : {}; } catch { j = {}; }
  let say = String(j.say ?? (m ? "" : raw)).replace(/\s+/g, " ").trim();
  const outcome = (OUTCOMES as readonly string[]).includes(String(j.outcome)) ? (j.outcome as Outcome) : null;
  let end = j.end === true || j.end === "true";
  if (CLAIMS_HUMAN.test(say)) say = "I'm an AI assistant, to be honest — but I'm here to help.";
  if (asksIfAi(heard) && !/\b(ai|artificial|assistant|automated|bot)\b/i.test(say)) say = `Yes, I'm an AI assistant. ${say}`.trim();
  if (PAYMENT.test(say)) say = "There's nothing to pay now — the demo is free. Harshavardhan will go through everything with you.";
  if (!say) { say = "Sorry, could you say that again?"; end = false; }
  if (say.length > 420) say = `${say.slice(0, 417).replace(/\s+\S*$/, "")}…`;
  const cb = typeof j.callbackAt === "string" && !Number.isNaN(Date.parse(j.callbackAt)) ? new Date(j.callbackAt).toISOString() : null;
  return { say, end, outcome, callbackAt: cb, notes: typeof j.notes === "string" ? j.notes.slice(0, 500) : null };
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
