/**
 * MIKE — Market Intelligence & Knowledge Engine. Shared types (safe for both
 * server and browser: no secrets, no server imports).
 */

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TF_MS: Record<Timeframe, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000, "1w": 604_800_000,
};
export const TF_LABEL: Record<Timeframe, string> = {
  "1m": "1M", "5m": "5M", "15m": "15M", "30m": "30M", "1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W",
};

export type MarketKind = "crypto" | "stock" | "index" | "forex" | "commodity" | "etf" | "futures";
export const MARKETS: { id: MarketKind; label: string }[] = [
  { id: "crypto", label: "Crypto" }, { id: "index", label: "Indices" }, { id: "stock", label: "Stocks" },
  { id: "forex", label: "Forex" }, { id: "commodity", label: "Commodities" }, { id: "etf", label: "ETFs" }, { id: "futures", label: "Futures" },
];

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

/**
 * How current the data is — shown on every screen and every answer.
 *  live        real-time exchange data (fetched seconds ago, last bar is current)
 *  delayed     a free quote feed that may lag the exchange (typically up to ~15 min)
 *  closed      the market is closed; the last bar is the last session's
 *  stale       the newest bar is older than it should be — can't be treated as current
 *  unavailable no data could be fetched at all
 */
export type Freshness = "live" | "delayed" | "closed" | "stale" | "unavailable";

export interface AssetRef {
  /** What the user sees ("BTC/USDT", "NIFTY 50"). */
  display: string;
  /** The provider's symbol ("BTCUSDT", "^NSEI"). */
  symbol: string;
  kind: MarketKind;
  provider: "binance" | "yahoo";
  /** Exchange / venue shown to the user. */
  exchange: string;
  /** Correlation bucket for exposure checks. */
  group: string;
}

export interface Series {
  asset: AssetRef;
  timeframe: Timeframe;
  candles: Candle[];
  source: string;
  freshness: Freshness;
  /** Open time of the newest bar (ms). */
  lastBarAt: number | null;
  fetchedAt: number;
  /** Why the freshness is what it is (or why data is missing). */
  note: string;
  currency?: string | null;
  /** Has real traded volume (forex/most indices on free feeds don't). */
  hasVolume: boolean;
}

export type Bias = "bullish" | "bearish" | "neutral";
export type Direction = "long" | "short";

export type RegimeId =
  | "strong_bullish" | "weak_bullish" | "strong_bearish" | "weak_bearish" | "ranging";
export type VolState = "high" | "normal" | "low";

export interface Regime {
  id: RegimeId;
  volatility: VolState;
  breakout: boolean;
  reversal: boolean;
  /** "STRONG BULLISH TREND · HIGH VOLATILITY" */
  label: string;
  evidence: string[];
}

export interface Level { price: number; touches: number; kind: "support" | "resistance" }
export interface StructurePoint { i: number; t: number; price: number; type: "high" | "low"; label?: "HH" | "HL" | "LH" | "LL" }
export interface StructureEvent { i: number; t: number; price: number; kind: "BOS" | "CHoCH"; dir: Bias }

export interface Snapshot {
  price: number;
  ema20: number; ema50: number; ema200: number; sma50: number;
  rsi: number; macd: number; macdSignal: number; macdHist: number; macdHistPrev: number;
  atr: number; atrPct: number; atrPctile: number;
  adx: number; plusDI: number; minusDI: number;
  bbUpper: number; bbMid: number; bbLower: number; bbWidthPctile: number;
  vwap: number; obvSlope: number; stochK: number; stochD: number;
  volumeRatio: number;
  changePct: number;
}

export type ScanEvent =
  | "strong_trend" | "trend_reversal" | "breakout" | "breakdown" | "consolidation" | "near_support" | "near_resistance"
  | "liquidity_zone" | "volume_spike" | "volatility_expansion" | "momentum_shift" | "unusual_activity";

export const SCAN_EVENT_LABEL: Record<ScanEvent, string> = {
  strong_trend: "Strong trend", trend_reversal: "Trend reversal", breakout: "Breakout", breakdown: "Breakdown",
  consolidation: "Consolidation", near_support: "At support", near_resistance: "At resistance", liquidity_zone: "Liquidity zone",
  volume_spike: "Volume spike", volatility_expansion: "Volatility expansion", momentum_shift: "Momentum shift", unusual_activity: "Unusual activity",
};

export interface TfAnalysis {
  timeframe: Timeframe;
  bias: Bias;
  /** -100 … 100: weighted vote of the evidence below. */
  score: number;
  trend: "up" | "down" | "range";
  regime: Regime;
  snapshot: Snapshot;
  support: Level[];
  resistance: Level[];
  swings: StructurePoint[];
  events: StructureEvent[];
  scanEvents: ScanEvent[];
  evidence: string[];
  freshness: Freshness;
  bars: number;
}

export type CheckState = "pass" | "fail" | "neutral" | "unavailable";
export type CheckId = "structure" | "trend" | "momentum" | "volume" | "volatility" | "levels" | "mtf" | "context";
export const CHECK_LABEL: Record<CheckId, string> = {
  structure: "Market structure", trend: "Trend", momentum: "Momentum", volume: "Volume",
  volatility: "Volatility", levels: "Support / resistance", mtf: "Multi-timeframe", context: "Market / news context",
};
export const CHECK_WEIGHT: Record<CheckId, number> = {
  structure: 15, trend: 15, momentum: 12, volume: 10, volatility: 8, levels: 10, mtf: 20, context: 10,
};
export interface Check { id: CheckId; state: CheckState; detail: string }

export interface Target { price: number; basis: string; rr: number }
export interface TradeSetup {
  direction: Direction;
  entryLow: number;
  entryHigh: number;
  stop: number;
  targets: Target[];
  /** Reward to risk, measured to target 2 from the middle of the entry zone. */
  riskReward: number;
  invalidation: string;
  stopBasis: string;
}

export interface RiskPlan {
  accountSize: number;
  currency: string;
  riskPct: number;
  riskAmount: number;
  stopDistance: number;
  stopDistancePct: number;
  units: number;
  notional: number;
  maxDailyRiskPct: number;
  openRiskPct: number;
  correlatedOpen: string[];
  warnings: string[];
}

export type ConfidenceTier = "very_strong" | "strong" | "moderate" | "weak" | "no_trade";
export interface Confidence {
  score: number;
  tier: ConfidenceTier;
  breakdown: { id: CheckId; weight: number; earned: number; state: CheckState }[];
  adjustments: string[];
}

export interface Headline { title: string; url: string; source: string; publishedAt: string | null; tone: -1 | 0 | 1 }
export type SentimentId = "extremely_bearish" | "bearish" | "neutral" | "bullish" | "extremely_bullish";
export interface External {
  available: boolean;
  note: string;
  headlines: Headline[];
  newsSentiment: SentimentId | null;
  eventRisk: string[];
}

export interface MikeAnalysis {
  id?: string;
  asset: AssetRef;
  timeframe: Timeframe;
  generatedAt: string;
  mode: "mtf" | "single";
  data: { source: string; freshness: Freshness; note: string; lastBarAt: number | null; perTimeframe: { timeframe: Timeframe; freshness: Freshness; bars: number }[] };
  regime: Regime;
  alignment: { timeframe: Timeframe; bias: Bias; score: number; role: "context" | "setup" | "entry" }[];
  primary: TfAnalysis | null;
  checks: Check[];
  direction: Direction | null;
  confidence: Confidence;
  decision: "setup" | "no_trade";
  setup: TradeSetup | null;
  noTradeReasons: string[];
  sentiment: { price: SentimentId; evidence: string[] };
  external: External;
  risk: RiskPlan | null;
  chart: ChartData | null;
}

export interface ChartData {
  candles: Candle[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  ema200: (number | null)[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
  vwap: (number | null)[];
  rsi: (number | null)[];
  swings: StructurePoint[];
  events: StructureEvent[];
  support: Level[];
  resistance: Level[];
}

export interface MikeSettings {
  accountSize: number;
  currency: string;
  riskPct: number;
  maxDailyRiskPct: number;
  minConfidence: number;
  minRiskReward: number;
  defaultTimeframe: Timeframe;
  watchlist: string[];
}

export const DEFAULT_SETTINGS: MikeSettings = {
  accountSize: 0,
  currency: "USD",
  riskPct: 1,
  maxDailyRiskPct: 3,
  minConfidence: 70,
  minRiskReward: 2,
  defaultTimeframe: "1h",
  watchlist: ["BTC", "ETH", "SOL", "NIFTY", "SENSEX", "BANKNIFTY", "NASDAQ", "S&P 500", "GOLD", "EUR/USD"],
};

export const TIER_LABEL: Record<ConfidenceTier, string> = {
  very_strong: "Very strong alignment", strong: "Strong alignment", moderate: "Moderate alignment", weak: "Weak setup", no_trade: "No-trade zone",
};

export function tierOf(score: number): ConfidenceTier {
  return score >= 90 ? "very_strong" : score >= 80 ? "strong" : score >= 70 ? "moderate" : score >= 60 ? "weak" : "no_trade";
}

export const RISK_WARNING = "Trading involves substantial risk. Analytical confidence does not guarantee profit.";
export const CONFIDENCE_NOTE = "Confidence measures how well the evidence lines up — it is NOT the probability that the trade wins.";
