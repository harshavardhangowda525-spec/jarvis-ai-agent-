import { describe, it, expect } from "vitest";
import { addDays, istDate, istInstant, latestDueWeek, weekOf, weeksBack } from "@/lib/trading/week";
import { computeWeek, weekRow } from "@/lib/trading/analyze";
import { allowedNumbers, factsFor, rulesNarrative, unknownNumbers } from "@/lib/trading/narrative";
import { parseBackup } from "@/lib/trading/source";
import { playbookDump } from "./fixtures/playbook";

const W = { start: "2026-10-19", end: "2026-10-25" };

describe("IST reporting weeks", () => {
  it("runs Monday to Sunday in India time", () => {
    expect(weekOf("2026-10-25")).toEqual(W);
    expect(weekOf("2026-10-19")).toEqual(W);
    expect(weekOf("2026-10-26").start).toBe("2026-10-26");
    // 23:30 UTC Sunday is already Monday in India
    expect(istDate(Date.parse("2026-10-25T19:00:00Z"))).toBe("2026-10-26");
  });
  it("is due at Sunday 18:00 IST, and covers the week ending that Sunday", () => {
    expect(latestDueWeek(istInstant("2026-10-25", 17, 59))).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(latestDueWeek(istInstant("2026-10-25", 18, 0))).toEqual(W);
    expect(latestDueWeek(istInstant("2026-10-28", 9))).toEqual(W);
    expect(weeksBack(W, 3).map((w) => w.start)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("weekly analysis from the playbook's records", () => {
  const m = computeWeek(playbookDump() as never, W);

  it("counts only this week's activity and labels it as simulated", () => {
    expect(m.backtests.runs).toBe(2); // the run from the 14th is last week
    expect(m.backtests.trades).toBe(23);
    expect(m.paper.sessions).toBe(1);
    expect(m.paper.trades).toBe(4);
    expect(m.journal.entries).toBe(2);
    expect(m.labels.backtest).toMatch(/HISTORICAL SIMULATION/);
    expect(m.labels.paper).toMatch(/HISTORICAL PAPER/);
    expect(m.activity.find((a) => a.date === "2026-10-20")).toMatchObject({ backtestRuns: 1, backtestTrades: 20, workflowSteps: 3 });
  });

  it("marks small samples as insufficient data and empty ones as no data — never zero", () => {
    const by = Object.fromEntries(m.strategies.map((s) => [s.id, s]));
    expect(by.trend.status).toBe("insufficient");
    expect(by.trend.verdict).toMatch(/Insufficient data — 20 simulated trades/);
    expect(by.trend.outOfSample?.trades).toBe(6);
    expect(by.range.status).toBe("none");
    expect(by.range.backtest.winRate).toBeNull();
    expect(by.range.backtest.net).toBeNull();
    expect(by.range.backtest.avgR).toBeNull();
    expect(by.pullback.paper.trades).toBe(4);
    expect(by.trend.backtest.winRate).toBeCloseTo(13 / 20);
  });

  it("audits every risk rule with evidence from the records", () => {
    const rules = m.risk.findings.map((f) => f.rule);
    expect(rules).toContain("Risk per trade above 0.5%");
    expect(rules).toContain("Planned reward:risk below 1.5");
    expect(rules).toContain("Trade without a stop-loss");
    expect(rules).toContain("More than 3 trades in a day");
    expect(rules).toContain("Daily loss beyond the limit");
    expect(rules).toContain("Daily loss limit reached (day locked)");
    expect(rules).toContain("Rule violation logged by the paper simulator");
    expect(rules).toContain("Journal trade without a stop-loss");
    expect(rules).toContain("Self-review: plan not followed");
    const over = m.risk.findings.find((f) => f.rule.startsWith("Risk per trade"))!;
    expect(over.evidence[0]).toMatchObject({ source: "paper", date: "2026-10-21" });
    expect(over.evidence[0].detail).toMatch(/risked 1200\.00 vs budget 500\.00/);
    expect(m.risk.findings[0].severity).toBe("high");
    expect(m.risk.clean).toBe(false);
  });

  it("measures discipline and learning from what was recorded", () => {
    expect(m.discipline.checksAnswered).toBe(14);
    expect(m.discipline.checksPassed).toBe(11);
    expect(m.discipline.paperReviewed).toBe(2);
    expect(m.discipline.score).toBeGreaterThan(0);
    expect(m.learning.lessonsThisWeek).toEqual([15, 16, 17]);
    expect(m.learning.lessonsTotal).toBe(17);
    expect(m.learning.expectedDay).toBe(25);
    expect(m.learning.behind).toBe(8);
    expect(m.learning.phase?.name).toBe("Risk Management");
    expect(m.learning.backtestTradesTotal).toBe(25);
    expect(m.journal.mistakes[0]).toMatchObject({ key: "early", count: 1 });
  });

  it("an empty week has no data, not zeros", () => {
    const e = computeWeek(playbookDump() as never, { start: "2026-09-07", end: "2026-09-13" });
    expect(e.discipline.score).toBeNull();
    expect(e.backtests.all.winRate).toBeNull();
    expect(e.risk.clean).toBeNull();
    expect(e.missing).toContain("No backtests were saved this week.");
    const row = weekRow(e);
    expect(row.winRate).toBeNull();
    expect(row.discipline).toBeNull();
  });

  it("flags instruments outside Indian-listed ETFs", () => {
    const d = playbookDump() as Record<string, Record<string, Record<string, unknown>>>;
    (d.etfRuns.r2.config as Record<string, unknown>).exchange = "US";
    (d.etfRuns.r2.config as Record<string, unknown>).symbol = "SPY";
    expect(computeWeek(d as never, W).instruments.nonIndian).toEqual(["SPY"]);
  });
});

describe("the written review", () => {
  const m = computeWeek(playbookDump() as never, W);
  const history = weeksBack(W, 3).map((w) => weekRow(computeWeek(playbookDump() as never, w)));

  it("rejects AI text that uses numbers not in the records", () => {
    const allowed = allowedNumbers(factsFor(m, history));
    const good = { executiveSummary: "You saved 2 backtest runs with 23 simulated trades; the trend win rate was 65%.", strategies: [], risk: "", learning: "", discipline: "", comparison: "", nextWeek: [{ action: "Backtest more", why: "Only 20 trend trades" }] };
    expect(unknownNumbers(good, allowed)).toEqual([]);
    const bad = { ...good, executiveSummary: "Your win rate hit 87% and you made ₹45,210 this week." };
    expect(unknownNumbers(bad, allowed)).toEqual(expect.arrayContaining(["87", "45210"]));
  });

  it("reads thousands separators the same way in sources and replies", () => {
    const allowed = allowedNumbers({ headline: "UPI charge above Rs 2,000 and 1,20,000 merchants" });
    const body = { executiveSummary: "A charge applies above Rs 2,000 for 1,20,000 merchants.", strategies: [], risk: "", learning: "", discipline: "", comparison: "", nextWeek: [{ action: "Check UPI fees", why: "Rs 2000 threshold" }] };
    expect(unknownNumbers(body, allowed)).toEqual([]);
  });

  it("the rule-based write-up states the facts and next steps", () => {
    const n = rulesNarrative(m, history);
    expect(n.executiveSummary).toMatch(/2 backtest runs \(23 historical simulated trades\)/);
    expect(n.nextWeek.map((x) => x.action).join(" ")).toMatch(/50-trade goal \(25 so far\)/);
    expect(n.strategies.find((s) => s.id === "trend")!.note).toMatch(/Insufficient data/);
    expect(unknownNumbers(n, allowedNumbers(factsFor(m, history)))).toEqual([]);
  });

  it("accepts only real playbook backups", () => {
    expect(() => parseBackup([1, 2])).toThrow(/isn't a playbook backup/);
    expect(() => parseBackup({ foo: { a: 1 } })).toThrow(/none of the playbook's collections/);
    expect(Object.keys(parseBackup(playbookDump()))).toContain("etfRuns");
  });
});
