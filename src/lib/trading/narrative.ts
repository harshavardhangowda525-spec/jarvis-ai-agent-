/**
 * The written part of the weekly review. The AI only rewords the figures it is
 * given; a reply that mentions a number not found in those figures is thrown
 * away and the rule-based write-up (built straight from the numbers) is used.
 */

import { z } from "zod";
import { MIN_TRADES } from "./playbook-types";
import type { WeekMetrics, WeekRow } from "./analyze";
import { weekLabel } from "./week";

// over-long text is trimmed, not rejected — the number check below is what guards the facts
const text = (max: number) => z.string().transform((x) => (x.length > max ? `${x.slice(0, max - 1).trimEnd()}…` : x));
export const narrativeSchema = z.object({
  executiveSummary: text(1600).pipe(z.string().min(20)),
  strategies: z.array(z.object({ id: z.string(), note: text(700) })).default([]).transform((xs) => xs.slice(0, 4)),
  risk: text(1000).default(""),
  learning: text(1000).default(""),
  discipline: text(1000).default(""),
  comparison: text(1000).default(""),
  nextWeek: z.array(z.object({ action: text(240), why: text(400) })).min(1).transform((xs) => xs.slice(0, 6)),
});
export type NarrativeBody = z.infer<typeof narrativeSchema>;
export interface Narrative extends NarrativeBody { by: "ai" | "rules"; provider?: string; rejected?: string }

const pct = (x: number | null) => (x == null ? "no data" : `${Math.round(x * 100)}%`);
const num = (x: number | null, d = 2) => (x == null ? "no data" : x.toFixed(d));
const money = (x: number | null) => (x == null ? "no data" : `${x < 0 ? "−" : ""}₹${Math.abs(x).toFixed(2)}`);

/** Compact facts for the model — exactly what the dashboard shows. */
export function factsFor(m: WeekMetrics, history: WeekRow[]) {
  return {
    week: `${m.week.start} to ${m.week.end} (${weekLabel(m.week)})`,
    labels: m.labels,
    minimumTradesForConclusions: MIN_TRADES,
    backtests: { runs: m.backtests.runs, trades: m.backtests.trades, metrics: m.backtests.all, list: m.backtests.list.slice(0, 10) },
    paper: { sessions: m.paper.sessions, trades: m.paper.trades, metrics: m.paper.all, list: m.paper.list.slice(0, 10) },
    strategies: m.strategies.map((s) => ({ id: s.id, name: `${s.letter} · ${s.name}`, status: s.status, verdict: s.verdict, backtest: s.backtest, outOfSample: s.outOfSample, paper: s.paper, warnings: s.warnings.slice(0, 4) })),
    riskRules: m.risk.rules,
    riskFindings: m.risk.findings.map((f) => ({ rule: f.rule, severity: f.severity, count: f.count, examples: f.evidence.slice(0, 3).map((e) => `${e.date} ${e.ref}: ${e.detail}`) })),
    discipline: { score: m.discipline.score, ruleAdherence: m.discipline.ruleAdherence, byCheck: m.discipline.byCheck, paperReviewed: m.discipline.paperReviewed, paperFollowed: m.discipline.paperFollowed },
    journal: m.journal,
    learning: m.learning,
    previousWeeks: history,
    missingData: m.missing,
  };
}

export const SYSTEM = `You are MIKE, JARVIS's trading coach, writing the weekly review of a learner's ETF day-trading practice (Indian-listed ETFs, simulation only).
Rules — follow every one:
- Use ONLY the facts provided. Never invent trades, prices, results, dates or percentages. If a figure says "no data" or null, say there is no data.
- Every backtest is a HISTORICAL SIMULATION and every paper trade is HISTORICAL PAPER TRADING with virtual money. Say so; never call them real profits.
- A strategy with fewer than the minimum trades is "Insufficient data" — do not judge it as good or bad.
- No advice to trade real money, no instruments other than Indian-listed ETFs, no buy/sell calls on any market.
- Next-week actions are learning and process steps (backtests to run, rules to practise, lessons to finish), each tied to a finding.
- Plain, direct English. Write percentages as whole numbers and money with 2 decimals.
Reply with ONE JSON object only:
{"executiveSummary": string, "strategies": [{"id": "trend"|"breakout"|"pullback"|"range", "note": string}], "risk": string, "learning": string, "discipline": string, "comparison": string, "nextWeek": [{"action": string, "why": string}]}`;

/** Every number a reply may use: the facts' own numbers in their common spellings. */
export function allowedNumbers(facts: unknown): Set<string> {
  const out = new Set<string>(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "30", "50", "84", "100"]);
  const add = (x: number) => {
    for (const v of [x, Math.abs(x), x * 100, Math.abs(x) * 100]) {
      for (const d of [0, 1, 2]) out.add(Number(v.toFixed(d)).toString());
      out.add(Math.round(v).toString());
    }
  };
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) add(v);
    // "Rs 2,000" / "1,20,000" are one number, read the same way as in the reply
    else if (typeof v === "string") for (const m of v.replace(/(\d),(?=\d)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []) add(Number(m));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

/** Numbers in the reply that appear nowhere in the facts. */
export function unknownNumbers(body: NarrativeBody, allowed: Set<string>): string[] {
  const text = [body.executiveSummary, body.risk, body.learning, body.discipline, body.comparison, ...body.strategies.map((s) => s.note), ...body.nextWeek.flatMap((n) => [n.action, n.why])].join(" ");
  const bad: string[] = [];
  for (const raw of text.replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []) {
    const n = Number(raw);
    if (allowed.has(raw) || allowed.has(n.toString())) continue;
    bad.push(raw);
  }
  return [...new Set(bad)];
}

/** The rule-based write-up — always correct, used when the AI isn't available or strays from the facts. */
export function rulesNarrative(m: WeekMetrics, history: WeekRow[]): NarrativeBody {
  const sim = m.backtests.trades + m.paper.trades;
  const parts: string[] = [];
  parts.push(sim ? `This week you saved ${m.backtests.runs} backtest run${m.backtests.runs === 1 ? "" : "s"} (${m.backtests.trades} historical simulated trades) and ran ${m.paper.sessions} paper session${m.paper.sessions === 1 ? "" : "s"} (${m.paper.trades} historical paper trades).` : "No backtests or paper trades were recorded this week.");
  if (m.backtests.trades) parts.push(`Backtests: win rate ${pct(m.backtests.all.winRate)}, average ${num(m.backtests.all.avgR)}R, net ${money(m.backtests.all.net)} after costs (historical simulation).`);
  if (m.paper.trades) parts.push(`Paper: win rate ${pct(m.paper.all.winRate)}, average ${num(m.paper.all.avgR)}R, net ${money(m.paper.all.net)} (virtual money).`);
  parts.push(m.learning.lessonsThisWeek.length ? `You completed ${m.learning.lessonsThisWeek.length} lesson${m.learning.lessonsThisWeek.length === 1 ? "" : "s"} of the 84-day plan (${m.learning.lessonsTotal} in total).` : `No lessons of the 84-day plan were completed this week (${m.learning.lessonsTotal} in total).`);
  const high = m.risk.findings.filter((f) => f.severity === "high");
  parts.push(high.length ? `Risk audit: ${high.length} high-severity issue${high.length === 1 ? "" : "s"} — ${high.slice(0, 3).map((f) => `${f.rule} (${f.count})`).join(", ")}.` : m.risk.clean === null ? "Risk audit: nothing to audit this week." : "Risk audit: no high-severity issues found.");

  const strategies = m.strategies.map((s) => ({ id: s.id, note: s.verdict + (s.status !== "none" ? ` Backtest ${s.backtest.trades} trades, paper ${s.paper.trades}.` : "") }));
  const prev = history.length > 1 ? history[history.length - 2] : null;
  const cur = history[history.length - 1];
  const comparison = prev && cur
    ? `Versus the previous week: backtested trades ${prev.backtestTrades} → ${cur.backtestTrades}, paper trades ${prev.paperTrades} → ${cur.paperTrades}, journal entries ${prev.journalEntries} → ${cur.journalEntries}, lessons ${prev.lessons} → ${cur.lessons}, discipline ${prev.discipline ?? "no data"} → ${cur.discipline ?? "no data"}.`
    : "No earlier week to compare with yet.";
  const next: NarrativeBody["nextWeek"] = [];
  const thin = m.strategies.filter((s) => s.status !== "ok");
  if (m.learning.backtestTradesTotal < m.learning.backtestTarget.min) next.push({ action: `Backtest towards the ${m.learning.backtestTarget.min}-trade goal (${m.learning.backtestTradesTotal} so far).`, why: "The plan needs 50–100 backtested trades before strategy results can be compared." });
  if (thin.length) next.push({ action: `Add backtests for ${thin.slice(0, 2).map((s) => `${s.letter} · ${s.name}`).join(" and ")}.`, why: `Each has fewer than ${MIN_TRADES} simulated trades — insufficient data.` });
  if (high[0]) next.push({ action: `Fix: ${high[0].rule}.`, why: `${high[0].count} occurrence${high[0].count === 1 ? "" : "s"} this week (see the risk audit evidence).` });
  if (m.learning.behind) next.push({ action: `Catch up ${m.learning.behind} lesson${m.learning.behind === 1 ? "" : "s"} of the 84-day plan.`, why: `You are on day ${m.learning.expectedDay} by the calendar with ${m.learning.lessonsTotal} completed.` });
  if (!m.journal.entries) next.push({ action: "Journal every practice session.", why: "No journal entries this week, so discipline can't be measured." });
  if (!next.length) next.push({ action: "Keep the same routine and add out-of-sample checks.", why: "No gaps were found in this week's records." });
  return {
    executiveSummary: parts.join(" "),
    strategies,
    risk: high.length ? high.map((f) => `${f.rule}: ${f.count}`).join("; ") : "No high-severity issues.",
    learning: m.learning.phase ? `Calendar day ${m.learning.expectedDay} (phase ${m.learning.phase.num}: ${m.learning.phase.name}); ${m.learning.lessonsTotal} of 84 lessons complete.` : "The 84-day plan hasn't started (no start date).",
    discipline: m.discipline.score == null ? "No discipline data this week." : `Discipline score ${m.discipline.score} (${m.discipline.definition})`,
    comparison,
    nextWeek: next.slice(0, 6),
  };
}
