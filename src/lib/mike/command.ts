import type { AssetRef, Timeframe } from "./types";
import { assetInText } from "./assets";

/**
 * What a spoken/typed MIKE command means. Fast local routing for the commands
 * that drive the interface; everything else goes to MIKE's AI brain.
 */
export type MikeCommand =
  | { kind: "scan"; setups: boolean }
  | { kind: "analyze"; asset: AssetRef | null; timeframe: Timeframe | null }
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

export function parseMikeCommand(raw: string): MikeCommand {
  const text = raw.trim().replace(/^(hey\s+|ok(ay)?\s+)?mike[,!.\s]+/i, "").trim();
  const low = text.toLowerCase();
  if (/^(deactivate|close|exit|shut ?down|stand ?down)( mike)?[.!\s]*$|\b(back to|return to|open|go to) jarvis\b|\bmike[,\s]+(deactivate|stand ?down|off)\b/.test(low)) return { kind: "exit" };
  if (/\bbacktest/.test(low)) return { kind: "backtest", asset: assetInText(text), timeframe: timeframeInText(text) };
  if (/\b(why|explain|compare|what does|what is|how)\b/.test(low) && !/\bscan\b/.test(low)) return { kind: "ask", text: raw.trim() };
  if (/\b(scan|sweep)\b.*\b(market|markets|watchlist)\b|^scan\b|\bwhat changed\b|\b(strongest|best|high[- ]confidence|today'?s)\b.*\bsetups?\b|\bfind\b.*\bsetups?\b/.test(low)) {
    return { kind: "scan", setups: /\bsetups?\b/.test(low) };
  }
  if (/\b(journal|signal history|past signals)\b/.test(low)) return { kind: "journal" };
  if (/\b(alerts?)\b/.test(low) && !/\b(set|create|add|alert me)\b/.test(low)) return { kind: "alerts" };
  if (/\b(risk settings|account size|position siz)/.test(low)) return { kind: "risk" };
  const asset = assetInText(text);
  if (/\b(analy[sz]e|analysis|check|look at|chart|pull up|show me)\b/.test(low) && asset && !/\balert\b/.test(low)) {
    return { kind: "analyze", asset, timeframe: timeframeInText(text) };
  }
  return { kind: "ask", text: raw.trim() };
}
