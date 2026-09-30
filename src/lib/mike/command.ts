import type { AssetRef, Timeframe } from "./types";
import { assetInText } from "./assets";
import { isMikeDeactivation, stripMikeWake } from "./wake";

/**
 * What a spoken/typed MIKE command means. Fast local routing for the commands
 * that drive the interface; everything else goes to MIKE's AI brain.
 */
export type MikeCommand =
  | { kind: "scan"; setups: boolean }
  | { kind: "analyze"; asset: AssetRef | null; timeframe: Timeframe | null }
  /** Pull up the live chart. `query` is a catalogue name or free text for the server to look up. */
  | { kind: "chart"; query: string | null; timeframe: Timeframe | null }
  | { kind: "close_chart" }
  | { kind: "backtest"; asset: AssetRef | null; timeframe: Timeframe | null }
  | { kind: "journal" }
  | { kind: "alerts" }
  | { kind: "risk" }
  | { kind: "exit" }
  | { kind: "ask"; text: string };

export function timeframeInText(text: string): Timeframe | null {
  const t = text.toLowerCase();
  if (/\b(weekly|1 ?w(eek)?|one week)\b/.test(t)) return "1w";
  if (/\b(daily|1 ?d(ay)?|one day|day chart)\b/.test(t)) return "1d";
  if (/\b(4 ?h(ou)?r?s?|four[- ]hour|4-hour)\b/.test(t)) return "4h";
  if (/\b(1 ?h(ou)?r?|one[- ]hour|hourly|60 ?m(in)?)\b/.test(t)) return "1h";
  if (/\b(30 ?m(in(ute)?s?)?|thirty[- ]minute)\b/.test(t)) return "30m";
  if (/\b(15 ?m(in(ute)?s?)?|fifteen[- ]minute)\b/.test(t)) return "15m";
  if (/\b(5 ?m(in(ute)?s?)?|five[- ]minute)\b/.test(t)) return "5m";
  if (/\b(1 ?m(in(ute)?)?|one[- ]minute)\b/.test(t)) return "1m";
  return null;
}

const CHART_WORDS = /\b(pull(?:ing)? up|bring up|show(?: me)?|open|display|load|switch to|go to|get me|put up|chart(?:s|ing)?|graph|live|price(?: action)?|candles?|candlesticks?|of|for|on|in|the|a|an|please|now|me|full ?screen|view|time ?frame|timeframe|chart)\b/gi;
const TF_WORDS = /\b(weekly|daily|hourly|one|five|fifteen|thirty|four|minute|minutes|min|hour|hours|day|week|\d+ ?(m|h|d|w|min|mins|minute|minutes|hour|hours|hr|hrs)?)\b/gi;

/** The market named in "pull up the live chart of Reliance Industries on the daily" → "Reliance Industries". */
export function chartSubject(text: string): string | null {
  const known = assetInText(text, { catalogOnly: true });
  if (known) return known.symbol;
  const rest = stripMikeWake(text)
    .replace(/^(hey\s+|ok(ay)?\s+)?jarvis[,!.\s]+/i, "")
    .replace(/[?!.,]/g, " ")
    .replace(TF_WORDS, " ")
    .replace(CHART_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return rest.length >= 2 && rest.length <= 40 ? rest : null;
}

export function parseMikeCommand(raw: string): MikeCommand {
  const text = stripMikeWake(raw);
  const low = text.toLowerCase();
  if (/^(deactivate|close|exit|shut ?down|stand ?down)[.!\s]*$/.test(low) || isMikeDeactivation(raw)) return { kind: "exit" };
  if (/\bbacktest/.test(low)) return { kind: "backtest", asset: assetInText(text), timeframe: timeframeInText(text) };
  if (/^(close|hide|exit|minimi[sz]e)( the)?( live)? chart\b|\b(close|hide) (the )?(live )?chart\b/.test(low)) return { kind: "close_chart" };
  if (/\b(scan|sweep)\b.*\b(market|markets|watchlist)\b|^scan\b|\bwhat changed\b|\b(strongest|best|high[- ]confidence|today'?s)\b.*\bsetups?\b|\bfind\b.*\bsetups?\b/.test(low)) {
    return { kind: "scan", setups: /\bsetups?\b/.test(low) };
  }
  // "pull up / show me / open the chart of X" → the live chart (no trade call)
  if (!/\banaly[sz]/.test(low) && (/\b(chart|graph|candles?|candlesticks?|price action)\b/.test(low) || /^(pull up|bring up|show me|open|display)\b/.test(low)) && !/\b(why|explain|what)\b/.test(low) && !/\b(journal|alerts?|risk|settings|backtest)\b/.test(low)) {
    return { kind: "chart", query: chartSubject(text), timeframe: timeframeInText(text) };
  }
  if (/\b(why|explain|compare|what does|what is|how)\b/.test(low) && !/\bscan\b/.test(low)) return { kind: "ask", text: raw.trim() };
  if (/\b(scan|sweep)\b.*\b(market|markets|watchlist)\b|^scan\b|\bwhat changed\b|\b(strongest|best|high[- ]confidence|today'?s)\b.*\bsetups?\b|\bfind\b.*\bsetups?\b/.test(low)) {
    return { kind: "scan", setups: /\bsetups?\b/.test(low) };
  }
  if (/\b(journal|signal history|past signals)\b/.test(low)) return { kind: "journal" };
  if (/\b(alerts?)\b/.test(low) && !/\b(set|create|add|alert me)\b/.test(low)) return { kind: "alerts" };
  if (/\b(risk settings|account size|position siz)/.test(low)) return { kind: "risk" };
  const asset = assetInText(text);
  if (/\b(analy[sz]e|analysis|check|look at)\b/.test(low) && asset && !/\balert\b/.test(low)) {
    return { kind: "analyze", asset, timeframe: timeframeInText(text) };
  }
  return { kind: "ask", text: raw.trim() };
}
