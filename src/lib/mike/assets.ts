import type { AssetRef, MarketKind } from "./types";

/**
 * Asset catalogue: friendly names → the provider symbol MIKE fetches. Crypto
 * comes from Binance's public market data (real-time). Stocks, indices, forex,
 * commodities, ETFs and futures come from Yahoo Finance's chart feed, which is
 * free but can be delayed — MIKE labels it that way everywhere.
 *
 * Anything not listed still works: "AAPL", "RELIANCE.NS", "TSLA", "ES=F" are
 * passed to Yahoo as-is; "XYZUSDT" goes to Binance.
 */

type Entry = Omit<AssetRef, "provider"> & { provider?: AssetRef["provider"]; aliases: string[] };

const B = (base: string, name: string): Entry => ({
  display: `${base}/USDT`, symbol: `${base}USDT`, kind: "crypto", provider: "binance", exchange: "Binance", group: "crypto",
  aliases: [base.toLowerCase(), name, `${base.toLowerCase()}usdt`, `${base.toLowerCase()}/usdt`, `${base.toLowerCase()}usd`],
});
const Y = (display: string, symbol: string, kind: MarketKind, exchange: string, group: string, aliases: string[]): Entry =>
  ({ display, symbol, kind, provider: "yahoo", exchange, group, aliases });

const CATALOG: Entry[] = [
  B("BTC", "bitcoin"), B("ETH", "ethereum"), B("SOL", "solana"), B("BNB", "binance coin"), B("XRP", "ripple"),
  B("ADA", "cardano"), B("DOGE", "dogecoin"), B("AVAX", "avalanche"), B("LINK", "chainlink"), B("DOT", "polkadot"),
  Y("NIFTY 50", "^NSEI", "index", "NSE", "india_index", ["nifty", "nifty 50", "nifty50", "nsei"]),
  Y("SENSEX", "^BSESN", "index", "BSE", "india_index", ["sensex", "bse sensex"]),
  Y("BANK NIFTY", "^NSEBANK", "index", "NSE", "india_index", ["banknifty", "bank nifty", "nifty bank"]),
  Y("NASDAQ", "^IXIC", "index", "NASDAQ", "us_index", ["nasdaq", "nasdaq composite", "ixic"]),
  Y("NASDAQ 100", "^NDX", "index", "NASDAQ", "us_index", ["nasdaq 100", "ndx", "nasdaq100"]),
  Y("S&P 500", "^GSPC", "index", "NYSE", "us_index", ["s&p 500", "s&p", "sp500", "s and p", "spx", "s&p500"]),
  Y("DOW JONES", "^DJI", "index", "NYSE", "us_index", ["dow", "dow jones", "djia"]),
  Y("FTSE 100", "^FTSE", "index", "LSE", "eu_index", ["ftse", "ftse 100"]),
  Y("DAX", "^GDAXI", "index", "XETRA", "eu_index", ["dax"]),
  Y("NIKKEI 225", "^N225", "index", "TSE", "asia_index", ["nikkei", "nikkei 225"]),
  Y("GOLD", "GC=F", "commodity", "COMEX", "metals", ["gold", "xau", "xauusd", "xau/usd"]),
  Y("SILVER", "SI=F", "commodity", "COMEX", "metals", ["silver", "xag", "xagusd"]),
  Y("CRUDE OIL", "CL=F", "commodity", "NYMEX", "energy", ["crude", "crude oil", "oil", "wti"]),
  Y("BRENT", "BZ=F", "commodity", "ICE", "energy", ["brent"]),
  Y("NATURAL GAS", "NG=F", "commodity", "NYMEX", "energy", ["natural gas", "natgas"]),
  Y("EUR/USD", "EURUSD=X", "forex", "FX", "usd_fx", ["eurusd", "eur/usd", "euro"]),
  Y("GBP/USD", "GBPUSD=X", "forex", "FX", "usd_fx", ["gbpusd", "gbp/usd", "cable", "pound"]),
  Y("USD/JPY", "JPY=X", "forex", "FX", "usd_fx", ["usdjpy", "usd/jpy", "yen"]),
  Y("USD/INR", "INR=X", "forex", "FX", "usd_fx", ["usdinr", "usd/inr", "rupee"]),
  Y("AUD/USD", "AUDUSD=X", "forex", "FX", "usd_fx", ["audusd", "aud/usd"]),
  Y("SPY", "SPY", "etf", "NYSE Arca", "us_index", ["spy"]),
  Y("QQQ", "QQQ", "etf", "NASDAQ", "us_index", ["qqq"]),
  Y("E-MINI S&P", "ES=F", "futures", "CME", "us_index", ["es", "es=f", "e-mini", "emini"]),
  Y("E-MINI NASDAQ", "NQ=F", "futures", "CME", "us_index", ["nq", "nq=f"]),
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Resolve what the user typed/said to an asset. Never guesses a price — only a symbol. */
export function resolveAsset(query: string, market?: MarketKind): AssetRef | null {
  const q = norm(query).replace(/^(the|a)\s+/, "");
  if (!q) return null;
  const hit = CATALOG.find((e) => e.aliases.includes(q) || norm(e.display) === q || e.symbol.toLowerCase() === q);
  if (hit) { const { aliases: _a, ...a } = hit; return { ...a, provider: hit.provider ?? "yahoo" }; }
  const raw = query.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9^.=\-/&]{1,20}$/.test(raw)) return null;
  // BTC-USD / ETH/USDT / SOLUSDT → Binance
  const crypto = raw.match(/^([A-Z0-9]{2,10})[-/]?(USDT|USD|USDC)$/);
  if (market === "crypto" || (crypto && market !== "stock" && market !== "etf")) {
    const base = crypto ? crypto[1] : raw.replace(/[-/]/g, "");
    return { display: `${base}/USDT`, symbol: `${base}USDT`, kind: "crypto", provider: "binance", exchange: "Binance", group: "crypto" };
  }
  const kind: MarketKind = market ?? (raw.startsWith("^") ? "index" : raw.endsWith("=X") ? "forex" : raw.endsWith("=F") ? "futures" : "stock");
  const exchange = raw.endsWith(".NS") ? "NSE" : raw.endsWith(".BO") ? "BSE" : raw.endsWith(".L") ? "LSE" : kind === "forex" ? "FX" : "Yahoo Finance";
  const group = raw.endsWith(".NS") || raw.endsWith(".BO") ? "india_equity" : kind === "forex" ? "usd_fx" : "us_equity";
  return { display: raw.replace(/=X$|=F$/, ""), symbol: raw, kind, provider: "yahoo", exchange, group };
}

/** Assets offered in the picker for a market. */
export function catalog(market?: MarketKind): AssetRef[] {
  return CATALOG.filter((e) => !market || e.kind === market).map(({ aliases: _a, ...a }) => ({ ...a, provider: a.provider ?? "yahoo" }));
}

/** Pull an asset name out of a sentence ("Mike, analyze Bitcoin on the 4 hour"). */
export function assetInText(text: string): AssetRef | null {
  const low = ` ${norm(text).replace(/[,.!?]/g, " ")} `;
  let best: { e: Entry; len: number } | null = null;
  for (const e of CATALOG) {
    for (const a of e.aliases) {
      if (a.length < 2) continue;
      if (low.includes(` ${a} `) && (!best || a.length > best.len)) best = { e, len: a.length };
    }
  }
  if (best) { const { aliases: _a, ...a } = best.e; return { ...a, provider: a.provider ?? "yahoo" }; }
  // "analyze AAPL" / "analyze reliance.ns"
  const m = text.match(/\b(?:analy[sz]e|chart|check|scan|explain|on)\s+([A-Za-z0-9^.=\-/]{2,16})\b/i);
  return m && !/^(the|market|markets|this|it|chart)$/i.test(m[1]) ? resolveAsset(m[1]) : null;
}
