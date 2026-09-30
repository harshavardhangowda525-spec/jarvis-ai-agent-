import { describe, it, expect, afterEach } from "vitest";
import { sma, ema, rsi, atr, macd, bollinger, fibRetracement, fibExtension, stochastic } from "@/lib/mike/indicators";
import { prepare, analyzeAt } from "@/lib/mike/timeframe";
import { decide, buildSetup, directionScore, MIN_BARS } from "@/lib/mike/decide";
import { riskPlan } from "@/lib/mike/risk";
import { resolveAsset, assetInText } from "@/lib/mike/assets";
import { fetchSeries, clearMarketCache, closedBars, groupBars } from "@/lib/mike/data";
import { timeframePlan } from "@/lib/mike/analyze";
import { DEFAULT_SETTINGS, tierOf } from "@/lib/mike/types";
import { walk, binanceJson, yahooJson } from "./mike-helpers";

const SETTINGS = { minConfidence: 70, minRiskReward: 2 };

describe("indicators", () => {
  it("match hand-computed values", () => {
    expect(sma([1, 2, 3, 4, 5], 3).slice(2)).toEqual([2, 3, 4]);
    const e = ema([1, 2, 3, 4, 5, 6], 3);
    expect(e[2]).toBeCloseTo(2); // seeded with the SMA
    expect(e[3]).toBeCloseTo(3);
    expect(Number.isNaN(e[1])).toBe(true);
    // steadily rising closes → RSI 100; steadily falling → 0
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 + i), 14).at(-1)).toBe(100);
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 - i), 14).at(-1)).toBe(0);
    const bb = bollinger(Array(25).fill(10), 20, 2);
    expect(bb.upper.at(-1)).toBe(10);
    expect(fibRetracement(100, 200)[2].price).toBe(150);
    expect(fibExtension(100, 200)[0].price).toBeCloseTo(227.2);
  });

  it("ATR / MACD / stochastic are finite once warmed up", () => {
    const c = walk(300);
    expect(Number.isFinite(atr(c).at(-1)!)).toBe(true);
    expect(Number.isFinite(macd(c.map((x) => x.c)).hist.at(-1)!)).toBe(true);
    const st = stochastic(c);
    expect(st.k.at(-1)!).toBeGreaterThanOrEqual(0);
    expect(st.k.at(-1)!).toBeLessThanOrEqual(100);
  });
});

describe("no look-ahead", () => {
  it("the analysis at bar i is identical whether or not later bars exist", () => {
    const c = walk(400, { drift: 0.002, seed: 11 });
    const full = prepare(c, "1h");
    for (const i of [230, 290, 350]) {
      const a = analyzeAt(full, i);
      const b = analyzeAt(prepare(c.slice(0, i + 1), "1h"), i);
      expect(a.score).toBe(b.score);
      expect(a.bias).toBe(b.bias);
      expect(a.trend).toBe(b.trend);
      expect(a.support).toEqual(b.support);
      expect(a.resistance).toEqual(b.resistance);
      expect(a.events).toEqual(b.events);
      expect(a.swings).toEqual(b.swings);
      expect(a.regime.id).toBe(b.regime.id);
    }
  });
});

describe("validation engine", () => {
  const up = walk(400, { drift: 0.004, vol: 0.008, seed: 3 });
  const upA = analyzeAt(prepare(up, "1h"), up.length - 1);

  it("a clean multi-timeframe uptrend gives a long setup with ordered levels", () => {
    expect(upA.bias).toBe("bullish");
    const d = decide({
      primary: upA, freshness: "live", hasVolume: true, external: null, settings: SETTINGS, mode: "mtf",
      alignment: [
        { timeframe: "1d", bias: "bullish", score: 70, role: "context" },
        { timeframe: "4h", bias: "bullish", score: 65, role: "context" },
        { timeframe: "1h", bias: upA.bias, score: upA.score, role: "setup" },
        { timeframe: "15m", bias: "bullish", score: 40, role: "entry" },
      ],
    });
    expect(d.direction).toBe("long");
    const s = d.setup!;
    expect(s.stop).toBeLessThan(s.entryLow);
    expect(s.entryLow).toBeLessThan(s.entryHigh);
    expect(s.targets[0].price).toBeGreaterThan(s.entryHigh);
    expect(s.targets[1].price).toBeGreaterThan(s.targets[0].price);
    expect(s.targets[2].price).toBeGreaterThan(s.targets[1].price);
    expect(s.riskReward).toBeGreaterThanOrEqual(2);
    expect(d.checks.find((c) => c.id === "mtf")!.state).toBe("pass");
    expect(d.checks.find((c) => c.id === "context")!.state).toBe("unavailable"); // no news source → not counted, not faked
    expect(d.confidence.adjustments.join(" ")).toMatch(/evidence unavailable/);
    // the confidence is a transparent sum of the checks
    expect(d.confidence.breakdown.length).toBe(8);
    if (d.decision === "setup") expect(d.noTradeReasons).toEqual([]);
    else expect(d.noTradeReasons.length).toBeGreaterThan(0);
  });

  it("a higher timeframe against the setup → TIMEFRAME CONFLICT, no trade", () => {
    const d = decide({
      primary: upA, freshness: "live", hasVolume: true, external: null, settings: SETTINGS, mode: "mtf",
      alignment: [
        { timeframe: "1d", bias: "bearish", score: -70, role: "context" },
        { timeframe: "4h", bias: "bullish", score: 50, role: "context" },
        { timeframe: "1h", bias: "bullish", score: upA.score, role: "setup" },
        { timeframe: "15m", bias: "bullish", score: 40, role: "entry" },
      ],
    });
    expect(d.decision).toBe("no_trade");
    expect(d.noTradeReasons.join(" ")).toMatch(/TIMEFRAME CONFLICT/);
  });

  it("evenly split timeframes → no direction at all", () => {
    const d = decide({
      primary: upA, freshness: "live", hasVolume: true, external: null, settings: SETTINGS, mode: "mtf",
      alignment: [
        { timeframe: "1d", bias: "bearish", score: -60, role: "context" },
        { timeframe: "4h", bias: "bearish", score: -50, role: "context" },
        { timeframe: "1h", bias: "bullish", score: 40, role: "setup" },
        { timeframe: "15m", bias: "neutral", score: 0, role: "entry" },
      ],
    });
    expect(d.direction).toBeNull();
    expect(d.decision).toBe("no_trade");
    expect(d.setup).toBeNull();
  });

  it("no data / too little data / news against → no trade, with the reason", () => {
    const base = { primary: upA, hasVolume: true, external: null, settings: SETTINGS, mode: "single" as const, alignment: [] };
    expect(decide({ ...base, freshness: "unavailable" }).noTradeReasons[0]).toMatch(/LIVE DATA UNAVAILABLE/);
    const short = analyzeAt(prepare(up.slice(0, 120), "1h"), 119);
    expect(decide({ ...base, primary: short, freshness: "live" }).noTradeReasons[0]).toMatch(new RegExp(`only 120 bars.*${MIN_BARS}`));
    const neg = decide({
      ...base, freshness: "live",
      external: { available: true, note: "", headlines: [], newsSentiment: "extremely_bearish", eventRisk: [] },
    });
    expect(neg.checks.find((c) => c.id === "context")!.state).toBe("fail");
    expect(neg.decision).toBe("no_trade");
  });

  it("a demanding minimum R:R blocks the setup rather than stretching the targets", () => {
    const d = decide({ primary: upA, freshness: "live", hasVolume: true, external: null, settings: { minConfidence: 0, minRiskReward: 50 }, mode: "single", alignment: [] });
    expect(d.noTradeReasons.join(" ")).toMatch(/POOR RISK\/REWARD/);
  });

  it("weights higher timeframes more when deciding direction", () => {
    expect(directionScore([{ timeframe: "1d", bias: "bullish", score: 50, role: "context" }, { timeframe: "15m", bias: "bearish", score: -50, role: "entry" }])).toBeGreaterThan(0);
  });

  it("short setups mirror long ones", () => {
    const dn = walk(400, { drift: -0.004, vol: 0.008, seed: 5 });
    const a = analyzeAt(prepare(dn, "1h"), dn.length - 1);
    const s = buildSetup(a, "short");
    expect(s.stop).toBeGreaterThan(s.entryHigh);
    expect(s.targets[0].price).toBeLessThan(s.entryLow);
    expect(s.targets[2].price).toBeLessThan(s.targets[1].price);
    expect(s.invalidation).toMatch(/close above/);
  });

  it("confidence tiers", () => {
    expect([95, 85, 75, 65, 40].map(tierOf)).toEqual(["very_strong", "strong", "moderate", "weak", "no_trade"]);
  });
});

describe("risk", () => {
  const setup = { direction: "long" as const, entryLow: 99, entryHigh: 101, stop: 95, targets: [], riskReward: 2, invalidation: "", stopBasis: "" };
  it("sizes from the stop distance and the risk %, never from confidence", () => {
    const r = riskPlan({ ...DEFAULT_SETTINGS, accountSize: 10_000, riskPct: 1 }, setup, "crypto", [], "BTC/USDT");
    expect(r.riskAmount).toBe(100);
    expect(r.units).toBe(20); // 100 / (100 - 95)
    expect(r.notional).toBe(2000);
  });
  it("respects the daily limit and halves risk when a correlated asset is already open", () => {
    const r = riskPlan({ ...DEFAULT_SETTINGS, accountSize: 10_000, riskPct: 1, maxDailyRiskPct: 3 }, setup, "crypto", [{ asset: "ETH/USDT", group: "crypto", riskPct: 2.5 }], "BTC/USDT");
    expect(r.riskPct).toBe(0.25); // 0.5 left today, halved for correlation
    expect(r.warnings.join(" ")).toMatch(/Correlated/);
    const full = riskPlan({ ...DEFAULT_SETTINGS, accountSize: 10_000 }, setup, "crypto", [{ asset: "ETH/USDT", group: "crypto", riskPct: 3 }], "BTC/USDT");
    expect(full.riskPct).toBe(0);
    expect(full.units).toBe(0);
  });
});

describe("assets", () => {
  it("resolves names people say", () => {
    expect(resolveAsset("bitcoin")!.symbol).toBe("BTCUSDT");
    expect(resolveAsset("Nifty")!.symbol).toBe("^NSEI");
    expect(resolveAsset("gold")!.symbol).toBe("GC=F");
    expect(resolveAsset("eur/usd")!.symbol).toBe("EURUSD=X");
    expect(resolveAsset("RELIANCE.NS")).toMatchObject({ provider: "yahoo", exchange: "NSE", kind: "stock" });
    expect(resolveAsset("PEPEUSDT")).toMatchObject({ provider: "binance", symbol: "PEPEUSDT" });
    expect(assetInText("Mike, analyze Bitcoin on the 4 hour")!.symbol).toBe("BTCUSDT");
    expect(assetInText("Mike analyze bank nifty")!.symbol).toBe("^NSEBANK");
    expect(assetInText("scan the market")).toBeNull();
  });
  it("plans the timeframe ladder (1D → 4H → 1H → 15M → 5M)", () => {
    expect(timeframePlan("15m").map((p) => p.timeframe)).toEqual(["1d", "4h", "1h", "15m", "5m"]);
    expect(timeframePlan("1d").map((p) => `${p.timeframe}:${p.role}`)).toEqual(["1w:context", "1d:setup", "4h:entry"]);
  });
});

describe("market data (stubbed feeds)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; clearMarketCache(); });
  const now = Date.UTC(2026, 5, 1, 12, 30);

  it("Binance: real-time candles are labelled live", async () => {
    const c = walk(300, { t0: now - 300 * 3_600_000 + 3_600_000 });
    const urls: string[] = [];
    const f = (async (u: RequestInfo | URL) => { urls.push(String(u)); return Response.json(binanceJson(c)); }) as typeof fetch;
    const s = await fetchSeries(resolveAsset("btc")!, "1h", { fetchImpl: f, now });
    expect(urls[0]).toMatch(/klines\?symbol=BTCUSDT&interval=1h/);
    expect(s.freshness).toBe("live");
    expect(s.candles.length).toBe(300);
    // the still-forming bar is drawn but never analysed
    expect(closedBars(s, now).length).toBe(299);
  });

  it("Yahoo: labelled delayed while open, closed after the session, never live", async () => {
    const c = walk(300, { t0: now - 300 * 3_600_000 + 3_600_000 });
    const open = { currentTradingPeriod: { regular: { start: now / 1000 - 3600, end: now / 1000 + 3600 } } };
    const f = (async () => Response.json(yahooJson(c, open))) as typeof fetch;
    const s = await fetchSeries(resolveAsset("nifty")!, "1h", { fetchImpl: f, now, noCache: true });
    expect(s.freshness).toBe("delayed");
    expect(s.note).toMatch(/may lag/);
    const shut = { currentTradingPeriod: { regular: { start: now / 1000 - 9 * 3600, end: now / 1000 - 3 * 3600 } } };
    const g = (async () => Response.json(yahooJson(c, shut))) as typeof fetch;
    expect((await fetchSeries(resolveAsset("nifty")!, "1h", { fetchImpl: g, now, noCache: true })).freshness).toBe("closed");
  });

  it("Yahoo gaps (null bars) are skipped and 4H is built from 1H", async () => {
    const c = walk(40, { t0: Date.UTC(2026, 5, 1) });
    const j = yahooJson(c);
    j.chart.result[0].indicators.quote[0].close[5] = null as unknown as number;
    const f = (async () => Response.json(j)) as typeof fetch;
    const s = await fetchSeries(resolveAsset("nifty")!, "4h", { fetchImpl: f, now, noCache: true });
    expect(s.candles.length).toBe(10);
    expect(groupBars(c.slice(0, 8), 4 * 3_600_000).length).toBe(2);
  });

  it("feed down → UNAVAILABLE with the reason, and no candles at all", async () => {
    const f = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    const s = await fetchSeries(resolveAsset("nifty")!, "1h", { fetchImpl: f, now, noCache: true });
    expect(s.freshness).toBe("unavailable");
    expect(s.candles).toEqual([]);
    expect(s.note).toMatch(/Couldn't reach Yahoo Finance \(HTTP 503\)/);
  });

  it("Binance blocked in this region → the same coin from Yahoo, labelled delayed", async () => {
    const c = walk(300, { t0: now - 300 * 3_600_000 + 3_600_000 });
    const f = (async (u: RequestInfo | URL) => String(u).includes("binance")
      ? new Response("{}", { status: 451 })
      : Response.json(yahooJson(c, { currency: "USD" }))) as typeof fetch;
    const s = await fetchSeries(resolveAsset("eth")!, "1h", { fetchImpl: f, now, noCache: true });
    expect(s.freshness).toBe("delayed");
    expect(s.asset.display).toBe("ETH/USDT");
    expect(s.note).toMatch(/Binance unreachable/);
  });
});
