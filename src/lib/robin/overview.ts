import "server-only";
import { getDb } from "@/lib/db";
import { attention } from "./qualify";
import { dayBounds, loadSettings, userTz } from "./crm";
import { NODES, nodeOf, CLOSED, STAGE_ORDER, type NodeId, type Stage } from "./types";

/**
 * Everything ROBIN's command center shows, from the real CRM: the pipeline
 * (counts, values, the leads in each stage), today's work, the next action,
 * live activity. No placeholders — an empty CRM returns zeros and empty lists.
 */

export interface LeadCard {
  id: string; number: number | null; name: string; category: string | null; score: number; priority: string; stage: string;
  value: number | null; nextFollowUpAt: string | null; flag: "overdue" | "today" | null; attention: number;
  demoAt: string | null; quote: { status: string; total: number } | null; phone: boolean; email: boolean; whatsapp: boolean; source: string;
}
export interface NodeView { id: NodeId; label: string; count: number; value: number; leads: LeadCard[] }
export interface Overview {
  currency: string;
  tz: string;
  /** How many leads (all time) reached each step — the funnel. */
  funnel: { id: NodeId; label: string; count: number }[];
  /** Every lead's current node, so the chart can animate moves between polls. */
  stageMap: [string, NodeId][];
  counts: { total: number; qualified: number; contacted: number; interested: number; followUpsDue: number; demos: number; quotations: number; won: number; lost: number; pipelineValue: number; revenueWon: number; clients: number };
  nodes: NodeView[];
  today: { calls: number; followUps: number; overdue: number; demos: number; quotations: number; highPriority: number };
  next: { leadId: string; name: string; text: string; why: string } | null;
  attentionCount: number;
  overdueAdvice: string | null;
  recent: { id: string; at: string; type: string; detail: string; leadId: string | null }[];
  notifications: { id: string; kind: string; title: string; body: string | null; at: string; leadId: string | null }[];
  darwin: { total: number; today: number };
  /** The command center's side panels — every number is counted from the CRM. */
  dash: {
    qualifiedToday: number;
    /** Open leads you've actually talked to / messaged in the last 14 days. */
    activeConversations: number;
    /** Leads with a proposal (quotation) out: sent or negotiating. */
    proposals: number;
    /** Won ÷ all leads (null with no leads). */
    conversion: { value: number | null; won: number; total: number };
    /** Follow-ups due in the last 30 days that were completed (null when none were due). */
    followUpRate: { value: number | null; done: number; due: number };
    pending: { total: number; overdue: number; dueToday: number; demosToday: number; drafts: number };
  };
  generatedAt: string;
}

/** Open leads with a real conversation (not just a dialer opened) in the last 14 days. */
export const ACTIVE_DAYS = 14;
export async function activeConversationIds(userId: string, now = new Date()): Promise<string[]> {
  const rows = await getDb().robinInteraction.findMany({
    where: { userId, occurredAt: { gte: new Date(now.getTime() - ACTIVE_DAYS * 86_400_000) }, status: { notIn: ["opened", "failed"] }, lead: { stage: { notIn: [...CLOSED] } } },
    select: { leadId: true }, distinct: ["leadId"],
  });
  return rows.map((r) => r.leadId);
}

export async function robinOverview(userId: string, now = new Date()): Promise<Overview> {
  const db = getDb();
  const tz = await userTz(userId);
  const { start, end } = dayBounds(tz, now);
  const [settings, leads, followUps, demos, quotes, clients, recent, notes] = await Promise.all([
    loadSettings(userId),
    db.robinLead.findMany({ where: { userId }, select: { id: true, number: true, businessName: true, category: true, score: true, priority: true, stage: true, potentialValue: true, nextFollowUpAt: true, lastContactAt: true, phone: true, email: true, whatsapp: true, source: true, createdAt: true } }),
    db.robinFollowUp.findMany({ where: { userId, status: "pending" }, select: { id: true, leadId: true, dueAt: true, action: true, priority: true } }),
    db.robinDemo.findMany({ where: { userId, status: { in: ["scheduled", "rescheduled"] }, scheduledAt: { gte: new Date(now.getTime() - 3 * 3_600_000) } }, select: { leadId: true, scheduledAt: true }, orderBy: { scheduledAt: "asc" } }),
    db.robinQuotation.findMany({ where: { userId, status: { in: ["draft", "sent", "accepted"] } }, select: { leadId: true, status: true, total: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    db.robinClient.findMany({ where: { userId }, select: { amount: true } }),
    db.robinActivity.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 24, select: { id: true, createdAt: true, type: true, detail: true, leadId: true } }),
    db.robinNotification.findMany({ where: { userId, readAt: null }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const [changes, activeIds, qualifiedToday, fuWindow, drafts] = await Promise.all([
    db.robinStageChange.findMany({ where: { userId }, select: { leadId: true, toStage: true } }),
    activeConversationIds(userId, now),
    // leads that reached QUALIFIED today (not every lead Robin scored)
    db.robinStageChange.findMany({ where: { userId, toStage: "qualified", createdAt: { gte: start } }, select: { leadId: true }, distinct: ["leadId"] }).then((r) => r.length),
    db.robinFollowUp.findMany({ where: { userId, dueAt: { gte: monthAgo, lt: now }, status: { in: ["pending", "completed"] } }, select: { status: true } }),
    db.robinQuotation.count({ where: { userId, status: "draft" } }),
  ]);

  const demoBy = new Map<string, Date>();
  for (const d of demos) if (!demoBy.has(d.leadId)) demoBy.set(d.leadId, d.scheduledAt);
  const quoteBy = new Map<string, { status: string; total: number }>();
  for (const q of quotes) if (!quoteBy.has(q.leadId)) quoteBy.set(q.leadId, { status: q.status, total: q.total });

  const cards = toCards(leads, demoBy, quoteBy, start, end, now);

  const nodes: NodeView[] = NODES.map((n) => {
    const inNode = cards.filter((c) => nodeOf(c.stage) === n.id).sort((a, b) => b.attention - a.attention);
    return { id: n.id, label: n.label, count: inNode.length, value: inNode.reduce((s, c) => s + (c.value ?? 0), 0), leads: inNode.slice(0, 12) };
  });

  const active = cards.filter((c) => !CLOSED.includes(c.stage as Stage));
  const reached = (min: Stage[]) => cards.filter((c) => min.includes(c.stage as Stage)).length;
  const dueToday = followUps.filter((f) => f.dueAt >= start && f.dueAt < end);
  const overdue = followUps.filter((f) => f.dueAt < start);
  const counts: Overview["counts"] = {
    total: cards.length,
    qualified: reached(["qualified"]),
    contacted: reached(["contacted"]),
    interested: reached(["interested"]),
    followUpsDue: dueToday.length + overdue.length,
    demos: demos.filter((d) => d.scheduledAt >= now).length,
    quotations: quotes.filter((q) => q.status === "sent").length,
    won: reached(["won"]),
    lost: reached(["lost", "not_interested", "do_not_contact"]),
    pipelineValue: active.reduce((s, c) => s + (c.value ?? 0), 0),
    revenueWon: clients.reduce((s, c) => s + c.amount, 0),
    clients: clients.length,
  };

  const byId = new Map(cards.map((c) => [c.id, c]));
  const engaged = (c?: LeadCard) => !!c && ["interested", "demo_completed", "quotation_sent", "negotiating"].includes(c.stage);
  const sortWork = (a: { leadId: string }, b: { leadId: string }) => (byId.get(b.leadId)?.attention ?? 0) - (byId.get(a.leadId)?.attention ?? 0);
  const today = {
    calls: [...dueToday, ...overdue].filter((f) => f.action === "call").length,
    followUps: dueToday.length,
    overdue: overdue.length,
    demos: demos.filter((d) => d.scheduledAt >= start && d.scheduledAt < end).length,
    quotations: quotes.filter((q) => q.status === "sent").length,
    highPriority: active.filter((c) => c.priority === "high" && ["new", "qualified"].includes(c.stage)).length,
  };

  // the one thing to do next, with the reason
  let next: Overview["next"] = null;
  let overdueAdvice: string | null = null;
  const soonDemo = demos.find((d) => d.scheduledAt >= now && d.scheduledAt.getTime() - now.getTime() < 2 * 3_600_000);
  if (overdue.length) {
    const first = [...overdue].sort(sortWork)[0];
    const c = byId.get(first.leadId);
    if (c) {
      next = { leadId: c.id, name: c.name, text: "Follow up — overdue", why: engaged(c) ? "it's already interested" : c.priority === "high" ? "it's high priority" : "it's the most overdue" };
      overdueAdvice = `${overdue.length} follow-up${overdue.length === 1 ? " is" : "s are"} overdue. I'd handle ${c.name} first because ${next.why}.`;
    }
  }
  if (!next && soonDemo) {
    const c = byId.get(soonDemo.leadId);
    if (c) next = { leadId: c.id, name: c.name, text: `Demo at ${soonDemo.scheduledAt.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" })}`, why: "it's coming up" };
  }
  if (!next && dueToday.length) {
    const f = [...dueToday].sort(sortWork)[0];
    const c = byId.get(f.leadId);
    if (c) next = { leadId: c.id, name: c.name, text: "Follow up today", why: engaged(c) ? "it's already interested" : "it's due today" };
  }
  if (!next) {
    const fresh = active.filter((c) => ["new", "qualified"].includes(c.stage) && c.priority === "high" && (c.phone || c.whatsapp || c.email)).sort((a, b) => b.attention - a.attention)[0];
    if (fresh) next = { leadId: fresh.id, name: fresh.name, text: fresh.phone ? "Call — not contacted yet" : "Reach out — not contacted yet", why: "it's high priority and hasn't been contacted" };
  }

  const darwinLeads = cards.filter((c) => c.source === "darwin");
  // funnel: the furthest step each lead ever reached (WON only counts wins; LOST is its own bar)
  const far = new Map<string, number>();
  const bump = (id: string, s: string) => { const o = STAGE_ORDER[s as Stage]; if (o != null && o < 10) far.set(id, Math.max(far.get(id) ?? 0, o)); };
  for (const l of leads) bump(l.id, l.stage);
  for (const c of changes) bump(c.leadId, c.toStage);
  const journey = [...NODES].sort((a, b) => Math.min(...a.stages.map((s) => STAGE_ORDER[s as Stage])) - Math.min(...b.stages.map((s) => STAGE_ORDER[s as Stage])));
  const funnel = journey.map((n) => {
    if (n.id === "lost") return { id: n.id, label: n.label, count: cards.filter((c) => nodeOf(c.stage) === "lost").length };
    if (n.id === "won") return { id: n.id, label: n.label, count: cards.filter((c) => c.stage === "won").length };
    const min = Math.min(...n.stages.map((s) => STAGE_ORDER[s as Stage]));
    return { id: n.id, label: n.label, count: leads.filter((l) => (far.get(l.id) ?? 0) >= min).length };
  });
  return {
    currency: settings.currency, tz, funnel, stageMap: cards.map((c) => [c.id, nodeOf(c.stage)] as [string, NodeId]), counts, nodes, today, next, overdueAdvice,
    attentionCount: active.filter((c) => c.flag || (c.priority === "high" && ["new", "qualified"].includes(c.stage))).length,
    recent: recent.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), type: r.type, detail: r.detail, leadId: r.leadId })),
    notifications: notes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, at: n.createdAt.toISOString(), leadId: n.leadId })),
    darwin: { total: darwinLeads.length, today: leads.filter((l) => l.source === "darwin" && l.createdAt >= start).length },
    dash: (() => {
      const done = fuWindow.filter((f) => f.status === "completed").length;
      const pending = { overdue: overdue.length, dueToday: dueToday.length, demosToday: today.demos, drafts };
      return {
        qualifiedToday,
        activeConversations: activeIds.length,
        proposals: cards.filter((c) => nodeOf(c.stage) === "proposal").length,
        conversion: { value: cards.length ? Math.round((counts.won / cards.length) * 1000) / 10 : null, won: counts.won, total: cards.length },
        followUpRate: { value: fuWindow.length ? Math.round((done / fuWindow.length) * 100) : null, done, due: fuWindow.length },
        pending: { ...pending, total: pending.overdue + pending.dueToday + pending.demosToday + pending.drafts },
      };
    })(),
    generatedAt: now.toISOString(),
  };
}

type CardSource = { id: string; number: number | null; businessName: string; category: string | null; score: number; priority: string; stage: string; potentialValue: number | null; nextFollowUpAt: Date | null; lastContactAt: Date | null; phone: string | null; email: string | null; whatsapp: string | null; source: string };
function toCards(leads: CardSource[], demoBy: Map<string, Date>, quoteBy: Map<string, { status: string; total: number }>, start: Date, end: Date, now: Date): LeadCard[] {
  return leads.map((l) => {
    const due = l.nextFollowUpAt;
    const flag = due ? (due < start ? "overdue" : due < end ? "today" : null) : null;
    const q = quoteBy.get(l.id) ?? null;
    return {
      id: l.id, number: l.number, name: l.businessName, category: l.category, score: l.score, priority: l.priority, stage: l.stage,
      value: l.potentialValue ?? q?.total ?? null, nextFollowUpAt: due?.toISOString() ?? null, flag,
      attention: attention(l, now), demoAt: demoBy.get(l.id)?.toISOString() ?? null, quote: q,
      phone: !!l.phone, email: !!l.email, whatsapp: !!l.whatsapp, source: l.source,
    };
  });
}

/** EVERY lead in one stage of the chart (most-needing-you first) — for "show all qualified leads". */
export async function nodeCards(userId: string, node: NodeId, now = new Date()): Promise<LeadCard[]> {
  const db = getDb();
  const stages = [...(NODES.find((n) => n.id === node)?.stages ?? [])] as string[];
  if (!stages.length) return [];
  const tz = await userTz(userId);
  const { start, end } = dayBounds(tz, now);
  const leads = await db.robinLead.findMany({
    where: { userId, stage: { in: stages } }, take: 5000,
    select: { id: true, number: true, businessName: true, category: true, score: true, priority: true, stage: true, potentialValue: true, nextFollowUpAt: true, lastContactAt: true, phone: true, email: true, whatsapp: true, source: true },
  });
  const ids = leads.map((l) => l.id);
  const [demos, quotes] = await Promise.all([
    db.robinDemo.findMany({ where: { userId, leadId: { in: ids }, status: { in: ["scheduled", "rescheduled"] }, scheduledAt: { gte: new Date(now.getTime() - 3 * 3_600_000) } }, select: { leadId: true, scheduledAt: true }, orderBy: { scheduledAt: "asc" } }),
    db.robinQuotation.findMany({ where: { userId, leadId: { in: ids }, status: { in: ["draft", "sent", "accepted"] } }, select: { leadId: true, status: true, total: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const demoBy = new Map<string, Date>();
  for (const d of demos) if (!demoBy.has(d.leadId)) demoBy.set(d.leadId, d.scheduledAt);
  const quoteBy = new Map<string, { status: string; total: number }>();
  for (const q of quotes) if (!quoteBy.has(q.leadId)) quoteBy.set(q.leadId, { status: q.status, total: q.total });
  return toCards(leads, demoBy, quoteBy, start, end, now).sort((a, b) => b.attention - a.attention);
}
