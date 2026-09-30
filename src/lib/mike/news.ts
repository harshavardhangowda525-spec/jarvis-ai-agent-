import "server-only";
import { env } from "@/lib/env";
import type { AssetRef, External, Headline, SentimentId } from "./types";

/**
 * EXTERNAL INFORMATION — kept strictly apart from price data. Headlines come
 * from a real news search (Tavily, SEARCH_API_KEY); nothing is invented. Their
 * tone is scored with a small, transparent word list (each headline shows its
 * tone), and scheduled high-impact events are flagged as event risk.
 * No key → "unavailable", and MIKE says so instead of guessing.
 */

const POS = ["surge", "surges", "rally", "rallies", "soar", "soars", "jump", "jumps", "gain", "gains", "record high", "beat", "beats", "upgrade", "upgraded", "bullish", "inflows", "approval", "approved", "rebound", "rebounds", "strong", "rise", "rises", "climb", "climbs", "cut rates", "rate cut", "stimulus", "outperform"];
const NEG = ["plunge", "plunges", "crash", "crashes", "tumble", "tumbles", "slump", "slumps", "fall", "falls", "drop", "drops", "sell-off", "selloff", "miss", "misses", "downgrade", "downgraded", "bearish", "outflows", "ban", "lawsuit", "hack", "hacked", "fraud", "probe", "recession", "weak", "slide", "slides", "rate hike", "hikes rates", "default", "sanctions", "war"];
const EVENTS: [RegExp, string][] = [
  [/\b(fomc|fed(eral reserve)? (meeting|decision|rate decision)|powell)\b/i, "Federal Reserve decision / FOMC"],
  [/\b(rbi (policy|monetary|rate)|monetary policy committee|mpc meeting)\b/i, "RBI policy decision"],
  [/\b(ecb (meeting|decision|rate))\b/i, "ECB rate decision"],
  [/\b(cpi|inflation data|inflation report)\b/i, "Inflation (CPI) data"],
  [/\b(non-?farm payrolls|nfp|jobs report|employment data)\b/i, "Employment data"],
  [/\bgdp\b/i, "GDP release"],
  [/\b(earnings|quarterly results|q[1-4] results)\b/i, "Earnings"],
  [/\b(sec|regulator|regulatory|etf approval|etf decision)\b/i, "Regulatory development"],
  [/\b(war|missile|invasion|sanctions|geopolitical)\b/i, "Geopolitical development"],
];

function tone(title: string): -1 | 0 | 1 {
  const t = title.toLowerCase();
  const p = POS.filter((w) => t.includes(w)).length, n = NEG.filter((w) => t.includes(w)).length;
  return p > n ? 1 : n > p ? -1 : 0;
}

function queryFor(a: AssetRef): string {
  const name = a.kind === "crypto" ? a.display.split("/")[0] : a.display;
  const extra = a.kind === "crypto" ? "crypto price" : a.kind === "forex" ? "forex" : a.kind === "commodity" ? "price" : a.kind === "index" ? "index market" : "stock";
  return `${name} ${extra} news`;
}

const cache = new Map<string, { at: number; ex: External }>();

export async function externalContext(asset: AssetRef, fetchImpl: typeof fetch = fetch): Promise<External> {
  if (!env.searchApiKey) {
    return { available: false, note: "News context unavailable — add SEARCH_API_KEY (Tavily) to .env.local to include news.", headlines: [], newsSentiment: null, eventRisk: [] };
  }
  const key = asset.symbol;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.ex;
  try {
    const res = await fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: env.searchApiKey, query: queryFor(asset), topic: "news", days: 3, max_results: 8, search_depth: "basic" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { available: false, note: `News search failed (HTTP ${res.status}) — analysis uses price data only.`, headlines: [], newsSentiment: null, eventRisk: [] };
    const j = await res.json();
    const headlines: Headline[] = (j.results ?? []).slice(0, 8).map((r: any) => {
      let source = "";
      try { source = new URL(r.url).hostname.replace(/^www\./, ""); } catch { /* keep blank */ }
      return { title: String(r.title ?? "").slice(0, 200), url: String(r.url ?? ""), source, publishedAt: r.published_date ?? null, tone: tone(String(r.title ?? "")) };
    }).filter((h: Headline) => h.title && h.url);
    const ex = summarize(headlines);
    cache.set(key, { at: Date.now(), ex });
    return ex;
  } catch (e) {
    return { available: false, note: `News search unreachable (${(e as Error).message}) — analysis uses price data only.`, headlines: [], newsSentiment: null, eventRisk: [] };
  }
}

export function summarize(headlines: Headline[]): External {
  if (!headlines.length) return { available: true, note: "No recent news found for this asset.", headlines, newsSentiment: "neutral", eventRisk: [] };
  const sum = headlines.reduce((s, h) => s + h.tone, 0);
  const avg = sum / headlines.length;
  const newsSentiment: SentimentId = avg >= 0.6 ? "extremely_bullish" : avg >= 0.2 ? "bullish" : avg <= -0.6 ? "extremely_bearish" : avg <= -0.2 ? "bearish" : "neutral";
  const eventRisk = [...new Set(headlines.flatMap((h) => EVENTS.filter(([re]) => re.test(h.title)).map(([, name]) => name)))];
  return {
    available: true,
    note: `${headlines.length} headline${headlines.length === 1 ? "" : "s"} from the last 3 days: ${headlines.filter((h) => h.tone > 0).length} positive, ${headlines.filter((h) => h.tone < 0).length} negative, ${headlines.filter((h) => h.tone === 0).length} neutral (word-list scoring).`,
    headlines, newsSentiment, eventRisk,
  };
}
