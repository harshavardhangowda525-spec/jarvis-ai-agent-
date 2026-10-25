/**
 * Read-only shapes of the records your trading playbook app
 * (github.com/harshavardhangowda525-spec/trading-playbook-) stores. JARVIS
 * never writes them; it reads the app's own `documents` (Supabase) or a backup
 * you exported from it. Only the fields the weekly review uses are listed.
 */

export const COLLECTIONS = {
  settings: "settings",
  journey: "journey",
  journal: "journal",
  trades: "trades",
  backtests: "backtests",
  sims: "sims",
  mistakes: "mistakes",
  strategies: "strategies",
  playbook: "playbook",
  psych: "psych",
  practice: "practice",
  etfRuns: "etfRuns",
  paperSessions: "paperSessions",
  etfWorkflow: "etfWorkflow",
  jentries: "jentries",
  jweekly: "jweekly",
} as const;

/** collection → doc id → document */
export type PlaybookDump = Record<string, Record<string, unknown>>;

export type StrategyId = "trend" | "breakout" | "pullback" | "range";
export const STRATEGIES: { id: StrategyId; letter: string; name: string }[] = [
  { id: "trend", letter: "A", name: "Trend-Following" },
  { id: "breakout", letter: "B", name: "Breakout" },
  { id: "pullback", letter: "C", name: "Pullback" },
  { id: "range", letter: "D", name: "Range-Bound" },
];

/** The playbook's own minimum before a backtest result means anything (src/lib/etf/metrics.ts MIN_TRADES). */
export const MIN_TRADES = 30;
/** The learning plan's backtesting goal: 50–100 backtested trades. */
export const BACKTEST_TARGET = { min: 50, max: 100 };

export interface RiskConfig {
  capital: number;
  riskPct: number;
  dailyLossPct: number;
  maxTrades: number;
  maxPositionPct: number;
  minRR: number;
  cooldownMin: number;
  allowShort: boolean;
  skipOpenMin: number;
  lastEntryBeforeCloseMin: number;
  squareOffBeforeCloseMin: number;
}
/** The playbook's defaults (src/lib/etf/risk.ts DEFAULT_RISK) — used only when you never changed them. */
export const DEFAULT_RISK: RiskConfig = {
  capital: 100000, riskPct: 0.5, dailyLossPct: 1.5, maxTrades: 3, maxPositionPct: 100, minRR: 1.5,
  cooldownMin: 60, allowShort: false, skipOpenMin: 15, lastEntryBeforeCloseMin: 45, squareOffBeforeCloseMin: 15,
};

export interface SimTrade {
  id: string;
  strategy: StrategyId | "manual";
  symbol: string;
  side: "long" | "short";
  qty: number;
  day: string;
  entryT: number;
  exitT: number;
  entryFill: number;
  exitFill: number;
  stop: number;
  target: number | null;
  exitReason: string;
  gross: number;
  charges: number;
  friction: number;
  net: number;
  plannedRR: number | null;
  r: number;
  riskAmount?: number;
  reason: string;
  segment?: "train" | "test";
}

export interface Metrics {
  trades: number; wins: number; losses: number; winRate: number | null; net: number; costs: number;
  profitFactor: number | null; maxDrawdown: number; maxDrawdownPct: number; avgR: number | null; maxConsecLosses: number;
}

export interface BacktestRun {
  id: string;
  createdAt: number;
  datasetName: string;
  config: { symbol: string; exchange: "NSE" | "US"; interval: string; strategy: StrategyId; risk: RiskConfig; from?: string; to?: string };
  result: {
    trades: SimTrade[];
    metrics: { all: Metrics; train: Metrics; test: Metrics };
    splitDay: string | null;
    trainDays: number;
    testDays: number;
    warnings: string[];
    lockedDays: string[];
    costPct: number;
  };
}

export interface PaperSession {
  id: string;
  day: string;
  exchange: "NSE" | "US";
  interval: string;
  symbols: string[];
  strategy: StrategyId | "discretionary";
  plan: string;
  startCash: number;
  cash: number;
  trades: SimTrade[];
  events: { t: number; kind: "info" | "fill" | "reject" | "risk" | "violation"; text: string }[];
  risk: RiskConfig;
  dayLocked: boolean;
  status: "active" | "ended";
  journal: { t: number; text: string }[];
  review: Record<string, { followed: boolean; mistakes: string[]; note: string }>;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
}

export interface JournalTradeEntry {
  id: string;
  createdAt: number;
  date: string;
  session: string;
  market: string;
  timeframe: string;
  condition: string;
  strategyId: string;
  setup: string;
  direction: "long" | "short";
  entry: number | null;
  stop: number | null;
  target: number | null;
  exit: number | null;
  checks: Partial<Record<"strategy" | "confirmation" | "entry" | "stop" | "fomo" | "revenge" | "rules", boolean>>;
  result: "success" | "fail" | "breakeven" | "notrade" | "";
  learned: string;
  improve: string;
  mindset: string;
  confidence: number;
  discipline: number;
  focus: number;
  mistakes: string[];
  otherMistake: string;
  processScore?: number | null;
}

export const CHECK_LABELS: Record<string, string> = {
  strategy: "Followed the strategy", confirmation: "Waited for confirmation", entry: "Respected the planned entry",
  stop: "Respected the stop", fomo: "Avoided FOMO", revenge: "Avoided revenge trading", rules: "Followed the trading rules",
};

export const MISTAKE_LABELS: Record<string, string> = {
  fomo: "FOMO", early: "Entered too early", late: "Entered too late", structure: "Ignored market structure",
  confirmation: "Ignored confirmation", risk: "Poor risk planning", overtrading: "Overtrading", rules: "Broke strategy rules",
  stop: "Moved stop unnecessarily", exit: "Exited too early", nosetup: "No clear setup", other: "Other",
};

/** Legacy manual trade log (collections trades / backtests / sims). */
export interface ManualTrade {
  id: string;
  date: string;
  asset: string;
  setup: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  outcome: "win" | "loss" | "breakeven" | "open";
  resultR: number | null;
  mistake: string;
}

export interface JourneyDay { id: string; day: number; completed: boolean; completedAt?: number; completedDate?: string; checks?: { learn: boolean; practice: boolean; journal: boolean } }
export interface Profile { id: "profile"; startDate: string | null }
export interface WorkflowDay { id: string; done: Record<string, number>; etf?: string }
export interface DailyJournal { id: string; date: string; mistake: string; improvement: string; confidence: number; discipline: number; learn: string; practice: string; observations: string }
export interface PsychEntry { id: string; date: string; emotions: Record<string, number>; rating: number }
export interface Mistake { id: string; title: string; category: string; date: string; status: "open" | "improved" }
export interface PlaybookDoc { id: "main"; sections: Record<string, string>; updatedAt?: number }

/** The 12 phases of the 84-day ETF learning plan (src/data/curriculum.ts). */
export const PHASES: { num: number; name: string; days: [number, number] }[] = [
  { num: 1, name: "ETF Foundations", days: [1, 7] },
  { num: 2, name: "Reading ETF Charts", days: [8, 14] },
  { num: 3, name: "Market Context", days: [15, 21] },
  { num: 4, name: "Risk Management", days: [22, 28] },
  { num: 5, name: "Trend-Following", days: [29, 35] },
  { num: 6, name: "Breakout", days: [36, 42] },
  { num: 7, name: "Pullback", days: [43, 49] },
  { num: 8, name: "Range-Bound", days: [50, 56] },
  { num: 9, name: "Backtesting Properly", days: [57, 63] },
  { num: 10, name: "Paper Trading", days: [64, 70] },
  { num: 11, name: "Psychology & Playbook", days: [71, 77] },
  { num: 12, name: "Final Evaluation", days: [78, 84] },
];
export const TOTAL_DAYS = 84;
/** The ETF daily workflow has 11 steps (src/components/etf/EtfWorkflow.tsx). */
export const WORKFLOW_STEPS = 11;
