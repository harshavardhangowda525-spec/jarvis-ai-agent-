import "server-only";
import { getDb } from "@/lib/db";
import { addDays, dayLabel, isDate, localDate, rangeBounds, todayIn, validTz, yesterdayIn, type DayRange } from "@/lib/activity/dates";
import { buildBriefing, type Briefing } from "./build";

/**
 * Loads REAL recorded activity for a range of the user's local days and builds
 * the briefing. Completed days are also stored as a DailySummary (refreshed
 * when more activity for that day turns up later).
 */
export async function loadBriefing(userId: string, range: DayRange, tzIn: string, now = Date.now()): Promise<Briefing> {
  const db = getDb();
  const tz = validTz(tzIn);
  const { start, end } = rangeBounds(range.from, range.to, tz);
  const soon = new Date(end.getTime() + 2 * 86_400_000);
  const includesRecent = range.to >= yesterdayIn(tz, now);

  const [events, completed, remaining, anyTask, followUps, evReady, first, profile] = await Promise.all([
    db.activityEvent.findMany({
      where: { userId, timestamp: { gte: start, lt: end } }, orderBy: { timestamp: "asc" }, take: 5000,
      select: { id: true, timestamp: true, category: true, agent: true, action: true, result: true, status: true, importance: true, project: true, source: true, metadata: true },
    }),
    db.task.findMany({ where: { userId, completedAt: { gte: start, lt: end } }, select: { title: true, priority: true, completedAt: true }, take: 200 }),
    // open at the end of the range: created before it ended and not completed by then
    db.task.findMany({
      where: { userId, createdAt: { lt: end }, OR: [{ status: "pending" }, { completedAt: { gte: end } }] },
      orderBy: [{ priority: "desc" }, { dueAt: "asc" }], select: { title: true, priority: true, dueAt: true }, take: 200,
    }),
    db.task.count({ where: { userId, createdAt: { lt: end } } }),
    includesRecent ? db.darwinFollowUp.findMany({
      where: { userId, status: "pending", dueAt: { gte: end, lt: soon } }, orderBy: { dueAt: "asc" }, take: 5,
      select: { dueAt: true, lead: { select: { businessName: true } } },
    }).catch(() => []) : [],
    includesRecent ? db.evContent.count({ where: { userId, status: "ready" } }).catch(() => 0) : 0,
    db.activityEvent.findFirst({ where: { userId }, orderBy: { timestamp: "asc" }, select: { timestamp: true } }),
    db.profile.findUnique({ where: { userId }, select: { displayName: true } }),
  ]);

  const briefing = buildBriefing({
    ...range, tz, now, events,
    tasks: { completed, remaining, used: anyTask > 0 },
    followUpsSoon: followUps.map((f) => ({ business: f.lead?.businessName ?? "a lead", dueAt: f.dueAt })),
    evAwaitingApproval: evReady,
    recordedSince: first ? localDate(first.timestamp, tz) : null,
    userName: profile?.displayName ?? null,
  });

  if (range.kind === "day" && range.from < todayIn(tz, now)) await storeDaily(userId, range.from, tz, briefing, events.at(-1)?.timestamp ?? null);
  return briefing;
}

async function storeDaily(userId: string, date: string, tz: string, b: Briefing, lastEventAt: Date | null) {
  try {
    const db = getDb();
    const cur = await db.dailySummary.findUnique({ where: { userId_date: { userId, date } }, select: { eventCount: true, lastEventAt: true } });
    if (cur && cur.eventCount === b.eventCount && +(cur.lastEventAt ?? 0) === +(lastEventAt ?? 0)) return;
    const data = { ...b.daily, metrics: b.metrics, agents: b.agents.filter((a) => a.status !== "inactive"), insights: b.insights };
    const stats = { metrics: b.metrics, completion: b.completion, timeline: b.timeline };
    await db.dailySummary.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, timezone: tz, data: data as object, narrative: b.spoken, stats: stats as object, eventCount: b.eventCount, lastEventAt },
      update: { timezone: tz, data: data as object, narrative: b.spoken, stats: stats as object, eventCount: b.eventCount, lastEventAt, generatedAt: new Date() },
    });
  } catch (e) {
    console.error("[briefing] store daily summary failed:", e instanceof Error ? e.message : e);
  }
}

/** Resolve query params to a day range (default: yesterday in the user's timezone). */
export function rangeFromParams(sp: URLSearchParams, tz: string, now = Date.now()): DayRange {
  const from = sp.get("from"), to = sp.get("to");
  if (from && isDate(from)) {
    const t = to && isDate(to) && to >= from ? to : from;
    const days = Math.round((Date.parse(t) - Date.parse(from)) / 86_400_000);
    if (days > 62) return { from: addDays(t, -62), to: t, label: `${dayLabel(addDays(t, -62))} – ${dayLabel(t)}`, kind: "range" };
    return t === from
      ? { from, to: t, label: from === yesterdayIn(tz, now) ? "Yesterday" : dayLabel(from, { weekday: true }), kind: "day" }
      : { from, to: t, label: sp.get("label") || `${dayLabel(from)} – ${dayLabel(t)}`, kind: "range" };
  }
  const y = yesterdayIn(tz, now);
  return { from: y, to: y, label: "Yesterday", kind: "day" };
}

/** End-of-day job: store yesterday's summary for everyone with recorded activity. */
export async function summarizeYesterdayForAll(now = Date.now()) {
  const db = getDb();
  const since = new Date(now - 3 * 86_400_000);
  const users = await db.activityEvent.findMany({ where: { timestamp: { gte: since } }, distinct: ["userId"], select: { userId: true } });
  let stored = 0;
  for (const { userId } of users) {
    const p = await db.profile.findUnique({ where: { userId }, select: { timezone: true } });
    const tz = validTz(p?.timezone);
    const y = yesterdayIn(tz, now);
    try { await loadBriefing(userId, { from: y, to: y, label: "Yesterday", kind: "day" }, tz, now); stored++; } catch { /* next user */ }
  }
  return { users: users.length, stored };
}
