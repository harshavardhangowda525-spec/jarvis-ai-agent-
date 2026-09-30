import type { Candle } from "@/lib/mike/types";

/**
 * Deterministic candle generators for MIKE's tests. These are TEST FIXTURES
 * only (never shown to users): a seeded random walk with a chosen drift.
 */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export function walk(n: number, opts: { start?: number; drift?: number; vol?: number; seed?: number; stepMs?: number; t0?: number; volume?: boolean } = {}): Candle[] {
  const r = rng(opts.seed ?? 7);
  const drift = opts.drift ?? 0, vol = opts.vol ?? 0.01, step = opts.stepMs ?? 3_600_000;
  let price = opts.start ?? 100;
  const t0 = opts.t0 ?? Date.UTC(2026, 0, 1);
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = o * (1 + drift + (r() - 0.5) * 2 * vol);
    const h = Math.max(o, c) * (1 + r() * vol * 0.6);
    const l = Math.min(o, c) * (1 - r() * vol * 0.6);
    out.push({ t: t0 + i * step, o, h, l, c, v: opts.volume === false ? 0 : 1000 + r() * 500 + (c > o ? 300 : 0) });
    price = c;
  }
  return out;
}

/** Binance /klines JSON for candles. */
export const binanceJson = (c: Candle[]) => c.map((k) => [k.t, String(k.o), String(k.h), String(k.l), String(k.c), String(k.v), k.t + 3_599_999, "0", 0, "0", "0", "0"]);

/** Yahoo /v8/finance/chart JSON for candles. */
export const yahooJson = (c: Candle[], meta: Record<string, unknown> = {}) => ({
  chart: {
    result: [{
      meta: { currency: "INR", exchangeName: "NSI", fullExchangeName: "NSE", ...meta },
      timestamp: c.map((k) => Math.floor(k.t / 1000)),
      indicators: { quote: [{ open: c.map((k) => k.o), high: c.map((k) => k.h), low: c.map((k) => k.l), close: c.map((k) => k.c), volume: c.map((k) => k.v) }] },
    }],
    error: null,
  },
});
