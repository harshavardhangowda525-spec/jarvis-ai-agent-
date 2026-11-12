import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { getLiveBrain } from "@/lib/ai/brain";
import { agentConfigs } from "@/lib/ai/agent";
import { completeWithFallback } from "@/lib/ai/complete";
import { loadOperator } from "@/lib/ai/operator";
import { localParts } from "@/lib/prospects/rules";
import { event, updateProspect, CrmError } from "@/lib/prospects/service";
import { ownerNext, ownerTick } from "./owner";
import {
  inCallingWindow, cantCall, dialable, openerText, isMachine, saysDoNotCall, parseTurn, crmPatchFor, manualCallSection,
  OUTCOMES, MAX_TURNS, MAX_CALL_MS, LINES, detectLang, type Outcome, type Turn, type Lang,
} from "./rules";

/**
 * Prospect calls through Windows Phone Link (your own number). JARVIS plans,
 * YOU approve (a batch approval covers that batch only), and the caller on your
 * laptop (JARVIS's own calls window) dials, talks and reports back. The CRM is updated
 * after every call, with the transcript and a short summary.
 */
const db = () => getDb();
export class CallError extends Error {}
export const STALE_MS = 10 * 60_000;
type Line = { who: "jarvis" | "them"; text: string; at: string };
type Ask = (system: string, user: string) => Promise<string>;

async function tzOf(userId: string) {
  const tz = (await db().profile.findUnique({ where: { userId }, select: { timezone: true } }).catch(() => null))?.timezone || "Asia/Kolkata";
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return "Asia/Kolkata"; }
}
function dayStart(now: Date, tz: string) {
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number);
  return new Date(now.getTime() - ((t[0] * 60 + t[1]) * 60 + t[2]) * 1000 - now.getMilliseconds());
}

export async function getSettings(userId: string) {
  return (await db().callSettings.findUnique({ where: { userId } })) ?? { userId, enabled: false, dailyCap: 25, hoursFrom: "10:00", hoursTo: "19:00", days: [1, 2, 3, 4, 5, 6], recordingNotice: true, callerName: "Jarvis", company: "Infinity Web & Apps", ownerName: "Harshavardhan", city: "Bengaluru" };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export async function saveSettings(userId: string, s: Partial<{ enabled: boolean; dailyCap: number; hoursFrom: string; hoursTo: string; days: number[]; recordingNotice: boolean; callerName: string; company: string; ownerName: string; city: string }>) {
  if (s.hoursFrom && !HHMM.test(s.hoursFrom)) throw new CallError("Start time must be HH:MM.");
  if (s.hoursTo && !HHMM.test(s.hoursTo)) throw new CallError("End time must be HH:MM.");
  if (s.dailyCap != null && (s.dailyCap < 1 || s.dailyCap > 60)) throw new CallError("Calls per day must be 1–60.");
  const data = Object.fromEntries(Object.entries({ ...s, days: s.days ? [...new Set(s.days.filter((d) => d >= 0 && d <= 6))].sort() : undefined,
    callerName: s.callerName?.trim().slice(0, 40), company: s.company?.trim().slice(0, 80), ownerName: s.ownerName?.trim().slice(0, 60), city: s.city?.trim().slice(0, 60) }).filter(([, v]) => v !== undefined && v !== ""));
  const r = await db().callSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  if (r.hoursFrom >= r.hoursTo) throw new CallError("The calling window must end after it starts.");
  return r;
}

async function attemptsOf(userId: string, prospectIds: string[], now: Date, tz: string) {
  const calls = await db().prospectCall.findMany({ where: { userId, prospectId: { in: prospectIds }, startedAt: { not: null } }, select: { prospectId: true, startedAt: true } });
  const start = dayStart(now, tz);
  const m = new Map<string, { attempts: number; today: boolean }>();
  for (const c of calls) { const x = m.get(c.prospectId) ?? { attempts: 0, today: false }; x.attempts++; if (c.startedAt! >= start) x.today = true; m.set(c.prospectId, x); }
  return m;
}

/** JARVIS proposes calls (today's call list, or the leads given). Nothing is dialled until you approve the batch. */
export async function planCalls(userId: string, i: { prospectIds?: string[]; limit?: number } = {}, now = new Date()) {
  const tz = await tzOf(userId);
  const s = await getSettings(userId);
  const end = new Date(dayStart(now, tz).getTime() + 86_400_000);
  const open = await db().prospectCall.findMany({ where: { userId, status: { in: ["proposed", "approved", "dialing", "in_call"] } }, select: { prospectId: true } });
  const busy = new Set(open.map((c) => c.prospectId));
  const leads = await db().prospect.findMany({
    where: { userId, ...(i.prospectIds?.length ? { id: { in: i.prospectIds } } : { status: { in: ["new", "not_reachable", "callback", "called"] }, nextActionAt: { lt: end } }) },
    orderBy: [{ leadScore: "desc" }, { createdAt: "asc" }], take: 200,
  });
  const att = await attemptsOf(userId, leads.map((l) => l.id), now, tz);
  const picked: { prospectId: string; toNumber: string; name: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const max = Math.min(i.limit ?? s.dailyCap, s.dailyCap);
  for (const l of leads) {
    if (picked.length >= max) break;
    const a = att.get(l.id) ?? { attempts: 0, today: false };
    const why = busy.has(l.id) ? "already planned" : cantCall({ phone: l.phone, doNotContact: l.doNotContact, status: l.status, attempts: a.attempts, calledToday: a.today }) ?? (dialable(l.phone) ? null : "phone number isn't dialable");
    if (why) { skipped.push({ name: l.businessName, reason: why }); continue; }
    picked.push({ prospectId: l.id, toNumber: dialable(l.phone)!, name: l.businessName });
  }
  if (!picked.length) return { batchId: null, calls: [], skipped };
  const batchId = `cb_${randomBytes(6).toString("hex")}`;
  await db().prospectCall.createMany({ data: picked.map((p) => ({ userId, prospectId: p.prospectId, toNumber: p.toNumber, batchId, status: "proposed" })) });
  await event(userId, null, "call", `Planned ${picked.length} call${picked.length === 1 ? "" : "s"} — waiting for your approval in the CRM.`, "jarvis", { batchId });
  return { batchId, calls: picked, skipped };
}

/** Your approval (never JARVIS's). Covers this batch only. */
export async function approveBatch(userId: string, batchId: string, now = new Date()) {
  const r = await db().prospectCall.updateMany({ where: { userId, batchId, status: "proposed" }, data: { status: "approved", approvedAt: now } });
  if (!r.count) throw new CallError("Nothing in that batch is waiting for approval.");
  await event(userId, null, "call", `You approved ${r.count} call${r.count === 1 ? "" : "s"}.`, "you", { batchId });
  return r.count;
}

export async function cancelCalls(userId: string, w: { batchId?: string; id?: string }) {
  const r = await db().prospectCall.updateMany({ where: { userId, ...(w.id ? { id: w.id } : { batchId: w.batchId }), status: { in: ["proposed", "approved"] } }, data: { status: "cancelled", endedAt: new Date() } });
  return r.count;
}

/** Everything the CRM's Calls panel shows. */
export async function callsBoard(userId: string, now = new Date()) {
  const tz = await tzOf(userId);
  const s = await getSettings(userId);
  const start = dayStart(now, tz);
  const [calls, today] = await Promise.all([
    db().prospectCall.findMany({ where: { userId, OR: [{ status: { in: ["proposed", "approved", "dialing", "in_call"] } }, { createdAt: { gte: new Date(now.getTime() - 3 * 86_400_000) } }] }, orderBy: { createdAt: "desc" }, take: 120, include: { prospect: { select: { businessName: true, category: true, area: true } } } }),
    db().prospectCall.count({ where: { userId, startedAt: { gte: start } } }),
  ]);
  return {
    settings: s, windowOpen: inCallingWindow(s, now, tz), callsToday: today, local: localParts(now, tz),
    calls: calls.map((c) => ({ id: c.id, batchId: c.batchId, status: c.status, to: c.toNumber, prospectId: c.prospectId, name: c.prospect.businessName, category: c.prospect.category, area: c.prospect.area,
      outcome: c.outcome, summary: c.summary, error: c.error, transcript: c.transcript as Line[], startedAt: c.startedAt, endedAt: c.endedAt, createdAt: c.createdAt })),
  };
}

// ───────────────────────── the caller on your laptop ─────────────────────────

/** The next approved call the caller may dial now, or why not. */
/** Should JARVIS's calling window be running on the laptop? */
export async function callsWanted(userId: string) {
  const s = await getSettings(userId);
  const link = await db().phoneLink.findUnique({ where: { userId }, select: { mode: true, enabled: true } });
  const toYou = !!link?.enabled && link.mode === "laptop";
  return { on: s.enabled || toYou, leads: s.enabled, toYou };
}

export async function callerNext(userId: string, now = new Date()) {
  const tz = await tzOf(userId);
  const s = await getSettings(userId);
  await closeStale(now, userId);
  // calls to YOU (laptop mode) come first, whatever the lead-calling settings and hours
  const busy = (await db().prospectCall.findFirst({ where: { userId, status: { in: ["dialing", "in_call"] } } })) || (await db().ownerCall.findFirst({ where: { userId, status: { in: ["dialing", "in_call"] } } }));
  if (busy) return { call: null, wait: "A call is already in progress." };
  const own = await ownerNext(userId, now);
  if (own) return { call: own };
  if (!s.enabled) return { call: null, wait: "Calling leads is switched off in the CRM (calls to you still go out)." };
  if (!inCallingWindow(s, now, tz)) return { call: null, wait: `Outside calling hours (${s.hoursFrom}–${s.hoursTo}, ${s.days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(" ")}).` };
  if (await db().prospectCall.findFirst({ where: { userId, status: { in: ["dialing", "in_call"] } } })) return { call: null, wait: "A call is already in progress." };
  const made = await db().prospectCall.count({ where: { userId, startedAt: { gte: dayStart(now, tz) } } });
  if (made >= s.dailyCap) return { call: null, wait: `Today's ${s.dailyCap} calls are done.` };
  for (let guard = 0; guard < 50; guard++) {
    const c = await db().prospectCall.findFirst({ where: { userId, status: "approved" }, orderBy: { approvedAt: "asc" }, include: { prospect: true } });
    if (!c) return { call: null, wait: "No approved calls waiting." };
    const a = (await attemptsOf(userId, [c.prospectId], now, tz)).get(c.prospectId) ?? { attempts: 0, today: false };
    const why = cantCall({ phone: c.prospect.phone, doNotContact: c.prospect.doNotContact, status: c.prospect.status, attempts: a.attempts, calledToday: a.today });
    if (why) { await db().prospectCall.update({ where: { id: c.id }, data: { status: "skipped", error: `Skipped: ${why}.`, endedAt: now } }); continue; }
    // claim it (only one caller wins)
    const claimed = await db().prospectCall.updateMany({ where: { id: c.id, status: "approved" }, data: { status: "dialing", startedAt: now, heartbeatAt: now } });
    if (!claimed.count) continue;
    const opener = openerText(s, c.prospect.businessName, c.prospect.contactPerson);
    return { call: { id: c.id, to: c.toNumber, name: c.prospect.businessName, opener, maxMs: MAX_CALL_MS, maxTurns: MAX_TURNS } };
  }
  return { call: null, wait: "No approved calls waiting." };
}

async function mine(userId: string, id: string) {
  const c = await db().prospectCall.findFirst({ where: { id, userId }, include: { prospect: true } });
  if (!c) throw new CallError("That call isn't there.");
  return c;
}

/** answered · heartbeat */
export async function callerEvent(userId: string, id: string, state: "answered" | "heartbeat", now = new Date()) {
  const c = await mine(userId, id);
  if (!["dialing", "in_call"].includes(c.status)) return { stop: true };
  await db().prospectCall.update({ where: { id }, data: { heartbeatAt: now, ...(state === "answered" && c.status === "dialing" ? { status: "in_call", answeredAt: now } : {}) } });
  return { stop: false };
}

async function defaultAsk(userId: string): Promise<Ask> {
  const brain = await getLiveBrain(userId).catch(() => null);
  const pick = agentConfigs("jarvis", brain);
  if (!pick.configs.length) throw new CallError(pick.missing ?? "No AI provider is configured for calls.");
  return (system, user) => completeWithFallback(pick.configs, system, user, { maxTokens: 260, timeoutMs: 9_000 });
}

function leadFacts(p: { businessName: string; category: string | null; area: string | null; city: string | null; rating: number | null; reviews: number | null; websiteStatus: string; website: string | null; instagram: string | null; signals: string[]; contactPerson: string | null }) {
  return [`Business: ${p.businessName}`, p.category && `Category: ${p.category}`, (p.area || p.city) && `Where: ${[p.area, p.city].filter(Boolean).join(", ")}`,
    p.rating != null && `Google rating: ${p.rating}${p.reviews != null ? ` (${p.reviews} reviews)` : ""}`,
    `Website: ${p.websiteStatus === "none" ? "none" : p.websiteStatus === "social_only" ? `only a social page (${p.website})` : `${p.website} (${p.websiteStatus})`}`,
    p.contactPerson && `Contact person: ${p.contactPerson}`, p.signals.length && `Signals: ${p.signals.join("; ")}`].filter(Boolean).join("\n");
}

/** One exchange: what they said → what JARVIS says next. */
export async function callerTurn(userId: string, id: string, heard: string, opts: { ask?: Ask; now?: Date; opener?: boolean; lang?: Lang | null; interrupted?: boolean } = {}): Promise<Turn> {
  const now = opts.now ?? new Date();
  const c = await mine(userId, id);
  const text = heard.replace(/\s+/g, " ").trim().slice(0, 1000);
  const lang: Lang = opts.lang ?? detectLang(text);
  const L = LINES[lang];
  if (!["dialing", "in_call"].includes(c.status)) return { say: "", end: true, outcome: null, callbackAt: null, notes: null, lang };
  const lines = (c.transcript as Line[]) ?? [];
  // they talked over JARVIS: mark where it was cut off, so the brain knows they didn't hear the rest
  if (opts.interrupted && lines.length && lines[lines.length - 1].who === "jarvis") lines[lines.length - 1] = { ...lines[lines.length - 1], text: `${lines[lines.length - 1].text} [interrupted]` };
  const push = async (t: Turn) => {
    const add: Line[] = [...(text ? [{ who: "them" as const, text, at: now.toISOString() }] : []), ...(t.say ? [{ who: "jarvis" as const, text: t.say, at: now.toISOString() }] : [])];
    const lastOutcome = t.outcome ?? (c.outcome as Outcome | null);
    await db().prospectCall.update({ where: { id }, data: { transcript: [...lines, ...add] as unknown as Prisma.InputJsonValue, heartbeatAt: now, outcome: lastOutcome, ...(t.callbackAt ? { callbackAt: new Date(t.callbackAt) } : {}) } });
    return t;
  };
  if (opts.opener) {
    if (isMachine(text)) return push({ say: "", end: true, outcome: "not_reachable", callbackAt: null, notes: "Operator message / voicemail", lang });
    // the opener is always in English (it carries the AI disclosure); JARVIS follows their language after it
    return push({ say: openerText(await getSettings(userId), c.prospect.businessName, c.prospect.contactPerson), end: false, outcome: null, callbackAt: null, notes: null, lang: "en" });
  }
  if (isMachine(text) && !lines.some((l) => l.who === "them" && !isMachine(l.text))) return push({ say: "", end: true, outcome: "not_reachable", callbackAt: null, notes: "Operator message / voicemail", lang });
  if (saysDoNotCall(text)) return push({ say: L.dnc, end: true, outcome: "do_not_call", callbackAt: null, notes: "Asked not to be called again", lang });
  const theirTurns = lines.filter((l) => l.who === "them").length;
  if (theirTurns + 1 >= MAX_TURNS) return push({ say: L.bye, end: true, outcome: null, callbackAt: null, notes: null, lang });

  const s = await getSettings(userId);
  const tz = await tzOf(userId);
  const manual = manualCallSection((await loadOperator(userId).catch(() => ({ content: "" }))).content);
  const l = localParts(now, tz);
  const system = `You are ${s.callerName}, an AI assistant phoning a local business for ${s.company} (${s.city}) on behalf of ${s.ownerName}. You speak on a live phone call: short, warm, natural spoken sentences (1–2 short sentences per turn — it's a phone call, keep it brisk), no lists, no markdown, no emojis.
Language: answer in the language they last spoke — English, Hindi or Kannada (their last line looks like ${lang === "hi" ? "Hindi" : lang === "kn" ? "Kannada" : "English"}). Write Hindi in Devanagari and Kannada in Kannada script (it is read aloud), keep brand and service names in English, and switch whenever they switch. Set "lang" to "en", "hi" or "kn".
Hard rules (they win over everything else):
- You are an AI assistant. Never claim or imply you're human. If asked, say so honestly and carry on.
- If they say not to call again, apologise, confirm, and end (outcome do_not_call).
- Never ask for or accept payment, card, bank, UPI or OTP details. Never promise discounts or deadlines.
- Prices: only if they ask, only prices written in the playbook; if a price is a [FILL] blank or the scope is unusual, say ${s.ownerName} will share the exact figure. Never invent one.
- Be respectful of their time. If it's a bad time, ask when to call back and end (outcome callback, callbackAt).
- Goal: offer a FREE demo website and book 15 minutes with ${s.ownerName}. If they agree on a time, confirm it and end (outcome demo_booked, callbackAt = that time). Say ${s.ownerName} will confirm on WhatsApp.
- "Not interested" → thank them, end (not_interested). Already have a developer → friendly close (has_vendor). Wrong business → apologise, end (wrong_number).
Local time now: ${l.date} ${l.hhmm} (${tz}).
The user's call playbook (follow its flow and objection answers; the hard rules above still win):
${manual || "(no playbook — use the flow: open, hook about their missing website, ask how customers find them, offer a free demo, book 15 minutes)"}

${opts.interrupted ? 'They interrupted your last line (marked [interrupted]): they did not hear the rest. Answer what they just said; repeat a cut-off point only if it still matters.\n' : ""}Reply with ONLY a JSON object: {"say": "<your next words>", "lang": "en" | "hi" | "kn", "end": <true when the call should end after this line>, "outcome": <null or one of ${OUTCOMES.join(", ")}>, "callbackAt": <null or ISO date-time with offset>, "notes": <null or a short note for the CRM>}`;
  const user = `About this lead:\n${leadFacts(c.prospect)}\n\nCall so far:\n${lines.map((x) => `${x.who === "jarvis" ? "You" : "Them"}: ${x.text}`).join("\n") || "(you just said the opening line)"}\nThem: ${text || "(silence)"}\n\nYour next turn as JSON:`;
  const ask = opts.ask ?? (await defaultAsk(userId));
  let raw = "";
  try { raw = await ask(system, user); } catch (e) { console.error("[calls] brain failed:", (e as Error).message); raw = JSON.stringify({ say: lang === "en" ? `Sorry, I'm having a little trouble on my side. ${s.ownerName} will call you back personally. Thank you!` : L.bye, end: true, outcome: "callback", lang }); }
  return push(parseTurn(raw, text, lang));
}

/** The call is over: summary, outcome, CRM update, transcript kept. */
export async function callerFinish(userId: string, id: string, i: { reason: string; error?: string | null }, opts: { ask?: Ask; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const c = await mine(userId, id);
  if (!["dialing", "in_call"].includes(c.status)) return { status: c.status, outcome: c.outcome };
  const lines = (c.transcript as Line[]) ?? [];
  const talked = !!c.answeredAt && lines.some((l) => l.who === "them" && !isMachine(l.text));
  let outcome = (c.outcome as Outcome | null) ?? null;
  let summary = "", extra: Record<string, unknown> = {};
  if (!talked) {
    if (i.reason === "failed" && !c.answeredAt) {
      await db().prospectCall.update({ where: { id }, data: { status: "failed", error: (i.error || "The call couldn't be placed.").slice(0, 400), endedAt: now } });
      await event(userId, c.prospectId, "call", `Call failed: ${i.error || "couldn't be placed"}.`);
      return { status: "failed", outcome: null };
    }
    outcome = "not_reachable"; summary = lines.length ? "Reached an operator message / voicemail." : "No answer.";
  } else {
    try {
      const ask = opts.ask ?? (await defaultAsk(userId));
      const raw = await ask(
        "You summarise a sales call for a CRM. Reply with ONLY JSON: {\"summary\": \"3 short lines\", \"outcome\": one of " + OUTCOMES.join("|") + ", \"interestedServices\": [..], \"budgetHint\": null|string, \"decisionMaker\": null|string, \"contactPerson\": null|string, \"whatsapp\": null|string, \"callbackAt\": null|ISO}. Use only what was said; never guess.",
        lines.map((x) => `${x.who === "jarvis" ? "JARVIS" : "Them"}: ${x.text}`).join("\n"));
      const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
      summary = String(j.summary ?? "").slice(0, 1200);
      if (!outcome && (OUTCOMES as readonly string[]).includes(j.outcome)) outcome = j.outcome;
      extra = j;
    } catch (e) { console.error("[calls] summary failed:", (e as Error).message); }
    outcome ??= "called";
    if (!summary) summary = lines.filter((l) => l.who === "them").map((l) => l.text).join(" ").slice(0, 400);
  }
  const callbackAt = c.callbackAt ?? (typeof extra.callbackAt === "string" && !Number.isNaN(Date.parse(extra.callbackAt)) ? new Date(extra.callbackAt) : null);
  await db().prospectCall.update({ where: { id }, data: { status: talked ? "completed" : "no_answer", outcome, summary, endedAt: now, callbackAt } });

  // the CRM, by JARVIS (manual 6.5)
  const p = crmPatchFor(outcome, { callbackAt, now });
  try {
    if (talked && c.prospect.status === "new" && p.status !== "called") await updateProspect(userId, c.prospectId, { status: "called", contacted: true }, "jarvis", now);
    await updateProspect(userId, c.prospectId, {
      status: p.status as never, ...(p.lostReason ? { lostReason: p.lostReason } : {}), ...(p.nextAction ? { nextAction: p.nextAction, nextActionAt: p.nextActionAt } : {}),
      contacted: true, note: `Call (${talked ? "spoke" : "no answer"}): ${summary}`,
      ...(Array.isArray(extra.interestedServices) && extra.interestedServices.length ? { interestedServices: (extra.interestedServices as unknown[]).map(String).slice(0, 10) } : {}),
      ...(typeof extra.budgetHint === "string" && extra.budgetHint ? { budgetRange: extra.budgetHint.slice(0, 80) } : {}),
      ...(typeof extra.decisionMaker === "string" && extra.decisionMaker ? { decisionMaker: extra.decisionMaker.slice(0, 120) } : {}),
      ...(typeof extra.contactPerson === "string" && extra.contactPerson ? { contactPerson: extra.contactPerson.slice(0, 120) } : {}),
      ...(typeof extra.whatsapp === "string" && extra.whatsapp ? { whatsapp: extra.whatsapp.slice(0, 30) } : {}),
    }, "jarvis", now);
  } catch (e) { if (!(e instanceof CrmError)) throw e; console.error("[calls] CRM update:", e.message); }
  if (p.doNotContact) {
    await db().prospect.update({ where: { id: c.prospectId }, data: { doNotContact: true } });
    await event(userId, c.prospectId, "status", "Asked not to be called again — marked Do not contact (forever).");
  }
  return { status: talked ? "completed" : "no_answer", outcome, summary };
}

async function closeStale(now: Date, userId?: string) {
  const stale = await db().prospectCall.findMany({ where: { ...(userId ? { userId } : {}), status: { in: ["dialing", "in_call"] }, heartbeatAt: { lt: new Date(now.getTime() - STALE_MS) } } });
  for (const c of stale) await db().prospectCall.update({ where: { id: c.id }, data: { status: "failed", endedAt: now, error: "The caller on the laptop stopped answering in the middle of this call." } });
  return stale.length;
}
export const callsTick = async (now = new Date()) => (await closeStale(now)) + (await ownerTick(now));
