import "server-only";
import type { RobinLead } from "@prisma/client";
import { getDb } from "@/lib/db";
import { RobinError, advanceTo, logRobin, audit, mustLead, moveStage, dayBounds, userTz, type Source } from "./crm";
import { CALL_OUTCOMES, CHANNELS, FOLLOWUP_ACTIONS, DEMO_TYPES, OUTCOME_LABEL, type Channel } from "./types";

/**
 * Contact tracking, follow-ups and demos. Robin never contacts anyone by itself:
 * a call is only recorded when YOU log how it went, a WhatsApp/Instagram message
 * only when you say you sent it, and "sent"/"delivered" only when an API
 * confirmed it. Opening the dialer or WhatsApp records nothing.
 */

const CHANNEL_NAME: Record<Channel, string> = { call: "Call", whatsapp: "WhatsApp", instagram: "Instagram DM", email: "Email" };

export interface InteractionInput {
  channel: Channel;
  direction?: "outbound" | "inbound";
  outcome?: string | null;
  notes?: string | null;
  /** logged (you recorded it) | sent/delivered (an API confirmed it) | received */
  status?: "logged" | "sent" | "delivered" | "failed" | "received";
  subject?: string | null;
  externalId?: string | null;
  occurredAt?: Date;
  followUp?: { dueAt: Date; action?: string; notes?: string | null; priority?: string } | null;
}

export async function logInteraction(userId: string, leadId: string, i: InteractionInput, source: Source) {
  if (!CHANNELS.includes(i.channel)) throw new RobinError("Unknown channel.", 422, "invalid");
  if (i.channel === "call" && i.outcome && !(CALL_OUTCOMES as readonly string[]).includes(i.outcome)) throw new RobinError("Unknown call outcome.", 422, "invalid");
  let lead = await mustLead(userId, leadId);
  const db = getDb();
  const at = i.occurredAt ?? new Date();
  const direction = i.direction ?? "outbound";
  const row = await db.robinInteraction.create({
    data: {
      userId, leadId: lead.id, channel: i.channel, direction, outcome: i.outcome ?? null,
      status: i.status ?? (direction === "inbound" ? "received" : "logged"), subject: i.subject ?? null,
      notes: i.notes?.slice(0, 4000) ?? null, externalId: i.externalId ?? null, occurredAt: at,
    },
  });
  const outcome = i.outcome ? ` — ${OUTCOME_LABEL[i.outcome] ?? i.outcome}` : "";
  const verb = direction === "inbound" ? `Reply received from ${lead.businessName} (${CHANNEL_NAME[i.channel]})` : i.channel === "call" ? `Call logged with ${lead.businessName}${outcome}` : `${CHANNEL_NAME[i.channel]} ${i.status === "sent" || i.status === "delivered" ? "sent" : "logged"} with ${lead.businessName}${outcome}`;
  await logRobin(userId, lead.id, direction === "inbound" ? "reply" : i.channel, verb, { interactionId: row.id, outcome: i.outcome ?? null, status: row.status });
  await audit(userId, "interaction_logged", "interaction", row.id, source, { channel: i.channel, outcome: i.outcome ?? null, direction });

  if (direction === "outbound" && i.outcome !== "wrong_number") {
    lead = await db.robinLead.update({ where: { id: lead.id }, data: { lastContactAt: at } });
    lead = await advanceTo(userId, lead, "contacted", source, `${CHANNEL_NAME[i.channel]}${outcome}`);
  }
  if (direction === "inbound") lead = await db.robinLead.update({ where: { id: lead.id }, data: { lastContactAt: at } });
  // what the conversation itself tells us (forward-only; never past a decision)
  if (i.outcome && ["interested", "wants_demo", "wants_quotation"].includes(i.outcome)) lead = await advanceTo(userId, lead, "interested", source, OUTCOME_LABEL[i.outcome]);
  if (i.outcome === "not_interested" && !["won", "do_not_contact"].includes(lead.stage)) lead = (await moveStage(userId, lead.id, "not_interested", { source, note: i.notes ?? "Said not interested" })).lead;

  let followUp = null;
  if (i.followUp) followUp = await scheduleFollowUp(userId, lead.id, { dueAt: i.followUp.dueAt, action: i.followUp.action ?? i.channel, notes: i.followUp.notes ?? null, priority: i.followUp.priority }, source);
  return { interaction: row, lead: (await db.robinLead.findUnique({ where: { id: lead.id } }))!, followUp };
}

// ---------------------------------------------------------------- follow-ups

async function syncNextFollowUp(leadId: string) {
  const db = getDb();
  const next = await db.robinFollowUp.findFirst({ where: { leadId, status: "pending" }, orderBy: { dueAt: "asc" }, select: { dueAt: true } });
  return db.robinLead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
}

export async function scheduleFollowUp(userId: string, leadId: string, f: { dueAt: Date; action?: string; priority?: string; notes?: string | null }, source: Source) {
  if (!(f.dueAt instanceof Date) || Number.isNaN(+f.dueAt)) throw new RobinError("That follow-up time isn't a valid date.", 422, "invalid");
  const lead = await mustLead(userId, leadId);
  if (lead.stage === "do_not_contact") throw new RobinError(`${lead.businessName} is marked Do Not Contact.`, 409, "invalid");
  const action = (FOLLOWUP_ACTIONS as readonly string[]).includes(f.action ?? "") ? f.action! : "call";
  const priority = ["high", "medium", "low"].includes(f.priority ?? "") ? f.priority! : lead.priority === "high" ? "high" : "medium";
  const row = await getDb().robinFollowUp.create({ data: { userId, leadId: lead.id, dueAt: f.dueAt, action, priority, notes: f.notes?.slice(0, 2000) ?? null } });
  await syncNextFollowUp(lead.id);
  await advanceTo(userId, lead, "follow_up", source, "Follow-up scheduled");
  const tz = await userTz(userId);
  await logRobin(userId, lead.id, "followup_scheduled", `Follow-up scheduled with ${lead.businessName} — ${fmtWhen(f.dueAt, tz)}`, { followUpId: row.id, action });
  await audit(userId, "followup_scheduled", "followup", row.id, source, { dueAt: f.dueAt.toISOString(), action });
  return row;
}

export async function completeFollowUp(userId: string, id: string, o: { notes?: string | null } = {}, source: Source = "user") {
  const db = getDb();
  const f = await db.robinFollowUp.findFirst({ where: { id, userId }, include: { lead: { select: { businessName: true } } } });
  if (!f) throw new RobinError("That follow-up doesn't exist.", 404, "not_found");
  if (f.status !== "pending") return f;
  const done = o.notes?.trim() ? `Done: ${o.notes.trim().slice(0, 1000)}` : null;
  const row = await db.robinFollowUp.update({ where: { id }, data: { status: "completed", completedAt: new Date(), ...(done ? { notes: [f.notes, done].filter(Boolean).join("\n") } : {}) } });
  await syncNextFollowUp(f.leadId);
  await logRobin(userId, f.leadId, "followup_completed", `Follow-up with ${f.lead.businessName} completed${done ? ` — ${o.notes!.trim().slice(0, 300)}` : ""}`, { followUpId: id });
  await audit(userId, "followup_completed", "followup", id, source);
  return row;
}

/**
 * Take down a note you told Robin. It goes on the follow-up it's about (`followUpId`),
 * else the lead's next pending follow-up, else the lead's own notes — so "how many
 * follow-ups do we have?" can read it back with the follow-up.
 */
export async function addFollowUpNote(userId: string, p: { leadId?: string; followUpId?: string; text: string }, source: Source = "user") {
  const db = getDb();
  const text = p.text.trim().replace(/\s+/g, " ").slice(0, 1000);
  if (!text) throw new RobinError("The note is empty.", 422, "invalid");
  const f = p.followUpId
    ? await db.robinFollowUp.findFirst({ where: { id: p.followUpId, userId }, include: { lead: { select: { id: true, number: true, businessName: true } } } })
    : p.leadId ? await db.robinFollowUp.findFirst({ where: { userId, leadId: p.leadId, status: "pending" }, orderBy: { dueAt: "asc" }, include: { lead: { select: { id: true, number: true, businessName: true } } } }) : null;
  if (p.followUpId && !f) throw new RobinError("That follow-up doesn't exist.", 404, "not_found");
  if (f) {
    const row = await db.robinFollowUp.update({ where: { id: f.id }, data: { notes: [f.notes, text].filter(Boolean).join("\n").slice(-2000) } });
    await logRobin(userId, f.leadId, "note", `Note on the follow-up with ${f.lead.businessName}: ${text}`, { followUpId: f.id }, 1);
    await audit(userId, "followup_note", "followup", f.id, source);
    return { on: "followup" as const, followUp: row, lead: f.lead };
  }
  const lead = await mustLead(userId, p.leadId!);
  const stamp = new Date().toISOString().slice(0, 10);
  await db.robinLead.update({ where: { id: lead.id }, data: { notes: [lead.notes, `${stamp}: ${text}`].filter(Boolean).join("\n").slice(-8000) } });
  await logRobin(userId, lead.id, "note", `Note on ${lead.businessName}: ${text}`, {}, 1);
  await audit(userId, "lead_note", "lead", lead.id, source);
  return { on: "lead" as const, followUp: null, lead: { id: lead.id, number: lead.number, businessName: lead.businessName } };
}

export async function cancelFollowUp(userId: string, id: string, source: Source = "user") {
  const db = getDb();
  const f = await db.robinFollowUp.findFirst({ where: { id, userId }, include: { lead: { select: { businessName: true } } } });
  if (!f) throw new RobinError("That follow-up doesn't exist.", 404, "not_found");
  const row = await db.robinFollowUp.update({ where: { id }, data: { status: "cancelled" } });
  await syncNextFollowUp(f.leadId);
  await logRobin(userId, f.leadId, "followup_cancelled", `Follow-up with ${f.lead.businessName} cancelled`, { followUpId: id }, 1);
  await audit(userId, "followup_cancelled", "followup", id, source);
  return row;
}

export async function followUpQueue(userId: string, now = new Date()) {
  const tz = await userTz(userId);
  const { start, end } = dayBounds(tz, now);
  const rows = await getDb().robinFollowUp.findMany({
    where: { userId, status: "pending" }, orderBy: { dueAt: "asc" }, take: 300,
    include: { lead: { select: { id: true, number: true, businessName: true, category: true, stage: true, priority: true, phone: true } } },
  });
  return {
    overdue: rows.filter((r) => r.dueAt < start),
    today: rows.filter((r) => r.dueAt >= start && r.dueAt < end),
    upcoming: rows.filter((r) => r.dueAt >= end),
    tz,
  };
}

// ---------------------------------------------------------------- demos

export async function scheduleDemo(userId: string, leadId: string, d: { at: Date; demoType?: string; notes?: string | null }, source: Source) {
  if (Number.isNaN(+d.at)) throw new RobinError("That demo time isn't a valid date.", 422, "invalid");
  const lead = await mustLead(userId, leadId);
  const demoType = (DEMO_TYPES as readonly string[]).includes(d.demoType ?? "") ? d.demoType! : "online";
  const row = await getDb().robinDemo.create({ data: { userId, leadId: lead.id, scheduledAt: d.at, demoType, notes: d.notes?.slice(0, 2000) ?? null } });
  await advanceTo(userId, lead, "demo_scheduled", source, "Demo scheduled");
  const tz = await userTz(userId);
  await logRobin(userId, lead.id, "demo_scheduled", `Demo scheduled with ${lead.businessName} — ${fmtWhen(d.at, tz)}`, { demoId: row.id }, 3);
  await audit(userId, "demo_scheduled", "demo", row.id, source, { at: d.at.toISOString(), demoType });
  return row;
}

export async function updateDemo(userId: string, id: string, u: { status: "completed" | "cancelled" | "rescheduled"; at?: Date; notes?: string | null }, source: Source) {
  const db = getDb();
  const d = await db.robinDemo.findFirst({ where: { id, userId }, include: { lead: true } });
  if (!d) throw new RobinError("That demo doesn't exist.", 404, "not_found");
  if (u.status === "rescheduled" && (!u.at || Number.isNaN(+u.at))) throw new RobinError("Give the new demo time.", 422, "invalid");
  const row = await db.robinDemo.update({
    where: { id },
    data: {
      status: u.status, ...(u.status === "completed" ? { completedAt: new Date() } : {}),
      ...(u.status === "rescheduled" ? { scheduledAt: u.at, remindedAt: null } : {}),
      ...(u.notes ? { notes: [d.notes, u.notes].filter(Boolean).join("\n") } : {}),
    },
  });
  const tz = await userTz(userId);
  const text = u.status === "completed" ? `Demo completed with ${d.lead.businessName}` : u.status === "cancelled" ? `Demo with ${d.lead.businessName} cancelled` : `Demo with ${d.lead.businessName} moved to ${fmtWhen(u.at!, tz)}`;
  if (u.status === "completed") await advanceTo(userId, d.lead as RobinLead, "demo_completed", source, "Demo completed");
  await logRobin(userId, d.leadId, `demo_${u.status}`, text, { demoId: id }, u.status === "completed" ? 3 : 2);
  await audit(userId, `demo_${u.status}`, "demo", id, source);
  return row;
}

/**
 * Demos starting within the next 30 minutes that haven't been announced yet.
 * Each is announced once, as an in-app Robin notification (and a browser
 * notification only if you allowed those).
 */
export async function demoReminders(userId: string, now = new Date()) {
  const db = getDb();
  const soon = await db.robinDemo.findMany({
    where: { userId, status: { in: ["scheduled", "rescheduled"] }, remindedAt: null, scheduledAt: { gt: now, lte: new Date(now.getTime() + 30 * 60_000) } },
    include: { lead: { select: { businessName: true } } },
  });
  const out: { demoId: string; leadId: string; text: string }[] = [];
  for (const d of soon) {
    const claim = await db.robinDemo.updateMany({ where: { id: d.id, remindedAt: null }, data: { remindedAt: now } });
    if (claim.count !== 1) continue;
    const mins = Math.max(1, Math.round((+d.scheduledAt - +now) / 60_000));
    const text = `Your demo with ${d.lead.businessName} starts in ${mins} minute${mins === 1 ? "" : "s"}.`;
    await db.robinNotification.create({ data: { userId, kind: "demo_soon", title: "Demo soon", body: text, leadId: d.leadId } });
    out.push({ demoId: d.id, leadId: d.leadId, text });
  }
  return out;
}

export function fmtWhen(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);
}
