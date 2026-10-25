import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { currentWeekPreview, generateNow, getReport, listReports } from "@/lib/trading/reports";
import { NoPlaybookSource } from "@/lib/trading/source";
import type { WeekMetrics, WeekRow } from "@/lib/trading/analyze";
import type { Narrative } from "@/lib/trading/narrative";

/**
 * MIKE's weekly review of your trading playbook — read-only. Answers come from
 * the stored report (or a live read of this week) and say which; nothing here
 * can place, change or cancel an order.
 */

const schema = z.object({
  action: z.enum(["latest", "week", "generate", "this_week", "strategy", "risk", "learning", "compare", "history"]).describe(
    "latest = the newest weekly review; week = a given week's review; generate = make/refresh the review now; this_week = this week so far (live, not a report); " +
    "strategy = one strategy's figures; risk = the risk audit with evidence; learning = 84-day plan and backtest progress; compare = week-over-week; history = list of reports",
  ),
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Any date in the week wanted (YYYY-MM-DD). Default: the latest."),
  strategy: z.enum(["trend", "breakout", "pullback", "range"]).optional().describe("A trend-following, B breakout, C pullback, D range-bound."),
});

const LINK = "/dashboard/trading";
const weekStartOf = (d?: string) => {
  if (!d) return undefined;
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};

function compact(m: WeekMetrics & { history?: WeekRow[] }) {
  return {
    labels: m.labels,
    backtests: { runs: m.backtests.runs, trades: m.backtests.trades, winRate: m.backtests.all.winRate, avgR: m.backtests.all.avgR, net: m.backtests.all.net, maxDrawdown: m.backtests.all.maxDrawdown },
    paper: { sessions: m.paper.sessions, trades: m.paper.trades, winRate: m.paper.all.winRate, avgR: m.paper.all.avgR, net: m.paper.all.net },
    strategies: m.strategies.map((s) => ({ id: s.id, name: `${s.letter} · ${s.name}`, data: s.status, verdict: s.verdict })),
    riskFindings: m.risk.findings.map((f) => ({ rule: f.rule, severity: f.severity, count: f.count })),
    discipline: m.discipline.score,
    learning: { lessonsThisWeek: m.learning.lessonsThisWeek.length, lessonsTotal: m.learning.lessonsTotal, behind: m.learning.behind, backtestTradesTotal: m.learning.backtestTradesTotal, goal: m.learning.backtestTarget },
    missing: m.missing,
  };
}

export const tradingReviewTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "trading_review",
  description:
    "MIKE's weekly trading review of the user's own trading playbook (ETF learning plan, backtests, paper trading, journal): strategy results, risk audit with evidence, learning and discipline, week-over-week comparison and next week's plan. " +
    "Read-only; results are historical/simulated, never live. Use for 'how did my trading practice go this week', 'generate my weekly trading analysis', 'how is my breakout strategy doing', 'did I break any risk rules'.",
  schema,
  activityLabel: "Reading your trading playbook",
  async execute(input, ctx) {
    const weekStart = weekStartOf(input.week);
    try {
      if (input.action === "history") {
        const list = await listReports(ctx.userId);
        return { data: { reports: list.slice(0, 12), link: LINK }, summary: `${list.length} weekly review${list.length === 1 ? "" : "s"}` };
      }
      if (input.action === "this_week") {
        ctx.activity("Reading this week's records…");
        const p = await currentWeekPreview(ctx.userId);
        return { data: { note: "This week so far — live from the playbook, not a finished report.", week: p.label, source: p.source.kind, ...compact(p.metrics), link: LINK }, summary: `This week so far (${p.label})` };
      }
      if (input.action === "generate") {
        ctx.activity("Analysing the week…");
        const r = await generateNow(ctx.userId, weekStart);
        if (r.status === "unavailable") throw new ToolError(r.error ?? "The trading playbook isn't connected.");
        if (r.status !== "ready") throw new ToolError(`The review couldn't be made: ${r.error ?? r.status}`);
      }
      const r = await getReport(ctx.userId, input.action === "generate" || input.action === "latest" ? weekStart : weekStart);
      if (!r) return { data: { none: true, note: "No weekly review yet. Say 'generate my weekly trading analysis' or open Trading Intelligence.", link: LINK }, summary: "No weekly review yet" };
      if (r.status === "unavailable") throw new ToolError(r.error ?? "The trading playbook isn't connected.");
      if (r.status !== "ready" || !r.metrics) return { data: { status: r.status, error: r.error, link: LINK }, summary: `Review ${r.status}` };
      const m = r.metrics;
      const n = r.narrative as Narrative | null;
      const base = { week: r.label, revision: r.revision, generatedAt: r.generatedAt, source: r.source?.kind, labels: m.labels, link: `${LINK}?week=${r.weekStart}` };
      switch (input.action) {
        case "strategy": {
          const s = m.strategies.find((x) => x.id === (input.strategy ?? "trend"))!;
          return { data: { ...base, strategy: s, note: n?.strategies.find((x) => x.id === s.id)?.note ?? s.verdict }, summary: `${s.letter} · ${s.name}: ${s.status}` };
        }
        case "risk":
          return { data: { ...base, rules: m.risk.rules, rulesSource: m.risk.rulesSource, findings: m.risk.findings, checked: m.risk.checked, summary: n?.risk }, summary: `${m.risk.findings.length} risk finding${m.risk.findings.length === 1 ? "" : "s"}` };
        case "learning":
          return { data: { ...base, learning: m.learning, journal: { entries: m.journal.entries, mistakes: m.journal.mistakes }, discipline: m.discipline, summary: n?.learning }, summary: `${m.learning.lessonsTotal}/84 lessons` };
        case "compare":
          return { data: { ...base, history: m.history, comparison: n?.comparison }, summary: "Week-over-week" };
        default:
          return { data: { ...base, ...compact(m), executiveSummary: n?.executiveSummary, nextWeek: n?.nextWeek, writtenBy: n?.by }, summary: `Weekly review — ${r.label}` };
      }
    } catch (e) {
      if (e instanceof NoPlaybookSource) throw new ToolError(e.detail);
      throw e;
    }
  },
};
