import type { Bias, MikeAnalysis, Timeframe } from "./types";
import { TF_LABEL } from "./types";
import { fmtPrice } from "./format";

/**
 * MIKE's read of the market, built only from the analysis it just ran — shown
 * whether or not there's a trade. A rejected setup still comes with the
 * analysis: where price is, which way each timeframe leans, the levels that
 * matter, what the indicators say, and the levels that would change the
 * picture. Nothing here is a trade call, and nothing is invented: every number
 * is one the analysis computed from the market data.
 */

export interface MarketRead {
  price: string;
  changePct: number | null;
  lean: { bias: Bias; text: string };
  timeframes: { timeframe: Timeframe; label: string; bias: Bias; score: number; role: string }[];
  support: { price: string; distPct: number; touches: number }[];
  resistance: { price: string; distPct: number; touches: number }[];
  structure: string;
  lastEvent: string | null;
  indicators: { label: string; value: string; tone: Bias }[];
  watch: string[];
}

const fin = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const pctFrom = (from: number, to: number) => Math.round(((to - from) / from) * 1000) / 10;

export function marketRead(a: MikeAnalysis): MarketRead | null {
  const p = a.primary;
  if (!p || a.data.freshness === "unavailable") return null;
  const s = p.snapshot;
  const price = s.price;

  // which way the timeframes lean (the higher ones first, as analysed)
  const tfs = (a.alignment.length ? a.alignment : [{ timeframe: p.timeframe, bias: p.bias, score: p.score, role: "setup" as const }])
    .map((r) => ({ timeframe: r.timeframe, label: TF_LABEL[r.timeframe], bias: r.bias, score: r.score, role: r.role }));
  const bull = tfs.filter((t) => t.bias === "bullish").length, bear = tfs.filter((t) => t.bias === "bearish").length;
  const lean: MarketRead["lean"] = bull > bear && bull > tfs.length / 2 ? { bias: "bullish", text: `Leaning bullish — ${bull} of ${tfs.length} timeframes` }
    : bear > bull && bear > tfs.length / 2 ? { bias: "bearish", text: `Leaning bearish — ${bear} of ${tfs.length} timeframes` }
    : { bias: "neutral", text: `No clear direction — ${bull} bullish, ${bear} bearish, ${tfs.length - bull - bear} neutral` };

  // market structure: the latest labelled swing high and low
  const lastH = [...p.swings].reverse().find((x) => x.type === "high" && x.label);
  const lastL = [...p.swings].reverse().find((x) => x.type === "low" && x.label);
  const pair = lastH && lastL ? `${lastH.label}/${lastL.label}` : null;
  const structure = p.trend === "up" ? `Uptrend structure — higher highs and higher lows${pair ? ` (${pair})` : ""}`
    : p.trend === "down" ? `Downtrend structure — lower highs and lower lows${pair ? ` (${pair})` : ""}`
    : `Range — no clean trend structure${pair ? ` (latest swings ${pair})` : ""}`;
  const ev = p.events.at(-1);
  const lastEvent = ev ? `${ev.kind === "BOS" ? "Break of structure" : "Change of character"} (${ev.dir}) through ${fmtPrice(ev.price)}` : null;

  // indicators, each in plain words
  const ind: MarketRead["indicators"] = [];
  if (fin(s.rsi)) {
    const r = Math.round(s.rsi);
    ind.push({ label: "RSI (14)", value: `${r} — ${r >= 70 ? "overbought" : r <= 30 ? "oversold" : r >= 55 ? "bullish momentum" : r <= 45 ? "bearish momentum" : "neutral"}`, tone: r >= 55 ? "bullish" : r <= 45 ? "bearish" : "neutral" });
  }
  if (fin(s.adx)) {
    const dir: Bias = s.plusDI > s.minusDI ? "bullish" : s.minusDI > s.plusDI ? "bearish" : "neutral";
    ind.push({ label: "Trend strength (ADX)", value: `${Math.round(s.adx)} — ${s.adx < 20 ? "weak / no trend" : s.adx < 25 ? "trend developing" : "trending"}${s.adx >= 20 ? `, ${dir === "bullish" ? "buyers" : "sellers"} in control` : ""}`, tone: s.adx >= 20 ? dir : "neutral" });
  }
  if (fin(s.macdHist) && fin(s.macdHistPrev)) {
    const up = s.macdHist > s.macdHistPrev;
    ind.push({ label: "MACD", value: `histogram ${s.macdHist >= 0 ? "above" : "below"} zero and ${up ? "rising" : "falling"}`, tone: s.macdHist >= 0 && up ? "bullish" : s.macdHist < 0 && !up ? "bearish" : "neutral" });
  }
  const emas = ([["EMA 20", s.ema20], ["EMA 50", s.ema50], ["EMA 200", s.ema200]] as const).filter(([, v]) => fin(v));
  if (emas.length) {
    const above = emas.filter(([, v]) => price > v).map(([k]) => k), below = emas.filter(([, v]) => price <= v).map(([k]) => k);
    ind.push({ label: "Moving averages", value: [above.length ? `above ${above.join(", ")}` : "", below.length ? `below ${below.join(", ")}` : ""].filter(Boolean).join(" · "), tone: below.length === 0 ? "bullish" : above.length === 0 ? "bearish" : "neutral" });
  }
  if (fin(s.volumeRatio)) ind.push({ label: "Volume", value: `${s.volumeRatio.toFixed(2)}× its average${s.volumeRatio >= 1.5 ? " — unusually active" : s.volumeRatio < 0.7 ? " — quiet" : ""}`, tone: "neutral" });
  if (fin(s.atrPct)) ind.push({ label: "Volatility (ATR)", value: `${fmtPrice(s.atr)} — ${s.atrPct.toFixed(2)}% of price per bar`, tone: "neutral" });

  const support = p.support.filter((l) => l.price < price).slice(0, 2).map((l) => ({ price: fmtPrice(l.price), distPct: pctFrom(price, l.price), touches: l.touches }));
  const resistance = p.resistance.filter((l) => l.price > price).slice(0, 2).map((l) => ({ price: fmtPrice(l.price), distPct: pctFrom(price, l.price), touches: l.touches }));

  // what would change the picture — the nearest levels on each side
  const tf = TF_LABEL[p.timeframe];
  const watch: string[] = [];
  if (resistance[0]) watch.push(`A ${tf} close above ${resistance[0].price} (${resistance[0].distPct > 0 ? "+" : ""}${resistance[0].distPct}%) would break resistance — the bullish case gets stronger.`);
  if (support[0]) watch.push(`A ${tf} close below ${support[0].price} (${support[0].distPct}%) would break support — the bearish case gets stronger.`);
  if (resistance[0] && support[0]) watch.push(`Between ${support[0].price} and ${resistance[0].price} price is mid-range — no edge either way until one side breaks.`);

  return {
    price: fmtPrice(price),
    changePct: fin(s.changePct) ? Math.round(s.changePct * 100) / 100 : null,
    lean, timeframes: tfs, support, resistance, structure, lastEvent, indicators: ind, watch,
  };
}
