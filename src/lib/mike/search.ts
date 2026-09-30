import "server-only";
import type { AssetRef, MarketKind } from "./types";
import { catalog, catalogMatch, looksLikeSymbol, resolveAsset } from "./assets";

/**
 * Find ANY market by name or ticker: the built-in catalogue first, then Yahoo
 * Finance's symbol search (every exchange it covers — NSE/BSE, NYSE/NASDAQ,
 * LSE, indices, FX, futures, ETFs, crypto). Coins are charted from Binance
 * when it lists them (real-time), otherwise from Yahoo. Nothing is invented:
 * an unknown name returns no match.
 */

const HOSTS = ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"];
const KIND: Record<string, MarketKind> = { EQUITY: "stock", ETF: "etf", INDEX: "index", CURRENCY: "forex", FUTURE: "futures", CRYPTOCURRENCY: "crypto" };
const cache = new Map<string, { at: number; list: AssetRef[] }>();

/** Yahoo search result → an asset MIKE can chart. Pure (tested). */
export function fromYahooQuote(q: { symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchDisp?: string; exchange?: string }): AssetRef | null {
  const kind = KIND[String(q.quoteType ?? "").toUpperCase()];
  const symbol = String(q.symbol ?? "").trim();
  if (!kind || !symbol) return null;
  const name = String(q.longname ?? q.shortname ?? "").trim() || undefined;
  if (kind === "crypto") {
    // "BTC-USD", "PEPE24478-USD" → Binance BTCUSDT / PEPEUSDT, with the Yahoo symbol as the fallback
    const m = symbol.match(/^([A-Z0-9]+?)(\d{3,})?-(USD|USDT)$/);
    if (!m) return null;
    const base = m[1];
    return { display: `${base}/USDT`, symbol: `${base}USDT`, kind, provider: "binance", exchange: "Binance", group: "crypto", name, alt: symbol };
  }
  const exchange = String(q.exchDisp ?? q.exchange ?? "Yahoo Finance");
  const india = /\.(NS|BO)$/.test(symbol);
  const group = kind === "forex" ? "usd_fx" : kind === "index" ? (india ? "india_index" : "index") : india ? "india_equity" : "us_equity";
  return { display: symbol.replace(/=X$/, "").replace(/=F$/, ""), symbol, kind, provider: "yahoo", exchange, group, name };
}

export async function searchAssets(query: string, fetchImpl: typeof fetch = fetch, limit = 8): Promise<AssetRef[]> {
  const q = query.trim().slice(0, 60);
  if (!q) return [];
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.list.slice(0, limit);
  const out: AssetRef[] = [];
  const add = (a: AssetRef | null) => { if (a && !out.some((x) => x.symbol === a.symbol)) out.push(a); };
  add(catalogMatch(q));
  const low = key.replace(/\s+/g, " ");
  for (const c of catalog()) if (c.display.toLowerCase().includes(low) || c.symbol.toLowerCase().includes(low)) add(c);
  for (const host of HOSTS) {
    try {
      const res = await fetchImpl(`${host}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`, {
        headers: { "User-Agent": "Mozilla/5.0 (JARVIS MIKE market analysis)", Accept: "application/json" },
        signal: AbortSignal.timeout(8000), cache: "no-store",
      });
      if (!res.ok) continue;
      const j = await res.json();
      for (const quote of j?.quotes ?? []) add(fromYahooQuote(quote));
      break;
    } catch { /* try the other host */ }
  }
  if (out.length) cache.set(key, { at: Date.now(), list: out });
  return out.slice(0, limit);
}

/**
 * The single asset a request means: an exact catalogue name or a full ticker
 * is used as-is; a company/coin name is looked up; failing that, the text is
 * tried as a raw ticker (the feed will say if it doesn't exist).
 */
export async function findAsset(query: string, market?: MarketKind, fetchImpl: typeof fetch = fetch): Promise<AssetRef | null> {
  const q = query.trim();
  if (!q) return null;
  const exact = catalogMatch(q);
  if (exact) return exact;
  if (looksLikeSymbol(q)) return resolveAsset(q, market);
  const found = await searchAssets(q, fetchImpl, 10).catch(() => []);
  const pick = (market ? found.find((a) => a.kind === market) : null) ?? found[0];
  // last resort: a single word may still be a raw ticker the search didn't know (the feed will say if not)
  return pick ?? (/\s/.test(q) ? null : resolveAsset(q, market));
}
