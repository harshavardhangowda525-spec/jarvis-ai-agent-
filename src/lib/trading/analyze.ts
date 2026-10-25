/**
 * The weekly review's numbers — pure calculations over your playbook's own
 * records for one IST week. Every figure carries its sample size; a figure
 * with no records behind it is null ("no data"), never 0. Backtests are
 * HISTORICAL SIMULATIONS on past candles; paper sessions replay a past session
 * bar by bar with virtual money (also historical). Neither is live trading.
 */

import {
  BACKTEST_TARGET, CHECK_LABELS, COLLECTIONS as C, DEFAULT_RISK, MIN_TRADES, MISTAKE_LABELS, PHASES, STRATEGIES, TOTAL_DAYS, WORKFLOW_STEPS,
  type BacktestRun, type DailyJournal, type JournalTradeEntry, type JourneyDay, type ManualTrade, type Mistake, type PaperSession,
  type PlaybookDump, type Profile, type PsychEntry, type RiskConfig, type SimTrade, type StrategyId, type WorkflowDay,
} from "./playbook-types";
import { addDays, inWeek, inWeekMs, istDate, type Week } from "./week";

const list = <T>(d: PlaybookDump, c: string): T[] => Object.values(d[c] ?? {}) as T[];
const doc = <T>(d: PlaybookDump, c: string, id: string): T | undefined => d[c]?.[id] as T | undefined;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
const r2 = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r4 = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export type SampleStatus = "none" | "insufficient" | "ok";
export const sampleStatus = (n: number): SampleStatus => (n === 0 ? "none" : n < MIN_TRADES ? "insufficient" : "ok");

export interface MetricBlock {
  trades: number; wins: number; losses: number;
  winRate: number | null; net: number | null; costs: number | null; avgR: number | null;
  profitFactor: number | null; maxDrawdown: number | null; maxDrawdownPct: number | null; maxConsecLosses: number;
  sample: SampleStatus;
}

/** The playbook's own formulas (src/lib/etf/metrics.ts): a win is a trade with net > 0 after costs. */
export function metricBlock(trades: SimTrade[], capital: number): MetricBlock {
  const wins = trades.filter((t) => t.net > 0), losses = trades.filter((t) => t.net <= 0);
  let eq = 0, peak = 0, dd = 0, streak = 0, maxStreak = 0;
  for (const t of [...trades].sort((a, b) => a.exitT - b.exitT)) {
    eq += t.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
    streak = t.net <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak);
  }
  const lossSum = sum(losses.map((t) => t.net));
  const n = trades.length;
  return {
    trades: n, wins: wins.length, losses: losses.length,
    winRate: n ? r4(wins.length / n) : null,
    net: n ? r2(sum(trades.map((t) => t.net))) : null,
    costs: n ? r2(sum(trades.map((t) => (t.charges ?? 0) + (t.friction ?? 0)))) : null,
    avgR: n ? r2(mean(trades.map((t) => t.r))) : null,
    profitFactor: lossSum < 0 ? r2(sum(wins.map((t) => t.net)) / -lossSum) : null,
    maxDrawdown: n ? r2(dd) : null,
    maxDrawdownPct: n && capital > 0 ? r2((dd / capital) * 100) : null,
    maxConsecLosses: maxStreak,
    sample: sampleStatus(n),
  };
}

export interface Evidence { source: string; ref: string; date: string; detail: string }
export interface Finding { rule: string; severity: "high" | "medium" | "low"; count: number; evidence: Evidence[] }

export interface StrategyStat {
  id: StrategyId; letter: string; name: string;
  backtest: MetricBlock; outOfSample: MetricBlock | null; paper: MetricBlock;
  runs: number; symbols: string[]; warnings: string[];
  status: SampleStatus; verdict: string;
}

export interface DayActivity { date: string; backtestRuns: number; backtestTrades: number; paperSessions: number; paperTrades: number; journalEntries: number; lessons: number; workflowSteps: number }

export interface WeekMetrics {
  week: Week;
  labels: { backtest: string; paper: string };
  activity: DayActivity[];
  backtests: {
    runs: number; trades: number; all: MetricBlock;
    list: { id: string; createdAt: string; strategy: string; symbol: string; interval: string; period: string; trades: number; net: number | null; winRate: number | null; avgR: number | null; testTrades: number; warnings: string[] }[];
  };
  paper: {
    sessions: number; trades: number; all: MetricBlock;
    list: { id: string; replayedDay: string; startedOn: string; strategy: string; symbols: string[]; trades: number; net: number | null; dayLocked: boolean; violations: number }[];
  };
  manual: { backtests: number; sims: number; trades: number; note: string | null };
  equity: { kind: "paper" | "backtest"; points: { i: number; t: number; label: string; net: number; cum: number; dd: number }[] }[];
  strategies: StrategyStat[];
  risk: { rules: RiskConfig; rulesSource: "your settings" | "playbook defaults"; findings: Finding[]; checked: string[]; clean: boolean | null };
  discipline: {
    score: number | null; ruleAdherence: number | null; checksAnswered: number; checksPassed: number;
    byCheck: { key: string; label: string; passed: number; answered: number }[];
    paperReviewed: number; paperFollowed: number; tradesWithoutViolation: number | null; definition: string;
  };
  journal: {
    entries: number; results: Record<string, number>; avgDiscipline: number | null; avgConfidence: number | null; avgFocus: number | null;
    mistakes: { key: string; label: string; count: number }[]; mindsets: Record<string, number>;
    lessons: string[]; improvements: string[]; dailyJournals: number; psychEntries: number; avgEmotionalRating: number | null; mistakeLab: number;
  };
  learning: {
    startDate: string | null; expectedDay: number | null; phase: { num: number; name: string } | null;
    lessonsThisWeek: number[]; lessonsTotal: number; behind: number | null; progressPct: number;
    workflowDays: number; workflowSteps: number; workflowStepsPossible: number;
    backtestTradesTotal: number; backtestTarget: typeof BACKTEST_TARGET; paperTradesTotal: number; paperSessionsTotal: number;
  };
  instruments: { nonIndian: string[] };
  missing: string[];
}

const strategyName = (id: string) => STRATEGIES.find((s) => s.id === id)?.name ?? (id === "discretionary" ? "Discretionary" : id === "manual" ? "Manual" : id);

export function riskRules(d: PlaybookDump): { rules: RiskConfig; source: "your settings" | "playbook defaults" } {
  const cfg = doc<{ risk?: Partial<RiskConfig> }>(d, C.settings, "etfConfig");
  return cfg?.risk ? { rules: { ...DEFAULT_RISK, ...cfg.risk }, source: "your settings" } : { rules: DEFAULT_RISK, source: "playbook defaults" };
}

function equitySeries(kind: "paper" | "backtest", trades: SimTrade[]) {
  let cum = 0, peak = 0;
  return {
    kind,
    points: [...trades].sort((a, b) => a.exitT - b.exitT).map((t, i) => {
      cum += t.net; peak = Math.max(peak, cum);
      return { i: i + 1, t: t.exitT, label: `${t.symbol} ${t.day}`, net: r2(t.net)!, cum: r2(cum)!, dd: r2(cum - peak)! };
    }),
  };
}

export function computeWeek(d: PlaybookDump, week: Week): WeekMetrics {
  const { rules, source: rulesSource } = riskRules(d);
  const capital = rules.capital;

  // ── backtests (saved runs, by the day you ran them) ──
  const runs = list<BacktestRun>(d, C.etfRuns).filter((r) => inWeekMs(r.createdAt, week)).sort((a, b) => a.createdAt - b.createdAt);
  const btTrades = runs.flatMap((r) => (r.result?.trades ?? []).map((t) => ({ ...t, strategy: t.strategy ?? r.config.strategy })));
  // ── paper sessions (started this week; each replays a past session) ──
  const sessions = list<PaperSession>(d, C.paperSessions).filter((s) => inWeekMs(s.createdAt, week)).sort((a, b) => a.createdAt - b.createdAt);
  const paperTrades = sessions.flatMap((s) => (s.trades ?? []).map((t) => ({ ...t, strategy: t.strategy === "manual" && s.strategy !== "discretionary" ? s.strategy : t.strategy })));
  const sessionRisk = (s: PaperSession) => ({ ...rules, ...(s.risk ?? {}) });

  // ── journals ──
  const entries = list<JournalTradeEntry>(d, C.jentries).filter((e) => inWeek(e.date, week));
  const dailies = list<DailyJournal>(d, C.journal).filter((e) => inWeek(e.date ?? e.id, week));
  const psych = list<PsychEntry>(d, C.psych).filter((e) => inWeek(e.date ?? e.id, week));
  const lab = list<Mistake>(d, C.mistakes).filter((m) => inWeek(m.date, week));
  const manual = {
    backtests: list<ManualTrade>(d, C.backtests).filter((t) => inWeek(t.date, week)).length,
    sims: list<ManualTrade>(d, C.sims).filter((t) => inWeek(t.date, week)).length,
    trades: list<ManualTrade>(d, C.trades).filter((t) => inWeek(t.date, week)).length,
  };

  // ── learning ──
  const profile = doc<Profile>(d, C.settings, "profile");
  const journey = list<JourneyDay>(d, C.journey);
  const doneDate = (j: JourneyDay) => j.completedDate ?? (j.completedAt ? istDate(j.completedAt) : undefined);
  const lessonsThisWeek = journey.filter((j) => j.completed && inWeek(doneDate(j), week)).map((j) => j.day).sort((a, b) => a - b);
  const completedByEnd = journey.filter((j) => j.completed && (doneDate(j) ?? "") <= week.end);
  const startDate = profile?.startDate ?? null;
  const expectedDay = startDate ? Math.min(Math.max(daysBetween(startDate, week.end) + 1, 0), TOTAL_DAYS) : null;
  const phase = expectedDay && expectedDay > 0 ? PHASES.find((p) => expectedDay >= p.days[0] && expectedDay <= p.days[1]) ?? null : null;
  const workflow = list<WorkflowDay>(d, C.etfWorkflow).filter((w) => inWeek(w.id, week));
  const workflowSteps = sum(workflow.map((w) => Object.keys(w.done ?? {}).length));
  const allRunsToEnd = list<BacktestRun>(d, C.etfRuns).filter((r) => istDate(r.createdAt) <= week.end);
  const allSessionsToEnd = list<PaperSession>(d, C.paperSessions).filter((s) => istDate(s.createdAt) <= week.end);
  const manualBtToEnd = list<ManualTrade>(d, C.backtests).filter((t) => t.date <= week.end).length;

  // ── activity per day ──
  const activity: DayActivity[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(week.start, i);
    const dayRuns = runs.filter((r) => istDate(r.createdAt) === date);
    const daySessions = sessions.filter((s) => istDate(s.createdAt) === date);
    return {
      date,
      backtestRuns: dayRuns.length,
      backtestTrades: sum(dayRuns.map((r) => r.result?.trades?.length ?? 0)),
      paperSessions: daySessions.length,
      paperTrades: sum(daySessions.map((s) => s.trades?.length ?? 0)),
      journalEntries: entries.filter((e) => e.date === date).length,
      lessons: journey.filter((j) => j.completed && doneDate(j) === date).length,
      workflowSteps: Object.keys(workflow.find((w) => w.id === date)?.done ?? {}).length,
    };
  });

  // ── strategies ──
  const strategies: StrategyStat[] = STRATEGIES.map((s) => {
    const sRuns = runs.filter((r) => r.config.strategy === s.id);
    const bt = btTrades.filter((t) => t.strategy === s.id);
    const oos = bt.filter((t) => t.segment === "test");
    const pp = paperTrades.filter((t) => t.strategy === s.id);
    const backtest = metricBlock(bt, capital), paper = metricBlock(pp, capital);
    const warnings = [...new Set(sRuns.flatMap((r) => r.result?.warnings ?? []))];
    const status = sampleStatus(bt.length + pp.length);
    const verdict =
      status === "none" ? "No backtests or paper trades this week."
      : status === "insufficient" ? `Insufficient data — ${bt.length + pp.length} simulated trade${bt.length + pp.length === 1 ? "" : "s"} this week; the playbook needs at least ${MIN_TRADES} before a result means anything.`
      : oos.length < MIN_TRADES ? `Enough in-sample trades, but only ${oos.length} out-of-sample — treat the result as unproven.`
      : "Enough trades for a first read, including out-of-sample.";
    return {
      id: s.id, letter: s.letter, name: s.name, backtest, outOfSample: oos.length ? metricBlock(oos, capital) : null, paper,
      runs: sRuns.length, symbols: [...new Set([...sRuns.map((r) => r.config.symbol), ...pp.map((t) => t.symbol)])], warnings, status, verdict,
    };
  });

  // ── risk audit ──
  const findings = new Map<string, Finding>();
  const flag = (rule: string, severity: Finding["severity"], ev: Evidence) => {
    const f = findings.get(rule) ?? { rule, severity, count: 0, evidence: [] };
    f.count++;
    if (f.evidence.length < 12) f.evidence.push(ev);
    findings.set(rule, f);
  };
  for (const s of sessions) {
    const rk = sessionRisk(s);
    const budget = (rk.capital * rk.riskPct) / 100;
    const ref = `paper session ${s.day} (${s.symbols.join(", ")})`;
    for (const e of s.events ?? []) {
      if (e.kind === "violation") flag("Rule violation logged by the paper simulator", "high", { source: "paper", ref, date: istDate(s.createdAt), detail: e.text });
      else if (e.kind === "reject") flag("Order rejected by a risk check", "medium", { source: "paper", ref, date: istDate(s.createdAt), detail: e.text });
    }
    if (s.dayLocked) flag("Daily loss limit reached (day locked)", "high", { source: "paper", ref, date: istDate(s.createdAt), detail: `Limit ${rk.dailyLossPct}% of ₹${rk.capital.toLocaleString("en-IN")}` });
    if ((s.trades?.length ?? 0) > rk.maxTrades) flag(`More than ${rk.maxTrades} trades in a day`, "medium", { source: "paper", ref, date: istDate(s.createdAt), detail: `${s.trades.length} trades` });
    const dayNet = sum((s.trades ?? []).map((t) => t.net));
    if (dayNet < -(rk.capital * rk.dailyLossPct) / 100) flag("Daily loss beyond the limit", "high", { source: "paper", ref, date: istDate(s.createdAt), detail: `Net ${dayNet.toFixed(2)} vs limit −${((rk.capital * rk.dailyLossPct) / 100).toFixed(2)}` });
    for (const t of s.trades ?? []) {
      if (t.riskAmount != null && t.riskAmount > budget * 1.05) flag(`Risk per trade above ${rk.riskPct}%`, "high", { source: "paper", ref, date: istDate(s.createdAt), detail: `${t.symbol}: risked ${t.riskAmount.toFixed(2)} vs budget ${budget.toFixed(2)}` });
      if (t.plannedRR != null && t.plannedRR < rk.minRR) flag(`Planned reward:risk below ${rk.minRR}`, "medium", { source: "paper", ref, date: istDate(s.createdAt), detail: `${t.symbol}: planned ${t.plannedRR.toFixed(2)}R` });
      if (!t.stop) flag("Trade without a stop-loss", "high", { source: "paper", ref, date: istDate(s.createdAt), detail: t.symbol });
      if (t.side === "short" && !rk.allowShort) flag("Short trade while shorts are off", "medium", { source: "paper", ref, date: istDate(s.createdAt), detail: t.symbol });
    }
    for (const [tid, rv] of Object.entries(s.review ?? {})) {
      if (rv && rv.followed === false) flag("Self-review: plan not followed", "medium", { source: "paper review", ref, date: istDate(s.createdAt), detail: [rv.mistakes?.join(", "), rv.note].filter(Boolean).join(" — ") || `trade ${tid}` });
    }
  }
  for (const e of entries) {
    const ref = `journal ${e.date} ${e.market || ""} ${e.setup || ""}`.trim();
    if (e.result && e.result !== "notrade" && e.entry != null && e.stop == null) flag("Journal trade without a stop-loss", "high", { source: "journal", ref, date: e.date, detail: "Entry recorded, no stop" });
    if (e.checks?.stop === false) flag("Stop not respected (journal self-check)", "high", { source: "journal", ref, date: e.date, detail: CHECK_LABELS.stop + ": no" });
    for (const m of e.mistakes ?? []) {
      if (["stop", "risk", "overtrading", "rules"].includes(m)) flag(`Journal mistake: ${MISTAKE_LABELS[m]}`, m === "stop" || m === "risk" ? "high" : "medium", { source: "journal", ref, date: e.date, detail: MISTAKE_LABELS[m] });
    }
  }
  for (const r of runs) {
    for (const day of r.result?.lockedDays ?? []) flag("Backtest hit the daily loss limit", "low", { source: "backtest (historical simulation)", ref: `${r.config.symbol} ${strategyName(r.config.strategy)}`, date: istDate(r.createdAt), detail: `Locked on ${day}` });
  }
  const checked = ["Risk per trade", "Daily loss limit", "Max trades per day", "Minimum planned R:R", "Stop-loss present", "Shorts allowed", "Simulator violations and rejections", "Self-review", "Journal self-checks and mistakes"];
  const sev = { high: 0, medium: 1, low: 2 };
  const riskFindings = [...findings.values()].sort((a, b) => sev[a.severity] - sev[b.severity] || b.count - a.count);
  const audited = sessions.length + entries.length + runs.length;

  // ── discipline ──
  const byCheck = Object.keys(CHECK_LABELS).map((key) => {
    const answered = entries.filter((e) => typeof e.checks?.[key as keyof JournalTradeEntry["checks"]] === "boolean");
    return { key, label: CHECK_LABELS[key], answered: answered.length, passed: answered.filter((e) => e.checks[key as keyof JournalTradeEntry["checks"]]).length };
  });
  const checksAnswered = sum(byCheck.map((c) => c.answered)), checksPassed = sum(byCheck.map((c) => c.passed));
  const reviews = sessions.flatMap((s) => Object.values(s.review ?? {}));
  const paperFollowed = reviews.filter((r) => r?.followed).length;
  const violatedSessions = sessions.filter((s) => (s.events ?? []).some((e) => e.kind === "violation"));
  const tradesWithoutViolation = paperTrades.length ? 1 - Math.min(1, sum(violatedSessions.map((s) => (s.events ?? []).filter((e) => e.kind === "violation").length)) / paperTrades.length) : null;
  const parts = [checksAnswered ? checksPassed / checksAnswered : null, reviews.length ? paperFollowed / reviews.length : null, tradesWithoutViolation].filter((x): x is number => x != null);

  // ── journal insights ──
  const results: Record<string, number> = {};
  for (const e of entries) if (e.result) results[e.result] = (results[e.result] ?? 0) + 1;
  const mistakeCounts = new Map<string, number>();
  for (const e of entries) for (const m of e.mistakes ?? []) mistakeCounts.set(m, (mistakeCounts.get(m) ?? 0) + 1);
  const mindsets: Record<string, number> = {};
  for (const e of entries) if (e.mindset) mindsets[e.mindset] = (mindsets[e.mindset] ?? 0) + 1;

  // ── scope: Indian-listed ETFs only ──
  const nonIndian = [...new Set([...runs.filter((r) => r.config.exchange !== "NSE").map((r) => r.config.symbol), ...sessions.filter((s) => s.exchange !== "NSE").flatMap((s) => s.symbols)])];

  const missing: string[] = [];
  if (!runs.length) missing.push("No backtests were saved this week.");
  if (!sessions.length) missing.push("No paper-trading sessions this week.");
  if (!entries.length) missing.push("No trading-journal entries this week.");
  if (!startDate) missing.push("The 84-day plan has no start date yet, so lesson pace can't be measured.");
  if (rulesSource === "playbook defaults") missing.push("You haven't saved your own risk settings — the audit uses the playbook's defaults.");

  const allTrades = [...btTrades];
  return {
    week,
    labels: {
      backtest: "HISTORICAL SIMULATION — backtests on past candles, after costs and slippage; not live results.",
      paper: "HISTORICAL PAPER TRADING — past sessions replayed bar by bar with virtual money; no real orders.",
    },
    activity,
    backtests: {
      runs: runs.length, trades: btTrades.length, all: metricBlock(allTrades, capital),
      list: runs.map((r) => ({
        id: r.id, createdAt: new Date(r.createdAt).toISOString(), strategy: strategyName(r.config.strategy), symbol: r.config.symbol, interval: r.config.interval,
        period: [r.config.from, r.config.to].filter(Boolean).join(" → ") || r.datasetName, trades: r.result?.trades?.length ?? 0,
        net: r2(r.result?.metrics?.all?.net ?? null), winRate: r4(r.result?.metrics?.all?.winRate ?? null), avgR: r2(r.result?.metrics?.all?.avgR ?? null),
        testTrades: r.result?.metrics?.test?.trades ?? 0, warnings: r.result?.warnings ?? [],
      })),
    },
    paper: {
      sessions: sessions.length, trades: paperTrades.length, all: metricBlock(paperTrades, capital),
      list: sessions.map((s) => ({
        id: s.id, replayedDay: s.day, startedOn: istDate(s.createdAt), strategy: strategyName(s.strategy), symbols: s.symbols, trades: s.trades?.length ?? 0,
        net: s.trades?.length ? r2(sum(s.trades.map((t) => t.net))) : null, dayLocked: !!s.dayLocked, violations: (s.events ?? []).filter((e) => e.kind === "violation").length,
      })),
    },
    manual: { ...manual, note: manual.backtests + manual.sims + manual.trades ? "Manually logged trades (Track → trade logs) are counted but not used for win rate or R — they have no costs or fills." : null },
    equity: [equitySeries("paper", paperTrades), equitySeries("backtest", btTrades)],
    strategies,
    risk: { rules, rulesSource, findings: riskFindings, checked, clean: audited ? riskFindings.every((f) => f.severity === "low") : null },
    discipline: {
      score: parts.length ? Math.round(mean(parts)! * 100) : null,
      ruleAdherence: checksAnswered ? r4(checksPassed / checksAnswered) : null,
      checksAnswered, checksPassed, byCheck,
      paperReviewed: reviews.length, paperFollowed,
      tradesWithoutViolation: r4(tradesWithoutViolation),
      definition: "Average of what was recorded: journal execution checks passed, paper trades whose self-review says the plan was followed, and paper trades without a simulator rule violation.",
    },
    journal: {
      entries: entries.length, results,
      avgDiscipline: r2(mean(entries.map((e) => e.discipline).filter((x) => typeof x === "number"))),
      avgConfidence: r2(mean(entries.map((e) => e.confidence).filter((x) => typeof x === "number"))),
      avgFocus: r2(mean(entries.map((e) => e.focus).filter((x) => typeof x === "number"))),
      mistakes: [...mistakeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: MISTAKE_LABELS[key] ?? key, count })),
      mindsets,
      lessons: entries.map((e) => e.learned?.trim()).filter(Boolean).slice(0, 8) as string[],
      improvements: entries.map((e) => e.improve?.trim()).filter(Boolean).slice(0, 8) as string[],
      dailyJournals: dailies.length, psychEntries: psych.length,
      avgEmotionalRating: r2(mean(psych.map((p) => p.rating).filter((x) => typeof x === "number"))),
      mistakeLab: lab.length,
    },
    learning: {
      startDate, expectedDay, phase: phase ? { num: phase.num, name: phase.name } : null,
      lessonsThisWeek, lessonsTotal: completedByEnd.length,
      behind: expectedDay != null ? Math.max(0, expectedDay - completedByEnd.length) : null,
      progressPct: Math.round((completedByEnd.length / TOTAL_DAYS) * 100),
      workflowDays: workflow.length, workflowSteps, workflowStepsPossible: 7 * WORKFLOW_STEPS,
      backtestTradesTotal: sum(allRunsToEnd.map((r) => r.result?.trades?.length ?? 0)) + manualBtToEnd,
      backtestTarget: BACKTEST_TARGET,
      paperTradesTotal: sum(allSessionsToEnd.map((s) => s.trades?.length ?? 0)),
      paperSessionsTotal: allSessionsToEnd.length,
    },
    instruments: { nonIndian },
    missing,
  };
}

/** One row of the week-over-week comparison. */
export interface WeekRow {
  week: Week; backtestRuns: number; backtestTrades: number; paperTrades: number; journalEntries: number; lessons: number;
  winRate: number | null; avgR: number | null; net: number | null; discipline: number | null; riskFindings: number;
}

export function weekRow(m: WeekMetrics): WeekRow {
  const sim = [m.backtests.all, m.paper.all];
  const trades = sim[0].trades + sim[1].trades;
  const wins = sim[0].wins + sim[1].wins;
  return {
    week: m.week, backtestRuns: m.backtests.runs, backtestTrades: m.backtests.trades, paperTrades: m.paper.trades, journalEntries: m.journal.entries,
    lessons: m.learning.lessonsThisWeek.length,
    winRate: trades ? r4(wins / trades) : null,
    avgR: trades ? r2(((m.backtests.all.avgR ?? 0) * sim[0].trades + (m.paper.all.avgR ?? 0) * sim[1].trades) / trades) : null,
    net: trades ? r2((m.backtests.all.net ?? 0) + (m.paper.all.net ?? 0)) : null,
    discipline: m.discipline.score,
    riskFindings: m.risk.findings.filter((f) => f.severity !== "low").reduce((a, f) => a + f.count, 0),
  };
}
