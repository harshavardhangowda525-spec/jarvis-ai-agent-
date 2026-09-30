"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MikeSettings, Timeframe } from "@/lib/mike/types";
import { TIMEFRAMES, TF_LABEL, RISK_WARNING } from "@/lib/mike/types";
import { fmtPrice } from "@/lib/mike/format";
import { Spark } from "./widgets";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3" onClick={onClose}>
      <div className={cn("mike-glass-strong mike-glass-in max-h-[88vh] w-full overflow-y-auto rounded-2xl p-4 sm:p-5", wide ? "max-w-4xl" : "max-w-xl")} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="hud-label text-[11px] tracking-[0.25em] text-cyan-300">{title}</div>
          <button onClick={onClose} aria-label="Close" className="mike-btn rounded border border-white/10 p-1 text-slate-300"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const Stat = ({ k, v, tone }: { k: string; v: string; tone?: string }) => (
  <div className="rounded-lg bg-slate-900/50 px-2.5 py-1.5"><div className="hud-label text-[8px] text-slate-500">{k}</div><div className={cn("font-mono text-sm font-semibold", tone ?? "text-slate-100")}>{v}</div></div>
);

// ---- Backtest ---------------------------------------------------------------------
const STRATS = [
  ["mike", "MIKE rules"], ["ema_cross", "EMA 20/50 cross"], ["breakout", "20-bar breakout"], ["rsi_reversion", "RSI reversion"],
] as const;

export function BacktestPanel({ asset, timeframe, onClose, autoRun, onResult }: { asset: string; timeframe: Timeframe; onClose: () => void; autoRun?: boolean; onResult?: (r: any) => void }) {
  const [form, setForm] = useState({ asset, timeframe, strategy: "mike" as string, target: 2 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [r, setR] = useState<any>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/mike/backtest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Backtest failed.");
      setR(j.data); onResult?.(j.data);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (autoRun) void run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="BACKTEST ENGINE" onClose={onClose} wide>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[10px] text-slate-400">Asset<input value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })} className="mt-0.5 block w-28 rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white" /></label>
        <label className="text-[10px] text-slate-400">Timeframe<select value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value as Timeframe })} className="mt-0.5 block rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white">{TIMEFRAMES.map((t) => <option key={t} value={t}>{TF_LABEL[t]}</option>)}</select></label>
        <label className="text-[10px] text-slate-400">Strategy<select value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })} className="mt-0.5 block rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white">{STRATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {form.strategy === "mike" && <label className="text-[10px] text-slate-400">Exit at<select value={form.target} onChange={(e) => setForm({ ...form, target: Number(e.target.value) })} className="mt-0.5 block rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white"><option value={1}>Target 1</option><option value={2}>Target 2</option><option value={3}>Target 3</option></select></label>}
        <button onClick={run} disabled={busy} className="mike-btn rounded border border-cyan-400/40 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "RUN BACKTEST"}</button>
      </div>
      {err && <div className="mt-3 rounded border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{err}</div>}
      {r && (
        <div className="mt-4 space-y-3">
          <div className="rounded border border-amber-400/30 bg-amber-400/[0.06] px-3 py-1.5 font-mono text-[11px] font-bold tracking-wider text-amber-200">BACKTEST RESULTS — NOT LIVE PERFORMANCE · {r.asset?.display} {TF_LABEL[r.timeframe as Timeframe]} · {new Date(r.from).toISOString().slice(0, 10)} → {new Date(r.to).toISOString().slice(0, 10)} · {r.bars} bars</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Stat k="TOTAL TRADES" v={String(r.totalTrades)} />
            <Stat k="WINNING / LOSING" v={`${r.wins} / ${r.losses}`} />
            <Stat k="WIN RATE" v={`${r.winRate}%`} />
            <Stat k="PROFIT FACTOR" v={r.profitFactor == null ? "∞ (no losses)" : String(r.profitFactor)} tone={r.profitFactor != null && r.profitFactor < 1 ? "text-rose-300" : undefined} />
            <Stat k="AVG WIN" v={`${r.avgWinR}R · ${r.avgWinPct}%`} tone="text-emerald-300" />
            <Stat k="AVG LOSS" v={`${r.avgLossR}R · ${r.avgLossPct}%`} tone="text-rose-300" />
            <Stat k="EXPECTANCY" v={`${r.expectancyR}R / trade`} tone={r.expectancyR < 0 ? "text-rose-300" : "text-emerald-300"} />
            <Stat k="MAX DRAWDOWN" v={`${r.maxDrawdownR}R · ${r.maxDrawdownPct}%`} />
            <Stat k="SHARPE (PER TRADE)" v={r.sharpePerTrade == null ? "n/a (<10 trades)" : String(r.sharpePerTrade)} />
            <Stat k="AVG HOLDING" v={`${r.avgHoldingBars} bars · ${r.avgHoldingHours}h`} />
            <Stat k="MAX CONSECUTIVE LOSSES" v={String(r.maxConsecutiveLosses)} />
            <Stat k="NET (AT RISK %/TRADE)" v={`${r.netR}R · ${r.netPct}%`} />
          </div>
          {r.equityR?.length > 1 && (
            <div className="rounded-lg bg-slate-900/50 p-2">
              <div className="hud-label text-[8px] text-slate-500">EQUITY CURVE (CUMULATIVE R)</div>
              <Spark values={[0, ...r.equityR]} up={r.netR >= 0} w={820} h={70} />
            </div>
          )}
          {r.byRegime?.length > 0 && (
            <div>
              <div className="hud-label text-[9px] text-slate-400">PERFORMANCE BY MARKET REGIME</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {r.byRegime.map((g: any) => <div key={g.regime} className="flex justify-between rounded bg-slate-900/40 px-2 py-1 font-mono text-[11px]"><span className="uppercase text-slate-300">{g.regime.replace("_", " ")}</span><span className="text-slate-400">{g.trades} trades · {g.winRate}% · {g.expectancyR}R</span></div>)}
              </div>
            </div>
          )}
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-400">{r.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
    </Modal>
  );
}

// ---- Journal ------------------------------------------------------------------------
export function JournalPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => fetch("/api/mike/journal?limit=60").then((r) => r.json()).then((j) => setData(j.data)).catch(() => setData({ signals: [], insights: null }));
  useEffect(() => { void load(); }, []);
  const resolve = async () => { setBusy(true); await fetch("/api/mike/journal", { method: "POST" }).catch(() => null); await load(); setBusy(false); };
  const ins = data?.insights;
  return (
    <Modal title="SIGNAL JOURNAL · LIVE RECORD" onClose={onClose} wide>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-400">Every analysis MIKE made — setups and deliberate no-trades — with outcomes from real candles. Finished rows are never edited.</div>
        <button onClick={resolve} disabled={busy} className="mike-btn shrink-0 rounded border border-cyan-400/30 px-2 py-1 text-[10px] text-cyan-100">{busy ? "CHECKING…" : "UPDATE OUTCOMES"}</button>
      </div>
      {ins && (
        <div className="mt-3 rounded-lg border border-white/5 bg-slate-900/40 p-2.5 text-[11px]">
          <div className="hud-label text-[9px] text-cyan-300/80">WHAT WORKS (LIVE, NOT BACKTEST)</div>
          {!ins.ready ? <div className="mt-1 text-slate-400">{ins.notes[0]}</div> : (
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              <div><div className="text-slate-500">Overall</div><div className="font-mono text-slate-200">{ins.overall.trades} setups · {ins.overall.winRate}% · {ins.overall.expectancyR}R</div></div>
              <div><div className="text-slate-500">By confidence</div>{ins.byConfidence.map((g: any) => <div key={g.tier} className="font-mono text-slate-300">{g.tier}: {g.trades} · {g.winRate}%</div>)}</div>
              <div><div className="text-slate-500">By regime</div>{ins.byRegime.slice(0, 4).map((g: any) => <div key={g.regime} className="truncate font-mono text-slate-300">{g.regime.split(" · ")[0]}: {g.trades} · {g.winRate}%</div>)}</div>
            </div>
          )}
        </div>
      )}
      <div className="mt-3 space-y-1">
        {!data && <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-cyan-300" /></div>}
        {data?.signals?.length === 0 && <div className="py-4 text-center text-sm text-slate-400">No analyses yet.</div>}
        {data?.signals?.map((s: any) => {
          const res = s.status;
          const tone = res === "won" ? "text-emerald-300" : res === "lost" ? "text-rose-300" : res === "no_trade" ? "text-amber-200/80" : "text-cyan-200";
          return (
            <div key={s.id} className="rounded-lg bg-slate-900/40">
              <button onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px]">
                <span className="w-28 shrink-0 font-mono text-slate-500">{new Date(s.createdAt).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="w-24 shrink-0 font-semibold text-slate-100">{s.asset}</span>
                <span className="w-10 shrink-0 font-mono text-slate-400">{TF_LABEL[s.timeframe as Timeframe]}</span>
                <span className="w-14 shrink-0 uppercase text-slate-300">{s.direction ?? "—"}</span>
                <span className="w-10 shrink-0 font-mono text-slate-300">{s.confidence}</span>
                <span className={cn("flex-1 truncate font-mono uppercase", tone)}>{res.replace("_", " ")}{s.outcome?.rMultiple != null ? ` ${s.outcome.rMultiple}R` : ""}</span>
              </button>
              {open === s.id && (
                <div className="border-t border-white/5 px-3 py-2 text-[11px] text-slate-300">
                  {s.decision === "setup" ? (
                    <div className="font-mono">Entry {fmtPrice(s.entryLow)} – {fmtPrice(s.entryHigh)} · Stop {fmtPrice(s.stop)} · Targets {(s.targets ?? []).map((t: any) => fmtPrice(t.price)).join(" / ")} · R:R 1:{s.riskReward}</div>
                  ) : <div className="text-amber-200/80">{(s.reasoning?.noTradeReasons ?? []).join(" · ")}</div>}
                  <div className="mt-1 text-slate-500">{s.regime} · {s.freshness} data · {s.source}</div>
                  {s.outcome && <div className="mt-1">Outcome: {s.outcome.result} · best {s.outcome.mfeR}R · worst −{s.outcome.maeR}R · {s.outcome.bars} bars</div>}
                  {s.audit && (
                    <div className="mt-2 rounded border border-cyan-400/15 bg-cyan-400/[0.04] p-2">
                      <div className="hud-label text-[8px] text-cyan-300/80">SELF-AUDIT</div>
                      <div>Predicted: {s.audit.predicted}</div>
                      <div>Actual: {s.audit.actual}</div>
                      {s.audit.confirmationsMisleading?.length > 0 && <div>Misleading: {s.audit.confirmationsMisleading.join(", ")}</div>}
                      <div>Regime classified correctly: {s.audit.regimeCorrect == null ? "unknown" : s.audit.regimeCorrect ? "yes" : "no"} · Rules followed: {s.audit.rulesFollowed ? "yes" : "no"} · Over-confident: {s.audit.overconfident ? "yes" : "no"}</div>
                      <ul className="mt-1 list-disc pl-4 text-slate-400">{s.audit.lessons.map((l: string) => <li key={l}>{l}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ---- Alerts ---------------------------------------------------------------------------
const KINDS = [
  ["price_above", "Price above"], ["price_below", "Price below"], ["breakout", "Breakout"], ["breakdown", "Breakdown"],
  ["volume_spike", "Volume spike"], ["trend_reversal", "Trend reversal"], ["rsi_above", "RSI above"], ["rsi_below", "RSI below"], ["new_setup", "New validated setup"],
] as const;
export function AlertsPanel({ asset, timeframe, onClose }: { asset: string; timeframe: Timeframe; onClose: () => void }) {
  const [alerts, setAlerts] = useState<any[] | null>(null);
  const [form, setForm] = useState({ asset, kind: "price_above", level: "", timeframe });
  const [err, setErr] = useState<string | null>(null);
  const load = () => fetch("/api/mike/alerts").then((r) => r.json()).then((j) => setAlerts(j.data?.alerts ?? [])).catch(() => setAlerts([]));
  useEffect(() => { void load(); }, []);
  const needs = ["price_above", "price_below", "rsi_above", "rsi_below"].includes(form.kind);
  const create = async () => {
    setErr(null);
    const res = await fetch("/api/mike/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", asset: form.asset, kind: form.kind, timeframe: form.timeframe, ...(needs ? { level: Number(form.level) } : {}) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error || "Couldn't create the alert."); return; }
    setForm({ ...form, level: "" }); void load();
  };
  const del = async (id: string) => { await fetch(`/api/mike/alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" }); void load(); };
  return (
    <Modal title="MARKET ALERTS" onClose={onClose}>
      <div className="text-[11px] text-slate-400">Alerts only notify you. MIKE never places, changes or closes a trade.</div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <input value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })} className="w-24 rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white" aria-label="Asset" />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {needs && <input value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} placeholder="level" inputMode="decimal" className="w-28 rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white" />}
        <select value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value as Timeframe })} className="rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white">{TIMEFRAMES.map((t) => <option key={t} value={t}>{TF_LABEL[t]}</option>)}</select>
        <button onClick={create} className="mike-btn rounded border border-cyan-400/40 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100">ADD</button>
      </div>
      {err && <div className="mt-2 text-sm text-rose-300">{err}</div>}
      <div className="mt-3 space-y-1">
        {alerts?.length === 0 && <div className="text-sm text-slate-400">No alerts yet.</div>}
        {alerts?.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded bg-slate-900/40 px-2.5 py-1.5 text-[11px]">
            <span className={cn("w-16 font-mono uppercase", a.status === "triggered" ? "text-emerald-300" : "text-cyan-200")}>{a.status}</span>
            <span className="flex-1 text-slate-200">{a.asset} · {KINDS.find((k) => k[0] === a.kind)?.[1]}{a.level != null ? ` ${a.level}` : ""} · {TF_LABEL[a.timeframe as Timeframe]}{a.triggerInfo?.message ? <span className="block text-slate-400">{a.triggerInfo.message}</span> : null}</span>
            <button onClick={() => del(a.id)} aria-label="Delete alert" className="text-slate-500 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---- Risk settings -------------------------------------------------------------------
export function RiskPanel({ onClose, onSaved }: { onClose: () => void; onSaved: (s: MikeSettings) => void }) {
  const [s, setS] = useState<MikeSettings | null>(null);
  const [news, setNews] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { fetch("/api/mike/settings").then((r) => r.json()).then((j) => { setS(j.data.settings); setNews(j.data.newsAvailable); }).catch(() => setErr("Couldn't load settings.")); }, []);
  const save = async () => {
    if (!s) return;
    setErr(null); setSaved(false);
    const res = await fetch("/api/mike/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error || "Invalid settings."); return; }
    setSaved(true); onSaved(j.data.settings);
  };
  const num = (k: keyof MikeSettings, label: string, step = "0.1", hint?: string) => (
    <label className="block text-[11px] text-slate-400">{label}
      <input type="number" step={step} value={String(s?.[k] ?? "")} onChange={(e) => setS({ ...(s as MikeSettings), [k]: Number(e.target.value) })} className="mt-0.5 block w-full rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white" />
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
  return (
    <Modal title="RISK MANAGEMENT" onClose={onClose}>
      {!s ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-cyan-300" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {num("accountSize", "Account size", "100")}
            <label className="block text-[11px] text-slate-400">Currency<input value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value.toUpperCase().slice(0, 8) })} className="mt-0.5 block w-full rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white" /></label>
            {num("riskPct", "Max risk per trade (%)", "0.1")}
            {num("maxDailyRiskPct", "Max risk per day (%)", "0.1")}
            {num("minConfidence", "Minimum confidence (60–95)", "1", "Below this MIKE says no trade.")}
            {num("minRiskReward", "Minimum reward : risk", "0.1")}
          </div>
          <label className="block text-[11px] text-slate-400">Default timeframe
            <select value={s.defaultTimeframe} onChange={(e) => setS({ ...s, defaultTimeframe: e.target.value as Timeframe })} className="mt-0.5 block rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white">{TIMEFRAMES.map((t) => <option key={t} value={t}>{TF_LABEL[t]}</option>)}</select>
          </label>
          <label className="block text-[11px] text-slate-400">Watchlist (comma-separated, up to 20)
            <input value={s.watchlist.join(", ")} onChange={(e) => setS({ ...s, watchlist: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20) })} className="mt-0.5 block w-full rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white" />
          </label>
          <div className="text-[11px] text-slate-400">Position size = (account × risk %) ÷ stop distance. It is never increased because confidence is high. Correlated open setups halve the risk; the daily limit caps it.</div>
          <div className={cn("text-[11px]", news ? "text-emerald-300/80" : "text-amber-300/80")}>News context: {news ? "connected (SEARCH_API_KEY)" : "not connected — add SEARCH_API_KEY to include news"}</div>
          <div className="text-[10px] text-slate-500">{RISK_WARNING}</div>
          {err && <div className="text-sm text-rose-300">{err}</div>}
          <div className="flex items-center gap-2">
            <button onClick={save} className="mike-btn rounded border border-cyan-400/40 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100">SAVE</button>
            {saved && <span className="text-[11px] text-emerald-300">Saved.</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}
