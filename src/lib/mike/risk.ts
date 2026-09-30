import type { MikeSettings, RiskPlan, TradeSetup } from "./types";
import { round } from "./format";

/**
 * Position sizing from the user's own risk settings. Size comes from the stop
 * distance and the risk budget ONLY — never from confidence. A high confidence
 * score never makes the position bigger.
 */

export interface OpenRisk { asset: string; group: string; riskPct: number }

export function riskPlan(settings: MikeSettings, setup: TradeSetup, group: string, open: OpenRisk[], asset: string): RiskPlan {
  const entry = (setup.entryLow + setup.entryHigh) / 2;
  const stopDistance = Math.abs(entry - setup.stop);
  const stopDistancePct = entry ? (stopDistance / entry) * 100 : 0;
  const warnings: string[] = [];
  const openRiskPct = round(open.reduce((s, o) => s + o.riskPct, 0), 2);
  const correlatedOpen = open.filter((o) => o.group === group && o.asset !== asset).map((o) => o.asset);

  let riskPct = settings.riskPct;
  const room = settings.maxDailyRiskPct - openRiskPct;
  if (room <= 0) { riskPct = 0; warnings.push(`Daily risk limit reached (${openRiskPct}% open of ${settings.maxDailyRiskPct}% max) — no new position.`); }
  else if (room < riskPct) { riskPct = round(room, 2); warnings.push(`Risk cut to ${riskPct}% so today's total stays within ${settings.maxDailyRiskPct}%.`); }
  if (correlatedOpen.length) {
    riskPct = round(riskPct / 2, 2);
    warnings.push(`Correlated exposure already open (${correlatedOpen.join(", ")}) — risk halved to ${riskPct}%.`);
  }
  if (!settings.accountSize) warnings.push("Set your account size in MIKE's risk settings to get a position size.");
  const riskAmount = round((settings.accountSize * riskPct) / 100, 2);
  const units = stopDistance > 0 ? riskAmount / stopDistance : 0;
  const notional = units * entry;
  if (settings.accountSize && notional > settings.accountSize) warnings.push(`Position value ${round(notional, 0)} exceeds the account (${settings.accountSize}) — this needs leverage; consider a smaller size.`);
  return {
    accountSize: settings.accountSize, currency: settings.currency, riskPct, riskAmount,
    stopDistance, stopDistancePct: round(stopDistancePct, 3),
    units: units >= 100 ? round(units, 0) : units >= 1 ? round(units, 2) : round(units, 6),
    notional: round(notional, 2), maxDailyRiskPct: settings.maxDailyRiskPct, openRiskPct, correlatedOpen, warnings,
  };
}
