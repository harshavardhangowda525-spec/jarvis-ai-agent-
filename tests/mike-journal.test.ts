import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { backtest } from "@/lib/mike/backtest";
import { resolveOutcome, selfAudit } from "@/lib/mike/outcome";
import { alertHits } from "@/lib/mike/alerts";
import { clearMarketCache } from "@/lib/mike/data";
import type { Candle } from "@/lib/mike/types";
import { walk, binanceJson } from "./mike-helpers";

const H = 3_600_000;
const bar = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t, o, h, l, c, v: 1000 });

describe("backtester", () => {
  const candles = walk(900, { drift: 0.0008, vol: 0.012, seed: 42 });

  it("never uses the future: results on a prefix don't change when more history is appended", () => {
    const a = backtest(candles.slice(0, 600), { strategy: "ema_cross", timeframe: "1h" });
    const b = backtest(candles, { strategy: "ema_cross", timeframe: "1h" });
    // every trade that CLOSED inside the first 600 bars is identical in the longer run
    const closedEarly = b.trades.filter((t) => t.exitAt <= candles[599].t);
    expect(a.trades.slice(0, closedEarly.length)).toEqual(closedEarly);
  });

  it("reports the full statistics and labels itself BACKTEST", () => {
    const r = backtest(candles, { strategy: "breakout", timeframe: "1h" });
    expect(r.kind).toBe("BACKTEST");
    expect(r.totalTrades).toBe(r.wins + r.losses);
    expect(r.equityR.length).toBe(r.totalTrades);
    if (r.totalTrades) {
      expect(r.winRate).toBeGreaterThanOrEqual(0);
      expect(r.maxDrawdownR).toBeGreaterThanOrEqual(0);
      expect(r.byRegime.reduce((s, x) => s + x.trades, 0)).toBe(r.totalTrades);
    }
    expect(r.notes[0]).toMatch(/not live performance/);
    for (const t of r.trades) {
      expect(t.entryAt).toBeGreaterThan(candles[0].t);
      expect(["target", "stop", "time"]).toContain(t.exitReason);
    }
  });

  it("MIKE's own rules replay too (and admit what isn't replayed)", () => {
    const r = backtest(walk(700, { drift: 0.002, vol: 0.01, seed: 8 }), { strategy: "mike", timeframe: "1h" });
    expect(r.notes.join(" ")).toMatch(/news context isn't replayed/);
    for (const t of r.trades) expect(t.confidence).toBeGreaterThanOrEqual(70);
  });

  it("a bar that hits both stop and target counts as a stop", () => {
    // flat history to warm up, then a signal forced by an EMA cross is hard to stage — test the resolver instead
    const t0 = 1_000_000;
    const o = resolveOutcome(
      { direction: "long", entryLow: 99, entryHigh: 101, stop: 95, targets: [{ price: 105, basis: "", rr: 1 }, { price: 110, basis: "", rr: 2 }, { price: 115, basis: "", rr: 3 }], createdAt: t0 },
      [bar(t0, 100, 101, 99.5, 100.5), bar(t0 + H, 100.5, 111, 94, 100)],
    );
    expect(o.status).toBe("lost");
    expect(o.rMultiple).toBe(-1);
  });
});

describe("signal outcomes + self-audit", () => {
  const t0 = Date.UTC(2026, 3, 1);
  const sig = { direction: "long" as const, entryLow: 99, entryHigh: 101, stop: 95, targets: [{ price: 106, basis: "", rr: 1.2 }, { price: 111, basis: "", rr: 2.2 }, { price: 116, basis: "", rr: 3.2 }], createdAt: t0 };

  it("waits for the entry zone, then tracks MFE/MAE to the target", () => {
    expect(resolveOutcome(sig, [bar(t0, 103, 104, 102, 103)]).status).toBe("open");
    const o = resolveOutcome(sig, [bar(t0, 103, 104, 102, 103), bar(t0 + H, 102, 102, 100, 101), bar(t0 + 2 * H, 101, 107, 98, 106), bar(t0 + 3 * H, 106, 112, 105, 111)]);
    expect(o.status).toBe("won");
    expect(o.entry).toBe(101);
    expect(o.targetsHit).toBe(2);
    expect(o.maeR).toBeCloseTo(0.5, 1); // 101 → 98, risk 6
    expect(o.rMultiple).toBeCloseTo(1.67, 1);
  });

  it("never triggered in 20 bars → not_triggered; candles before the signal are ignored", () => {
    const bars = Array.from({ length: 25 }, (_, i) => bar(t0 + i * H, 120, 121, 119, 120));
    expect(resolveOutcome(sig, [bar(t0 - H, 100, 100, 100, 100), ...bars]).status).toBe("not_triggered");
  });

  it("the audit names what misled it and suggests a change", () => {
    const o = resolveOutcome(sig, [bar(t0, 100, 108, 99, 107), bar(t0 + H, 107, 107, 94, 95)]);
    const a = selfAudit({
      direction: "long", confidence: 86, riskReward: 2.2, regime: "STRONG BULLISH TREND", regimeAfter: "WEAK BEARISH TREND",
      checks: [{ id: "trend", state: "pass", detail: "" }, { id: "volume", state: "neutral", detail: "" }],
      outcome: o, minConfidence: 70, minRiskReward: 2,
    });
    expect(a.actual).toMatch(/Stopped out/);
    expect(a.confirmationsMisleading).toEqual(["trend"]);
    expect(a.overconfident).toBe(true);
    expect(a.regimeCorrect).toBe(false);
    expect(a.lessons.join(" ")).toMatch(/partial exit|break-even/);
  });
});

describe("alerts (pure)", () => {
  it("price alerts only fire on bars after the alert was set", () => {
    const t0 = Date.UTC(2026, 3, 1);
    const bars = [bar(t0, 100, 130, 99, 100), bar(t0 + H, 100, 110, 99, 105)];
    expect(alertHits("price_above", 120, bars, t0 + H, "1h", true).hit).toBe(false);
    expect(alertHits("price_above", 108, bars, t0 + H, "1h", true).hit).toBe(true);
    expect(alertHits("price_below", 99.5, bars, t0 + H, "1h", true).hit).toBe(true);
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("journal + alerts in the database (stubbed Binance feed)", () => {
  const realFetch = globalThis.fetch;
  let userId = "";
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `mike-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });
  afterEach(() => { globalThis.fetch = realFetch; clearMarketCache(); });

  it("analysis is journalled once; the outcome resolves from later candles and is then final", async () => {
    const { analyzeAsset, loadSettings, saveSettings } = await import("@/lib/mike/analyze");
    const { resolveOpenSignals } = await import("@/lib/mike/journal");
    const { resolveAsset } = await import("@/lib/mike/assets");
    await saveSettings(userId, { accountSize: 10_000, riskPct: 1 });
    expect((await loadSettings(userId)).accountSize).toBe(10_000);

    const now = Date.now();
    const hist = walk(600, { drift: 0.003, vol: 0.008, seed: 21, t0: Math.floor(now / H) * H - 599 * H });
    const byTf = (u: string) => {
      const tf = new URL(u).searchParams.get("interval")!;
      const step = { "1w": 7 * 24 * H, "1d": 24 * H, "4h": 4 * H, "1h": H, "15m": H / 4 }[tf] ?? H;
      const c = walk(600, { drift: 0.003, vol: 0.008, seed: 21, stepMs: step, t0: Math.floor(now / step) * step - 599 * step });
      return tf === "1h" ? hist : c;
    };
    globalThis.fetch = (async (u: RequestInfo | URL) => String(u).includes("tavily") ? new Response("{}", { status: 500 }) : Response.json(binanceJson(byTf(String(u))))) as typeof fetch;
    const a = await analyzeAsset(userId, resolveAsset("btc")!, "1h", { news: false });
    expect(a.data.freshness).toBe("live");
    expect(a.alignment.map((r) => r.timeframe)).toEqual(["1w", "1d", "4h", "1h", "15m"]);
    expect(a.id).toBeTruthy();
    const row = await getDb().mikeSignal.findUnique({ where: { id: a.id! } });
    expect(row!.decision).toBe(a.decision);
    expect(row!.confidence).toBe(a.confidence.score);
    expect((row!.reasoning as { checks: unknown[] }).checks.length).toBe(a.checks.length);
    if (a.decision === "setup") {
      expect(a.risk!.riskAmount).toBe(100); // 1% of 10,000 — never scaled by confidence
      expect(row!.status).toBe("open");
    } else {
      expect(row!.status).toBe("no_trade");
      expect(a.risk).toBeNull();
    }

    // stage a setup and let price run through the stop afterwards
    const created = new Date(now - 5 * H);
    const s = await getDb().mikeSignal.create({
      data: {
        userId, asset: "BTC/USDT", symbol: "BTCUSDT", provider: "binance", assetGroup: "crypto", timeframe: "1h", decision: "setup", direction: "long",
        entryLow: 99, entryHigh: 101, stop: 95, targets: [{ price: 106, basis: "", rr: 1 }, { price: 111, basis: "", rr: 2 }, { price: 116, basis: "", rr: 3 }],
        riskReward: 2, confidence: 75, freshness: "live", source: "test", reasoning: { checks: [] }, createdAt: created,
      },
    });
    const after = [0, 1, 2, 3].map((k) => bar(created.getTime() + k * H, 100, k === 2 ? 101 : 102, k === 2 ? 94 : 99.5, 100));
    globalThis.fetch = (async () => Response.json(binanceJson([...walk(300, { t0: created.getTime() - 300 * H }), ...after]))) as typeof fetch;
    clearMarketCache();
    const res = await resolveOpenSignals(userId);
    expect(res.resolved.find((r) => r.id === s.id)?.status).toBe("lost");
    const done = await getDb().mikeSignal.findUnique({ where: { id: s.id } });
    expect(done!.status).toBe("lost");
    expect((done!.outcome as { rMultiple: number }).rMultiple).toBe(-1);
    expect((done!.audit as { lessons: string[] }).lessons.length).toBeGreaterThan(0);
    // a second pass doesn't touch it
    clearMarketCache();
    await resolveOpenSignals(userId);
    expect((await getDb().mikeSignal.findUnique({ where: { id: s.id } }))!.resolvedAt!.getTime()).toBe(done!.resolvedAt!.getTime());
  }, 60_000);

  it("price alert fires once from real bars; with the feed down it never fires", async () => {
    const { checkAlerts } = await import("@/lib/mike/alerts");
    const al = await getDb().mikeAlert.create({ data: { userId, asset: "ETH/USDT", symbol: "ETHUSDT", provider: "binance", kind: "price_above", level: 150, createdAt: new Date(Date.now() - 2 * H) } });
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
    expect(await checkAlerts(userId)).toEqual([]);
    const now = Date.now();
    globalThis.fetch = (async (u: RequestInfo | URL) => String(u).includes("binance")
      ? Response.json(binanceJson([...walk(100, { start: 100, drift: 0, vol: 0.001, t0: Math.floor(now / H) * H - 100 * H }), bar(Math.floor(now / H) * H, 149, 152, 148, 151)]))
      : new Response("{}", { status: 404 })) as typeof fetch;
    clearMarketCache();
    const fired = await checkAlerts(userId);
    expect(fired.map((f) => f.id)).toEqual([al.id]);
    expect(fired[0].message).toMatch(/ETH\/USDT: Price above — traded at or above 150/);
    clearMarketCache();
    expect(await checkAlerts(userId)).toEqual([]); // one-shot
  }, 60_000);
});
