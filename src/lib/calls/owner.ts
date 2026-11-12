import "server-only";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { getLiveBrain } from "@/lib/ai/brain";
import { agentConfigs } from "@/lib/ai/agent";
import { completeWithFallback } from "@/lib/ai/complete";
import { claimBatch, MAX_ATTEMPTS } from "@/lib/phone/service";
import { listCenter, decide, type ItemKind } from "@/lib/approvals/center";
import { JOB_AGENT_NAME, type JobAgent } from "@/lib/jobs/brief";
import { dialable, isMachine, LINES, detectLang, LANGS, type Lang } from "./rules";

/**
 * JARVIS calling YOU (Settings → Phone calls → "Through the laptop"): the same
 * Phone Link caller that phones leads rings your number when work is done,
 * fails or needs your OK — and talks with you. It tells you what happened,
 * answers questions from what it really knows, and approves or rejects
 * waiting work only when you clearly say so on the call.
 */
const db = () => getDb();
type Line = { who: "jarvis" | "them"; text: string; at: string };
type Ask = (system: string, user: string) => Promise<string>;
export const OWNER_PREFIX = "own_";
export const isOwnerCall = (id: string) => id.startsWith(OWNER_PREFIX);
const STALE_MS = 10 * 60_000;
const agentName = (a: string) => JOB_AGENT_NAME[a as JobAgent] ?? a.toUpperCase();

/** "Done - ASTON: Build the café site" → "ASTON finished: Build the café site". Pure (tested). */
export function spokenUpdate(e: { kind: string; text: string }): string {
  const m = e.text.match(/^(?:Done|Failed|Needs your approval) - ([^:]+): (.*)$/);
  if (e.kind === "test") return "This is a test call — I can reach you through the laptop.";
  if (!m) return e.text;
  const [, who, what] = m;
  return e.kind === "completed" ? `${who} finished: ${what}.` : e.kind === "failed" ? `${who} couldn't finish: ${what}.` : `${who} needs your approval: ${what}.`;
}

/** The first thing JARVIS says when you pick up. Pure (tested). */
export function ownerOpener(events: { kind: string; text: string }[]): string {
  const items = events.slice(0, 5).map(spokenUpdate);
  const more = events.length > 5 ? ` And ${events.length - 5} more.` : "";
  const head = events.length === 1 ? "Hi, it's JARVIS with an update." : `Hi, it's JARVIS with ${events.length} updates.`;
  const ask = events.some((e) => e.kind === "approval") ? " Do you want me to approve it, or hold off?" : events.every((e) => e.kind === "test") ? "" : " Anything you'd like me to do?";
  return `${head} ${items.join(" ")}${more}${ask}`.replace(/\s+/g, " ").trim();
}

const YES = /\b(yes|yeah|yep|yup|sure|ok(ay)?|go ahead|approve(d)?|do it|please do|haan|han|ji haan|theek hai|sari|houdu)\b|हाँ|हां|ठीक है|मंज़ूर|ಹೌದು|ಸರಿ|ಮಾಡಿ/i;
const NO = /\b(no|nope|reject|cancel|don'?t|do not|hold off|stop|nahi|mat|beda|illa)\b|नहीं|मत|रद्द|ಬೇಡ|ಇಲ್ಲ/i;
/** Did their last words clearly say yes (approve) / no (reject)? Pure (tested). */
export const saidYes = (heard: string) => YES.test(heard) && !NO.test(heard);
export const saidNo = (heard: string) => NO.test(heard);

/** The next call to you, when you use laptop mode and something is due. Claims the batch so it's never called twice. */
export async function ownerNext(userId: string, now = new Date()) {
  const link = await db().phoneLink.findUnique({ where: { userId } });
  if (!link || link.mode !== "laptop" || !link.enabled || !link.toNumber) return null;
  const b = await claimBatch(link, now);
  if (!b) return null;
  const to = dialable(link.toNumber);
  if (!to) {
    await db().phoneEvent.updateMany({ where: { batchId: b.batchId }, data: { status: "failed", error: "Your number in Settings → Phone calls isn't dialable." } });
    return null;
  }
  const id = `${OWNER_PREFIX}${b.batchId}`;
  await db().ownerCall.create({ data: { id, userId, batchId: b.batchId, toNumber: to, heartbeatAt: now } });
  return { id, to, name: "you (updates)", opener: ownerOpener(b.events), maxMs: 6 * 60_000, maxTurns: 20 };
}

async function mine(userId: string, id: string) {
  const c = await db().ownerCall.findFirst({ where: { id, userId } });
  if (!c) throw new Error("That call isn't there.");
  return c;
}

export async function ownerEvent(userId: string, id: string, state: "answered" | "heartbeat", now = new Date()) {
  const c = await mine(userId, id);
  if (!["dialing", "in_call"].includes(c.status)) return { stop: true };
  await db().ownerCall.update({ where: { id }, data: { heartbeatAt: now, ...(state === "answered" && c.status === "dialing" ? { status: "in_call", answeredAt: now } : {}) } });
  return { stop: false };
}

async function defaultAsk(userId: string): Promise<Ask> {
  const brain = await getLiveBrain(userId).catch(() => null);
  const pick = agentConfigs("jarvis", brain);
  if (!pick.configs.length) throw new Error(pick.missing ?? "No AI provider is configured.");
  return (system, user) => completeWithFallback(pick.configs, system, user, { maxTokens: 300, timeoutMs: 9_000 });
}

/** One exchange on a call to you. */
export async function ownerTurn(userId: string, id: string, heard: string, opts: { ask?: Ask; now?: Date; opener?: boolean; lang?: Lang | null; interrupted?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const c = await mine(userId, id);
  const text = heard.replace(/\s+/g, " ").trim().slice(0, 1000);
  const lang: Lang = opts.lang ?? detectLang(text);
  if (!["dialing", "in_call"].includes(c.status)) return { say: "", end: true, lang };
  const lines = (c.transcript as Line[]) ?? [];
  if (opts.interrupted && lines.length && lines[lines.length - 1].who === "jarvis") lines[lines.length - 1] = { ...lines[lines.length - 1], text: `${lines[lines.length - 1].text} [interrupted]` };
  const actions = (c.actions as unknown as Record<string, unknown>[]) ?? [];
  const push = async (say: string, end: boolean, l: Lang, act?: Record<string, unknown>) => {
    const add: Line[] = [...(text ? [{ who: "them" as const, text, at: now.toISOString() }] : []), ...(say ? [{ who: "jarvis" as const, text: say, at: now.toISOString() }] : [])];
    await db().ownerCall.update({ where: { id }, data: { transcript: [...lines, ...add] as unknown as Prisma.InputJsonValue, heartbeatAt: now, ...(act ? { actions: [...actions, act] as unknown as Prisma.InputJsonValue } : {}) } });
    return { say, end, lang: l };
  };
  const events = await db().phoneEvent.findMany({ where: { batchId: c.batchId }, orderBy: { createdAt: "asc" } });
  if (opts.opener) {
    if (isMachine(text)) return push("", true, lang); // your voicemail: the WhatsApp/approval list still has it
    return push(ownerOpener(events), false, "en");
  }

  // what JARVIS can talk about: these updates, what waits for you, what's running
  const center = await listCenter(userId).catch(() => ({ approvals: [] as { kind: ItemKind; id: string; agent: string; title: string; proposes: string }[] }));
  const pending = center.approvals.filter((a) => ["job", "proposal", "ev_daily", "darwin_message"].includes(a.kind)).slice(0, 8);
  const running = await db().agentJob.findMany({ where: { userId, status: { in: ["assigned", "running", "waiting_approval"] } }, orderBy: { createdAt: "desc" }, take: 8, select: { agent: true, title: true, status: true } });
  const system = `You are JARVIS, the user's own AI assistant, on a phone call WITH THE USER (your boss) to give them updates. Speak like a sharp, friendly assistant: 1–2 short spoken sentences per turn, no lists, no markdown.
Answer in the language they speak (English, Hindi in Devanagari, Kannada in Kannada script) and set "lang".
Use ONLY the facts below — never invent progress, prices or results. If they ask something you don't know, say so and offer to put it in the Activity Center.
You may approve or reject an item from "Waiting for approval" ONLY if their LAST words clearly ask you to (e.g. "yes, approve it", "reject number 2"). If it's unclear which item or what they want, ask them to confirm instead. Never approve anything else.
When they're done ("that's all", "bye", "okay thanks"), say a short goodbye and end.
Updates on this call:
${events.map((e) => `- ${spokenUpdate(e)}`).join("\n") || "- (none)"}
Waiting for approval (number: what):
${pending.map((a, i) => `${i + 1}: ${agentName(a.agent)} — ${a.title} (${a.proposes})`).join("\n") || "(nothing)"}
Agents' current tasks:
${running.map((j) => `- ${agentName(j.agent)}: ${j.title} (${j.status.replace(/_/g, " ")})`).join("\n") || "(none running)"}
${opts.interrupted ? "They interrupted your last line ([interrupted]).\n" : ""}Reply with ONLY JSON: {"say": "...", "end": true|false, "lang": "en"|"hi"|"kn", "action": null | {"type": "approve"|"reject", "item": <number from the list>}}`;
  const user = `Call so far:\n${lines.map((x) => `${x.who === "jarvis" ? "You" : "Boss"}: ${x.text}`).join("\n")}\nBoss: ${text || "(silence)"}\n\nYour next turn as JSON:`;
  let j: Record<string, unknown> = {};
  try { const raw = await (opts.ask ?? (await defaultAsk(userId)))(system, user); j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); }
  catch (e) { console.error("[owner-call] brain:", (e as Error).message); j = { say: "Sorry, I'm having trouble on my side — everything's in the Activity Center. Talk soon!", end: true }; }
  const l: Lang = (LANGS as readonly string[]).includes(String(j.lang)) ? (j.lang as Lang) : lang;
  let say = String(j.say ?? "").replace(/\s+/g, " ").trim().slice(0, 420) || LINES[l].again;
  const end = j.end === true;

  // approve / reject — only on a clear yes / no in their own last words
  const a = j.action as { type?: string; item?: number } | null | undefined;
  if (a && (a.type === "approve" || a.type === "reject")) {
    const item = pending[Number(a.item) - 1];
    const clear = a.type === "approve" ? saidYes(text) : saidNo(text);
    if (!item) say = "Sorry, which one did you mean?";
    else if (!clear) say = `Just to be sure — shall I ${a.type} ${agentName(item.agent)}'s "${item.title}"?`;
    else {
      const r = await decide(userId, { kind: item.kind, id: item.id, decision: a.type, note: `${a.type === "approve" ? "Approved" : "Rejected"} on a phone call with JARVIS` }).catch((e) => ({ ok: false, error: (e as Error).message }));
      const ok = !!(r as { ok?: boolean }).ok;
      const act = { type: a.type, kind: item.kind, id: item.id, title: item.title, ok, detail: ok ? null : (r as { error?: string }).error ?? "failed", at: now.toISOString() };
      say = ok ? `${say} Done — ${a.type === "approve" ? "approved" : "rejected"}.`.trim() : `I couldn't ${a.type} it: ${(r as { error?: string }).error ?? "something went wrong"}. It's still in the Activity Center.`;
      return push(say, end, l, act);
    }
  }
  return push(say, end, l);
}

/** The call to you is over: the updates count as delivered if you picked up, else they wait for the next try. */
export async function ownerFinish(userId: string, id: string, i: { reason: string; error?: string | null }, now = new Date()) {
  const c = await mine(userId, id);
  if (!["dialing", "in_call"].includes(c.status)) return { status: c.status };
  const spoke = !!c.answeredAt;
  const status = spoke ? "completed" : i.reason === "failed" ? "failed" : "no_answer";
  await db().ownerCall.update({ where: { id }, data: { status, endedAt: now, error: i.error?.slice(0, 400) ?? null } });
  if (spoke) await db().phoneEvent.updateMany({ where: { batchId: c.batchId, status: "sending" }, data: { status: "sent", error: null, sentAt: now } });
  else await requeue(c.batchId, i.error || (status === "failed" ? "The laptop couldn't place the call." : "You didn't pick up."));
  return { status };
}

async function requeue(batchId: string, why: string) {
  // one more try later (the 2-minute gap applies), then give up
  await db().phoneEvent.updateMany({ where: { batchId, status: "sending", attempts: { gte: MAX_ATTEMPTS } }, data: { status: "failed", error: why.slice(0, 300) } });
  await db().phoneEvent.updateMany({ where: { batchId, status: "sending" }, data: { status: "queued", batchId: null, error: why.slice(0, 300) } });
}

/** Calls to you whose caller went quiet mid-call (laptop asleep, window closed). */
export async function ownerTick(now = new Date()) {
  const stale = await db().ownerCall.findMany({ where: { status: { in: ["dialing", "in_call"] }, heartbeatAt: { lt: new Date(now.getTime() - STALE_MS) } } });
  for (const c of stale) {
    await db().ownerCall.update({ where: { id: c.id }, data: { status: "failed", endedAt: now, error: "The caller on the laptop stopped answering." } });
    await requeue(c.batchId, "The caller on the laptop stopped answering.");
  }
  return stale.length;
}

export async function recentOwnerCalls(userId: string) {
  return db().ownerCall.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, transcript: true, actions: true, error: true, createdAt: true, endedAt: true } });
}
