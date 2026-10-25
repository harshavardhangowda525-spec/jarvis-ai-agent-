"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { MetricBlock, WeekMetrics, WeekRow } from "@/lib/trading/analyze";
import type { Narrative } from "@/lib/trading/narrative";
import { PHASES } from "@/lib/trading/playbook-types";
import { EquityChart, Meter, SERIES, StackedBars, WeekLine } from "./charts";
import { TI_CSS } from "./styles";

/**
 * Trading Intelligence — MIKE's weekly review of your trading playbook. Every
 * figure comes from the stored report (or, for "this week so far", a live read
 * of the playbook). A figure with nothing behind it reads "No data", never 0.
 */

type Report = {
  id: string; weekStart: string; weekEnd: string; label: string; status: string; revision: number; trigger: string; error: string | null;
  generatedAt: string | null; metrics: (WeekMetrics & { history?: WeekRow[] }) | null; narrative: Narrative | null;
  source: { kind: string; fetchedAt: string; asOf: string | null; note: string | null } | null;
  revisions: { revision: number; trigger: string; createdAt: string }[]; viewingOld: boolean; notifyLog: { channel: string; status: string; detail?: string }[];
};
type Payload = {
  reports: { id: string; weekStart: string; label: string; status: string; revision: number }[];
  report: Report | null;
  source: { configured: boolean; supabase: string | null; url: string | null; hint: string | null; backupAt: string | null };
  settings: { weeklyEnabled: boolean; notifyEmail: boolean; notifyWhatsapp: boolean };
};
type Preview = { label: string; metrics: WeekMetrics; source: { kind: string; fetchedAt: string } };

const pct = (x: number | null | undefined) => (x == null ? null : `${Math.round(x * 100)}%`);
const r2 = (x: number | null | undefined) => (x == null ? null : x.toFixed(2));
const inr = (x: number | null | undefined) => (x == null ? null : `${x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const ND = "No data";
const TRIGGER: Record<string, string> = { scheduled: "Scheduled (Sun 18:00 IST)", catch_up: "Catch-up run", manual: "Generated on request" };
const STRAT_IDS = ["trend", "breakout", "pullback", "range"] as const;

/** Combine blocks for the active data filter. */
function combine(blocks: MetricBlock[]) {
  const trades = blocks.reduce((a, b) => a + b.trades, 0);
  const wins = blocks.reduce((a, b) => a + b.wins, 0);
  const avgR = trades ? blocks.reduce((a, b) => a + (b.avgR ?? 0) * b.trades, 0) / trades : null;
  return { trades, winRate: trades ? wins / trades : null, avgR };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j.data as T;
}

function Card({ k, v, s, title }: { k: string; v: string | null; s?: string; title?: string }) {
  return (
    <div className="ti-card" title={title}>
      <div className="k">{k}</div>
      <div className={`v${v == null ? " nd" : ""}`}>{v ?? ND}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

function Cell({ v }: { v: string | number | null | undefined }) {
  return v == null ? <span className="ti-nd">—</span> : <>{v}</>;
}

export function TradingDashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const week = params.get("week") ?? "";
  const revision = params.get("revision") ?? "";
  const [data, setData] = useState<Payload | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [view, setView] = useState<"report" | "live">("report");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [strategy, setStrategy] = useState<"all" | (typeof STRAT_IDS)[number]>("all");
  const [kind, setKind] = useState<"both" | "backtest" | "paper">("both");
  const [equityKind, setEquityKind] = useState<"paper" | "backtest">("paper");
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const q = new URLSearchParams();
      if (week) q.set("week", week);
      if (revision) q.set("revision", revision);
      setData(await api<Payload>(`/api/trading/reports?${q}`));
    } catch (e) { setErr((e as Error).message); }
  }, [week, revision]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (view !== "live" || preview) return;
    api<Preview>("/api/trading/preview").then(setPreview).catch((e) => setErr((e as Error).message));
  }, [view, preview]);

  const go = (w: string, rev?: number) => {
    const q = new URLSearchParams();
    if (w) q.set("week", w);
    if (rev) q.set("revision", String(rev));
    setView("report");
    router.replace(`/dashboard/trading${q.size ? `?${q}` : ""}`);
  };

  const generate = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api<{ report: Report }>("/api/trading/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(week ? { week } : {}) });
      if (r.report.status === "unavailable") setErr(r.report.error);
      else if (r.report.status === "failed") setErr(`The review couldn't be made: ${r.report.error}`);
      else setMsg(`Weekly analysis ready — ${r.report.label}, revision ${r.report.revision}.`);
      go(r.report.weekStart);
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const upload = async (f: File) => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ counts: Record<string, number> }>("/api/trading/backup", { method: "POST", body: await f.text() });
      setMsg(`Backup loaded: ${Object.entries(r.counts).map(([c, n]) => `${n} ${c}`).join(", ")}.`);
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const saveSettings = async (patch: Partial<Payload["settings"]>) => {
    try {
      const r = await api<{ settings: Payload["settings"] }>("/api/trading/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      setData((d) => (d ? { ...d, settings: r.settings } : d));
    } catch (e) { setErr((e as Error).message); }
  };

  const report = data?.report ?? null;
  const m: (WeekMetrics & { history?: WeekRow[] }) | null = view === "live" ? preview?.metrics ?? null : report?.status === "ready" || report?.viewingOld ? report.metrics : null;
  const n = view === "live" ? null : report?.narrative ?? null;

  const sel = useMemo(() => {
    if (!m) return null;
    const s = strategy === "all" ? null : m.strategies.find((x) => x.id === strategy)!;
    const bt = s ? s.backtest : m.backtests.all;
    const pp = s ? s.paper : m.paper.all;
    const blocks = kind === "backtest" ? [bt] : kind === "paper" ? [pp] : [bt, pp];
    return { s, bt, pp, ...combine(blocks) };
  }, [m, strategy, kind]);

  const sourceChip = !data ? null : data.source.configured
    ? <span className="ti-chip good">● Playbook: Supabase {data.source.url ? `(${data.source.url})` : ""}</span>
    : data.source.backupAt ? <span className="ti-chip warn">● Playbook: backup from {data.source.backupAt.slice(0, 10)}</span>
    : <span className="ti-chip bad">● Playbook not connected</span>;

  return (
    <div className="ti">
      <style dangerouslySetInnerHTML={{ __html: TI_CSS }} />
      <div className="ti-head">
        <div>
          <h1>Trading Intelligence</h1>
          <div className="ti-sub">
            MIKE&apos;s weekly review of your trading playbook ·{" "}
            {view === "live" ? <>This week so far{preview ? ` — ${preview.label}` : ""} (live, not a report)</> : report ? <>{report.label} · <b>{report.status === "ready" ? "Ready" : report.status}</b>{report.revision ? ` · revision ${report.revision}` : ""}{report.viewingOld ? " (older revision)" : ""}</> : "No report yet"}
          </div>
        </div>
        <div className="ti-row">
          {sourceChip}
          <select aria-label="Report week" value={view === "live" ? "live" : report?.weekStart ?? ""} onChange={(e) => (e.target.value === "live" ? setView("live") : go(e.target.value))}>
            <option value="live">This week so far (live)</option>
            {data?.reports.map((r) => <option key={r.id} value={r.weekStart}>{r.label}{r.status !== "ready" ? ` — ${r.status}` : ""}</option>)}
            {!data?.reports.length && <option value="">No reports yet</option>}
          </select>
          {report && report.revisions.length > 1 && view === "report" && (
            <select aria-label="Revision" value={report.revision} onChange={(e) => go(report.weekStart, Number(e.target.value))}>
              {report.revisions.map((v) => <option key={v.revision} value={v.revision}>Revision {v.revision} · {new Date(v.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</option>)}
            </select>
          )}
          <button className="ti-btn primary" onClick={generate} disabled={busy}>{busy ? <span className="ti-spin" /> : "⟳"} Generate Weekly Analysis</button>
          {report?.status === "ready" && view === "report" && (
            <>
              <a className="ti-btn" href={`/api/trading/export?week=${report.weekStart}&revision=${report.revision}&format=csv`}>CSV</a>
              <a className="ti-btn" href={`/api/trading/export?week=${report.weekStart}&revision=${report.revision}&format=pdf`}>PDF</a>
            </>
          )}
        </div>
      </div>

      {err && <div className="ti-banner bad" role="alert">{err}</div>}
      {msg && <div className="ti-banner info" role="status">{msg}</div>}

      {data && !data.source.configured && (
        <details className="ti-glass" style={{ marginBottom: 12 }} open={!data.source.backupAt}>
          <summary style={{ cursor: "pointer" }}><h2 style={{ display: "inline" }}>{data.source.backupAt ? "Playbook source: uploaded backup — update or connect Supabase" : "Connect your trading playbook"}</h2></summary>
          <p className="ti-prose" style={{ fontSize: 13 }}>
            MIKE reads your playbook&apos;s own records — it never copies them by hand or writes to them. If your playbook syncs to Supabase, add to JARVIS&apos;s environment:{" "}
            <code>PLAYBOOK_SUPABASE_URL</code>, <code>PLAYBOOK_SUPABASE_ANON_KEY</code>, <code>PLAYBOOK_EMAIL</code>, <code>PLAYBOOK_PASSWORD</code> (or <code>PLAYBOOK_SUPABASE_SERVICE_KEY</code> + <code>PLAYBOOK_USER_ID</code>), then restart.
            If it runs in LOCAL MODE (records only in your browser), export a backup there (Settings → Export) and load it here.
          </p>
          <div className="ti-row">
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            <button className="ti-btn" onClick={() => fileRef.current?.click()} disabled={busy}>Load playbook backup (.json)</button>
            {data.source.backupAt && <span className="ti-sub">Current backup: {new Date(data.source.backupAt).toLocaleString("en-IN")}</span>}
          </div>
        </details>
      )}

      {view === "report" && report && report.status !== "ready" && !report.viewingOld && (
        <div className={`ti-banner ${report.status === "failed" ? "bad" : ""}`}>
          {report.status === "generating" ? "This week's review is being written…" : report.status === "unavailable" ? `No review for ${report.label}: ${report.error}` : `The review for ${report.label} failed: ${report.error}`}
        </div>
      )}
      {view === "report" && !report && data && <div className="ti-banner info">No weekly review yet. The first one is made on Sunday at 18:00 IST, or press Generate Weekly Analysis.</div>}

      {m && sel && (
        <>
          <div className="ti-banner">{m.labels.backtest}<br />{m.labels.paper}</div>
          {m.instruments.nonIndian.length > 0 && <div className="ti-banner bad">Outside the playbook&apos;s scope (Indian-listed ETFs): {m.instruments.nonIndian.join(", ")} — counted, but review them separately.</div>}

          <div className="ti-row" role="group" aria-label="Filters" style={{ marginTop: 4 }}>
            <span className="ti-sub" style={{ marginTop: 0 }}>Strategy</span>
            {(["all", ...STRAT_IDS] as const).map((id) => {
              const s = m.strategies.find((x) => x.id === id);
              return <span key={id} className={`ti-chip${strategy === id ? " on" : ""}`}><button onClick={() => setStrategy(id)}>{s ? `${s.letter} · ${s.name}` : "All"}</button></span>;
            })}
            <span className="ti-sub" style={{ marginTop: 0, marginLeft: 8 }}>Data</span>
            {(["both", "backtest", "paper"] as const).map((k) => <span key={k} className={`ti-chip${kind === k ? " on" : ""}`}><button onClick={() => setKind(k)}>{k === "both" ? "Backtest + paper" : k === "backtest" ? "Backtests" : "Paper"}</button></span>)}
          </div>

          <div className="ti-cards">
            <Card k="Backtests" v={m.backtests.runs ? String(m.backtests.runs) : null} s={m.backtests.runs ? `${sel.bt.trades} simulated trades${sel.s ? ` (${sel.s.letter})` : ""}` : "No runs saved this week"} />
            <Card k="Paper trades" v={sel.pp.trades ? String(sel.pp.trades) : null} s={m.paper.sessions ? `${m.paper.sessions} session${m.paper.sessions === 1 ? "" : "s"} (historical replay)` : "No sessions this week"} />
            <Card k="Rule adherence" v={pct(m.discipline.ruleAdherence)} s={m.discipline.checksAnswered ? `${m.discipline.checksPassed}/${m.discipline.checksAnswered} journal checks passed` : "No journal checks this week"} />
            <Card k="Win rate" v={pct(sel.winRate)} s={sel.trades ? `${sel.trades} trades · ${sel.trades < 30 ? "insufficient data" : "after costs"}` : undefined} title="Share of simulated trades with a net result above zero, after costs and slippage." />
            <Card k="Average R" v={sel.avgR == null ? null : `${sel.avgR >= 0 ? "+" : ""}${sel.avgR.toFixed(2)}R`} s={sel.trades ? `${sel.trades} trades` : undefined} />
            <Card k="Max drawdown" v={kind === "paper" ? inr(sel.pp.maxDrawdown) : inr(sel.bt.maxDrawdown)} s={kind === "both" ? `Paper ${inr(sel.pp.maxDrawdown) ?? ND}` : kind === "paper" ? `${r2(sel.pp.maxDrawdownPct) ?? "—"}% of virtual capital` : `${r2(sel.bt.maxDrawdownPct) ?? "—"}% of virtual capital`} />
            <Card k="Learning progress" v={`${m.learning.lessonsTotal}/84`} s={m.learning.expectedDay != null ? `${m.learning.lessonsThisWeek.length} this week · calendar day ${m.learning.expectedDay}${m.learning.behind ? ` · ${m.learning.behind} behind` : ""}` : "Plan not started"} />
            <Card k="Discipline score" v={m.discipline.score == null ? null : String(m.discipline.score)} s={m.discipline.score == null ? "Nothing recorded to measure" : "out of 100"} title={m.discipline.definition} />
          </div>

          <div className="ti-grid2">
            <div className="ti-glass">
              <h2>Activity by day</h2>
              <StackedBars
                days={m.activity.map((a) => ({ label: new Date(`${a.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" }), values: [a.backtestRuns, a.paperSessions, a.journalEntries, a.lessons] }))}
                series={[{ label: "Backtest runs", color: SERIES.backtest }, { label: "Paper sessions", color: SERIES.paper }, { label: "Journal entries", color: SERIES.journal }, { label: "Lessons", color: SERIES.lessons }]}
              />
            </div>
            <div className="ti-glass">
              <div className="ti-row" style={{ justifyContent: "space-between" }}>
                <h2>Simulated equity &amp; drawdown</h2>
                <div className="ti-row">
                  {(["paper", "backtest"] as const).map((k) => <span key={k} className={`ti-chip${equityKind === k ? " on" : ""}`}><button onClick={() => setEquityKind(k)}>{k === "paper" ? "Paper" : "Backtests"}</button></span>)}
                </div>
              </div>
              <div className="ti-label">{equityKind === "paper" ? "HISTORICAL PAPER TRADING · virtual money" : "HISTORICAL SIMULATION · after costs"}</div>
              <EquityChart points={(m.equity.find((e) => e.kind === equityKind)?.points ?? [])} color={equityKind === "paper" ? SERIES.paper : SERIES.backtest} label={equityKind === "paper" ? "Paper" : "Backtest"} />
            </div>
          </div>

          {m.history && m.history.length > 1 && (
            <div className="ti-glass" style={{ marginTop: 12 }}>
              <h2>Compared with previous weeks</h2>
              <div className="ti-grid4">
                <WeekLine title="Simulated trades" weeks={m.history.map((h) => h.week.start)} values={m.history.map((h) => (h.backtestTrades + h.paperTrades) || null)} color={SERIES.backtest} format={(v) => String(v)} />
                <WeekLine title="Win rate" weeks={m.history.map((h) => h.week.start)} values={m.history.map((h) => h.winRate)} color={SERIES.backtest} format={(v) => `${Math.round(v * 100)}%`} />
                <WeekLine title="Discipline score" weeks={m.history.map((h) => h.week.start)} values={m.history.map((h) => h.discipline)} color={SERIES.journal} format={(v) => String(v)} />
                <WeekLine title="Lessons completed" weeks={m.history.map((h) => h.week.start)} values={m.history.map((h) => h.lessons)} color={SERIES.lessons} format={(v) => String(v)} />
              </div>
              <details style={{ marginTop: 10 }}>
                <summary className="ti-sub" style={{ cursor: "pointer" }}>Table view</summary>
                <div className="ti-scroll">
                  <table className="ti-table">
                    <thead><tr><th>Week</th><th>Backtest trades</th><th>Paper trades</th><th>Journal</th><th>Lessons</th><th>Win rate</th><th>Avg R</th><th>Discipline</th><th>Risk issues</th></tr></thead>
                    <tbody>{m.history.map((h) => <tr key={h.week.start}><td>{h.week.start}</td><td>{h.backtestTrades}</td><td>{h.paperTrades}</td><td>{h.journalEntries}</td><td>{h.lessons}</td><td><Cell v={pct(h.winRate)} /></td><td><Cell v={r2(h.avgR)} /></td><td><Cell v={h.discipline} /></td><td>{h.riskFindings}</td></tr>)}</tbody>
                  </table>
                </div>
              </details>
              {n?.comparison && <p className="ti-prose" style={{ marginTop: 8 }}>{n.comparison}</p>}
            </div>
          )}

          <div className="ti-glass" style={{ marginTop: 12 }}>
            <h2>Strategy intelligence</h2>
            <div className="ti-grid4">
              {m.strategies.filter((s) => strategy === "all" || s.id === strategy).map((s) => (
                <div key={s.id} className="ti-strat ti-glass" style={{ padding: 12 }}>
                  <div className="ti-row" style={{ justifyContent: "space-between" }}>
                    <div><div className="tag">STRATEGY {s.letter}</div><h3>{s.name}</h3></div>
                    <span className={`ti-chip ${s.status === "ok" ? "good" : s.status === "insufficient" ? "warn" : ""}`}>{s.status === "ok" ? "Enough data" : s.status === "insufficient" ? "Insufficient data" : "No data"}</span>
                  </div>
                  <div className="ti-kv">
                    <span className="h" /> <span className="h">Backtest</span><span className="h">Paper</span>
                    <span className="l">Trades</span><span>{s.backtest.trades}</span><span>{s.paper.trades}</span>
                    <span className="l">Win rate</span><span><Cell v={pct(s.backtest.winRate)} /></span><span><Cell v={pct(s.paper.winRate)} /></span>
                    <span className="l">Avg R</span><span><Cell v={r2(s.backtest.avgR)} /></span><span><Cell v={r2(s.paper.avgR)} /></span>
                    <span className="l">Net (after costs)</span><span><Cell v={inr(s.backtest.net)} /></span><span><Cell v={inr(s.paper.net)} /></span>
                    <span className="l">Costs</span><span><Cell v={inr(s.backtest.costs)} /></span><span><Cell v={inr(s.paper.costs)} /></span>
                    <span className="l">Max drawdown</span><span><Cell v={inr(s.backtest.maxDrawdown)} /></span><span><Cell v={inr(s.paper.maxDrawdown)} /></span>
                    <span className="l">Out-of-sample</span><span>{s.outOfSample ? `${s.outOfSample.trades} · ${pct(s.outOfSample.winRate)}` : <span className="ti-nd">—</span>}</span><span />
                  </div>
                  <p className="ti-sub">{n?.strategies.find((x) => x.id === s.id)?.note ?? s.verdict}</p>
                  {s.symbols.length > 0 && <div className="ti-sub">ETFs: {s.symbols.join(", ")}</div>}
                  {s.warnings.length > 0 && <ul className="ti-list">{s.warnings.slice(0, 3).map((w) => <li key={w}>{w}</li>)}</ul>}
                </div>
              ))}
            </div>
          </div>

          <div className="ti-grid2">
            <div className="ti-glass">
              <h2>Risk &amp; discipline audit</h2>
              <div className="ti-sub" style={{ marginTop: 0 }}>
                Rules ({m.risk.rulesSource}): {m.risk.rules.riskPct}% risk per trade · {m.risk.rules.dailyLossPct}% daily loss · max {m.risk.rules.maxTrades} trades/day · min R:R {m.risk.rules.minRR} · shorts {m.risk.rules.allowShort ? "on" : "off"} · virtual capital ₹{m.risk.rules.capital.toLocaleString("en-IN")}
              </div>
              {m.risk.clean === null ? <div className="ti-empty">Nothing to audit this week.</div>
                : !m.risk.findings.length ? <div className="ti-empty">No rule breaks found in {m.risk.checked.length} checks.</div>
                : m.risk.findings.map((f) => (
                  <details key={f.rule} className="ti-find">
                    <summary><span className={`ti-sev ${f.severity}`}>{f.severity}</span><span>{f.rule}</span><span className="ti-sub" style={{ margin: "0 0 0 auto" }}>×{f.count}</span></summary>
                    <ul>{f.evidence.map((e, i) => <li key={i}>{e.date} · {e.source} · {e.ref}: {e.detail}</li>)}</ul>
                  </details>
                ))}
              <h2 style={{ marginTop: 14 }}>Execution checks (journal)</h2>
              {m.discipline.checksAnswered === 0 ? <div className="ti-sub">No journal self-checks this week.</div> : m.discipline.byCheck.filter((c) => c.answered).map((c) => (
                <div key={c.key}>
                  <div className="ti-row" style={{ justifyContent: "space-between", fontSize: 12.5 }}><span className="ti-sub" style={{ margin: 0 }}>{c.label}</span><span>{c.passed}/{c.answered}</span></div>
                  <Meter value={c.passed} max={c.answered} color={SERIES.journal} />
                </div>
              ))}
              <div className="ti-sub">{m.discipline.definition}</div>
            </div>

            <div className="ti-glass">
              <h2>Learning journey</h2>
              <div className="ti-sub" style={{ marginTop: 0 }}>
                84-day ETF plan · {m.learning.startDate ? `started ${m.learning.startDate}` : "no start date"} {m.learning.phase ? `· phase ${m.learning.phase.num}: ${m.learning.phase.name}` : ""}
              </div>
              <Meter value={m.learning.lessonsTotal} max={84} color={SERIES.lessons} marks={m.learning.expectedDay ? [{ at: m.learning.expectedDay, label: `Calendar day ${m.learning.expectedDay}` }] : []} />
              <div className="ti-sub">{m.learning.lessonsTotal} lessons done ({m.learning.progressPct}%){m.learning.behind != null ? ` · ${m.learning.behind ? `${m.learning.behind} behind the calendar` : "on pace"}` : ""}{m.learning.lessonsThisWeek.length ? ` · this week: day ${m.learning.lessonsThisWeek.join(", ")}` : " · none this week"}</div>
              <div className="ti-phases" aria-label="Phases">
                {PHASES.map((p) => {
                  const done = m.learning.lessonsTotal >= p.days[1];
                  const now = m.learning.phase?.num === p.num;
                  return <div key={p.num} className={`ti-phase${done ? " done" : ""}${now ? " now" : ""}`} title={`${p.num}. ${p.name} (days ${p.days[0]}–${p.days[1]})`}>{p.num}</div>;
                })}
              </div>
              <h2 style={{ marginTop: 14 }}>Backtesting goal</h2>
              <Meter value={m.learning.backtestTradesTotal} max={m.learning.backtestTarget.max} color={SERIES.backtest} marks={[{ at: m.learning.backtestTarget.min, label: `${m.learning.backtestTarget.min} trades` }]} />
              <div className="ti-sub">{m.learning.backtestTradesTotal} backtested trades to date · goal {m.learning.backtestTarget.min}–{m.learning.backtestTarget.max}</div>
              <div className="ti-sub">Paper trading to date: {m.learning.paperSessionsTotal} sessions, {m.learning.paperTradesTotal} trades · ETF workflow: {m.learning.workflowDays} day{m.learning.workflowDays === 1 ? "" : "s"}, {m.learning.workflowSteps} steps this week</div>
              {n?.learning && <p className="ti-prose" style={{ marginTop: 8 }}>{n.learning}</p>}
            </div>
          </div>

          <div className="ti-grid2">
            <div className="ti-glass">
              <h2>Journal insights</h2>
              {m.journal.entries === 0 ? <div className="ti-empty">No trading-journal entries this week.</div> : (
                <>
                  <div className="ti-kv" style={{ gridTemplateColumns: "1fr auto" }}>
                    <span className="l">Entries</span><span>{m.journal.entries}</span>
                    <span className="l">Results</span><span>{Object.entries(m.journal.results).map(([k, v]) => `${v} ${k === "success" ? "successful" : k === "fail" ? "unsuccessful" : k === "notrade" ? "no trade" : k}`).join(" · ") || "—"}</span>
                    <span className="l">Avg discipline / confidence / focus</span><span><Cell v={r2(m.journal.avgDiscipline)} /> / <Cell v={r2(m.journal.avgConfidence)} /> / <Cell v={r2(m.journal.avgFocus)} /></span>
                    <span className="l">Mindsets</span><span>{Object.entries(m.journal.mindsets).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</span>
                  </div>
                  {m.journal.mistakes.length > 0 && <><h2 style={{ marginTop: 12 }}>Most frequent mistakes</h2><ul className="ti-list">{m.journal.mistakes.slice(0, 5).map((x) => <li key={x.key}>{x.label} — {x.count}</li>)}</ul></>}
                  {m.journal.lessons.length > 0 && <><h2 style={{ marginTop: 12 }}>What you learned</h2><ul className="ti-list">{m.journal.lessons.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
                </>
              )}
              <div className="ti-sub">Daily journal: {m.journal.dailyJournals} · psychology entries: {m.journal.psychEntries}{m.journal.avgEmotionalRating != null ? ` (avg ${m.journal.avgEmotionalRating}/10)` : ""} · Mistake Lab: {m.journal.mistakeLab}</div>
            </div>

            <div className="ti-glass">
              <h2>Weekly review</h2>
              {view === "live" ? <div className="ti-sub">This is the week in progress. The written review is made on Sunday at 18:00 IST, or when you press Generate Weekly Analysis.</div>
                : n ? (
                  <>
                    <p className="ti-prose">{n.executiveSummary}</p>
                    {n.risk && <p className="ti-prose"><b>Risk:</b> {n.risk}</p>}
                    {n.discipline && <p className="ti-prose"><b>Discipline:</b> {n.discipline}</p>}
                    <h2 style={{ marginTop: 12 }}>Next week</h2>
                    <ol className="ti-list">{n.nextWeek.map((x, i) => <li key={i}><b>{x.action}</b> — {x.why}</li>)}</ol>
                  </>
                ) : <div className="ti-empty">No written review.</div>}
            </div>
          </div>

          <div className="ti-glass" style={{ marginTop: 12 }}>
            <h2>AI analysis</h2>
            {view === "live" ? <div className="ti-sub">Live figures only — no AI text for an unfinished week.</div> : n ? (
              <div className="ti-sub" style={{ marginTop: 0 }}>
                {n.by === "ai" ? <>Written by MIKE ({n.provider}) from the figures above. Every number in it was checked against your records before it was kept.</> : <>Written by rules straight from the figures above.{n.rejected ? ` ${n.rejected}` : ""}</>}
                {report && <> · {TRIGGER[report.trigger] ?? report.trigger} · {report.generatedAt ? new Date(report.generatedAt).toLocaleString("en-IN") : ""} · source: {report.source?.kind}{report.source?.note ? ` — ${report.source.note}` : ""}</>}
              </div>
            ) : null}
            <div className="ti-row" style={{ marginTop: 10 }}>
              <Link className="ti-btn" href="/dashboard/chat/mike">Ask MIKE about this week</Link>
              {m.missing.length > 0 && <span className="ti-sub" style={{ margin: 0 }}>Missing: {m.missing.join(" ")}</span>}
            </div>
          </div>
        </>
      )}

      {data && (
        <div className="ti-glass" style={{ marginTop: 12 }}>
          <h2>Schedule &amp; notifications</h2>
          <div className="ti-row">
            {([["weeklyEnabled", "Weekly review every Sunday 18:00 IST"], ["notifyWhatsapp", "WhatsApp me when it's ready"], ["notifyEmail", "Email me when it's ready"]] as const).map(([k, label]) => (
              <label key={k} className="ti-chip" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={data.settings[k]} onChange={(e) => void saveSettings({ [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </div>
          {report?.notifyLog?.length ? <div className="ti-sub">Last notice: {report.notifyLog.map((l) => `${l.channel} ${l.status}`).join(" · ")}</div> : null}
          <div className="ti-sub">Educational review of simulated practice on Indian-listed ETFs. MIKE never places, changes or cancels real orders and never asks for brokerage credentials.</div>
        </div>
      )}
    </div>
  );
}
