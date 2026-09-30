"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { MikeAnalysis } from "@/lib/mike/types";
import { CHECK_LABEL, CONFIDENCE_NOTE, RISK_WARNING, TF_LABEL, TIER_LABEL } from "@/lib/mike/types";
import { fmtPrice } from "@/lib/mike/format";
import type { LevelKey } from "./mike-chart";

export type SheetPhase = "empty" | "building" | "ready" | "no_trade";

/** Counts smoothly up to a value (the confidence number). */
function useCountUp(target: number, run: boolean, ms = 1400) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) { setV(0); return; }
    let raf = 0; const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      setV(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

const FRESH: Record<string, { text: string; cls: string }> = {
  live: { text: "LIVE DATA", cls: "text-emerald-300 border-emerald-400/40" },
  delayed: { text: "DELAYED FEED", cls: "text-amber-300 border-amber-400/40" },
  closed: { text: "MARKET CLOSED", cls: "text-slate-300 border-slate-400/40" },
  stale: { text: "STALE DATA", cls: "text-rose-300 border-rose-400/40" },
  unavailable: { text: "LIVE DATA UNAVAILABLE", cls: "text-rose-300 border-rose-400/50" },
};

export function TradeSheet({ analysis, phase, alertKey, rowRef, onExplain }: {
  analysis: MikeAnalysis | null; phase: SheetPhase; alertKey: number;
  rowRef: (key: LevelKey, el: HTMLElement | null) => void;
  onExplain?: () => void;
}) {
  const a = analysis;
  const s = a?.setup;
  const showSetup = phase === "ready" && a?.decision === "setup" && !!s;
  const conf = useCountUp(a?.confidence.score ?? 0, phase === "ready" || phase === "no_trade", 1500);
  const [alerting, setAlerting] = useState(false);
  const firstAlert = useRef(alertKey);
  useEffect(() => {
    if (alertKey === firstAlert.current) return;
    setAlerting(true);
    const t = setTimeout(() => setAlerting(false), 2600);
    return () => clearTimeout(t);
  }, [alertKey]);

  if (phase === "empty" || !a) {
    return (
      <div className="mike-glass relative flex h-full min-h-[260px] flex-col items-center justify-center rounded-2xl p-6 text-center">
        <div className="hud-label text-[10px] tracking-[0.3em] text-cyan-300/70">TRADE ANALYSIS</div>
        <div className="mt-3 text-sm text-slate-300/80">Say <span className="text-cyan-200">“Mike, analyze Bitcoin”</span> or pick an asset and press <span className="text-cyan-200">Analyze</span>.</div>
        <div className="mt-2 text-[11px] text-slate-500">MIKE only builds a trade sheet when the evidence lines up. Otherwise it tells you why not.</div>
      </div>
    );
  }

  const dir = s?.direction;
  const fresh = FRESH[a.data.freshness] ?? FRESH.delayed;
  return (
    <div className={cn("relative", alerting && "mike-alert")}>
      {alerting && <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-cyan-300/70 mike-radial" />}
      {/* holographic outline that draws itself */}
      <svg key={`o-${a.generatedAt}-${phase}`} className="pointer-events-none absolute inset-0 z-10 h-full w-full" preserveAspectRatio="none" aria-hidden>
        <rect x="1" y="1" rx="16" ry="16" fill="none"
          stroke={phase === "no_trade" ? "rgba(251,191,36,0.55)" : "rgba(103,232,249,0.7)"} strokeWidth="1.5" pathLength={1} strokeDasharray="1"
          style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)", animation: "mike-outline 0.9s cubic-bezier(.2,.7,.2,1) both" }} />
      </svg>
      <div key={`${a.generatedAt}-${phase}`} className={cn("mike-glass-strong mike-glass-in relative overflow-hidden rounded-2xl p-4 sm:p-5", alerting && "shadow-[0_0_60px_-10px_rgba(34,211,238,0.8)]")} style={{ animationDelay: "0.35s" }}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-cyan-400/10 to-transparent" />
        {/* header */}
        <div className="mike-row flex items-start justify-between gap-3" style={{ animationDelay: "0.55s" }}>
          <div>
            <div className={cn("hud-label text-[10px] tracking-[0.28em]", phase === "no_trade" ? "text-amber-300" : alerting ? "text-white" : "text-cyan-300")}>
              {phase === "building" ? "BUILDING ANALYSIS…" : phase === "no_trade" ? "SETUP REJECTED" : alerting ? "NEW VALIDATED SETUP" : "TRADE ANALYSIS READY"}
            </div>
            <div className="mt-1 text-2xl font-semibold tracking-wide text-white">{a.asset.display}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">{a.asset.exchange} · {a.mode === "mtf" ? a.alignment.map((r) => TF_LABEL[r.timeframe]).join(" + ") : TF_LABEL[a.timeframe]}</div>
          </div>
          <div className="text-right">
            <span className={cn("inline-block rounded border px-2 py-0.5 font-mono text-[10px] tracking-wider", fresh.cls)} title={a.data.note}>{fresh.text}</span>
            <div className="mt-1 max-w-[150px] text-[10px] leading-tight text-slate-400">{a.regime.label}</div>
          </div>
        </div>

        {showSetup && s ? (
          <>
            <div className="mike-row mt-3 flex items-center gap-3" style={{ animationDelay: "0.7s" }}>
              <div className={cn("shrink-0 rounded-lg px-4 py-1.5 text-2xl font-bold tracking-[0.2em]", dir === "long" ? "bg-emerald-400/15 text-emerald-300 shadow-[0_0_24px_-6px_rgba(52,211,153,0.7)]" : "bg-rose-400/15 text-rose-300 shadow-[0_0_24px_-6px_rgba(251,113,133,0.7)]")}>
                {dir === "long" ? "LONG" : "SHORT"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="hud-label text-[9px] leading-tight text-slate-400">CONFIDENCE</span>
                  <span className="whitespace-nowrap font-mono text-xl font-bold text-white tabular-nums">{conf}<span className="text-sm text-slate-400"> / 100</span></span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-800">
                  <div className="h-full rounded bg-gradient-to-r from-cyan-500 via-cyan-300 to-white transition-[width] duration-300" style={{ width: `${conf}%` }} />
                </div>
                <div className="mt-0.5 text-[9px] text-slate-500">{TIER_LABEL[a.confidence.tier]} · not a win probability</div>
              </div>
            </div>

            <Row k="entry" label="ENTRY ZONE" value={`${fmtPrice(s.entryLow)} – ${fmtPrice(s.entryHigh)}`} tone="text-cyan-200" delay={0.85} rowRef={rowRef} big />
            <Row k="stop" label="STOP LOSS" value={fmtPrice(s.stop)} tone="text-rose-300" delay={1.0} rowRef={rowRef} big sub={s.stopBasis} />
            <div className="mt-2 grid grid-cols-3 gap-2">
              {s.targets.map((t, i) => (
                <div key={i} ref={(el) => rowRef((["t1", "t2", "t3"] as LevelKey[])[i], el)} className="mike-row rounded-lg border border-emerald-400/15 bg-emerald-400/[0.04] px-2 py-1.5" style={{ animationDelay: `${1.15 + i * 0.12}s` }} title={t.basis}>
                  <div className="hud-label text-[9px] text-emerald-300/70">TARGET 0{i + 1}</div>
                  <div className="font-mono text-sm font-semibold text-emerald-200 sm:text-base">{fmtPrice(t.price)}</div>
                  <div className="text-[9px] text-slate-500">{t.rr}R</div>
                </div>
              ))}
            </div>
            <div className="mike-row mt-2 flex items-center justify-between rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] px-3 py-2" style={{ animationDelay: "1.5s" }}>
              <span className="hud-label text-[10px] text-slate-400">RISK / REWARD</span>
              <span className="font-mono text-lg font-bold text-white">1 : {s.riskReward.toFixed(1)}</span>
            </div>
            {a.risk && (
              <div className="mike-row mt-2 rounded-lg border border-slate-500/20 px-3 py-2 text-[11px] text-slate-300" style={{ animationDelay: "1.6s" }}>
                <div className="flex justify-between"><span className="text-slate-400">Risk</span><span className="font-mono">{a.risk.riskPct}% {a.risk.accountSize ? `= ${a.risk.riskAmount} ${a.risk.currency}` : ""}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Position size</span><span className="font-mono">{a.risk.units ? `${a.risk.units} units` : "set account size"}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Stop distance</span><span className="font-mono">{a.risk.stopDistancePct}%</span></div>
                {a.risk.warnings.map((w) => <div key={w} className="mt-1 text-amber-300/90">⚠ {w}</div>)}
              </div>
            )}
            <div className="mike-row mt-3" style={{ animationDelay: "1.7s" }}>
              <div className="hud-label text-[9px] text-slate-400">VALIDATED CONDITIONS</div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {a.checks.map((c, i) => (
                  <div key={c.id} className="mike-row flex items-center gap-1.5 text-[11px]" style={{ animationDelay: `${1.8 + i * 0.08}s` }} title={c.detail}>
                    <CheckMark state={c.state} />
                    <span className={c.state === "pass" ? "text-slate-100" : "text-slate-400"}>{CHECK_LABEL[c.id]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mike-row mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2" style={{ animationDelay: "2.5s" }}>
              <div className="hud-label text-[9px] text-amber-300/80">INVALIDATION</div>
              <div className="text-[12px] text-slate-200">{s.invalidation}</div>
            </div>
          </>
        ) : phase === "building" ? (
          <div className="mt-6 space-y-2">
            {["ENTRY ZONE", "STOP LOSS", "TARGETS", "RISK / REWARD"].map((l, i) => (
              <div key={l} className="relative h-10 overflow-hidden rounded-lg border border-cyan-400/10 bg-cyan-400/[0.03]">
                <div className="absolute inset-y-0 left-3 flex items-center hud-label text-[9px] text-cyan-300/50">{l}</div>
                <div className="absolute inset-x-0 h-full bg-gradient-to-b from-transparent via-cyan-300/10 to-transparent mike-scanline" style={{ animationDelay: `${i * 0.2}s` }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <div className="mike-reason text-center text-lg font-bold tracking-[0.12em] text-amber-200 sm:text-xl" style={{ animationDelay: "0.7s" }}>NO HIGH-CONVICTION SETUP</div>
            <div className="mt-1 text-center text-[11px] text-slate-400">MIKE deliberately rejected this setup.</div>
            <div className="mt-3 space-y-1.5">
              {a.noTradeReasons.map((r, i) => {
                const [head, ...rest] = r.split(" — ");
                return (
                  <div key={r} className="mike-reason rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-3 py-1.5" style={{ animationDelay: `${1 + i * 0.45}s` }}>
                    <div className="font-mono text-[11px] font-bold tracking-wider text-amber-200">{head}</div>
                    {rest.length > 0 && <div className="text-[11px] text-slate-400">{rest.join(" — ")}</div>}
                  </div>
                );
              })}
            </div>
            {a.checks.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {a.checks.map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5 text-[11px]" title={c.detail}><CheckMark state={c.state} /><span className="text-slate-400">{CHECK_LABEL[c.id]}</span></div>
                ))}
              </div>
            )}
            {a.confidence.score > 0 && <div className="mt-2 text-center font-mono text-[11px] text-slate-400">confidence {conf}/100 · below the bar or blocked</div>}
            <div className="mt-2 text-center text-sm font-semibold text-slate-200">Insufficient evidence. No trade.</div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-2">
          <div className="text-[9px] leading-tight text-slate-500">{CONFIDENCE_NOTE}<br />{RISK_WARNING}</div>
          {onExplain && <button onClick={onExplain} className="mike-btn shrink-0 rounded border border-cyan-400/30 px-2 py-1 text-[10px] text-cyan-200">{phase === "no_trade" ? "WHY NO TRADE?" : "EXPLAIN"}</button>}
        </div>
      </div>
    </div>
  );
}

function Row({ k, label, value, tone, delay, rowRef, big, sub }: { k: LevelKey; label: string; value: string; tone: string; delay: number; rowRef: (key: LevelKey, el: HTMLElement | null) => void; big?: boolean; sub?: string }) {
  return (
    <div ref={(el) => rowRef(k, el)} className="mike-row mt-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5" style={{ animationDelay: `${delay}s` }}>
      <div className="hud-label text-[9px] text-slate-400">{label}</div>
      <div className={cn("whitespace-nowrap font-mono font-bold tabular-nums", big ? "text-lg sm:text-xl" : "text-base", tone)}>{value}</div>
      {sub && <div className="text-[9px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function CheckMark({ state }: { state: string }) {
  const m = state === "pass" ? ["✓", "text-emerald-300"] : state === "fail" ? ["✕", "text-rose-300"] : state === "neutral" ? ["~", "text-amber-300"] : ["–", "text-slate-500"];
  return <span className={cn("w-3 text-center font-bold", m[1])}>{m[0]}</span>;
}
