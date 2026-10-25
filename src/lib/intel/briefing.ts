import "server-only";
import { z } from "zod";
import type { IntelBriefing, IntelItem, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { agentConfigs } from "@/lib/ai/agent";
import { completeWithFallback } from "@/lib/ai/complete";
import { getLiveBrain } from "@/lib/ai/brain";
import { extractJson } from "@/lib/aston/build";
import { recordActivity } from "@/lib/activity/record";
import { notifySelf } from "@/lib/notify/channels";
import { publicBase } from "@/lib/public-url";
import { allowedNumbers } from "@/lib/trading/narrative";
import { istDate, istInstant, latestDueWeek, weekLabel, type Week } from "@/lib/trading/week";
import { analyzePending, type Ask, type ItemAnalysis } from "./analyze";
import { intelSettings, refreshIntel, type RefreshReport } from "./collect";
import { internalSnapshot } from "./internal";
import { detectOpportunities, SCORE_RULE } from "./opportunities";
import { BUSINESS, CATEGORIES } from "./topics";

/**
 * Business briefings: daily at 08:00 IST (period = the IST date) and weekly on
 * Sunday 19:00 IST (period = the Monday of that week). One row per user, kind
 * and period is the lock; a regenerate bumps the revision. Every headline is
 * a stored item with its publisher, date and link; the summary cites them as
 * [n] and is discarded if it cites something missing or uses unknown numbers.
 */

const db = () => getDb();
const LEASE_MS = 6 * 60_000;
export const DAILY_HOUR = 8;
export const WEEKLY_HOUR = 19;
export type Kind = "daily" | "weekly";

export async function defaultAsk(userId: string): Promise<{ ask: Ask; provider: string } | null> {
  const brain = await getLiveBrain(userId).catch(() => null);
  const pick = agentConfigs("jarvis", brain);
  if (!pick.configs.length) return null;
  return { ask: (s, u) => completeWithFallback(pick.configs, s, u, { maxTokens: 4000, timeoutMs: 150_000 }), provider: pick.configs[0].provider };
}

const summarySchema = z.object({
  summary: z.string().min(20).max(2500),
  actions: z.array(z.object({ action: z.string().max(300), cite: z.array(z.coerce.number().int()).default([]) })).max(6).default([]),
  risks: z.array(z.object({ text: z.string().max(300), cite: z.array(z.coerce.number().int()).default([]) })).max(6).default([]),
});
export type Summary = z.infer<typeof summarySchema> & { by: "ai" | "rules"; provider?: string; rejected?: string };

const SUMMARY_SYSTEM = `You write JARVIS's business briefing for ${BUSINESS.name}, ${BUSINESS.what}.
Use ONLY the numbered headlines and analyses given. Cite every claim with its number in square brackets, e.g. [2]. Never add facts, numbers, companies or dates that aren't in them. Be brief and practical.
Reply with ONE JSON object: {"summary": string (3–6 sentences with [n] citations), "actions": [{"action": string, "cite": [n]}], "risks": [{"text": string, "cite": [n]}]}`;

type Headline = { n: number; itemId: string; title: string; publisher: string | null; url: string; publishedAt: string | null; category: string | null; importance: number | null; relevance: number | null; via: string; analysis: ItemAnalysis | null };

function headline(it: IntelItem, n: number): Headline {
  return { n, itemId: it.id, title: it.title, publisher: it.publisher, url: it.url, publishedAt: it.publishedAt?.toISOString() ?? null, category: it.category, importance: it.importance, relevance: it.relevance, via: it.via, analysis: (it.analysis ?? null) as unknown as ItemAnalysis | null };
}

export function rulesSummary(hs: Headline[]): z.infer<typeof summarySchema> {
  if (!hs.length) return { summary: "No new external developments were collected for this period.", actions: [], risks: [] };
  const top = hs.slice(0, 4);
  return {
    summary: top.map((h) => `${h.title} (${h.publisher ?? "source"}) [${h.n}].`).join(" "),
    actions: top.filter((h) => h.analysis?.recommendedAction).slice(0, 3).map((h) => ({ action: h.analysis!.recommendedAction, cite: [h.n] })),
    risks: hs.filter((h) => h.analysis?.risk && (h.importance ?? 0) >= 3).slice(0, 3).map((h) => ({ text: h.analysis!.risk, cite: [h.n] })),
  };
}

export async function writeSummary(hs: Headline[], ai: { ask: Ask; provider: string } | null): Promise<Summary> {
  const rules = rulesSummary(hs);
  if (!ai || !hs.length) return { ...rules, by: "rules", rejected: ai ? undefined : "No AI provider is configured." };
  const facts = hs.map((h) => ({ n: h.n, headline: h.title, publisher: h.publisher, date: h.publishedAt?.slice(0, 10), analysis: h.analysis && { whatHappened: h.analysis.whatHappened, whyItMatters: h.analysis.whyItMatters, opportunity: h.analysis.opportunity, risk: h.analysis.risk, action: h.analysis.recommendedAction } }));
  try {
    const p = summarySchema.safeParse(extractJson(await ai.ask(SUMMARY_SYSTEM, `HEADLINES:\n${JSON.stringify(facts)}`)));
    if (!p.success) return { ...rules, by: "rules", rejected: "The AI summary didn't match the briefing format." };
    const ns = new Set(hs.map((h) => h.n));
    const text = [p.data.summary, ...p.data.actions.map((a) => a.action), ...p.data.risks.map((r) => r.text)].join(" ");
    const cited = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).concat(p.data.actions.flatMap((a) => a.cite), p.data.risks.flatMap((r) => r.cite));
    if (cited.some((c) => !ns.has(c))) return { ...rules, by: "rules", rejected: "The AI summary cited a headline that isn't in the briefing, so it was discarded." };
    if (!/\[\d+\]/.test(p.data.summary)) return { ...rules, by: "rules", rejected: "The AI summary had no citations, so it was discarded." };
    const allowed = allowedNumbers(facts);
    const bad = (text.replace(/\[\d+\]/g, "").replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).filter((x) => !allowed.has(x) && !allowed.has(String(Number(x))));
    if (bad.length) return { ...rules, by: "rules", rejected: `The AI summary used numbers not in the sources (${[...new Set(bad)].slice(0, 4).join(", ")}), so it was discarded.` };
    return { ...p.data, by: "ai", provider: ai.provider };
  } catch (e) {
    return { ...rules, by: "rules", rejected: `The AI couldn't write the summary (${String((e as Error).message).slice(0, 120)}).` };
  }
}

function windowFor(kind: Kind, period: string): { from: Date; to: Date } {
  if (kind === "daily") return { from: new Date(istInstant(period, DAILY_HOUR) - 36 * 3600_000), to: new Date(istInstant(period, DAILY_HOUR) + 3600_000) };
  const end = new Date(Date.parse(`${period}T00:00:00Z`) + 7 * 86_400_000);
  return { from: new Date(istInstant(period, 0)), to: new Date(istInstant(end.toISOString().slice(0, 10), WEEKLY_HOUR)) };
}

async function itemsIn(userId: string, from: Date, to: Date) {
  return db().intelItem.findMany({ where: { userId, OR: [{ publishedAt: { gte: from, lte: to } }, { publishedAt: null, fetchedAt: { gte: from, lte: to } }] } });
}

const rank = (it: IntelItem) => (it.importance ?? 2) * (it.relevance ?? 2) + (it.via === "youtube" ? 0 : 0.1);

export async function generateBriefing(
  userId: string, kind: Kind, period: string,
  o: { trigger?: "scheduled" | "catch_up" | "manual"; ai?: { ask: Ask; provider: string } | null; force?: boolean; now?: Date; refresh?: boolean; fetch?: typeof fetch } = {},
): Promise<IntelBriefing> {
  const now = o.now ?? new Date();
  const trigger = o.trigger ?? "manual";
  const where = { userId_kind_period: { userId, kind, period } };
  let row = await db().intelBriefing.findUnique({ where });
  if (row?.status === "ready" && !o.force) return row;
  if (!row) {
    try { row = await db().intelBriefing.create({ data: { userId, kind, period, status: "generating", trigger, leaseUntil: new Date(now.getTime() + LEASE_MS) } }); }
    catch { return (await db().intelBriefing.findUnique({ where }))!; }
  } else {
    const c = await db().intelBriefing.updateMany({ where: { id: row.id, OR: [{ status: { not: "generating" } }, { leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { status: "generating", trigger, leaseUntil: new Date(now.getTime() + LEASE_MS), error: null } });
    if (!c.count) return row;
  }
  try {
    const ai = o.ai === undefined ? await defaultAsk(userId) : o.ai;
    let refresh: RefreshReport | null = null;
    if (o.refresh !== false) refresh = await refreshIntel(userId, { now, fetch: o.fetch });
    let analysis: Awaited<ReturnType<typeof analyzePending>> | null = null;
    if (ai) {
      analysis = await analyzePending(userId, ai.ask, { provider: ai.provider });
      await detectOpportunities(userId, ai.ask, { now, days: kind === "weekly" ? 7 : 3 }).catch((e) => console.error("[intel] opportunities:", (e as Error).message));
    }
    const { from, to } = windowFor(kind, period);
    const items = (await itemsIn(userId, from, to)).sort((a, b) => rank(b) - rank(a));
    const hs = items.slice(0, kind === "weekly" ? 12 : 8).map((it, k) => headline(it, k + 1));
    const summary = await writeSummary(hs, ai);
    const opportunities = await db().intelOpportunity.findMany({ where: { userId, status: { not: "dismissed" }, updatedAt: { gte: from } }, orderBy: { score: "desc" }, take: 5 });
    const byCat = Object.fromEntries(CATEGORIES.map((c) => [c.id, items.filter((i) => i.category === c.id).length]));
    let trend: Record<string, { now: number; before: number }> | null = null;
    if (kind === "weekly") {
      const prevFrom = new Date(from.getTime() - 7 * 86_400_000);
      const prev = await itemsIn(userId, prevFrom, from);
      trend = Object.fromEntries(CATEGORIES.map((c) => [c.id, { now: byCat[c.id], before: prev.filter((i) => i.category === c.id).length }]));
    }
    const content = {
      kind, period, window: { from: from.toISOString(), to: to.toISOString() },
      summary, headlines: hs, byCategory: byCat, trend, itemsConsidered: items.length,
      opportunities: opportunities.map((x) => ({ id: x.id, title: x.title, score: x.score, detail: x.detail, evidence: x.evidence })),
      scoreRule: SCORE_RULE,
      internal: await internalSnapshot(userId, now).catch(() => null),
      analysis: analysis && { analyzed: analysis.analyzed, failed: analysis.failed, error: analysis.error ?? null },
    };
    const sources = refresh && { at: refresh.at, ok: refresh.sources.filter((s) => s.ok).length, failed: refresh.sources.filter((s) => !s.ok).map((s) => `${s.name}: ${s.error}`), youtube: refresh.youtube, tavily: refresh.tavily };
    const saved = await db().intelBriefing.update({ where: { id: row.id }, data: { status: "ready", revision: row.revision + 1, content: content as unknown as Prisma.InputJsonValue, sources: (sources ?? undefined) as Prisma.InputJsonValue | undefined, generatedAt: new Date(), leaseUntil: null, error: null } });
    void recordActivity(userId, { category: "notice", agent: "JARVIS", status: "success", importance: 3, source: "business-intel", action: `${kind === "daily" ? "Daily business briefing" : "Weekly business review"} ready — ${period}`, result: summary.summary.slice(0, 300) });
    return saved;
  } catch (e) {
    return db().intelBriefing.update({ where: { id: row.id }, data: { status: "failed", error: String((e as Error).message ?? e).slice(0, 500), leaseUntil: null } });
  }
}

export function briefingText(b: IntelBriefing, url: string | null) {
  const c = b.content as unknown as { summary: Summary; headlines: Headline[]; opportunities: { title: string; score: number }[] } | null;
  return [
    `JARVIS · ${b.kind === "daily" ? "Daily business briefing" : "Weekly business review"} — ${BUSINESS.name} (${b.period})`,
    c?.summary.summary ?? "",
    c?.headlines.length ? `Sources:\n${c.headlines.slice(0, 5).map((h) => `[${h.n}] ${h.title} — ${h.publisher ?? ""} ${h.url}`).join("\n")}` : "",
    c?.opportunities.length ? `Top opportunities:\n${c.opportunities.slice(0, 3).map((o) => `• ${o.title} (score ${o.score})`).join("\n")}` : "",
    url ? `Open: ${url}` : "Open it in JARVIS → Business Intelligence.",
  ].filter(Boolean).join("\n\n");
}

export async function notifyBriefing(b: IntelBriefing) {
  const claimed = await db().intelBriefing.updateMany({ where: { id: b.id, notifiedAt: null, status: "ready" }, data: { notifiedAt: new Date() } });
  if (!claimed.count) return;
  const st = await intelSettings(b.userId);
  const base = await publicBase(b.userId).catch(() => null);
  const url = base ? `${base}/dashboard/intel?briefing=${b.kind}:${b.period}` : null;
  const log = await notifySelf(b.userId, { whatsapp: st.notifyWhatsapp, email: st.notifyEmail }, `${b.kind === "daily" ? "Daily business briefing" : "Weekly business review"} — ${b.period}`, briefingText(b, url));
  await db().intelBriefing.update({ where: { id: b.id }, data: { notifyLog: log as unknown as Prisma.InputJsonValue } });
}

/** What is due now: today's daily (after 08:00 IST) and the latest weekly (after Sunday 19:00 IST). */
export function duePeriods(now: number): { daily: string | null; weekly: Week } {
  const today = istDate(now);
  return { daily: now >= istInstant(today, DAILY_HOUR) ? today : null, weekly: latestDueWeek(now, WEEKLY_HOUR) };
}

export async function runDueIntel(o: { now?: Date; ai?: { ask: Ask; provider: string } | null; userIds?: string[]; notify?: boolean; fetch?: typeof fetch } = {}) {
  const now = o.now ?? new Date();
  const due = duePeriods(now.getTime());
  const users = await db().user.findMany({ where: o.userIds ? { id: { in: o.userIds } } : {}, select: { id: true } });
  const out: { userId: string; kind: Kind; period: string; status: string; trigger: string; fresh?: boolean }[] = [];
  for (const u of users) {
    const st = await intelSettings(u.id);
    const todo: [Kind, string, boolean, number][] = [];
    if (st.dailyEnabled && due.daily) todo.push(["daily", due.daily, true, istInstant(due.daily, DAILY_HOUR)]);
    if (st.weeklyEnabled) todo.push(["weekly", due.weekly.start, true, istInstant(due.weekly.end, WEEKLY_HOUR)]);
    for (const [kind, period, , dueAt] of todo) {
      const ex = await db().intelBriefing.findUnique({ where: { userId_kind_period: { userId: u.id, kind, period } } });
      if (ex?.status === "ready") { out.push({ userId: u.id, kind, period, status: "ready", trigger: ex.trigger }); continue; }
      if (ex && ex.status !== "generating" && now.getTime() - ex.updatedAt.getTime() < 55 * 60_000) { out.push({ userId: u.id, kind, period, status: ex.status, trigger: ex.trigger }); continue; }
      const trigger = now.getTime() - dueAt < 90 * 60_000 ? "scheduled" : "catch_up";
      const b = await generateBriefing(u.id, kind, period, { trigger, ai: o.ai, now, fetch: o.fetch });
      if (b.status === "ready" && o.notify !== false) await notifyBriefing(b).catch((e) => console.error("[intel] notify failed:", e));
      out.push({ userId: u.id, kind, period, status: b.status, trigger, fresh: b.status === "ready" });
    }
    // keep the feed current between briefings (cached for 15 minutes)
    if (!todo.length || out.every((x) => x.userId !== u.id || !x.fresh)) await refreshIntel(u.id, { now, fetch: o.fetch }).catch(() => null);
  }
  return out;
}

export function briefingView(b: IntelBriefing) {
  return {
    id: b.id, kind: b.kind, period: b.period, label: b.kind === "daily" ? b.period : weekLabel({ start: b.period, end: new Date(Date.parse(`${b.period}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10) }),
    status: b.status, revision: b.revision, trigger: b.trigger, error: b.error, generatedAt: b.generatedAt?.toISOString() ?? null,
    content: b.content as unknown as Record<string, unknown> | null, sources: b.sources as unknown as Record<string, unknown> | null, notifyLog: (b.notifyLog ?? []) as unknown[],
  };
}
