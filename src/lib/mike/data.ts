import "server-only";
import type { AssetRef, Candle, Freshness, Series, Timeframe } from "./types";
import { TF_MS } from "./types";

/**
 * Real market data, fetched server-side only. MIKE never invents a price: when
 * a feed can't be reached the series comes back EMPTY with freshness
 * "unavailable" and the reason, and every screen shows LIVE DATA UNAVAILABLE.
 *
 *  Crypto  → Binance public market data (real-time REST; no key needed)
 *  Others  → Yahoo Finance chart feed (free; may be delayed — labelled "delayed")
 */

const BINANCE_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
const YAHOO_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const MAX_BARS = 600;

const YAHOO_PLAN: Record<Timeframe, { interval: string; range: string; group?: number }> = {
  "1m": { interval: "1m", range: "5d" },
  "5m": { interval: "5m", range: "1mo" },
  "15m": { interval: "15m", range: "1mo" },
  "30m": { interval: "30m", range: "1mo" },
  "1h": { interval: "60m", range: "6mo" },
  "4h": { interval: "60m", range: "1y", group: 4 }, // Yahoo has no 4h bars — built from 1h
  "1d": { interval: "1d", range: "2y" },
  "1w": { interval: "1wk", range: "10y" },
};

const YAHOO_HISTORY: Partial<Record<Timeframe, string>> = { "1h": "2y", "4h": "2y", "1d": "10y", "1w": "max", "5m": "60d", "15m": "60d", "30m": "60d" };

type FetchFn = typeof fetch;
export interface DataOpts {
  fetchImpl?: FetchFn; now?: number; noCache?: boolean;
  /** Backtests: as many bars as the free feed allows (up to this many). */
  historyBars?: number;
}

const cache = new Map<string, { at: number; series: Series }>();
const ttl = (tf: Timeframe) => (TF_MS[tf] <= 900_000 ? 15_000 : 60_000);

/** Candles for an asset + timeframe (cached briefly so a scan doesn't hammer the feed). */
export async function fetchSeries(asset: AssetRef, timeframe: Timeframe, opts: DataOpts = {}): Promise<Series> {
  const want = Math.min(Math.max(opts.historyBars ?? MAX_BARS, MAX_BARS), 3000);
  const key = `${asset.provider}:${asset.symbol}:${timeframe}:${want}`;
  const now = opts.now ?? Date.now();
  const hit = cache.get(key);
  if (!opts.noCache && hit && now - hit.at < ttl(timeframe)) return hit.series;
  const f = opts.fetchImpl ?? fetch;
  let series = asset.provider === "binance" ? await fromBinance(asset, timeframe, f, now, want) : await fromYahoo(asset, timeframe, f, now, want);
  if (asset.provider === "binance" && series.freshness === "unavailable" && !/doesn't list/.test(series.note)) {
    // Binance blocks some regions (e.g. US cloud servers) — Yahoo carries the major coins as BTC-USD.
    const base = asset.symbol.replace(/USDT$/, "");
    const alt = await fromYahoo({ ...asset, symbol: `${base}-USD`, provider: "yahoo" }, timeframe, f, now, want);
    if (alt.candles.length) series = { ...alt, asset, note: `${alt.note} (Binance unreachable: ${series.note})` };
  }
  if (series.candles.length) cache.set(key, { at: now, series });
  return series;
}

export function clearMarketCache() { cache.clear(); }

function unavailable(asset: AssetRef, timeframe: Timeframe, source: string, note: string, now: number): Series {
  return { asset, timeframe, candles: [], source, freshness: "unavailable", lastBarAt: null, fetchedAt: now, note, hasVolume: false };
}

async function getJson(fetchImpl: FetchFn, url: string): Promise<{ ok: boolean; status: number; json: any }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetchImpl(url, {
      signal: ac.signal, cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (JARVIS MIKE market analysis)", Accept: "application/json" },
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { error: (e as Error).name === "AbortError" ? "timed out" : (e as Error).message } };
  } finally { clearTimeout(t); }
}

const parseKlines = (rows: unknown[][]): Candle[] => rows
  .map((k) => ({ t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) }))
  .filter((c) => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite));

async function fromBinance(asset: AssetRef, timeframe: Timeframe, fetchImpl: FetchFn, now: number, want = MAX_BARS): Promise<Series> {
  const source = "Binance (public market data)";
  let lastErr = "";
  for (const host of BINANCE_HOSTS) {
    const url = (limit: number, endTime?: number) => `${host}/api/v3/klines?symbol=${encodeURIComponent(asset.symbol)}&interval=${timeframe}&limit=${limit}${endTime ? `&endTime=${endTime}` : ""}`;
    const r = await getJson(fetchImpl, url(Math.min(want, 1000)));
    if (r.ok && Array.isArray(r.json)) {
      let candles: Candle[] = parseKlines(r.json);
      // older pages for backtests (Binance serves up to 1000 bars per request)
      while (candles.length < want && candles.length) {
        const more = await getJson(fetchImpl, url(Math.min(want - candles.length, 1000), candles[0].t - 1));
        const older = more.ok && Array.isArray(more.json) ? parseKlines(more.json).filter((c) => c.t < candles[0].t) : [];
        if (!older.length) break;
        candles = [...older, ...candles];
      }
      if (!candles.length) return unavailable(asset, timeframe, source, `Binance returned no candles for ${asset.symbol}.`, now);
      const lastBarAt = candles[candles.length - 1].t;
      const age = now - lastBarAt;
      const freshness: Freshness = age <= TF_MS[timeframe] * 2 + 60_000 ? "live" : "stale";
      return {
        asset, timeframe, candles, source, freshness, lastBarAt, fetchedAt: now, hasVolume: true, currency: "USDT",
        note: freshness === "live"
          ? `Real-time Binance data, fetched ${new Date(now).toISOString().slice(11, 19)} UTC.`
          : `Binance's newest ${timeframe} bar is ${Math.round(age / 60_000)} min old — trading may be halted for this pair.`,
      };
    }
    if (r.status === 400) return unavailable(asset, timeframe, source, `Binance doesn't list ${asset.symbol}.`, now);
    lastErr = r.status ? `HTTP ${r.status}` : String(r.json?.error ?? "no response");
  }
  return unavailable(asset, timeframe, source, `Couldn't reach Binance (${lastErr}).`, now);
}

async function fromYahoo(asset: AssetRef, timeframe: Timeframe, fetchImpl: FetchFn, now: number, want = MAX_BARS): Promise<Series> {
  const source = "Yahoo Finance (free feed — may be delayed)";
  const plan = YAHOO_PLAN[timeframe];
  const range = want > MAX_BARS ? (YAHOO_HISTORY[timeframe] ?? plan.range) : plan.range;
  let lastErr = "";
  for (const host of YAHOO_HOSTS) {
    const r = await getJson(fetchImpl, `${host}/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=${plan.interval}&range=${range}&includePrePost=false`);
    const res = r.json?.chart?.result?.[0];
    if (r.ok && res) {
      const ts: number[] = res.timestamp ?? [];
      const q = res.indicators?.quote?.[0] ?? {};
      let candles: Candle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if ([o, h, l, c].some((x) => typeof x !== "number" || !Number.isFinite(x))) continue; // Yahoo pads gaps with null
        candles.push({ t: ts[i] * 1000, o, h, l, c, v: Number(q.volume?.[i]) || 0 });
      }
      if (plan.group) candles = groupBars(candles, TF_MS[timeframe]);
      candles = candles.slice(-want);
      if (!candles.length) return unavailable(asset, timeframe, source, `Yahoo Finance returned no ${timeframe} bars for ${asset.symbol}.`, now);
      const meta = res.meta ?? {};
      const lastBarAt = candles[candles.length - 1].t;
      const period = meta.currentTradingPeriod?.regular;
      const open = period ? now / 1000 >= period.start && now / 1000 <= period.end : true;
      const age = now - lastBarAt;
      const tolerance = Math.max(TF_MS[timeframe] * 2, 0) + 25 * 60_000;
      const freshness: Freshness = !open ? "closed" : timeframe === "1d" || timeframe === "1w" || age <= tolerance ? "delayed" : "stale";
      const hasVolume = candles.slice(-50).some((c) => c.v > 0);
      const exch = String(meta.fullExchangeName ?? meta.exchangeName ?? asset.exchange);
      return {
        asset: { ...asset, exchange: asset.exchange === "Yahoo Finance" ? exch : asset.exchange },
        timeframe, candles, source, freshness, lastBarAt, fetchedAt: now, hasVolume, currency: meta.currency ?? null,
        note: freshness === "closed"
          ? `${exch} is closed — the last bar is from the last session. Not real-time.`
          : freshness === "stale"
            ? `The newest bar is ${Math.round(age / 60_000)} min old — this can't be treated as current.`
            : `Free Yahoo Finance feed: prices may lag the exchange (often up to 15 min). Not verified real-time.`,
      };
    }
    lastErr = r.status ? `HTTP ${r.status}` : String(r.json?.error ?? "no response");
    if (r.status === 404) return unavailable(asset, timeframe, source, `Yahoo Finance doesn't know the symbol ${asset.symbol}.`, now);
  }
  return unavailable(asset, timeframe, source, `Couldn't reach Yahoo Finance (${lastErr}).`, now);
}

/** Merge bars into bigger buckets aligned to UTC (1h → 4h). */
export function groupBars(candles: Candle[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const b = Math.floor(c.t / bucketMs) * bucketMs;
    const last = out[out.length - 1];
    if (last && last.t === b) {
      last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l); last.c = c.c; last.v += c.v;
    } else out.push({ t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
  }
  return out;
}

/** Bars that have finished (the newest one is dropped while it's still forming). */
export function closedBars(series: Series, now = Date.now()): Candle[] {
  const c = series.candles;
  if (!c.length) return c;
  const last = c[c.length - 1];
  return last.t + TF_MS[series.timeframe] > now ? c.slice(0, -1) : c;
}
