import "server-only";
import { getDb } from "@/lib/db";
import { categoryBucket } from "@/lib/darwin/daily/verify";
import { localDate, startOfDay, addDays, todayIn } from "@/lib/activity/dates";
import { loadSettings, userTz } from "./crm";
import { STAGE_ORDER, NODES, nodeOf, type Range, type Stage } from "./types";

/**
 * Sales analytics, computed from the CRM's own records (stage history,
 * interactions, follow-ups, demos, quotations, clients, payments). Rates are
 * plain ratios with their numerator and denominator — no modelled numbers.
 */

export interface Rate { value: number | null; num: number; den: number }
const rate = (num: number, den: number): Rate => ({ value: den ? Math.round((num / den) * 1000) / 10 : null, num, den });

export function rangeDates(range: Range, tz: string, now = new Date(), custom?: { from?: string; to?: string }) {
  const today = todayIn(tz, +now);
  const days = { today: 0, "7d": 6, "30d": 29, "90d": 89 } as const;
  let from = range === "custom" && custom?.from ? custom.from : addDays(today, -(range === "custom" ? 29 : days[range]));
  let to = range === "custom" && custom?.to ? custom.to : today;
  if (from > to) [from, to] = [to, from];
  return { from, to, start: startOfDay(from, tz), end: startOfDay(addDays(to, 1), tz) };
}

export async function robinAnalytics(userId: string, range: Range, custom?: { from?: string; to?: string }, now = new Date()) {
  const db = getDb();
  const tz = await userTz(userId);
  const r = rangeDates(range, tz, now, custom);
  const inRange = { gte: r.start, lt: r.end };
  const [settings, leads, changes, interactions, followUps, demos, quotes, clients, payments] = await Promise.all([
    loadSettings(userId),
    db.robinLead.findMany({ where: { userId, createdAt: inRange }, select: { id: true, stage: true, source: true, category: true, createdAt: true } }),
    db.robinStageChange.findMany({ where: { userId, createdAt: { lt: r.end } }, select: { leadId: true, toStage: true, createdAt: true } }),
    db.robinInteraction.findMany({ where: { userId, occurredAt: { lt: r.end } }, select: { leadId: true, channel: true, direction: true, occurredAt: true } }),
    db.robinFollowUp.findMany({ where: { userId, dueAt: inRange }, select: { status: true, dueAt: true, completedAt: true } }),
    db.robinDemo.findMany({ where: { userId }, select: { leadId: true, scheduledAt: true, status: true, createdAt: true } }),
    db.robinQuotation.findMany({ where: { userId }, select: { leadId: true, status: true, total: true, createdAt: true, acceptedAt: true } }),
    db.robinClient.findMany({ where: { userId }, select: { leadId: true, amount: true, convertedAt: true } }),
    db.robinPayment.findMany({ where: { userId, paidAt: inRange }, select: { amount: true, paidAt: true } }),
  ]);

  // the cohort: leads that arrived in the range, and how far each one got
  const cohort = new Set(leads.map((l) => l.id));
  const furthest = new Map<string, number>();
  const bump = (id: string, s: string) => { const o = STAGE_ORDER[s as Stage]; if (o != null && o < 10) furthest.set(id, Math.max(furthest.get(id) ?? 0, o)); };
  for (const l of leads) bump(l.id, l.stage);
  for (const c of changes) if (cohort.has(c.leadId)) bump(c.leadId, c.toStage);
  const reachedOrder = (o: number) => leads.filter((l) => (furthest.get(l.id) ?? 0) >= o).length;
  const has = (rows: { leadId: string }[]) => new Set(rows.filter((x) => cohort.has(x.leadId)).map((x) => x.leadId));
  const replied = has(interactions.filter((i) => i.direction === "inbound"));
  const withDemo = has(demos);
  const withQuote = has(quotes);
  const total = leads.length;
  const qualified = reachedOrder(STAGE_ORDER.qualified);
  const contacted = reachedOrder(STAGE_ORDER.contacted);
  const interested = reachedOrder(STAGE_ORDER.interested);
  const wonCohort = leads.filter((l) => l.stage === "won").length;

  // deals decided IN the range (whenever the lead arrived)
  const wonIn = changes.filter((c) => c.toStage === "won" && c.createdAt >= r.start);
  const lostIn = changes.filter((c) => ["lost", "not_interested"].includes(c.toStage) && c.createdAt >= r.start);
  const clientsIn = clients.filter((c) => c.convertedAt >= r.start && c.convertedAt < r.end);
  const revenue = clientsIn.reduce((s, c) => s + c.amount, 0);
  const received = payments.reduce((s, p) => s + p.amount, 0);
  const fuDone = followUps.filter((f) => f.status === "completed").length;
  const fuOnTime = followUps.filter((f) => f.status === "completed" && f.completedAt && f.completedAt <= new Date(f.dueAt.getTime() + 86_400_000)).length;
  const fuMissed = followUps.filter((f) => f.status === "pending" && f.dueAt < now).length;

  // day buckets (weeks past 45 days)
  const dayCount = Math.round((+r.end - +r.start) / 86_400_000);
  const weekly = dayCount > 45;
  const buckets: string[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, weekly ? 7 : 1)) buckets.push(d);
  const keyOf = (t: Date) => {
    const d = localDate(t, tz);
    if (!weekly) return d;
    let k = buckets[0];
    for (const b of buckets) if (b <= d) k = b;
    return k;
  };
  const series = <T,>(rows: T[], at: (x: T) => Date, val: (x: T) => number = () => 1) => {
    const m = new Map(buckets.map((b) => [b, 0]));
    for (const x of rows) { const t = at(x); if (t >= r.start && t < r.end) { const k = keyOf(t); m.set(k, (m.get(k) ?? 0) + val(x)); } }
    return buckets.map((b) => m.get(b) ?? 0);
  };
  const out = (ch: string) => interactions.filter((i) => i.channel === ch && i.direction === "outbound");
  const activity = {
    labels: buckets,
    calls: series(out("call"), (i) => i.occurredAt),
    whatsapp: series(out("whatsapp"), (i) => i.occurredAt),
    instagram: series(out("instagram"), (i) => i.occurredAt),
    email: series(out("email"), (i) => i.occurredAt),
    followUps: series(followUps.filter((f) => f.completedAt), (f) => f.completedAt!),
    demos: series(demos.filter((d) => d.status === "completed"), (d) => d.scheduledAt),
    quotations: series(quotes, (q) => q.createdAt),
    conversions: series(clients, (c) => c.convertedAt),
  };
  const revenueSeries = { labels: buckets, won: series(clients, (c) => c.convertedAt, (c) => c.amount), received: series(payments, (p) => p.paidAt, (p) => p.amount) };

  const count = (key: (l: (typeof leads)[number]) => string) => {
    const m = new Map<string, number>();
    for (const l of leads) m.set(key(l), (m.get(key(l)) ?? 0) + 1);
    return [...m.entries()].map(([label, n]) => ({ label, count: n })).sort((a, b) => b.count - a.count);
  };

  // funnel by chart node (how many of the cohort reached each step)
  const nodeOrder = (id: string) => Math.min(...NODES.find((n) => n.id === id)!.stages.map((s) => STAGE_ORDER[s as Stage]));
  const funnel: { id: string; label: string; count: number }[] = NODES.filter((n) => n.id !== "lost").sort((a, b) => nodeOrder(a.id) - nodeOrder(b.id)).map((n) => ({ id: n.id, label: n.label, count: n.id === "won" ? wonCohort : reachedOrder(nodeOrder(n.id)) }));
  funnel.push({ id: "lost", label: "REJECTED", count: leads.filter((l) => nodeOf(l.stage) === "lost").length });

  return {
    range: { kind: range, from: r.from, to: r.to, weekly },
    currency: settings.currency,
    totals: { leads: total, qualified, contacted, interested, demos: withDemo.size, quotations: withQuote.size, won: wonIn.length, lost: lostIn.length, revenue, received, avgDeal: wonIn.length ? Math.round(revenue / Math.max(clientsIn.length, 1)) : null },
    rates: {
      contact: rate(contacted, total), response: rate(replied.size, contacted), interested: rate(interested, contacted),
      demo: rate(withDemo.size, interested), quotation: rate(withQuote.size, interested), conversion: rate(wonCohort, total),
      followUpCompletion: rate(fuDone, fuDone + fuMissed),
    },
    funnel,
    activity,
    revenueSeries,
    sources: count((l) => l.source),
    categories: count((l) => categoryBucket(l.category)),
    wonLost: { won: wonIn.length, lost: lostIn.length },
    followUps: { completed: fuDone, onTime: fuOnTime, missed: fuMissed, scheduled: followUps.length },
  };
}
export type RobinAnalytics = Awaited<ReturnType<typeof robinAnalytics>>;
