import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getDb } from "@/lib/db";
import { recordActivity } from "@/lib/activity/record";
import { findAsset } from "@/lib/mike/search";
import { analyzeAsset, loadSettings } from "@/lib/mike/analyze";
import { compactAnalysis } from "@/lib/mike/summary";
import { scanMarket } from "@/lib/mike/scan";
import { closedBars, fetchSeries } from "@/lib/mike/data";
import { backtest, STRATEGIES, type StrategyId } from "@/lib/mike/backtest";
import { journalInsights } from "@/lib/mike/journal";
import { ALERT_KINDS, ALERT_LABEL, NEEDS_LEVEL, type AlertKind } from "@/lib/mike/alerts";
import { MARKETS, RISK_WARNING, TIMEFRAMES, TF_LABEL, type Timeframe, type MarketKind } from "@/lib/mike/types";
import { fmtPct, fmtPrice } from "@/lib/mike/format";

/**
 * MIKE's tools. Every number they return comes from a real market feed (or is
 * clearly marked unavailable). Nothing here places an order.
 */

const tf = z.enum(TIMEFRAMES);
const assetOf = async (q: string, market?: MarketKind) => {
  const a = await findAsset(q, market);
  if (!a) throw new ToolError(`I couldn't find a market called "${q}". Try a name (Bitcoin, Reliance, Tesla, gold) or a ticker (AAPL, RELIANCE.NS, EURUSD=X).`);
  return a;
};

// ---- mike_analyze -----------------------------------------------------------
const analyzeSchema = z.object({
  asset: z.string().min(1).max(40).describe("Asset name or ticker: BTC, ETH, NIFTY, SENSEX, NASDAQ, GOLD, EUR/USD, AAPL, RELIANCE.NS …"),
  timeframe: tf.optional().describe("Setup timeframe (default: the user's setting, usually 1h)."),
  market: z.enum(MARKETS.map((m) => m.id) as [MarketKind, ...MarketKind[]]).optional(),
  mode: z.enum(["mtf", "single"]).optional().describe("mtf (default) compares higher/lower timeframes; single = this timeframe only."),
});
export const mikeAnalyzeTool: ToolDefinition<z.infer<typeof analyzeSchema>> = {
  name: "mike_analyze",
  description:
    "Full evidence-based analysis of one asset from REAL market data: market structure, indicators (EMA/SMA/RSI/MACD/ATR/ADX/Bollinger/VWAP/OBV/Stochastic/Fibonacci), regime, multi-timeframe alignment, news context, 8 independent confirmations, " +
    "confidence 0–100 (evidence quality, NOT win probability), and either a validated trade setup (entry zone, stop, 3 targets, R:R, invalidation, position size) or NO TRADE with reasons. Records it in the journal.",
  schema: analyzeSchema,
  agentScope: "mike",
  activityLabel: "Analysing the chart",
  async execute(input, ctx) {
    const asset = await assetOf(input.asset, input.market);
    const settings = await loadSettings(ctx.userId);
    const timeframe = (input.timeframe ?? settings.defaultTimeframe) as Timeframe;
    ctx.activity(`Scanning ${asset.display} across timeframes…`);
    const a = await analyzeAsset(ctx.userId, asset, timeframe, { mode: input.mode ?? "mtf", settings });
    await recordActivity(ctx.userId, {
      category: "decision", agent: "MIKE", source: "tool", action: `MIKE analysed ${a.asset.display} (${timeframe})`,
      result: a.decision === "setup" && a.setup ? `${a.setup.direction.toUpperCase()} setup · confidence ${a.confidence.score}` : `No trade — ${a.noTradeReasons[0] ?? ""}`,
      status: "info", importance: 2,
    });
    return {
      data: compactAnalysis(a),
      summary: a.data.freshness === "unavailable"
        ? `${a.asset.display}: LIVE DATA UNAVAILABLE.`
        : a.decision === "setup" && a.setup
          ? `${a.asset.display} ${TF_LABEL[timeframe]}: ${a.setup.direction.toUpperCase()} setup · confidence ${a.confidence.score}/100 · R:R 1:${a.setup.riskReward}`
          : `${a.asset.display} ${TF_LABEL[timeframe]}: NO TRADE — ${(a.noTradeReasons[0] ?? "insufficient evidence").split(" — ")[0]}`,
    };
  },
  inputSchema: {
    type: "object",
    properties: {
      asset: { type: "string" }, timeframe: { type: "string", enum: [...TIMEFRAMES] },
      market: { type: "string", enum: MARKETS.map((m) => m.id) }, mode: { type: "string", enum: ["mtf", "single"] },
    },
    required: ["asset"],
  },
};

// ---- mike_scan --------------------------------------------------------------
const scanSchema = z.object({
  assets: z.array(z.string().max(40)).max(20).optional().describe("Assets to scan (default: the user's watchlist)."),
  timeframe: tf.optional(),
});
export const mikeScanTool: ToolDefinition<z.infer<typeof scanSchema>> = {
  name: "mike_scan",
  description:
    "Scan a watchlist from REAL market data on one timeframe: price, 24h change, trend bias, regime, volatility, volume vs average, and detected events " +
    "(breakouts, breakdowns, reversals, consolidation, support/resistance, liquidity zones, volume spikes, volatility expansion, momentum shifts, unusual activity). Also the market summary (status, trend, sentiment, movers). Use it to find candidates, then mike_analyze the best.",
  schema: scanSchema,
  agentScope: "mike",
  activityLabel: "Scanning the market",
  async execute(input, ctx) {
    const settings = await loadSettings(ctx.userId);
    const r = await scanMarket(input.assets?.length ? input.assets : settings.watchlist, (input.timeframe ?? settings.defaultTimeframe) as Timeframe);
    return { data: scanData(r), summary: `Scanned ${r.summary.assets} assets on ${TF_LABEL[r.timeframe]} — ${r.summary.status}.` };
  },
  inputSchema: { type: "object", properties: { assets: { type: "array", items: { type: "string" } }, timeframe: { type: "string", enum: [...TIMEFRAMES] } } },
};

function scanData(r: Awaited<ReturnType<typeof scanMarket>>) {
  return {
    timeframe: TF_LABEL[r.timeframe], scannedAt: r.scannedAt, market: r.summary,
    rows: [...r.rows].sort((a, b) => b.interest - a.interest).map((x) => ({
      asset: x.asset.display, data: x.freshness, price: x.price != null ? fmtPrice(x.price) : null,
      change24h: fmtPct(x.change24hPct), bias: x.bias, evidenceScore: x.score, regime: x.regimeLabel,
      volumeVsAvg: x.volumeRatio != null ? `${x.volumeRatio.toFixed(2)}×` : "n/a", events: x.eventLabels, interest: x.interest,
      ...(x.freshness === "unavailable" ? { note: x.note } : {}),
    })),
  };
}

// ---- mike_backtest ----------------------------------------------------------
const btSchema = z.object({
  asset: z.string().min(1).max(40),
  timeframe: tf.optional(),
  strategy: z.enum(Object.keys(STRATEGIES) as [StrategyId, ...StrategyId[]]).optional().describe(Object.entries(STRATEGIES).map(([k, v]) => `${k}: ${v}`).join("; ")),
});
export const mikeBacktestTool: ToolDefinition<z.infer<typeof btSchema>> = {
  name: "mike_backtest",
  description: "Backtest a strategy on REAL historical candles with no look-ahead (next-bar entries, conservative stops, fees). Returns trades, win rate, avg win/loss, profit factor, max drawdown, expectancy, Sharpe per trade, holding period, losing streak and results by market regime. Results are BACKTEST, not live performance.",
  schema: btSchema,
  agentScope: "mike",
  activityLabel: "Backtesting",
  async execute(input, ctx) {
    const asset = await assetOf(input.asset);
    const settings = await loadSettings(ctx.userId);
    const timeframe = (input.timeframe ?? settings.defaultTimeframe) as Timeframe;
    const s = await fetchSeries(asset, timeframe, { historyBars: 2000 });
    if (!s.candles.length) throw new ToolError(`LIVE DATA UNAVAILABLE — ${s.note}`);
    const bars = closedBars(s);
    if (bars.length < 300) throw new ToolError(`Only ${bars.length} bars of history for ${asset.display} on ${timeframe} — too few for a meaningful backtest.`);
    const r = backtest(bars, { strategy: input.strategy ?? "mike", timeframe, hasVolume: s.hasVolume, minConfidence: settings.minConfidence, minRiskReward: settings.minRiskReward, riskPctPerTrade: settings.riskPct });
    const { trades: _t, equityR: _e, ...stats } = r;
    return {
      data: { asset: asset.display, source: s.source, period: `${new Date(r.from!).toISOString().slice(0, 10)} → ${new Date(r.to!).toISOString().slice(0, 10)}`, ...stats },
      summary: `BACKTEST ${asset.display} ${TF_LABEL[timeframe]}: ${r.totalTrades} trades, win rate ${r.winRate}%, expectancy ${r.expectancyR}R, max drawdown ${r.maxDrawdownR}R.`,
    };
  },
  inputSchema: { type: "object", properties: { asset: { type: "string" }, timeframe: { type: "string", enum: [...TIMEFRAMES] }, strategy: { type: "string", enum: Object.keys(STRATEGIES) } }, required: ["asset"] },
};

// ---- mike_journal -----------------------------------------------------------
const jSchema = z.object({ limit: z.number().int().min(1).max(30).optional(), decision: z.enum(["setup", "no_trade"]).optional() });
export const mikeJournalTool: ToolDefinition<z.infer<typeof jSchema>> = {
  name: "mike_journal",
  description: "MIKE's signal journal: recent analyses (setups and no-trades) with their outcome and self-audit, plus live statistics by confidence tier, regime, timeframe and confirmation (only once enough setups have finished).",
  schema: jSchema,
  agentScope: "mike",
  activityLabel: "Reading the signal journal",
  async execute(input, ctx) {
    const [rows, insights] = await Promise.all([
      getDb().mikeSignal.findMany({ where: { userId: ctx.userId, ...(input.decision ? { decision: input.decision } : {}) }, orderBy: { createdAt: "desc" }, take: input.limit ?? 10 }),
      journalInsights(ctx.userId),
    ]);
    return {
      data: {
        signals: rows.map((r) => ({
          id: r.id, at: r.createdAt.toISOString(), asset: r.asset, timeframe: r.timeframe, decision: r.decision, direction: r.direction,
          status: r.status, confidence: r.confidence, entry: r.entryLow != null ? `${fmtPrice(r.entryLow)} – ${fmtPrice(r.entryHigh)}` : null,
          stop: r.stop != null ? fmtPrice(r.stop) : null, outcome: r.outcome, audit: r.audit,
          noTradeReasons: (r.reasoning as { noTradeReasons?: string[] } | null)?.noTradeReasons ?? [],
        })),
        insights,
      },
      summary: `${rows.length} journal entr${rows.length === 1 ? "y" : "ies"} · ${insights.resolved} finished setup${insights.resolved === 1 ? "" : "s"}.`,
    };
  },
  inputSchema: { type: "object", properties: { limit: { type: "number" }, decision: { type: "string", enum: ["setup", "no_trade"] } } },
};

// ---- mike_alert -------------------------------------------------------------
const aSchema = z.object({
  action: z.enum(["create", "list", "delete"]),
  asset: z.string().max(40).optional(),
  kind: z.enum(ALERT_KINDS).optional(),
  level: z.number().finite().optional(),
  timeframe: tf.optional(),
  id: z.string().max(40).optional(),
});
export const mikeAlertTool: ToolDefinition<z.infer<typeof aSchema>> = {
  name: "mike_alert",
  description: `Market alerts that NOTIFY the user (they never trade): ${ALERT_KINDS.map((k) => `${k} (${ALERT_LABEL[k]})`).join(", ")}. price_*/rsi_* need a level. action: create | list | delete (by id).`,
  schema: aSchema,
  agentScope: "mike",
  activityLabel: "Setting a market alert",
  async execute(input, ctx) {
    const db = getDb();
    if (input.action === "list") {
      const alerts = await db.mikeAlert.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 30 });
      return { data: { alerts: alerts.map((a) => ({ id: a.id, asset: a.asset, kind: a.kind, level: a.level, timeframe: a.timeframe, status: a.status, triggered: a.triggerInfo })) }, summary: `${alerts.filter((a) => a.status === "active").length} active alert(s).` };
    }
    if (input.action === "delete") {
      if (!input.id) throw new ToolError("Which alert? Give its id (from list).");
      const r = await db.mikeAlert.deleteMany({ where: { id: input.id, userId: ctx.userId } });
      return { data: { removed: r.count }, summary: r.count ? "Alert removed." : "No such alert." };
    }
    if (!input.asset || !input.kind) throw new ToolError("Give the asset and the kind of alert.");
    if (NEEDS_LEVEL.includes(input.kind as AlertKind) && input.level == null) throw new ToolError(`${ALERT_LABEL[input.kind as AlertKind]} needs a level.`);
    const asset = await assetOf(input.asset);
    const alert = await db.mikeAlert.create({ data: { userId: ctx.userId, asset: asset.display, symbol: asset.symbol, provider: asset.provider, kind: input.kind, level: input.level ?? null, timeframe: input.timeframe ?? "1h" } });
    await recordActivity(ctx.userId, { category: "decision", agent: "MIKE", source: "tool", action: `MIKE alert set: ${asset.display} ${ALERT_LABEL[input.kind as AlertKind]}${input.level != null ? ` ${input.level}` : ""}`, status: "success", importance: 2 });
    return { data: { id: alert.id, asset: asset.display, kind: input.kind, level: input.level ?? null, note: "Alerts notify only — MIKE never places trades." }, summary: `Alert set: ${asset.display} ${ALERT_LABEL[input.kind as AlertKind]}${input.level != null ? ` ${input.level}` : ""}.` };
  },
  inputSchema: {
    type: "object",
    properties: { action: { type: "string", enum: ["create", "list", "delete"] }, asset: { type: "string" }, kind: { type: "string", enum: [...ALERT_KINDS] }, level: { type: "number" }, timeframe: { type: "string", enum: [...TIMEFRAMES] }, id: { type: "string" } },
    required: ["action"],
  },
};

// ---- mike_chart (MIKE + JARVIS) -----------------------------------------------
const chartSchema = z.object({
  asset: z.string().min(1).max(60).describe("Any market by name or ticker: Bitcoin, Reliance, Tesla, Nifty, gold, EUR/USD, AAPL, RELIANCE.NS, PEPE…"),
  timeframe: tf.optional(),
});
/** Pull up the LIVE chart of any market on MIKE's screen. */
export const mikeChartTool: ToolDefinition<z.infer<typeof chartSchema>> = {
  name: "mike_chart",
  description:
    "Pull up the LIVE price chart of any market (stocks on any exchange, indices, crypto, forex, commodities, ETFs, futures) on MIKE's screen — candlesticks, volume, indicators. " +
    "Use for 'show me the chart of X', 'pull up Tesla', 'open the Bitcoin chart', 'chart gold on the daily'. It only shows the chart; it makes no trade call. Opens MIKE if needed.",
  schema: chartSchema,
  activityLabel: "Pulling up the chart",
  async execute(input) {
    const asset = await assetOf(input.asset);
    const timeframe = (input.timeframe ?? "1h") as Timeframe;
    const s = await fetchSeries(asset, timeframe, { maxAgeMs: 5000 });
    const last = s.candles.at(-1);
    const status = s.freshness === "live" ? "LIVE" : s.freshness === "unavailable" ? "LIVE DATA UNAVAILABLE" : s.freshness.toUpperCase();
    return {
      data: {
        navigate: `/dashboard/mike?chart=${encodeURIComponent(asset.symbol)}&tf=${timeframe}`,
        asset: asset.display, name: asset.name ?? null, exchange: s.asset.exchange, timeframe: TF_LABEL[timeframe],
        data: status, note: s.note, lastPrice: last ? fmtPrice(last.c) : null, currency: s.currency ?? null,
      },
      summary: s.freshness === "unavailable" ? `${asset.display}: ${status} — ${s.note}` : `Chart: ${asset.name ?? asset.display} · ${TF_LABEL[timeframe]} · ${status}${last ? ` · ${fmtPrice(last.c)}` : ""}`,
    };
  },
  inputSchema: { type: "object", properties: { asset: { type: "string" }, timeframe: { type: "string", enum: [...TIMEFRAMES] } }, required: ["asset"] },
};

// ---- JARVIS → MIKE ----------------------------------------------------------
const sumSchema = z.object({
  assets: z.array(z.string().max(40)).max(10).optional().describe("Assets to include (default: the user's MIKE watchlist)."),
  timeframe: tf.optional(),
});
/** JARVIS asks MIKE for a structured market summary (no setups are forced). */
export const mikeMarketSummaryTool: ToolDefinition<z.infer<typeof sumSchema>> = {
  name: "mike_market_summary",
  description:
    "Ask MIKE (the trading-intelligence agent) for a structured market summary from REAL market data: market status, trend, volatility, sentiment, top movers, notable events per asset, active setups and no-trade conditions. " +
    "Use for 'how are the markets', 'market summary', 'what's Bitcoin doing'. For a full trade analysis tell the user to activate MIKE. Never give prices from memory.",
  schema: sumSchema,
  activityLabel: "Asking MIKE for a market summary",
  async execute(input, ctx) {
    const settings = await loadSettings(ctx.userId);
    const r = await scanMarket(input.assets?.length ? input.assets : settings.watchlist, (input.timeframe ?? "1h") as Timeframe);
    const active = await getDb().mikeSignal.findMany({ where: { userId: ctx.userId, decision: "setup", status: { in: ["open", "triggered"] } }, orderBy: { createdAt: "desc" }, take: 5 });
    return {
      data: {
        from: "MIKE",
        ...scanData(r),
        activeSetups: active.map((s) => ({ asset: s.asset, timeframe: s.timeframe, direction: s.direction, confidence: s.confidence, status: s.status, at: s.createdAt.toISOString() })),
        warning: RISK_WARNING,
      },
      summary: `MIKE: ${r.summary.status} · trend ${r.summary.trend} · sentiment ${r.summary.sentiment.replace("_", " ")}.`,
    };
  },
  inputSchema: { type: "object", properties: { assets: { type: "array", items: { type: "string" } }, timeframe: { type: "string", enum: [...TIMEFRAMES] } } },
};
