import "server-only";
import type { RobinLead } from "@prisma/client";
import { getDb } from "@/lib/db";
import { parseRobinCommand, parseWhen, type LeadFilter } from "./command";
import { CONFIRM_STAGES, STAGE_LABEL, isStage, nodeOf, type Stage } from "./types";
import { RobinError, findLeadsByName, moveStage, userTz, dayBounds } from "./crm";
import { scheduleFollowUp, followUpQueue, completeFollowUp, addFollowUpNote, fmtWhen } from "./engage";
import { robinBriefing } from "./briefing";
import { attention } from "./qualify";
import type { IslandCard, IslandFollowUp, IslandLead, IslandLeadDetail, IslandPending, IslandReply } from "./island-types";

/**
 * RUBEN's desktop island: one spoken/typed command → one real CRM action →
 * one short answer and only the card that answers it. Every list comes from
 * the database; every change goes through the CRM's own functions (stage
 * history, audit log); decisions (won / lost / do-not-contact) wait for your
 * "yes". Anything that isn't a CRM command goes to RUBIN's own AI brain.
 */

export interface IslandDeps {
  /** RUBIN's AI brain for everything else (pitches, questions) — text only. */
  ask: (userId: string, text: string, leadContext: string | null) => Promise<{ text: string; error?: string }>;
  now: () => Date;
}

export async function defaultAsk(userId: string, text: string, leadContext: string | null): Promise<{ text: string; error?: string }> {
  const { runAgent } = await import("@/lib/ai/agent");
  const profile = await getDb().profile.findUnique({ where: { userId } });
  let out = "", error: string | undefined;
  for await (const ev of runAgent({
    userId, timezone: profile?.timezone ?? "UTC", assistantName: "RUBIN", displayName: profile?.displayName ?? null,
    history: [], message: leadContext ? `${text}\n\n(The lead open in the pop-up: ${leadContext})` : text, agent: "robin",
  })) {
    if (ev.type === "done") out = ev.text;
    if (ev.type === "error") error = ev.message;
  }
  return { text: out.trim(), error };
}

const MAX_ROWS = 12;
export const toLead = (l: RobinLead, tz: string): IslandLead => ({
  id: l.id, number: l.number, name: l.businessName, category: l.category, city: l.city, stage: l.stage,
  stageLabel: isStage(l.stage) ? labelOf(l.stage) : l.stage, phone: l.phone,
  lastContact: l.lastContactAt ? fmtWhen(l.lastContactAt, tz) : null, nextFollowUp: l.nextFollowUpAt ? fmtWhen(l.nextFollowUpAt, tz) : null,
});

async function detail(userId: string, l: RobinLead, tz: string): Promise<IslandLeadDetail> {
  const db = getDb();
  const [acts, fus] = await Promise.all([
    db.robinInteraction.findMany({ where: { userId, leadId: l.id }, orderBy: { occurredAt: "desc" }, take: 3 }),
    db.robinFollowUp.findMany({ where: { userId, leadId: l.id, status: "pending" }, orderBy: { dueAt: "asc" }, take: 2 }),
  ]);
  return {
    ...toLead(l, tz), email: l.email, whatsapp: l.whatsapp, instagram: l.instagram, website: l.website, address: l.address,
    priority: l.priorityOverride ?? l.priority, score: l.score, notes: l.notes,
    recent: acts.map((a) => ({ when: fmtWhen(a.occurredAt, tz), text: `${a.channel}${a.outcome ? ` · ${a.outcome.replace(/_/g, " ")}` : ""}${a.notes ? ` — ${a.notes.slice(0, 120)}` : ""}` })),
    followUps: fus.map((f) => ({ id: f.id, when: fmtWhen(f.dueAt, tz), action: f.action })),
  };
}

/** Leads for a list command, most important first (from the database). */
async function leadsWhere(userId: string, tz: string, pick: { stages?: string[]; filter?: LeadFilter }): Promise<IslandLead[]> {
  const db = getDb();
  const now = new Date();
  let rows = await db.robinLead.findMany({ where: { userId, ...(pick.stages ? { stage: { in: pick.stages } } : {}) }, take: 500 });
  const f = pick.filter;
  if (f === "hottest") rows = rows.filter((l) => !["won", "lost", "not_interested", "do_not_contact"].includes(l.stage));
  else if (f === "uncontacted") rows = rows.filter((l) => !l.lastContactAt && ["new", "qualified"].includes(l.stage));
  else if (f === "high_priority") rows = rows.filter((l) => (l.priorityOverride ?? l.priority) === "high" && !["won", "lost", "not_interested", "do_not_contact"].includes(l.stage));
  else if (f) rows = rows.filter((l) => nodeOf(l.stage) === f);
  rows.sort((a, b) => attention(b, now) - attention(a, now));
  return rows.slice(0, MAX_ROWS).map((l) => toLead(l, tz));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listReply = (title: string, leads: IslandLead[], none: string): IslandReply => ({
  say: leads.length ? `${plural(leads.length, "lead")}${leads.length === MAX_ROWS ? " (the top ones)" : ""}.` : none,
  card: leads.length ? { type: "leads", title, leads } : { type: "text", text: none }, open: true,
});

/** Find the lead a command means: by name/number, else the one open in the pop-up. */
async function whichLead(userId: string, name: string | null, selected: string | null): Promise<RobinLead | IslandReply> {
  const db = getDb();
  if (!name) {
    const l = selected ? await db.robinLead.findFirst({ where: { id: selected, userId } }) : null;
    return l ?? { say: "Which lead? Say its name or number.", card: { type: "error", text: "No lead is open — say its name or number." }, open: true };
  }
  const hits = await findLeadsByName(userId, name);
  if (hits.length === 1) return hits[0];
  const tz = await userTz(userId);
  if (!hits.length) return { say: `I couldn't find ${name} in your CRM.`, card: { type: "error", text: `No lead matches "${name}".` }, open: true };
  return { say: `I found ${hits.length} matches — which one?`, card: { type: "leads", title: `Which "${name}"?`, leads: hits.map((h) => toLead(h, tz)) }, open: true };
}
const isReply = (x: unknown): x is IslandReply => !!x && typeof x === "object" && "say" in x;

/** Run one island command. `leadId` = the lead open in the pop-up; `pending` = a decision awaiting yes/no. */
export async function runIslandCommand(userId: string, input: { text: string; leadId?: string | null; pending?: IslandPending | null }, deps: Partial<IslandDeps> = {}): Promise<IslandReply> {
  const ask = deps.ask ?? defaultAsk;
  const now = (deps.now ?? (() => new Date()))();
  const db = getDb();
  const tz = await userTz(userId);
  const text = input.text.trim();
  const low = text.toLowerCase().replace(/[.!?]+$/, "").replace(/^(?:hey |ok |okay )?(?:rubin|ruben|reuben|robin)[,\s]+/, "").trim();
  const selected = input.leadId ?? null;

  // ---- the interface itself
  if (/^(?:open|show|launch|start|bring up)\s+(?:the\s+|my\s+)?crm$/.test(low)) return { say: "CRM open. What do you need?", card: null, open: true };
  if (/^(?:close|hide|dismiss|minimi[sz]e|exit)(?:\s+(?:the\s+)?crm)?$/.test(low) || /^that'?s all$/.test(low)) return { say: "Closing the CRM.", card: null, open: false, pending: null };

  // ---- a decision waiting for yes / no
  const cmd = parseRobinCommand(text);
  if (cmd.kind === "confirm") {
    const p = input.pending;
    if (!p) return { say: "There's nothing waiting for a yes.", card: null };
    if (!cmd.yes) return { say: "Okay — no change made.", card: { type: "done", text: `Nothing changed for ${p.name}.` }, pending: null, open: true };
    const lead = await db.robinLead.findFirst({ where: { id: p.leadId, userId } });
    if (!lead) return { say: "That lead isn't in your CRM any more.", card: { type: "error", text: "Lead not found." }, pending: null, open: true };
    return applyMove(userId, lead, p.stage, tz, true);
  }

  // ---- lists the island answers directly
  // "find clients who need follow-up", "who's due for a follow-up?" → today's (and overdue) follow-ups
  if (/\b(?:need|needs|due for|waiting for|pending)\b.*\bfollow[- ]?ups?\b/.test(low) && !/^(?:schedule|set up|book|add|create|plan|mark)\b/.test(low)) {
    return runIslandCommand(userId, { ...input, text: "show today's follow-ups" }, deps);
  }
  if (/\b(?:ready to (?:purchase|buy)|about to buy|hot (?:leads|prospects))\b/.test(low) && /\b(?:show|find|list|which|who|give|any|what)\b/.test(low)) {
    return listReply("Ready to purchase", await leadsWhere(userId, tz, { stages: ["ready_to_purchase"] }), "No leads are marked ready to purchase.");
  }
  if (/\binterested\b/.test(low) && !/\bnot interested\b/.test(low) && /\b(?:prospects?|leads?|clients?|people|businesses|who)\b/.test(low) && !/^(?:mark|set|move|put|change)\b/.test(low)) {
    return listReply("Interested (follow up)", await leadsWhere(userId, tz, { stages: ["interested", "follow_up", "demo_scheduled", "demo_completed"] }), "No interested prospects right now.");
  }
  if (/\b(?:rejected|lost)\b/.test(low) && /\b(?:show|list|which|who)\b/.test(low)) {
    return listReply("Rejected", await leadsWhere(userId, tz, { filter: "lost" }), "No rejected leads.");
  }
  if (/\b(?:summari[sz]e|summary of|recap)\b/.test(low) && /\b(?:interactions?|calls?|today|activity)\b/.test(low)) {
    const { start, end } = dayBounds(tz, now);
    const acts = await db.robinInteraction.findMany({ where: { userId, occurredAt: { gte: start, lt: end } }, orderBy: { occurredAt: "asc" }, include: { lead: { select: { businessName: true } } }, take: 40 });
    if (!acts.length) return { say: "No client interactions logged today.", card: { type: "text", title: "Today", text: "No client interactions logged today." }, open: true };
    const lines = acts.map((a) => `${fmtWhen(a.occurredAt, tz)} · ${a.lead.businessName} — ${a.channel}${a.outcome ? `, ${a.outcome.replace(/_/g, " ")}` : ""}${a.notes ? `: ${a.notes.slice(0, 80)}` : ""}`);
    return { say: `${plural(acts.length, "interaction")} today.`, card: { type: "text", title: `Today · ${plural(acts.length, "interaction")}`, text: lines.join("\n") }, open: true };
  }
  if (/^(?:open|show|pull up|display)\s+(?:the\s+)?(?:details?\s+(?:for|of)\s+)?(?:this|that|the)\s+(?:business|lead|client|one)(?:'s details)?$/.test(low)) {
    const l = await whichLead(userId, null, selected);
    if (isReply(l)) return l;
    return { say: l.businessName, card: { type: "lead", lead: await detail(userId, l, tz) }, leadId: l.id, open: true };
  }

  // "schedule a follow-up for tomorrow" — for the lead open in the pop-up
  const fu = low.match(/^(?:please\s+)?(?:schedule|set up|book|add|create|plan)\s+(?:a\s+|another\s+)?follow[- ]?up(?:\s+call)?\s+(?:for\s+|on\s+)?((?:today|tonight|tomorrow|day after tomorrow|next|this|in|at|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*)$/);
  if (fu) return runIslandCommand(userId, { ...input, text: `schedule a follow-up with this lead ${fu[1]}` }, deps);

  switch (cmd.kind) {
    case "exit": return { say: "Closing the CRM.", card: null, open: false, pending: null };
    case "leads": return listReply(cmd.filter === "hottest" ? "Need you most" : cmd.filter === "uncontacted" ? "Not contacted yet" : cmd.filter === "high_priority" ? "High priority" : `${cmd.filter.replace(/_/g, " ")} leads`, await leadsWhere(userId, tz, { filter: cmd.filter }), "No leads match that.");
    case "followups": {
      const q = await followUpQueue(userId, now);
      const pick = cmd.which === "today" ? [...q.overdue, ...q.today] : cmd.which === "overdue" ? q.overdue : cmd.which === "upcoming" ? q.upcoming.slice(0, MAX_ROWS) : [...q.overdue, ...q.today, ...q.upcoming].slice(0, MAX_ROWS);
      const items: IslandFollowUp[] = pick.slice(0, MAX_ROWS).map((f) => ({ id: f.id, leadId: f.lead.id, number: f.lead.number, name: f.lead.businessName, when: fmtWhen(f.dueAt, q.tz), action: f.action, overdue: q.overdue.includes(f), notes: f.notes }));
      const title = cmd.which === "today" ? "Follow up today" : cmd.which === "overdue" ? "Overdue follow-ups" : cmd.which === "upcoming" ? "Upcoming follow-ups" : "Follow-ups";
      if (!items.length) return { say: cmd.which === "today" ? "No follow-ups due today." : "No follow-ups.", card: { type: "text", text: cmd.which === "today" ? "No follow-ups due today." : "No follow-ups waiting." }, open: true };
      const over = items.filter((i) => i.overdue).length;
      return { say: `${plural(items.length, "follow-up")}${over ? `, ${over} overdue` : ""}.`, card: { type: "followups", title, items }, open: true };
    }
    case "open": {
      const l = await whichLead(userId, cmd.name, selected);
      if (isReply(l)) return l;
      return { say: l.businessName, card: { type: "lead", lead: await detail(userId, l, tz) }, leadId: l.id, open: true };
    }
    case "move": {
      const l = await whichLead(userId, cmd.name, selected);
      if (isReply(l)) return l;
      return applyMove(userId, l, cmd.stage, tz, false);
    }
    case "followup": {
      const l = await whichLead(userId, cmd.name, selected);
      if (isReply(l)) return l;
      const at = parseWhen(cmd.when, tz, now);
      if (!at) return { say: "When should I schedule it?", card: { type: "error", text: `I couldn't read a date or time in "${cmd.when}".` }, leadId: l.id, open: true };
      try {
        await scheduleFollowUp(userId, l.id, { dueAt: at, notes: cmd.note ?? null }, "voice");
        const fresh = await db.robinLead.findFirstOrThrow({ where: { id: l.id, userId } });
        return { say: `Follow-up with ${l.businessName} set for ${fmtWhen(at, tz)}.`, card: { type: "done", text: `Follow-up scheduled: ${fmtWhen(at, tz)}${cmd.note ? ` — ${cmd.note}` : ""}.`, lead: toLead(fresh, tz) }, leadId: l.id, open: true };
      } catch (e) { return failReply(e); }
    }
    case "complete_followup": {
      const l = await whichLead(userId, cmd.name, selected);
      if (isReply(l)) return l;
      const f = await db.robinFollowUp.findFirst({ where: { userId, leadId: l.id, status: "pending" }, orderBy: { dueAt: "asc" } });
      if (!f) return { say: `${l.businessName} has no follow-up waiting.`, card: { type: "error", text: "No pending follow-up for this lead." }, leadId: l.id, open: true };
      try {
        await completeFollowUp(userId, f.id, { notes: cmd.note ?? null }, "voice");
        return { say: `Done — follow-up with ${l.businessName} completed.`, card: { type: "done", text: `Follow-up completed${cmd.note ? ` — ${cmd.note}` : ""}.` }, leadId: l.id, open: true };
      } catch (e) { return failReply(e); }
    }
    case "note": {
      const l = await whichLead(userId, cmd.name, selected);
      if (isReply(l)) return l;
      try {
        await addFollowUpNote(userId, { leadId: l.id, text: cmd.text }, "voice");
        return { say: `Noted for ${l.businessName}.`, card: { type: "done", text: `Note saved: ${cmd.text}` }, leadId: l.id, open: true };
      } catch (e) { return failReply(e); }
    }
    case "briefing": {
      const b = await robinBriefing(userId, now);
      return { say: b.text.split(/(?<=[.!?])\s/)[0] ?? "Here's your day.", card: { type: "text", title: "Your day", text: b.text }, open: true };
    }
    case "view":
      if (cmd.view === "followups") return runIslandCommand(userId, { ...input, text: "show my follow-ups" }, deps);
      if (cmd.view === "clients") return listReply("Clients", await leadsWhere(userId, tz, { filter: "won" }), "No clients yet.");
      break; // other views → RUBIN answers in words (no dashboards here)
    case "chat":
      return { say: cmd.topic === "hello" ? "Hi — what do you need from the CRM?" : cmd.topic === "thanks" ? "Anytime." : cmd.topic === "bye" ? "Closing the CRM." : cmd.topic === "who" ? "I'm RUBEN, your sales CRM. Ask for leads, follow-ups or a client." : "All good — ready when you are.", card: null, ...(cmd.topic === "bye" ? { open: false } : {}) };
    default: break;
  }

  // ---- everything else: RUBIN's AI brain (pitches, questions) — it reads the CRM with its own tools
  let context: string | null = null;
  if (selected) {
    const l = await db.robinLead.findFirst({ where: { id: selected, userId } });
    if (l) context = `${l.businessName}${l.number ? ` (lead ${l.number})` : ""}, ${l.category ?? "business"}${l.city ? ` in ${l.city}` : ""}, stage ${l.stage}`;
  }
  const r = await ask(userId, text, context);
  if (r.error || !r.text) return { say: "I couldn't get an answer just now.", card: { type: "error", text: r.error ?? "RUBIN's brain didn't answer." }, open: true };
  return { say: r.text.split(/(?<=[.!?])\s/)[0].slice(0, 200), card: { type: "text", text: r.text }, open: true };
}

/** The island speaks your three sales words: Ready to purchase, Interested (follow up), Rejected. */
function labelOf(stage: Stage): string {
  return stage === "lost" ? "Rejected" : STAGE_LABEL[stage];
}

async function applyMove(userId: string, lead: RobinLead, stage: Stage, tz: string, confirmed: boolean): Promise<IslandReply> {
  const label = labelOf(stage);
  if (!confirmed && CONFIRM_STAGES.includes(stage)) {
    return {
      say: `Mark ${lead.businessName} as ${label.toLowerCase()}? Say yes to confirm.`,
      card: { type: "confirm", question: `Mark ${lead.businessName} as ${label}?` },
      pending: { kind: "move", leadId: lead.id, stage, name: lead.businessName }, leadId: lead.id, open: true,
    };
  }
  try {
    const r = await moveStage(userId, lead.id, stage, { source: "voice", confirm: confirmed || undefined });
    const text = r.changed ? `${lead.businessName} → ${label}.` : `${lead.businessName} is already ${label.toLowerCase()}.`;
    return { say: r.changed ? `Done — ${lead.businessName} is now ${label.toLowerCase()}.` : text, card: { type: "done", text, lead: toLead(r.lead, tz) }, leadId: lead.id, pending: null, open: true };
  } catch (e) { return failReply(e); }
}

function failReply(e: unknown): IslandReply {
  const msg = e instanceof RobinError ? e.message : "That didn't go through — nothing was changed.";
  if (!(e instanceof RobinError)) console.error("[robin island]", e);
  return { say: msg, card: { type: "error", text: msg }, open: true };
}

/** What the outline should briefly announce: due follow-ups and new notifications (real rows, not yet shown). */
export async function islandNotices(userId: string, since: Date, now = new Date()): Promise<{ id: string; text: string }[]> {
  const db = getDb();
  const tz = await userTz(userId);
  const [notes, due] = await Promise.all([
    db.robinNotification.findMany({ where: { userId, readAt: null, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.robinFollowUp.findMany({ where: { userId, status: "pending", dueAt: { gte: since, lte: now } }, include: { lead: { select: { businessName: true } } }, orderBy: { dueAt: "asc" }, take: 3 }),
  ]);
  return [
    ...due.map((f) => ({ id: `fu:${f.id}`, text: `FOLLOW-UP · ${f.lead.businessName} (${fmtWhen(f.dueAt, tz)})` })),
    ...notes.map((n) => ({ id: `n:${n.id}`, text: n.title.slice(0, 80) })),
  ].slice(0, 3);
}

export type { IslandCard };
