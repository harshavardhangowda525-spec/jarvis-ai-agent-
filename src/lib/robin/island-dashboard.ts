import "server-only";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { NODES, nodeOf, isStage, STAGE_LABEL } from "./types";
import { dayBounds, mustLead, userTz } from "./crm";
import { followUpQueue, fmtWhen } from "./engage";
import { attention } from "./qualify";
import { toLead } from "./island";
import type { IslandDashboard, IslandFollowUp, IslandLeadFull, IslandStatus } from "./island-types";

/**
 * The CRM dashboard in RUBEN's pop-up: counts, the three sales statuses,
 * follow-ups, today's activity, demo → proposal → client progress, and a
 * searchable lead list. All of it is read from the database on each request;
 * nothing here is estimated or made up.
 */

const CLOSED = ["won", "lost", "not_interested", "do_not_contact"];
const REJECTED = ["lost", "not_interested", "do_not_contact"];
const LIST_MAX = 60;

const STATUS_WHERE: Record<IslandStatus, Prisma.RobinLeadWhereInput> = {
  all: {},
  open: { stage: { notIn: CLOSED } },
  ready: { stage: "ready_to_purchase" },
  interested: { stage: { in: ["interested", "follow_up", "demo_scheduled", "demo_completed"] } },
  rejected: { stage: { in: REJECTED } },
  won: { stage: "won" },
};

function searchWhere(q: string): Prisma.RobinLeadWhereInput | null {
  const s = q.trim().slice(0, 80);
  if (!s) return null;
  const num = /^#?(\d{1,6})$/.exec(s);
  const c = (f: string) => ({ [f]: { contains: s, mode: "insensitive" as const } });
  return { OR: [...(num ? [{ number: Number(num[1]) }] : []), c("businessName"), c("category"), c("city"), c("phone"), c("email"), c("instagram"), c("website"), c("address")] };
}

export async function islandDashboard(userId: string, o: { status?: IslandStatus; q?: string } = {}, now = new Date()): Promise<IslandDashboard> {
  const db = getDb();
  const tz = await userTz(userId);
  const status: IslandStatus = o.status && o.status in STATUS_WHERE ? o.status : "open";
  const q = (o.q ?? "").trim();
  const { start, end } = dayBounds(tz, now);

  const listWhere: Prisma.RobinLeadWhereInput = { userId, ...STATUS_WHERE[status], ...(searchWhere(q) ?? {}) };
  const COLUMN_STAGES = { ready: ["ready_to_purchase"], interested: ["interested", "follow_up", "demo_scheduled", "demo_completed"], rejected: REJECTED };
  const [byStage, listRows, listTotal, queue, demosUpcoming, demosDone, proposalsOut, proposalsAccepted, clients, acts, todayInteractions, todayMoves, todayDone, recentRows, colRows, lastInteractions] = await Promise.all([
    db.robinLead.groupBy({ by: ["stage"], where: { userId }, _count: { _all: true } }),
    db.robinLead.findMany({ where: listWhere, take: 400 }),
    db.robinLead.count({ where: listWhere }),
    followUpQueue(userId, now),
    db.robinDemo.count({ where: { userId, status: { in: ["scheduled", "rescheduled"] }, scheduledAt: { gte: now } } }),
    db.robinDemo.count({ where: { userId, status: "completed" } }),
    db.robinQuotation.count({ where: { userId, status: "sent" } }),
    db.robinQuotation.count({ where: { userId, status: "accepted" } }),
    db.robinClient.count({ where: { userId } }),
    db.robinActivity.findMany({ where: { userId, createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "desc" }, take: 12 }),
    db.robinInteraction.count({ where: { userId, occurredAt: { gte: start, lt: end } } }),
    db.robinStageChange.count({ where: { userId, createdAt: { gte: start, lt: end } } }),
    db.robinFollowUp.count({ where: { userId, status: "completed", completedAt: { gte: start, lt: end } } }),
    db.robinLead.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 5 }),
    db.robinLead.findMany({ where: { userId, stage: { in: [...COLUMN_STAGES.ready, ...COLUMN_STAGES.interested, ...COLUMN_STAGES.rejected] } }, orderBy: { stageChangedAt: "desc" }, take: 300 }),
    db.robinInteraction.findMany({ where: { userId }, orderBy: { occurredAt: "desc" }, take: 8, include: { lead: { select: { businessName: true } } } }),
  ]);

  const n = (stages: string[]) => byStage.filter((r) => stages.includes(r.stage)).reduce((a, r) => a + r._count._all, 0);
  const total = byStage.reduce((a, r) => a + r._count._all, 0);
  const pipeline = NODES.map((node) => ({ id: node.id, label: node.label, count: byStage.filter((r) => nodeOf(r.stage) === node.id).reduce((a, r) => a + r._count._all, 0) }));

  // most important first (the same order RUBIN works in), then the newest
  listRows.sort((a, b) => attention(b, now) - attention(a, now) || +b.createdAt - +a.createdAt);

  const fu = [...queue.overdue, ...queue.today, ...queue.upcoming].slice(0, 20);
  const followups: IslandFollowUp[] = fu.map((f) => ({ id: f.id, leadId: f.lead.id, number: f.lead.number, name: f.lead.businessName, when: fmtWhen(f.dueAt, queue.tz), action: f.action, overdue: queue.overdue.includes(f), notes: f.notes }));

  const bits = [
    todayInteractions ? `${todayInteractions} interaction${todayInteractions === 1 ? "" : "s"} logged` : null,
    todayMoves ? `${todayMoves} stage change${todayMoves === 1 ? "" : "s"}` : null,
    todayDone ? `${todayDone} follow-up${todayDone === 1 ? "" : "s"} done` : null,
  ].filter(Boolean);

  const col = (stages: string[]) => colRows.filter((l) => stages.includes(l.stage)).sort((a, b) => attention(b, now) - attention(a, now)).slice(0, 6).map((l) => toLead(l, tz));
  const won = n(["won"]), rejected = n(REJECTED);
  return {
    recent: recentRows.map((l) => ({ id: l.id, name: l.businessName, number: l.number, email: l.email, phone: l.phone, instagram: l.instagram, website: l.website, stage: l.stage, stageLabel: label(l.stage) })),
    columns: { ready: col(COLUMN_STAGES.ready), interested: col(COLUMN_STAGES.interested), rejected: col(COLUMN_STAGES.rejected) },
    winRate: { won, decided: won + rejected, pct: won + rejected ? Math.round((won / (won + rejected)) * 100) : null },
    interactions: lastInteractions.map((i) => ({ id: i.id, leadId: i.leadId, name: i.lead.businessName, when: fmtWhen(i.occurredAt, tz), channel: i.channel, direction: i.direction, outcome: i.outcome, notes: i.notes })),
    counts: { new: n(["new"]), qualified: n(["qualified"]), inProgress: total - n(CLOSED) - n(["new", "qualified"]), total, open: total - n(CLOSED), ready: n(["ready_to_purchase"]), interested: n(["interested", "follow_up", "demo_scheduled", "demo_completed"]), rejected: n(REJECTED), won: n(["won"]), dueToday: queue.today.length, overdue: queue.overdue.length },
    pipeline,
    progress: { demosUpcoming, demosDone, proposalsOut, proposalsAccepted, clients },
    followups,
    activity: acts.map((a) => ({ id: a.id, when: fmtWhen(a.createdAt, tz), text: a.detail, leadId: a.leadId })),
    today: bits.length ? `Today: ${bits.join(", ")}.` : "Nothing logged yet today.",
    list: { status, q, total: listTotal, leads: listRows.slice(0, LIST_MAX).map((l) => toLead(l, tz)) },
  };
}

const label = (s: string) => (s === "lost" ? "Rejected" : isStage(s) ? STAGE_LABEL[s] : s);

/** One lead with its history — for the detail pane. */
export async function islandLeadFull(userId: string, leadId: string, now = new Date()): Promise<IslandLeadFull> {
  const db = getDb();
  const tz = await userTz(userId);
  const l = await mustLead(userId, leadId);
  const [interactions, followUps, moves, demos, quotes, client] = await Promise.all([
    db.robinInteraction.findMany({ where: { userId, leadId }, orderBy: { occurredAt: "desc" }, take: 20 }),
    db.robinFollowUp.findMany({ where: { userId, leadId }, orderBy: { dueAt: "desc" }, take: 12 }),
    db.robinStageChange.findMany({ where: { userId, leadId }, orderBy: { createdAt: "desc" }, take: 12 }),
    db.robinDemo.findMany({ where: { userId, leadId }, orderBy: { scheduledAt: "desc" }, take: 6 }),
    db.robinQuotation.findMany({ where: { userId, leadId }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.robinClient.findUnique({ where: { leadId } }),
  ]);
  const pending = followUps.filter((f) => f.status === "pending").sort((a, b) => +a.dueAt - +b.dueAt);
  return {
    ...toLead(l, tz),
    email: l.email, whatsapp: l.whatsapp, instagram: l.instagram, website: l.website, address: l.address,
    priority: l.priorityOverride ?? l.priority, score: l.score, notes: l.notes,
    mapsUrl: l.mapsUrl, potentialValue: l.potentialValue, serviceInterest: l.serviceInterest,
    recent: interactions.slice(0, 3).map((a) => ({ when: fmtWhen(a.occurredAt, tz), text: `${a.channel}${a.outcome ? ` · ${a.outcome.replace(/_/g, " ")}` : ""}` })),
    followUps: pending.slice(0, 3).map((f) => ({ id: f.id, when: fmtWhen(f.dueAt, tz), action: f.action })),
    createdAt: l.createdAt.toISOString(), stageSince: l.stageChangedAt.toISOString(),
    interactions: interactions.map((a) => ({ id: a.id, at: a.occurredAt.toISOString(), when: fmtWhen(a.occurredAt, tz), channel: a.channel, direction: a.direction, outcome: a.outcome, notes: a.notes })),
    followUpsAll: followUps.map((f) => ({ id: f.id, at: f.dueAt.toISOString(), doneAt: f.completedAt ? f.completedAt.toISOString() : null, when: fmtWhen(f.dueAt, tz), action: f.action, status: f.status, overdue: f.status === "pending" && f.dueAt < now, notes: f.notes })),
    stageHistory: moves.map((m) => ({ at: m.createdAt.toISOString(), when: fmtWhen(m.createdAt, tz), from: m.fromStage ? label(m.fromStage) : null, to: label(m.toStage) })),
    demos: demos.map((d) => ({ id: d.id, at: d.scheduledAt.toISOString(), when: fmtWhen(d.scheduledAt, tz), type: d.demoType, status: d.status })),
    quotations: quotes.map((x) => ({ id: x.id, at: x.createdAt.toISOString(), number: x.number, status: x.status, total: x.total, currency: x.currency, when: fmtWhen(x.createdAt, tz) })),
    client: client ? { status: client.status, paymentStatus: client.paymentStatus, amount: client.amount, currency: client.currency, project: client.project } : null,
  };
}
