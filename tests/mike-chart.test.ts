import { describe, it, expect, afterEach } from "vitest";
import { fromYahooQuote, findAsset, searchAssets } from "@/lib/mike/search";
import { parseMikeCommand, chartSubject } from "@/lib/mike/command";
import { fetchSeries, clearMarketCache } from "@/lib/mike/data";
import { availableTools } from "@/lib/tools/registry";
import { walk, binanceJson, yahooJson } from "./mike-helpers";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; clearMarketCache(); });

describe("any market by name or ticker", () => {
  it("maps Yahoo search results to chartable assets", () => {
    expect(fromYahooQuote({ symbol: "RELIANCE.NS", longname: "Reliance Industries Limited", quoteType: "EQUITY", exchDisp: "NSE" }))
      .toMatchObject({ symbol: "RELIANCE.NS", provider: "yahoo", kind: "stock", exchange: "NSE", group: "india_equity", name: "Reliance Industries Limited" });
    expect(fromYahooQuote({ symbol: "TSLA", shortname: "Tesla, Inc.", quoteType: "EQUITY", exchDisp: "NASDAQ" })).toMatchObject({ display: "TSLA", kind: "stock" });
    // coins chart from Binance (real-time), with Yahoo's symbol kept as the fallback
    expect(fromYahooQuote({ symbol: "PEPE24478-USD", shortname: "Pepe USD", quoteType: "CRYPTOCURRENCY" }))
      .toMatchObject({ symbol: "PEPEUSDT", provider: "binance", alt: "PEPE24478-USD", display: "PEPE/USDT" });
    expect(fromYahooQuote({ symbol: "GC=F", quoteType: "FUTURE" })).toMatchObject({ kind: "futures", display: "GC" });
    expect(fromYahooQuote({ symbol: "VFIAX", quoteType: "MUTUALFUND" })).toBeNull(); // no intraday bars
  });

  it("finds a company by name; exact tickers and catalogue names skip the search", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      asked.push(String(u));
      return Response.json({ quotes: [
        { symbol: "RELIANCE.NS", longname: "Reliance Industries Limited", quoteType: "EQUITY", exchDisp: "NSE" },
        { symbol: "RELIANCE.BO", longname: "Reliance Industries Limited", quoteType: "EQUITY", exchDisp: "BSE" },
      ] });
    }) as typeof fetch;
    expect((await findAsset("reliance industries"))?.symbol).toBe("RELIANCE.NS");
    expect(asked[0]).toMatch(/v1\/finance\/search\?q=reliance%20industries/);
    const n = asked.length;
    expect((await findAsset("bitcoin"))?.symbol).toBe("BTCUSDT");
    expect((await findAsset("AAPL"))?.symbol).toBe("AAPL");
    expect(asked.length).toBe(n); // no search needed
    expect((await searchAssets("reliance")).map((a) => a.symbol)).toEqual(["RELIANCE.NS", "RELIANCE.BO"]);
  });

  it("an unknown name returns nothing rather than a guess when the search is empty", async () => {
    globalThis.fetch = (async () => Response.json({ quotes: [] })) as typeof fetch;
    const a = await findAsset("zzqx nonexistent co");
    expect(a).toBeNull(); // not a valid ticker either
  });

  it("a coin Binance doesn't list is charted from Yahoo instead", async () => {
    const now = Date.UTC(2026, 5, 1, 12);
    const c = walk(300, { t0: now - 300 * 3_600_000 + 3_600_000 });
    globalThis.fetch = (async (u: RequestInfo | URL) => String(u).includes("binance")
      ? Response.json({ code: -1121, msg: "Invalid symbol." }, { status: 400 })
      : Response.json(yahooJson(c, { currency: "USD" }))) as typeof fetch;
    const s = await fetchSeries({ display: "NEWCOIN/USDT", symbol: "NEWCOINUSDT", kind: "crypto", provider: "binance", exchange: "Binance", group: "crypto", alt: "NEWCOIN12345-USD" }, "1h", { now, noCache: true });
    expect(s.candles.length).toBe(300);
    expect(s.freshness).toBe("delayed");
  });
});

describe("pull up the chart", () => {
  it("understands chart requests and keeps analysis separate", () => {
    expect(parseMikeCommand("Mike, pull up the chart of Bitcoin")).toEqual({ kind: "chart", query: "BTCUSDT", timeframe: null });
    expect(parseMikeCommand("Mike, show me the live chart of Reliance Industries on the daily")).toEqual({ kind: "chart", query: "Reliance Industries", timeframe: "1d" });
    expect(parseMikeCommand("open the Tesla chart on the 15 minute")).toEqual({ kind: "chart", query: "Tesla", timeframe: "15m" });
    expect(parseMikeCommand("pull up gold")).toEqual({ kind: "chart", query: "GC=F", timeframe: null });
    expect(parseMikeCommand("Mike, full screen chart")).toEqual({ kind: "chart", query: null, timeframe: null });
    expect(parseMikeCommand("close the chart")).toEqual({ kind: "close_chart" });
    expect(parseMikeCommand("Mike, analyze Bitcoin")).toMatchObject({ kind: "analyze" });
    expect(parseMikeCommand("Mike, explain this chart.").kind).toBe("ask");
    expect(parseMikeCommand("open the journal").kind).toBe("journal");
    expect(chartSubject("pull up the 4 hour chart for PEPE")).toBe("PEPE");
  });

  it("mike_chart is available to MIKE and to JARVIS, and opens MIKE on the right chart", async () => {
    expect(availableTools("mike").map((t) => t.name)).toContain("mike_chart");
    expect(availableTools().map((t) => t.name)).toContain("mike_chart");
    const now = Date.now();
    const c = walk(300, { t0: Math.floor(now / 3_600_000) * 3_600_000 - 299 * 3_600_000 });
    globalThis.fetch = (async () => Response.json(binanceJson(c))) as typeof fetch;
    const tool = availableTools("mike").find((t) => t.name === "mike_chart")!;
    const r = await tool.execute({ asset: "ethereum", timeframe: "4h" } as never, { userId: "u", timezone: "UTC", activity: () => {} });
    const d = r.data as { navigate: string; data: string; lastPrice: string };
    expect(d.navigate).toBe("/dashboard/mike?chart=ETHUSDT&tf=4h");
    expect(d.data).toBe("LIVE");
    expect(r.summary).toMatch(/Chart: .*4H · LIVE/);
  });
});
