import { describe, it, expect } from "vitest";
import { prepare, analyzeAt } from "@/lib/mike/timeframe";
import { decide } from "@/lib/mike/decide";
import { marketRead } from "@/lib/mike/market-read";
import { spokenSummary } from "@/lib/mike/summary";
import { DEFAULT_SETTINGS, type MikeAnalysis, type TfAnalysis } from "@/lib/mike/types";
import { walk } from "./mike-helpers";

/** A whole analysis around a real computed timeframe (the engine's own output). */
function analysis(primary: TfAnalysis, alignment: MikeAnalysis["alignment"]): MikeAnalysis {
  const d = decide({ primary, freshness: "live", hasVolume: true, external: null, settings: DEFAULT_SETTINGS, mode: "mtf", alignment });
  return {
    asset: { display: "BTC/USDT", symbol: "BTCUSDT", kind: "crypto", provider: "binance", exchange: "Binance", group: "crypto" },
    timeframe: "1h", generatedAt: new Date(0).toISOString(), mode: "mtf",
    data: { source: "Binance", freshness: "live", note: "", lastBarAt: null, perTimeframe: [] },
    regime: primary.regime, alignment, primary, checks: d.checks, direction: d.direction, confidence: d.confidence,
    decision: d.decision, setup: d.setup, noTradeReasons: d.noTradeReasons,
    sentiment: { price: "neutral", evidence: [] }, external: { available: false, note: "", headlines: [], newsSentiment: null, eventRisk: [] },
    risk: null, chart: null,
  } as MikeAnalysis;
}

describe("MIKE's market read (shown even when there's no trade)", () => {
  const down = walk(400, { start: 90_000, drift: -0.0015, vol: 0.006, seed: 11 });
  const tf = analyzeAt(prepare(down, "1h"), down.length - 1);
  const split: MikeAnalysis["alignment"] = [
    { timeframe: "1w", bias: "bullish", score: 60, role: "context" },
    { timeframe: "1d", bias: "bullish", score: 50, role: "context" },
    { timeframe: "4h", bias: "bearish", score: -35, role: "context" },
    { timeframe: "1h", bias: tf.bias, score: tf.score, role: "setup" },
    { timeframe: "15m", bias: "neutral", score: 0, role: "entry" },
  ];

  it("a rejected setup still gets the full analysis — from the engine's numbers only", () => {
    const a = analysis(tf, split);
    expect(a.decision).toBe("no_trade");
    const r = marketRead(a)!;
    expect(r).not.toBeNull();
    expect(r.timeframes.map((t) => t.label)).toEqual(["1W", "1D", "4H", "1H", "15M"]);
    // 2 bullish, 2 bearish, 1 neutral → no clear direction, said plainly
    expect(tf.bias).toBe("bearish");
    expect(r.lean).toEqual({ bias: "neutral", text: "No clear direction — 2 bullish, 2 bearish, 1 neutral" });
    // levels are the engine's levels, on the right side of price
    const px = tf.snapshot.price;
    for (const l of r.support) expect(l.distPct).toBeLessThan(0);
    for (const l of r.resistance) expect(l.distPct).toBeGreaterThan(0);
    expect(r.support.length + r.resistance.length).toBeGreaterThan(0);
    if (tf.support[0]) expect(r.support[0].distPct).toBeCloseTo(((tf.support[0].price - px) / px) * 100, 0);
    expect(r.indicators.map((i) => i.label)).toEqual(expect.arrayContaining(["RSI (14)", "Trend strength (ADX)", "MACD", "Moving averages"]));
    expect(r.indicators.find((i) => i.label === "RSI (14)")!.value).toMatch(new RegExp(`^${Math.round(tf.snapshot.rsi)} — `));
    expect(r.structure).toMatch(tf.trend === "down" ? /Downtrend/ : tf.trend === "up" ? /Uptrend/ : /Range/);
    expect(r.watch.length).toBeGreaterThan(0);
    expect(r.watch.join(" ")).not.toMatch(/\b(buy|sell|enter|go long|go short)\b/i); // levels to watch — never a trade call
  });

  it("MIKE says the analysis out loud too, not just 'no trade'", () => {
    const a = analysis(tf, split);
    const said = spokenSummary(a);
    expect(said).toMatch(/at [\d,.]+\./);
    expect(said).toMatch(/No high-conviction setup — main reason/);
  });

  it("no market data → no made-up analysis", () => {
    const a = { ...analysis(tf, split), primary: null, data: { source: "", freshness: "unavailable", note: "", lastBarAt: null, perTimeframe: [] } } as MikeAnalysis;
    expect(marketRead(a)).toBeNull();
  });
});
