import type { Candle } from "./types";

/**
 * Technical indicators. Every function is CAUSAL: the value at bar i uses only
 * bars 0…i, so the same code runs live and in the backtester without look-ahead.
 * Values that need more history than exists are NaN.
 */

export function sma(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < n; i++) prev += values[i];
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

/** Wilder smoothing (RSI / ATR / ADX). */
function wilder(values: number[], n: number, start = 0): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length - start < n) return out;
  let prev = 0;
  for (let i = start; i < start + n; i++) prev += values[i];
  prev /= n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < values.length; i++) { prev = (prev * (n - 1) + values[i]) / n; out[i] = prev; }
  return out;
}

export function rsi(closes: number[], n = 14): number[] {
  const gains = [0], losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0)); losses.push(Math.max(-d, 0));
  }
  const g = wilder(gains, n, 1), l = wilder(losses, n, 1);
  return closes.map((_, i) => (Number.isNaN(g[i]) ? NaN : l[i] === 0 ? (g[i] === 0 ? 50 : 100) : 100 - 100 / (1 + g[i] / l[i])));
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(closes, fast), s = ema(closes, slow);
  const line = closes.map((_, i) => f[i] - s[i]);
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const sig = new Array<number>(closes.length).fill(NaN);
  if (firstValid >= 0) {
    const e = ema(line.slice(firstValid), signal);
    for (let i = 0; i < e.length; i++) sig[firstValid + i] = e[i];
  }
  return { line, signal: sig, hist: line.map((v, i) => v - sig[i]) };
}

export function trueRange(c: Candle[]): number[] {
  return c.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - c[i - 1].c), Math.abs(b.l - c[i - 1].c))));
}

export function atr(c: Candle[], n = 14): number[] { return wilder(trueRange(c), n); }

export function adx(c: Candle[], n = 14) {
  const plusDM = [0], minusDM = [0];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].h - c[i - 1].h, down = c[i - 1].l - c[i].l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const tr = wilder(trueRange(c), n, 1), p = wilder(plusDM, n, 1), m = wilder(minusDM, n, 1);
  const plusDI = c.map((_, i) => (tr[i] ? (100 * p[i]) / tr[i] : NaN));
  const minusDI = c.map((_, i) => (tr[i] ? (100 * m[i]) / tr[i] : NaN));
  const dx = c.map((_, i) => {
    const s = plusDI[i] + minusDI[i];
    return Number.isNaN(s) ? NaN : s === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / s;
  });
  const first = dx.findIndex((v) => !Number.isNaN(v));
  const adxLine = new Array<number>(c.length).fill(NaN);
  if (first >= 0) { const w = wilder(dx, n, first); for (let i = 0; i < w.length; i++) adxLine[i] = w[i]; }
  return { adx: adxLine, plusDI, minusDI };
}

export function bollinger(closes: number[], n = 20, k = 2) {
  const mid = sma(closes, n);
  const upper: number[] = [], lower: number[] = [], width: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (Number.isNaN(mid[i])) { upper.push(NaN); lower.push(NaN); width.push(NaN); continue; }
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    upper.push(mid[i] + k * sd); lower.push(mid[i] - k * sd); width.push(mid[i] ? (2 * k * sd) / mid[i] : NaN);
  }
  return { mid, upper, lower, width };
}

/**
 * VWAP. Intraday bars: anchored to each UTC session day. Daily and weekly bars:
 * a rolling 20-bar volume-weighted average. No volume → NaN (not faked).
 */
export function vwap(c: Candle[], intraday: boolean): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  if (intraday) {
    let day = -1, pv = 0, vol = 0;
    for (let i = 0; i < c.length; i++) {
      const d = Math.floor(c[i].t / 86_400_000);
      if (d !== day) { day = d; pv = 0; vol = 0; }
      const tp = (c[i].h + c[i].l + c[i].c) / 3;
      pv += tp * c[i].v; vol += c[i].v;
      out[i] = vol > 0 ? pv / vol : NaN;
    }
    return out;
  }
  for (let i = 19; i < c.length; i++) {
    let pv = 0, vol = 0;
    for (let j = i - 19; j <= i; j++) { pv += ((c[j].h + c[j].l + c[j].c) / 3) * c[j].v; vol += c[j].v; }
    out[i] = vol > 0 ? pv / vol : NaN;
  }
  return out;
}

export function obv(c: Candle[]): number[] {
  const out: number[] = [];
  let v = 0;
  for (let i = 0; i < c.length; i++) {
    if (i > 0) v += c[i].c > c[i - 1].c ? c[i].v : c[i].c < c[i - 1].c ? -c[i].v : 0;
    out.push(v);
  }
  return out;
}

export function stochastic(c: Candle[], n = 14, smoothK = 3, d = 3) {
  const raw = c.map((_, i) => {
    if (i < n - 1) return NaN;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, c[j].h); lo = Math.min(lo, c[j].l); }
    return hi === lo ? 50 : (100 * (c[i].c - lo)) / (hi - lo);
  });
  const k = smaNan(raw, smoothK);
  return { k, d: smaNan(k, d) };
}

function smaNan(values: number[], n: number): number[] {
  return values.map((_, i) => {
    if (i < n - 1) return NaN;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) { if (Number.isNaN(values[j])) return NaN; s += values[j]; }
    return s / n;
  });
}

/** Slope of the last n values, normalised by their average magnitude (−∞…∞, ~−1…1). */
export function slope(values: number[], i: number, n: number): number {
  if (i - n < 0) return 0;
  const a = values[i - n], b = values[i];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  let mag = 0;
  for (let j = i - n; j <= i; j++) mag += Math.abs(values[j]);
  mag /= n + 1;
  return mag ? (b - a) / mag : 0;
}

/** Where x sits among values[i-n+1…i], 0–100 (100 = highest). */
export function percentile(values: number[], i: number, n: number): number {
  const x = values[i];
  if (!Number.isFinite(x)) return 50;
  let below = 0, count = 0;
  for (let j = Math.max(0, i - n + 1); j <= i; j++) {
    if (!Number.isFinite(values[j])) continue;
    count++;
    if (values[j] <= x) below++;
  }
  return count ? (100 * below) / count : 50;
}

export const FIB_RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786];
export const FIB_EXTENSIONS = [1.272, 1.618, 2.0];

/** Retracement levels of a swing (from → to), e.g. an up-swing low→high. */
export function fibRetracement(from: number, to: number) {
  return FIB_RETRACEMENTS.map((r) => ({ ratio: r, price: to - (to - from) * r }));
}
/** Extension levels projected beyond `to` in the swing's direction. */
export function fibExtension(from: number, to: number) {
  return FIB_EXTENSIONS.map((r) => ({ ratio: r, price: from + (to - from) * r }));
}

/** All indicator series for a candle array, computed once. */
export function computeIndicators(c: Candle[], intraday: boolean) {
  const closes = c.map((b) => b.c);
  const vols = c.map((b) => b.v);
  const a = atr(c, 14);
  return {
    closes,
    ema20: ema(closes, 20), ema50: ema(closes, 50), ema200: ema(closes, 200), sma50: sma(closes, 50),
    rsi: rsi(closes, 14), macd: macd(closes), atr: a, atrPct: a.map((v, i) => (closes[i] ? (100 * v) / closes[i] : NaN)),
    adx: adx(c, 14), bb: bollinger(closes, 20, 2), vwap: vwap(c, intraday), obv: obv(c), stoch: stochastic(c),
    volSma: sma(vols, 20),
  };
}
export type Indicators = ReturnType<typeof computeIndicators>;
