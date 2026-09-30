import type { Candle, Direction, Target } from "./types";
import { round } from "./format";

/**
 * How a journalled setup actually played out, read from REAL candles that
 * formed after the signal. Conservative: a bar that touches both the stop and
 * the primary target counts as a stop. Pure — tested directly.
 */

export const TRIGGER_WINDOW_BARS = 20;
export const MAX_HOLD_BARS = 100;

export interface SignalLike {
  direction: Direction;
  entryLow: number; entryHigh: number; stop: number;
  targets: Target[];
  createdAt: number;
}

export interface Outcome {
  status: "open" | "triggered" | "won" | "lost" | "expired" | "not_triggered";
  triggeredAt: number | null;
  entry: number | null;
  exitPrice: number | null;
  exitAt: number | null;
  targetsHit: number;
  rMultiple: number | null;
  mfeR: number; maeR: number;
  mfe: number; mae: number;
  bars: number;
}

export function resolveOutcome(sig: SignalLike, candles: Candle[], primaryTarget = 2): Outcome {
  const after = candles.filter((c) => c.t >= sig.createdAt);
  const d = sig.direction === "long" ? 1 : -1;
  const out: Outcome = { status: "open", triggeredAt: null, entry: null, exitPrice: null, exitAt: null, targetsHit: 0, rMultiple: null, mfeR: 0, maeR: 0, mfe: 0, mae: 0, bars: 0 };
  let k = 0;
  for (; k < after.length; k++) {
    const b = after[k];
    if (b.l <= sig.entryHigh && b.h >= sig.entryLow) {
      out.triggeredAt = b.t;
      out.entry = Math.min(Math.max(b.o, sig.entryLow), sig.entryHigh);
      break;
    }
    if (k + 1 >= TRIGGER_WINDOW_BARS) { out.status = "not_triggered"; return out; }
  }
  if (out.entry == null) return out; // still waiting for the entry zone
  out.status = "triggered";
  const entry = out.entry;
  const risk = Math.abs(entry - sig.stop) || 1e-9;
  const goal = sig.targets[Math.min(primaryTarget, sig.targets.length) - 1]?.price;
  for (let j = k; j < after.length; j++) {
    const b = after[j];
    out.bars = j - k + 1;
    out.mfe = Math.max(out.mfe, ((d === 1 ? b.h : b.l) - entry) * d);
    out.mae = Math.max(out.mae, (d === 1 ? entry - b.l : b.h - entry));
    const stopHit = d === 1 ? b.l <= sig.stop : b.h >= sig.stop;
    sig.targets.forEach((t, n) => { if ((d === 1 ? b.h >= t.price : b.l <= t.price) && !stopHit) out.targetsHit = Math.max(out.targetsHit, n + 1); });
    const goalHit = goal != null && (d === 1 ? b.h >= goal : b.l <= goal);
    if (stopHit) { out.status = "lost"; out.exitPrice = sig.stop; out.exitAt = b.t; break; }
    if (goalHit) { out.status = "won"; out.exitPrice = goal; out.exitAt = b.t; break; }
    if (out.bars >= MAX_HOLD_BARS) { out.status = "expired"; out.exitPrice = b.c; out.exitAt = b.t; break; }
  }
  out.mfeR = round(out.mfe / risk, 2);
  out.maeR = round(out.mae / risk, 2);
  if (out.exitPrice != null) out.rMultiple = round(((out.exitPrice - entry) * d) / risk, 2);
  return out;
}

export interface AuditInput {
  direction: Direction;
  confidence: number;
  riskReward: number | null;
  regime: string | null;
  checks: { id: string; state: string; detail: string }[];
  outcome: Outcome;
  regimeAfter?: string | null;
  minConfidence: number;
  minRiskReward: number;
}

/**
 * MIKE's self-audit of a finished setup: what it predicted, what happened, which
 * confirmations held up, whether it followed its own rules, whether confidence
 * was too high — and what to change. It only ADDS this note; the original
 * analysis is never edited.
 */
export function selfAudit(a: AuditInput) {
  const o = a.outcome;
  const won = o.status === "won";
  const passed = a.checks.filter((c) => c.state === "pass").map((c) => c.id);
  const weak = a.checks.filter((c) => c.state === "neutral" || c.state === "fail").map((c) => c.id);
  const predicted = `${a.direction.toUpperCase()} — reach target 2 before the stop (confidence ${a.confidence}/100${a.riskReward ? `, R:R 1:${a.riskReward}` : ""}).`;
  const actual = o.status === "not_triggered" ? "Price never reached the entry zone — no trade happened."
    : o.status === "expired" ? `Neither stop nor target 2 within ${MAX_HOLD_BARS} bars; closed at ${o.rMultiple}R.`
      : `${won ? "Target 2 reached" : "Stopped out"} after ${o.bars} bars (${o.rMultiple}R; best ${o.mfeR}R, worst −${o.maeR}R${o.targetsHit ? `, target ${o.targetsHit} touched` : ""}).`;
  const correct = won ? passed : [];
  const misleading = won ? [] : passed;
  const rulesFollowed = a.confidence >= a.minConfidence && (a.riskReward ?? 0) >= a.minRiskReward;
  const overconfident = !won && o.status === "lost" && a.confidence >= 80;
  const regimeCorrect = a.regimeAfter ? sameFamily(a.regime, a.regimeAfter) : null;
  const lessons: string[] = [];
  if (o.status === "not_triggered") lessons.push("Entry zone may be too tight for this volatility — consider entries nearer the current price or wait for a retest.");
  if (o.status === "lost" && o.mfeR >= 1) lessons.push(`Price went ${o.mfeR}R in favour before stopping out — a partial exit at target 1 or a break-even stop would have protected it.`);
  if (o.status === "lost" && o.mfeR < 0.3) lessons.push("The move failed almost immediately — entry timing or direction was wrong; weigh the lower-timeframe confirmation more.");
  if (o.status === "lost" && weak.includes("volume")) lessons.push("Volume didn't confirm this setup — treat unconfirmed volume as a stronger warning.");
  if (o.status === "lost" && weak.includes("momentum")) lessons.push("Momentum was not confirmed — avoid entries when momentum is only neutral.");
  if (regimeCorrect === false) lessons.push(`The regime changed (${a.regime} → ${a.regimeAfter}) — regime classification should be re-checked before entry.`);
  if (overconfident) lessons.push(`Confidence ${a.confidence} was too high for a losing setup — review which checks were over-weighted.`);
  if (won && o.maeR >= 0.8) lessons.push("It worked but came close to the stop — the stop placement was tight for this volatility.");
  if (!lessons.length) lessons.push(won ? "Setup behaved as analysed — no rule change suggested from this one sample." : "One loss is not evidence of a broken rule — keep collecting samples.");
  return {
    predicted, actual,
    confirmationsCorrect: correct, confirmationsMisleading: misleading,
    regimeCorrect, rulesFollowed, overconfident, lessons,
    auditedAt: new Date().toISOString(),
  };
}

function sameFamily(a: string | null, b: string | null): boolean {
  const fam = (s: string | null) => (s ?? "").includes("BULLISH") ? "bull" : (s ?? "").includes("BEARISH") ? "bear" : "range";
  return fam(a) === fam(b);
}
