import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { getLiveBrain } from "@/lib/ai/brain";
import { agentConfigs } from "@/lib/ai/agent";
import { completeWithFallback } from "@/lib/ai/complete";
import { recordActivity } from "@/lib/activity/record";
import { dialable, isMachine, LINES, detectLang, LANGS, type Lang } from "./rules";

/**
 * "Call Mom and tell her I'll be late": JARVIS phones someone you know (from
 * your contacts) through the laptop, says it's your AI assistant, passes on
 * your message, talks with them, never promises anything you didn't say —
 * questions it can't answer go back to you — and then tells you what they said.
 * Only ever when you ask for that call yourself.
 */
const db = () => getDb();
type Line = { who: "jarvis" | "them"; text: string; at: string };
type Ask = (system: string, user: string) => Promise<string>;
export const PERSONAL_PREFIX = "per_";
export const isPersonalCall = (id: string) => id.startsWith(PERSONAL_PREFIX);
export class PersonalCallError extends Error {}
const STALE_MS = 10 * 60_000;
const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Words people use for family ("mom" finds a contact called "Amma" with relation "mother"). Pure (tested). */
const KIN: Record<string, string[]> = {
  mother: ["mom", "mum", "mummy", "mommy", "ma", "amma", "maa", "mother", "aai", "mata"],
  father: ["dad", "daddy", "papa", "appa", "pappa", "father", "baba", "pitaji"],
  brother: ["bro", "brother", "anna", "bhaiya", "bhai", "tamma"],
  sister: ["sis", "sister", "akka", "didi", "tangi", "behen"],
  wife: ["wife", "hendathi", "biwi"], husband: ["husband", "ganda", "pati"],
  grandmother: ["grandma", "granny", "ajji", "nani", "dadi", "avva"], grandfather: ["grandpa", "ajja", "nana", "dada", "thatha"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
export function kinOf(word: string): string | null {
  const w = norm(word);
  for (const [rel, words] of Object.entries(KIN)) if (rel === w || words.includes(w)) return rel;
  return null;
}
/** Find who "mom" / "Ravi" / "my brother" means among your contacts. Pure (tested). */
export function matchContact<T extends { name: string; aliases: string[]; relation: string | null }>(who: string, contacts: T[]): T | null {
  const w = norm(who).replace(/^(my|our) /, "");
  if (!w) return null;
  const exact = contacts.find((c) => norm(c.name) === w || c.aliases.some((a) => norm(a) === w));
  if (exact) return exact;
  const rel = kinOf(w);
  if (rel) {
    const byRel = contacts.find((c) => (c.relation && kinOf(c.relation) === rel) || kinOf(c.name) === rel || c.aliases.some((a) => kinOf(a) === rel));
    if (byRel) return byRel;
  }
  const starts = contacts.filter((c) => norm(c.name).split(" ")[0] === w.split(" ")[0]);
  return starts.length === 1 ? starts[0] : null;
}

/** What JARVIS says first. Pure (tested). */
export function personalOpener(name: string, owner: string, message: string): string {
  const greet = kinOf(name) ? "Hi" : `Hi ${name.split(" ")[0]}`;
  const m = clip(message, 300).replace(/[.!\s]+$/, "");
  return `${greet}, this is JARVIS, ${owner}'s AI assistant. ${owner} asked me to let you know: ${m}.`;
}

// ---------- contacts ----------
export async function listContacts(userId: string) {
  return db().contact.findMany({ where: { userId }, orderBy: { name: "asc" } });
}
export async function saveContact(userId: string, i: { name: string; phone: string; relation?: string | null; aliases?: string[] }) {
  const name = clip(i.name, 60);
  const phone = dialable(i.phone);
  if (!name) throw new PersonalCallError("Whose number is it?");
  if (!phone) throw new PersonalCallError(`"${i.phone}" isn't a phone number I can dial.`);
  const relation = i.relation ? clip(i.relation, 40) : kinOf(name);
  const aliases = [...new Set((i.aliases ?? []).map((a) => clip(a, 40)).filter(Boolean))].slice(0, 8);
  return db().contact.upsert({
    where: { userId_name: { userId, name } },
    create: { userId, name, phone, relation, aliases },
    update: { phone, ...(relation ? { relation } : {}), ...(aliases.length ? { aliases } : {}) },
  });
}
export async function deleteContact(userId: string, id: string) {
  await db().contact.deleteMany({ where: { id, userId } });
}

// ---------- calls ----------
/** You asked: queue the call (it goes out from the laptop within ~20 s). */
export async function queuePersonalCall(userId: string, i: { who: string; message: string; phone?: string | null }) {
  const message = clip(i.message, 400);
  if (!message) throw new PersonalCallError("What should I tell them?");
  const contacts = await listContacts(userId);
  let c = matchContact(i.who, contacts);
  if (!c && i.phone) c = await saveContact(userId, { name: i.who, phone: i.phone });
  if (!c) throw new PersonalCallError(`I don't have ${i.who}'s number yet — tell me it (for example "${i.who}'s number is 98xxxxxxxx") and I'll save it.`);
  const to = dialable(c.phone);
  if (!to) throw new PersonalCallError(`${c.name}'s saved number isn't dialable — update it.`);
  const link = await db().phoneLink.findUnique({ where: { userId }, select: { mode: true, enabled: true } });
  if (!link || link.mode !== "laptop" || !link.enabled) throw new PersonalCallError("Calling from the laptop isn't set up — Settings → Phone calls → Through the laptop, and switch Phone calls on.");
  const open = await db().personalCall.count({ where: { userId, status: { in: ["queued", "dialing", "in_call"] } } });
  if (open >= 3) throw new PersonalCallError("3 calls are already waiting — let those finish first.");
  const call = await db().personalCall.create({ data: { id: `${PERSONAL_PREFIX}${randomBytes(9).toString("hex")}`, userId, contactId: c.id, name: c.name, toNumber: to, message } });
  return { call, contact: c };
}

/** The laptop's caller asks for work: your personal calls go right after calls to you. */
export async function personalNext(userId: string, now = new Date()) {
  await db().personalCall.updateMany({ where: { userId, status: { in: ["dialing", "in_call"] }, heartbeatAt: { lt: new Date(now.getTime() - STALE_MS) } }, data: { status: "failed", error: "The laptop stopped answering during this call.", endedAt: now } });
  const c = await db().personalCall.findFirst({ where: { userId, status: "queued" }, orderBy: { createdAt: "asc" } });
  if (!c) return null;
  const claimed = await db().personalCall.updateMany({ where: { id: c.id, status: "queued" }, data: { status: "dialing", startedAt: now, heartbeatAt: now } });
  if (!claimed.count) return null;
  return { id: c.id, to: c.toNumber, name: c.name, opener: "", maxMs: 5 * 60_000, maxTurns: 16 };
}

async function mine(userId: string, id: string) {
  const c = await db().personalCall.findFirst({ where: { id, userId } });
  if (!c) throw new PersonalCallError("That call isn't there.");
  return c;
}

export async function personalEvent(userId: string, id: string, state: "answered" | "heartbeat", now = new Date()) {
  const c = await mine(userId, id);
  if (!["dialing", "in_call"].includes(c.status)) return { stop: true };
  await db().personalCall.update({ where: { id }, data: { heartbeatAt: now, ...(state === "answered" && c.status === "dialing" ? { status: "in_call", answeredAt: now } : {}) } });
  return { stop: false };
}

async function ownerNameOf(userId: string) {
  const s = await db().callSettings.findUnique({ where: { userId }, select: { ownerName: true } });
  const p = await db().profile.findUnique({ where: { userId }, select: { displayName: true } }).catch(() => null);
  const full = p?.displayName || s?.ownerName || "my boss";
  return full.split(" ")[0];
}

async function defaultAsk(userId: string): Promise<Ask> {
  const brain = await getLiveBrain(userId).catch(() => null);
  const pick = agentConfigs("jarvis", brain);
  if (!pick.configs.length) throw new Error(pick.missing ?? "No AI provider is configured.");
  return (system, user) => completeWithFallback(pick.configs, system, user, { maxTokens: 300, timeoutMs: 9_000 });
}

/** One exchange on the call. */
export async function personalTurn(userId: string, id: string, heard: string, opts: { ask?: Ask; now?: Date; opener?: boolean; lang?: Lang | null; interrupted?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const c = await mine(userId, id);
  const text = clip(heard, 1000);
  const lang: Lang = opts.lang ?? detectLang(text);
  if (!["dialing", "in_call"].includes(c.status)) return { say: "", end: true, lang };
  const lines = (c.transcript as Line[]) ?? [];
  if (opts.interrupted && lines.length && lines[lines.length - 1].who === "jarvis") lines[lines.length - 1] = { ...lines[lines.length - 1], text: `${lines[lines.length - 1].text} [interrupted]` };
  const push = async (say: string, end: boolean, l: Lang) => {
    const add: Line[] = [...(text ? [{ who: "them" as const, text, at: now.toISOString() }] : []), ...(say ? [{ who: "jarvis" as const, text: say, at: now.toISOString() }] : [])];
    await db().personalCall.update({ where: { id }, data: { transcript: [...lines, ...add] as unknown as Prisma.InputJsonValue, heartbeatAt: now } });
    return { say, end, lang: l };
  };
  const owner = await ownerNameOf(userId);
  if (opts.opener) {
    if (text && isMachine(text)) return push("", true, lang); // voicemail: tell you instead
    return push(personalOpener(c.name, owner, c.message), false, "en");
  }
  const system = `You are JARVIS, ${owner}'s AI assistant, on a phone call with ${c.name}${kinOf(c.name) ? ` (${owner}'s ${kinOf(c.name)})` : ""}. ${owner} asked you to call and pass on this message: "${c.message}".
You already said who you are and gave the message. Now talk with them warmly and briefly, like a polite, caring assistant — 1–2 short spoken sentences per turn, no lists.
Answer in the language they speak (English, Hindi in Devanagari, Kannada in Kannada script) and set "lang".
You only know the message above. NEVER invent details, times, reasons or promises ${owner} didn't give. If they ask something you don't know ("what time?", "why?", "has he eaten?"), say kindly you'll ask ${owner} and pass it on — and remember it.
If they give a message for ${owner} ("tell him to bring milk"), confirm you'll pass it on.
You are an AI assistant — never claim to be ${owner} or a human. If asked, say so plainly.
When they're done ("okay", "bye", "theek hai", "sari"), say a short warm goodbye and end.
${opts.interrupted ? "They interrupted your last line ([interrupted]).\n" : ""}Reply with ONLY JSON: {"say": "...", "end": true|false, "lang": "en"|"hi"|"kn"}`;
  const user = `Call so far:\n${lines.map((x) => `${x.who === "jarvis" ? "You" : c.name}: ${x.text}`).join("\n")}\n${c.name}: ${text || "(silence)"}\n\nYour next turn as JSON:`;
  let j: Record<string, unknown> = {};
  try { const raw = await (opts.ask ?? (await defaultAsk(userId)))(system, user); j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); }
  catch (e) { console.error("[personal-call] brain:", (e as Error).message); j = { say: `Sorry, I'm having trouble on my side — I'll tell ${owner} to call you. Bye!`, end: true }; }
  const l: Lang = (LANGS as readonly string[]).includes(String(j.lang)) ? (j.lang as Lang) : lang;
  const say = clip(String(j.say ?? ""), 420) || LINES[l].again;
  return push(say, j.end === true, l);
}

/** The call is over: write what they said for you, and tell you. */
export async function personalFinish(userId: string, id: string, i: { reason: string; error?: string | null }, o: { ask?: Ask; now?: Date } = {}) {
  const now = o.now ?? new Date();
  const c = await mine(userId, id);
  if (!["dialing", "in_call"].includes(c.status)) return { status: c.status };
  const spoke = !!c.answeredAt;
  const status = spoke ? "completed" : i.reason === "failed" ? "failed" : "no_answer";
  const lines = (c.transcript as Line[]) ?? [];
  let summary: string;
  if (!spoke) summary = status === "failed" ? `I couldn't call ${c.name}: ${i.error ?? "the call didn't go through"}.` : `${c.name} didn't pick up — your message wasn't delivered.`;
  else if (!lines.some((l) => l.who === "them")) summary = `I told ${c.name}: "${c.message}". They didn't say anything back.`;
  else {
    summary = `I told ${c.name}: "${c.message}".`;
    try {
      const ask = o.ask ?? (await defaultAsk(userId));
      const raw = await ask(`You report back to the user, in 1–3 short plain sentences in English, what ${c.name} said on a call where you (JARVIS) passed on their message. Include any question they asked or anything they asked you to pass on. Only what is in the transcript.`,
        `Transcript:\n${lines.map((x) => `${x.who === "jarvis" ? "JARVIS" : c.name}: ${x.text}`).join("\n")}`);
      const s = clip(raw.replace(/^["']|["']$/g, ""), 500);
      if (s) summary = s;
    } catch { /* keep the plain line */ }
  }
  await db().personalCall.update({ where: { id }, data: { status, endedAt: now, summary, error: i.error?.slice(0, 1500) ?? null } });
  await recordActivity(userId, { category: "communication", agent: "JARVIS", action: `Called ${c.name}`, result: summary, status: status === "completed" ? "success" : "failed", importance: 4, source: "personal-call", metadata: { callId: id } });
  return { status, summary };
}

export async function recentPersonalCalls(userId: string, take = 8) {
  return db().personalCall.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take, select: { id: true, name: true, message: true, status: true, summary: true, createdAt: true, endedAt: true, transcript: true } });
}
