/**
 * A synthetic trading-playbook export for tests (the shape the playbook app's
 * Settings → Export writes). Every value is made up for the test only.
 */
import { istInstant } from "@/lib/trading/week";

type Trade = Record<string, unknown>;
let n = 0;
export function simTrade(o: Partial<{ strategy: string; symbol: string; day: string; net: number; r: number; risk: number; rr: number | null; stop: number; segment: "train" | "test"; side: "long" | "short" }>): Trade {
  n++;
  const t = istInstant(o.day ?? "2026-10-20", 10) + n * 60_000;
  return {
    id: `t${n}`, strategy: o.strategy ?? "trend", symbol: o.symbol ?? "NIFTYBEES", side: o.side ?? "long", qty: 10, day: o.day ?? "2026-10-20",
    signalT: t, entryT: t, entryRef: 100, entryFill: 100.05, stop: o.stop ?? 99, target: 102, exitT: t + 600_000, exitRef: 101, exitFill: 100.95, exitReason: "target",
    gross: (o.net ?? 10) + 2, charges: 1.5, friction: 0.5, net: o.net ?? 10, plannedRR: o.rr === undefined ? 2 : o.rr, r: o.r ?? (o.net ?? 10) / 10, reason: "test", segment: o.segment,
    riskAmount: o.risk ?? 400,
  };
}

/** Week of Mon 2026-10-19 … Sun 2026-10-25 (IST). */
export function playbookDump() {
  const at = (d: string, h = 11) => istInstant(d, h);
  const btTrades = [
    ...Array.from({ length: 20 }, (_, i) => simTrade({ strategy: "trend", net: i % 3 === 0 ? -8 : 12, segment: i < 14 ? "train" : "test" })),
  ];
  const btBreakout = Array.from({ length: 3 }, (_, i) => simTrade({ strategy: "breakout", net: i === 0 ? 9 : -6 }));
  const paperTrades = [
    simTrade({ strategy: "pullback", net: 15, risk: 480 }),
    simTrade({ strategy: "pullback", net: -900, risk: 1200, rr: 1.1 }), // over budget (0.5% of 1L = 500) and below min R:R
    simTrade({ strategy: "pullback", net: -700, risk: 450, stop: 0 }), // no stop
    simTrade({ strategy: "pullback", net: 20, risk: 300 }),
  ];
  return {
    settings: {
      profile: { id: "profile", startDate: "2026-10-01", callsign: "", targets: {} },
      etfConfig: { id: "etfConfig", risk: { capital: 100000, riskPct: 0.5, dailyLossPct: 1.5, maxTrades: 3, maxPositionPct: 100, minRR: 1.5, cooldownMin: 60, allowShort: false, skipOpenMin: 15, lastEntryBeforeCloseMin: 45, squareOffBeforeCloseMin: 15 } },
    },
    etfRuns: {
      r1: { id: "r1", createdAt: at("2026-10-20"), datasetId: "d1", datasetName: "NIFTYBEES 5m", config: { symbol: "NIFTYBEES", exchange: "NSE", interval: "5m", intervalSec: 300, strategy: "trend", params: {}, risk: {}, from: "2026-07-01", to: "2026-09-30" }, result: { trades: btTrades, metrics: { all: { trades: 20, net: 180, winRate: 0.65, avgR: 0.9 }, train: {}, test: { trades: 6 } }, splitDay: "2026-09-10", trainDays: 50, testDays: 20, warnings: ["Fewer than 30 trades — results are not statistically meaningful."], lockedDays: ["2026-08-14"], costPct: 0.08 } },
      r2: { id: "r2", createdAt: at("2026-10-22"), datasetId: "d2", datasetName: "BANKBEES 5m", config: { symbol: "BANKBEES", exchange: "NSE", interval: "5m", intervalSec: 300, strategy: "breakout", params: {}, risk: {} }, result: { trades: btBreakout, metrics: { all: { trades: 3 }, train: {}, test: { trades: 0 } }, splitDay: null, trainDays: 5, testDays: 0, warnings: [], lockedDays: [], costPct: 0.08 } },
      old: { id: "old", createdAt: at("2026-10-14"), datasetId: "d1", datasetName: "old", config: { symbol: "NIFTYBEES", exchange: "NSE", interval: "5m", intervalSec: 300, strategy: "trend", params: {}, risk: {} }, result: { trades: [simTrade({ day: "2026-10-14" }), simTrade({ day: "2026-10-14" })], metrics: { all: { trades: 2 }, train: {}, test: { trades: 0 } }, warnings: [], lockedDays: [] } },
    },
    paperSessions: {
      p1: {
        id: "p1", day: "2026-09-15", exchange: "NSE", interval: "5m", intervalSec: 300, symbols: ["NIFTYBEES", "BANKBEES"], sources: {}, strategy: "pullback", plan: "Pullbacks only",
        cursor: 0, startCash: 100000, cash: 98436, positions: [], orders: [], trades: paperTrades,
        events: [{ t: at("2026-10-21"), kind: "violation", text: "Entered without a stop-loss" }, { t: at("2026-10-21"), kind: "reject", text: "Order rejected: risk 1.2% exceeds 0.5%" }],
        risk: {}, costs: {}, dayLocked: true, status: "ended", journal: [], review: { t1: { followed: true, mistakes: [], note: "" }, t2: { followed: false, mistakes: ["Oversized"], note: "sized up after a win" } },
        createdAt: at("2026-10-21"), updatedAt: at("2026-10-21"),
      },
    },
    jentries: {
      j1: { id: "j1", createdAt: at("2026-10-21"), updatedAt: 0, date: "2026-10-21", session: "Evening practice", market: "NIFTYBEES", timeframe: "5m", condition: "Range", strategyId: "", setup: "Pullback to VWAP", direction: "long", entry: 250, stop: null, target: 253, exit: 249, size: 10, why: "", confirmed: "", structure: "", context: "", expected: "", invalidation: "", checks: { strategy: true, confirmation: false, entry: true, stop: false, fomo: true, revenge: true, rules: false }, result: "fail", happened: "", learned: "Wait for the close above VWAP", improve: "Set the stop before entry", image: null, imageNotes: "", mindset: "Impulsive", confidence: 4, discipline: 3, focus: 5, mistakes: ["early", "stop"], otherMistake: "" },
      j2: { id: "j2", createdAt: at("2026-10-23"), updatedAt: 0, date: "2026-10-23", session: "Evening practice", market: "BANKBEES", timeframe: "5m", condition: "Trending Up", strategyId: "", setup: "Trend continuation", direction: "long", entry: 500, stop: 497, target: 506, exit: 506, size: 5, why: "", confirmed: "", structure: "", context: "", expected: "", invalidation: "", checks: { strategy: true, confirmation: true, entry: true, stop: true, fomo: true, revenge: true, rules: true }, result: "success", happened: "", learned: "Patience pays", improve: "", image: null, imageNotes: "", mindset: "Calm", confidence: 7, discipline: 8, focus: 8, mistakes: [], otherMistake: "" },
    },
    journey: Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((d) => [String(d), { id: String(d), day: d, completed: true, completedDate: d <= 14 ? "2026-10-15" : "2026-10-2" + (d - 14), checks: { learn: true, practice: true, journal: true }, notes: "", takeaways: "" }]),
    ),
    etfWorkflow: { "2026-10-20": { id: "2026-10-20", done: { 0: 1, 1: 1, 2: 1 } }, "2026-10-21": { id: "2026-10-21", done: { 0: 1 } } },
  };
}
