import "server-only";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { dayBounds, loadSettings, userTz } from "./crm";
import { robinOverview } from "./overview";
import { money } from "./types";

/**
 * "Robin, what's my day?" and the once-a-day morning report. Every number is a
 * count from the CRM; anything that is zero is simply left out, never padded.
 */

export interface Briefing {
  newFromDarwin: number;
  highPriority: number;
  calls: number;
  followUps: number;
  overdue: number;
  demos: { name: string; at: string }[];
  quotationsAwaiting: number;
  next: string | null;
  yesterday: { calls: number; messages: number; stageChanges: number; quotations: number; won: number; revenue: number };
  text: string;
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export async function robinBriefing(userId: string, now = new Date()): Promise<Briefing> {
  const db = getDb();
  const tz = await userTz(userId);
  const today = dayBounds(tz, now);
  const yday = dayBounds(tz, now, -1);
  const [ov, settings, newFromDarwin, demosToday, yInteractions, yChanges, yQuotes, yClients] = await Promise.all([
    robinOverview(userId, now),
    loadSettings(userId),
    db.robinLead.count({ where: { userId, source: "darwin", createdAt: { gte: yday.start } } }),
    db.robinDemo.findMany({ where: { userId, status: { in: ["scheduled", "rescheduled"] }, scheduledAt: { gte: today.start, lt: today.end } }, include: { lead: { select: { businessName: true } } }, orderBy: { scheduledAt: "asc" } }),
    db.robinInteraction.findMany({ where: { userId, direction: "outbound", occurredAt: { gte: yday.start, lt: yday.end } }, select: { channel: true } }),
    db.robinStageChange.findMany({ where: { userId, source: { not: "darwin" }, createdAt: { gte: yday.start, lt: yday.end } }, select: { toStage: true } }),
    db.robinQuotation.count({ where: { userId, createdAt: { gte: yday.start, lt: yday.end } } }),
    db.robinClient.findMany({ where: { userId, convertedAt: { gte: yday.start, lt: yday.end } }, select: { amount: true } }),
  ]);
  const time = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const b: Omit<Briefing, "text"> = {
    newFromDarwin,
    highPriority: ov.today.highPriority,
    calls: ov.today.calls,
    followUps: ov.today.followUps,
    overdue: ov.today.overdue,
    demos: demosToday.map((d) => ({ name: d.lead.businessName, at: time(d.scheduledAt) })),
    quotationsAwaiting: ov.today.quotations,
    next: ov.overdueAdvice ?? (ov.next ? `Next: ${ov.next.name} — ${ov.next.text.toLowerCase()}, because ${ov.next.why}.` : null),
    yesterday: {
      calls: yInteractions.filter((i) => i.channel === "call").length,
      messages: yInteractions.filter((i) => i.channel !== "call").length,
      stageChanges: yChanges.length,
      quotations: yQuotes,
      won: yClients.length,
      revenue: yClients.reduce((s, c) => s + c.amount, 0),
    },
  };
  const lines: string[] = [];
  if (b.newFromDarwin) lines.push(`${n(b.newFromDarwin, "new lead")} arrived from Darwin.`);
  if (b.highPriority) lines.push(`${b.highPriority} ${b.highPriority === 1 ? "is" : "are"} high priority and not contacted yet.`);
  if (b.followUps || b.overdue) lines.push(`You have ${n(b.followUps, "follow-up")} today${b.overdue ? `, plus ${b.overdue} overdue` : ""}.`);
  if (b.calls) lines.push(`${n(b.calls, "call")} to make.`);
  if (b.demos.length) lines.push(`${n(b.demos.length, "demo")} scheduled: ${b.demos.map((d) => `${d.name} at ${d.at}`).join(", ")}.`);
  if (b.quotationsAwaiting) lines.push(`${n(b.quotationsAwaiting, "quotation")} ${b.quotationsAwaiting === 1 ? "is" : "are"} awaiting a response.`);
  if (b.next) lines.push(b.next);
  const y = b.yesterday;
  const ybits = [y.calls && n(y.calls, "call"), y.messages && n(y.messages, "message"), y.quotations && n(y.quotations, "quotation"), y.won && `${n(y.won, "client")} won (${money(y.revenue, settings.currency)})`].filter(Boolean);
  if (ybits.length) lines.push(`Yesterday: ${ybits.join(", ")}.`);
  const text = lines.length ? lines.join(" ") : ov.counts.total ? "Your pipeline is quiet today — nothing is due." : "Your CRM is empty. Leads arrive here as soon as Darwin finds them.";
  return { ...b, text };
}

/** The morning report — once per day, the first time Robin opens (if it's on in Settings). */
export async function morningReport(userId: string, now = new Date()): Promise<{ due: boolean; text: string | null }> {
  const db = getDb();
  const settings = await loadSettings(userId);
  if (!settings.morningReport) return { due: false, text: null };
  const tz = await userTz(userId);
  const { date } = dayBounds(tz, now);
  const row = await db.robinSettings.findUnique({ where: { userId } });
  const data = (row?.data ?? {}) as Record<string, unknown>;
  if (data.lastMorningReport === date) return { due: false, text: null };
  // claim today's report first so two tabs don't both say it
  const merged = { ...settings, ...data, lastMorningReport: date } as unknown as Prisma.InputJsonValue;
  await db.robinSettings.upsert({ where: { userId }, create: { userId, data: merged }, update: { data: merged } });
  const b = await robinBriefing(userId, now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return { due: true, text: `${greet}. Here's your sales briefing. ${b.text}` };
}
