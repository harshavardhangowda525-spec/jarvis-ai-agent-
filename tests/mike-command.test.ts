import { describe, it, expect } from "vitest";
import { parseMikeCommand, timeframeInText } from "@/lib/mike/command";
import { compactAnalysis, spokenSummary } from "@/lib/mike/summary";
import { buildMikeSystemPrompt } from "@/lib/mike/prompt";
import { availableTools } from "@/lib/tools/registry";

describe("MIKE voice / text commands", () => {
  it("routes the commands from the brief", () => {
    expect(parseMikeCommand("Mike, scan the market.")).toEqual({ kind: "scan", setups: false });
    expect(parseMikeCommand("Mike, find high-confidence setups")).toEqual({ kind: "scan", setups: true });
    expect(parseMikeCommand("Mike, show me today's strongest setups")).toEqual({ kind: "scan", setups: true });
    expect(parseMikeCommand("Mike, what changed in the market?")).toMatchObject({ kind: "scan" });
    const a = parseMikeCommand("Mike, analyze Bitcoin on the 4 hour");
    expect(a).toMatchObject({ kind: "analyze", timeframe: "4h" });
    expect(a.kind === "analyze" && a.asset?.symbol).toBe("BTCUSDT");
    expect(parseMikeCommand("Mike, analyze NIFTY")).toMatchObject({ kind: "analyze", asset: { symbol: "^NSEI" } });
    expect(parseMikeCommand("Mike, backtest this strategy")).toMatchObject({ kind: "backtest" });
    // questions go to MIKE's brain
    expect(parseMikeCommand("Mike, why is this a no-trade?").kind).toBe("ask");
    expect(parseMikeCommand("Mike, explain this chart.").kind).toBe("ask");
    expect(parseMikeCommand("Mike, compare these assets").kind).toBe("ask");
    expect(parseMikeCommand("back to JARVIS").kind).toBe("exit");
    expect(timeframeInText("on the daily")).toBe("1d");
    expect(timeframeInText("15 minute chart")).toBe("15m");
  });
});

describe("MIKE's brain", () => {
  it("has hard anti-hallucination rules and its own tools", () => {
    const p = buildMikeSystemPrompt({ userDisplayName: "Harsha", timezone: "Asia/Kolkata", journalSummary: "", newsAvailable: false, settingsSummary: "" });
    expect(p).toMatch(/NEVER state a price/);
    expect(p).toMatch(/NOT the probability/);
    expect(p).toMatch(/Never manufacture a setup/);
    expect(p).toMatch(/Never say "99%"/);
    const mike = availableTools("mike").map((t) => t.name);
    expect(mike).toEqual(expect.arrayContaining(["mike_analyze", "mike_scan", "mike_backtest", "mike_journal", "mike_alert"]));
    // JARVIS can ask MIKE for a summary, but doesn't get MIKE's own tools
    const jarvis = availableTools().map((t) => t.name);
    expect(jarvis).toContain("mike_market_summary");
    expect(jarvis).not.toContain("mike_analyze");
    expect(availableTools("darwin").map((t) => t.name)).not.toContain("mike_scan");
  });

  it("says 'no trade' out loud when data is missing, and never calls confidence a win chance", () => {
    const base = {
      asset: { display: "BTC/USDT", symbol: "BTCUSDT", kind: "crypto", provider: "binance", exchange: "Binance", group: "crypto" },
      timeframe: "1h", generatedAt: "", mode: "mtf",
      data: { source: "Binance", freshness: "unavailable", note: "Couldn't reach Binance", lastBarAt: null, perTimeframe: [] },
      regime: { id: "ranging", volatility: "normal", breakout: false, reversal: false, label: "", evidence: [] },
      alignment: [], primary: null, checks: [], direction: null,
      confidence: { score: 0, tier: "no_trade", breakdown: [], adjustments: [] },
      decision: "no_trade", setup: null, noTradeReasons: ["LIVE DATA UNAVAILABLE — Couldn't reach Binance"],
      sentiment: { price: "neutral", evidence: [] },
      external: { available: false, note: "no key", headlines: [], newsSentiment: null, eventRisk: [] }, risk: null, chart: null,
    } as never;
    expect(spokenSummary(base)).toMatch(/unavailable.*No trade/);
    const c = compactAnalysis(base) as { data: { status: string }; decision: string; confidence: { meaning: string } };
    expect(c.data.status).toBe("LIVE DATA UNAVAILABLE");
    expect(c.decision).toBe("NO TRADE");
    expect(c.confidence.meaning).toMatch(/NOT the probability/);
  });
});
