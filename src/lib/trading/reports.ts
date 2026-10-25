import "server-only";
import type { Prisma, TradingReport } from "@prisma/client";
import { getDb } from "@/lib/db";
import { agentConfigs } from "@/lib/ai/agent";
import { completeWithFallback } from "@/lib/ai/complete";
import { getLiveBrain } from "@/lib/ai/brain";
import { extractJson } from "@/lib/aston/build";
import { recordActivity } from "@/lib/activity/record";
import { notifySelf } from "@/lib/notify/channels";
import { publicBase } from "@/lib/public-url";
import { computeWeek, weekRow, type WeekMetrics, type WeekRow } from "./analyze";
import { allowedNumbers, factsFor, narrativeSchema, rulesNarrative, SYSTEM, unknownNumbers, type Narrative } from "./narrative";
import { loadPlaybook, NoPlaybookSource, type PlaybookSnapshot } from "./source";
import { latestDueWeek, weekLabel, weekOf, weeksBack, type Week } from "./week";

/**
 * MIKE's weekly trading review. One report per IST week (Monday–Sunday), due
 * Sunday 18:00 IST. The row is the lock, so many callers (Vercel cron, the
 * local tick, a button) can ask at once and only one generates. Regenerating
 * keeps every earlier version as a revision.
 */

export type Ask = (system: string, user: string) => Promise<{ text: string; provider: string }>;

const db = () => getDb();
const LEASE_MS = 5 * 60_000;
export const REVIEW_HOUR = 18;
const HISTORY_WEEKS = 6;

async function defaultAsk(userId: string): Promise<Ask | null> {
  const brain = await getLiveBrain(userId).catch(() => null);
  const pick = agentConfigs("mike", brain);
  if (!pick.configs.length) return null;
  return async (system, user) => ({ text: await completeWithFallback(pick.configs, system, user, { maxTokens: 2500, timeoutMs: 180_000 }), provider: pick.configs[0].provider });
}

export async function tradingSettings(userId: string) {
  return (await db().tradingSettings.findUnique({ where: { userId } })) ?? { userId, weeklyEnabled: true, notifyEmail: false, notifyWhatsapp: false, backup: null, backupAt: null, updatedAt: new Date(0) };
}

/** Write the narrative: AI first (checked against the facts), the rule-based write-up otherwise. */
export async function writeNarrative(m: WeekMetrics, history: WeekRow[], ask: Ask | null): Promise<Narrative> {
  const rules = rulesNarrative(m, history);
  if (!ask) return { ...rules, by: "rules", rejected: "No AI provider is configured for MIKE." };
  const facts = factsFor(m, history);
  let problem = "";
  try {
    const reply = await ask(SYSTEM, `FACTS (JSON):\n${JSON.stringify(facts)}\n\nWrite the weekly review JSON now.`);
    const parsed = narrativeSchema.safeParse(extractJson(reply.text));
    if (!parsed.success) problem = `The AI reply didn't match the review format (${parsed.error.issues[0]?.path.join(".")}).`;
    else {
      const bad = unknownNumbers(parsed.data, allowedNumbers(facts));
      if (bad.length) problem = `The AI reply used numbers that aren't in your records (${bad.slice(0, 5).join(", ")}), so it was discarded.`;
      else return { ...parsed.data, by: "ai", provider: reply.provider };
    }
  } catch (e) {
    problem = `The AI couldn't write the review (${String((e as Error).message).slice(0, 160)}).`;
  }
  return { ...rules, by: "rules", rejected: problem };
}

function sourceInfo(s: PlaybookSnapshot) {
  return { kind: s.kind, fetchedAt: s.fetchedAt, asOf: s.asOf, counts: s.counts, note: s.note ?? null };
}

/**
 * Make (or remake) one week's report. Returns the row — `ready`, `failed`, or
 * `unavailable` (no playbook data source; nothing is made up in its place).
 */
export async function generateWeekly(
  userId: string,
  week: Week,
  o: { trigger?: "scheduled" | "catch_up" | "manual"; ask?: Ask | null; snapshot?: PlaybookSnapshot; now?: Date; force?: boolean } = {},
): Promise<TradingReport> {
  const now = o.now ?? new Date();
  const trigger = o.trigger ?? "manual";
  let row = await db().tradingReport.findUnique({ where: { userId_weekStart: { userId, weekStart: week.start } } });
  if (row?.status === "ready" && !o.force) return row;
  if (!row) {
    try {
      row = await db().tradingReport.create({ data: { userId, weekStart: week.start, weekEnd: week.end, status: "generating", trigger, leaseUntil: new Date(now.getTime() + LEASE_MS) } });
    } catch {
      return (await db().tradingReport.findUnique({ where: { userId_weekStart: { userId, weekStart: week.start } } }))!;
    }
  } else {
    const claimed = await db().tradingReport.updateMany({
      where: { id: row.id, OR: [{ status: { not: "generating" } }, { leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { status: "generating", trigger, leaseUntil: new Date(now.getTime() + LEASE_MS), error: null },
    });
    if (!claimed.count) return row;
  }

  try {
    let snap: PlaybookSnapshot;
    try {
      snap = o.snapshot ?? (await loadPlaybook(userId, { fresh: trigger === "manual" }));
    } catch (e) {
      if (e instanceof NoPlaybookSource) {
        return await db().tradingReport.update({ where: { id: row.id }, data: { status: "unavailable", error: e.detail, leaseUntil: null } });
      }
      throw e;
    }
    const metrics = computeWeek(snap.dump, week);
    const history = weeksBack(week, HISTORY_WEEKS).map((w) => weekRow(w.start === week.start ? metrics : computeWeek(snap.dump, w)));
    const ask = o.ask === undefined ? await defaultAsk(userId) : o.ask;
    const narrative = await writeNarrative(metrics, history, ask);
    const revision = row.revision + 1;
    const source = sourceInfo(snap);
    const content = { metrics: { ...metrics, history } as unknown as Prisma.InputJsonValue, narrative: narrative as unknown as Prisma.InputJsonValue, source: source as unknown as Prisma.InputJsonValue };
    const [saved] = await db().$transaction([
      db().tradingReport.update({ where: { id: row.id }, data: { ...content, status: "ready", revision, generatedAt: new Date(), leaseUntil: null, error: null } }),
      db().tradingReportRevision.create({ data: { reportId: row.id, revision, trigger, ...content } }),
    ]);
    void recordActivity(userId, {
      category: "notice", agent: "MIKE", status: "success", importance: 3, source: "trading-weekly",
      action: `Weekly trading review ready — ${weekLabel(week)}${revision > 1 ? ` (revision ${revision})` : ""}`,
      result: narrative.executiveSummary.slice(0, 300),
    });
    return saved;
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 500);
    return db().tradingReport.update({ where: { id: row.id }, data: { status: "failed", error: msg, leaseUntil: null } });
  }
}

export function reviewMessage(r: TradingReport, url: string | null): string {
  const n = r.narrative as unknown as Narrative | null;
  return [
    `MIKE · Weekly trading review (${weekLabel({ start: r.weekStart, end: r.weekEnd })})`,
    n?.executiveSummary ?? "",
    n?.nextWeek?.length ? `Next week:\n${n.nextWeek.slice(0, 3).map((x) => `• ${x.action}`).join("\n")}` : "",
    "Simulated / historical results only — not live trading.",
    url ? `Open: ${url}` : "Open it in JARVIS → Trading Intelligence.",
  ].filter(Boolean).join("\n\n");
}

/** Send the "review ready" notice once per report, on the channels you switched on. */
export async function notifyReport(r: TradingReport): Promise<void> {
  const claimed = await db().tradingReport.updateMany({ where: { id: r.id, notifiedAt: null, status: "ready" }, data: { notifiedAt: new Date() } });
  if (!claimed.count) return;
  const st = await tradingSettings(r.userId);
  const base = await publicBase(r.userId).catch(() => null);
  const url = base ? `${base}/dashboard/trading?week=${r.weekStart}` : null;
  const log = await notifySelf(r.userId, { whatsapp: st.notifyWhatsapp, email: st.notifyEmail }, `Weekly trading review — ${weekLabel({ start: r.weekStart, end: r.weekEnd })}`, reviewMessage(r, url));
  await db().tradingReport.update({ where: { id: r.id }, data: { notifyLog: log as unknown as Prisma.InputJsonValue } });
}

/**
 * The scheduled run (hourly ticks are fine — it's idempotent). For each user
 * with the weekly review on: the latest week whose Sunday 18:00 IST has passed,
 * plus any earlier weeks missed since the last report (at most 4).
 */
export async function runDueWeekly(o: { now?: Date; ask?: Ask | null; userIds?: string[]; notify?: boolean } = {}) {
  const now = o.now ?? new Date();
  const due = latestDueWeek(now.getTime(), REVIEW_HOUR);
  const users = await db().user.findMany({ where: o.userIds ? { id: { in: o.userIds } } : {}, select: { id: true } });
  const out: { userId: string; week: string; status: string; trigger: string; fresh?: boolean }[] = [];
  for (const u of users) {
    const st = await tradingSettings(u.id);
    if (!st.weeklyEnabled) { out.push({ userId: u.id, week: due.start, status: "disabled", trigger: "scheduled" }); continue; }
    const last = await db().tradingReport.findFirst({ where: { userId: u.id, status: "ready" }, orderBy: { weekStart: "desc" }, select: { weekStart: true } });
    const weeks = last
      ? weeksBack(due, 4).filter((w) => w.start > last.weekStart || w.start === due.start)
      : [due];
    for (const w of weeks) {
      const existing = await db().tradingReport.findUnique({ where: { userId_weekStart: { userId: u.id, weekStart: w.start } } });
      if (existing?.status === "ready") { out.push({ userId: u.id, week: w.start, status: "ready", trigger: existing.trigger }); continue; }
      // an unavailable/failed week is retried at most hourly
      if (existing && existing.status !== "generating" && now.getTime() - existing.updatedAt.getTime() < 55 * 60_000) { out.push({ userId: u.id, week: w.start, status: existing.status, trigger: existing.trigger }); continue; }
      const trigger = w.start === due.start && now.getTime() - Date.parse(`${due.end}T12:30:00Z`) < 3 * 3600_000 ? "scheduled" : "catch_up";
      const r = await generateWeekly(u.id, w, { trigger, ask: o.ask, now });
      if (r.status === "ready" && o.notify !== false) await notifyReport(r).catch((e) => console.error("[trading] notify failed:", e));
      out.push({ userId: u.id, week: w.start, status: r.status, trigger, fresh: r.status === "ready" });
    }
  }
  return out;
}

export function reportView(r: TradingReport & { revisions?: { revision: number; trigger: string; createdAt: Date }[] }) {
  return {
    id: r.id, weekStart: r.weekStart, weekEnd: r.weekEnd, label: weekLabel({ start: r.weekStart, end: r.weekEnd }),
    status: r.status, revision: r.revision, trigger: r.trigger, error: r.error,
    generatedAt: r.generatedAt?.toISOString() ?? null, notifiedAt: r.notifiedAt?.toISOString() ?? null,
    metrics: r.metrics as unknown as (WeekMetrics & { history: WeekRow[] }) | null,
    narrative: r.narrative as unknown as Narrative | null,
    source: r.source as unknown as ReturnType<typeof sourceInfo> | null,
    notifyLog: (r.notifyLog ?? []) as unknown[],
    revisions: r.revisions?.map((v) => ({ revision: v.revision, trigger: v.trigger, createdAt: v.createdAt.toISOString() })) ?? [],
  };
}

export async function listReports(userId: string) {
  const rows = await db().tradingReport.findMany({ where: { userId }, orderBy: { weekStart: "desc" }, take: 60, select: { id: true, weekStart: true, weekEnd: true, status: true, revision: true, generatedAt: true } });
  return rows.map((r) => ({ ...r, label: weekLabel({ start: r.weekStart, end: r.weekEnd }), generatedAt: r.generatedAt?.toISOString() ?? null }));
}

export async function getReport(userId: string, weekStart?: string, revision?: number) {
  const r = weekStart
    ? await db().tradingReport.findUnique({ where: { userId_weekStart: { userId, weekStart } }, include: { revisions: { orderBy: { revision: "desc" }, select: { revision: true, trigger: true, createdAt: true } } } })
    : await db().tradingReport.findFirst({ where: { userId }, orderBy: { weekStart: "desc" }, include: { revisions: { orderBy: { revision: "desc" }, select: { revision: true, trigger: true, createdAt: true } } } });
  if (!r) return null;
  const view = reportView(r);
  if (revision && revision !== r.revision) {
    const v = await db().tradingReportRevision.findUnique({ where: { reportId_revision: { reportId: r.id, revision } } });
    if (v) return { ...view, revision: v.revision, trigger: v.trigger, generatedAt: v.createdAt.toISOString(), metrics: v.metrics as never, narrative: v.narrative as never, source: v.source as never, viewingOld: true };
  }
  return { ...view, viewingOld: false };
}

/** "Generate Weekly Analysis": the week that's due now, or a given week; always a fresh read of the playbook. */
export async function generateNow(userId: string, weekStart?: string, ask?: Ask | null) {
  const week = weekStart ? weekOf(weekStart) : latestDueWeek(Date.now(), REVIEW_HOUR);
  return generateWeekly(userId, week, { trigger: "manual", force: true, ask });
}

/** The current (not yet finished) week, computed live — shown as a preview, never stored as a report. */
export async function currentWeekPreview(userId: string) {
  const snap = await loadPlaybook(userId);
  const w = weekOf(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  const metrics = computeWeek(snap.dump, w);
  return { week: w, label: weekLabel(w), metrics, source: sourceInfo(snap) };
}
