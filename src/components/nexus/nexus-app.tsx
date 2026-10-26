"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAgent } from "@/hooks/useAgent";
import { useJobs } from "@/components/jobs/use-jobs";
import { OMEGA_CSS, STATE_COLOR } from "@/components/omega/tokens";
import { AgentGlyph } from "@/components/omega/glyphs";
import { STATE_LABEL } from "@/lib/nexus/agents";
import type { AgentStatus } from "@/lib/nexus/status";
import type { Signal } from "@/lib/nexus/events";
import type { JobView } from "@/lib/jobs/engine";
import { NeuralCore } from "./neural-core";
import { Network, type Pulse } from "./network";
import { AgentPanel } from "./agent-panel";
import { Timeline } from "./timeline";
import { NX_CSS } from "./styles";

/**
 * AGENT COMMAND NEXUS — JARVIS at the core, the agent team around it. Every
 * state, pathway and timeline bar is a real task record or a real health
 * check; the command bar talks to the real JARVIS, which delegates through
 * the same task engine as everywhere else.
 */

type Snapshot = { at: string; jarvis: { brain: string[]; offline: boolean; reason: string | null; pcBrain: boolean; claudeBridge: boolean; voice: boolean }; agents: AgentStatus[] };
const SIGNAL_COLOR: Record<string, string> = { dispatch: "#5fe1ff", planned: "#9b7bff", queued: "#7fa6c9", step: "#a9d8ff", approval: "#f4c35a", return: "#4ce0a6", fail: "#ff6b7a", cancel: "#7f8ea3" };
const PHASES = ["IDLE", "LISTENING", "THINKING", "ROUTING", "EXECUTING", "RESPONDING"] as const;

export function NexusApp() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [flashes, setFlashes] = useState<Record<string, { kind: "fail" | "return" | "dispatch"; at: number }>>({});
  const [events, setEvents] = useState<Signal[]>([]);
  const [live, setLive] = useState<"connecting" | "live" | "lost">("connecting");
  const [pulseKey, setPulseKey] = useState(0);
  const [timeline, setTimeline] = useState<JobView[]>([]);
  const [tlFilter, setTlFilter] = useState({ agent: "", status: "", days: 3, q: "" });
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [overlay, setOverlay] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const jobs = useJobs({ status: "active" }); // starts tasks that are ready, like the home console
  const agent = useAgent({});
  const jobAgents = useRef(new Map<string, string>());

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)"); setReduced(m.matches);
    const n = window.matchMedia("(max-width: 900px)"); setNarrow(n.matches);
    const a = () => setReduced(m.matches), b = () => setNarrow(n.matches);
    m.addEventListener("change", a); n.addEventListener("change", b);
    return () => { m.removeEventListener("change", a); n.removeEventListener("change", b); };
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/nexus", { cache: "no-store" }); const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSnap(j.data); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  const loadTimeline = useCallback(async () => {
    const q = new URLSearchParams({ days: String(tlFilter.days) });
    if (tlFilter.agent) q.set("agent", tlFilter.agent);
    if (tlFilter.status) q.set("status", tlFilter.status);
    if (tlFilter.q) q.set("q", tlFilter.q);
    try { const r = await fetch(`/api/nexus/timeline?${q}`, { cache: "no-store" }); const j = await r.json(); if (j.ok) { setTimeline(j.data.jobs); for (const x of j.data.jobs as JobView[]) jobAgents.current.set(x.id, x.agent); } } catch { /* keep the last one */ }
  }, [tlFilter]);
  useEffect(() => { void load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { void loadTimeline(); }, [loadTimeline]);

  // real task signals → pathways
  useEffect(() => {
    let es: EventSource | null = null, retry: ReturnType<typeof setTimeout> | null = null, refresh: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      es = new EventSource("/api/nexus/stream");
      es.addEventListener("ready", () => setLive("live"));
      es.addEventListener("signal", (ev) => {
        const s = JSON.parse((ev as MessageEvent).data) as Signal;
        jobAgents.current.set(s.jobId, s.agent);
        setEvents((e) => [s, ...e].slice(0, 40));
        const id = `${s.jobId}-${s.kind}-${Date.now()}`;
        const add: Pulse[] = [];
        if (s.kind === "dispatch" || s.kind === "planned" || s.kind === "queued") add.push({ id, from: "jarvis", to: s.agent, color: SIGNAL_COLOR[s.kind] });
        if (s.kind === "return" || s.kind === "approval" || s.kind === "fail") add.push({ id, from: "jarvis", to: s.agent, color: SIGNAL_COLOR[s.kind], reverse: true });
        if (s.kind === "dispatch") for (const d of s.dependsOn) { const from = jobAgents.current.get(d); if (from && from !== s.agent) add.push({ id: `${id}-${d}`, from, to: s.agent, color: "#9b7bff" }); }
        if (add.length) { setPulses((p) => [...p, ...add]); setTimeout(() => setPulses((p) => p.filter((x) => !add.some((a) => a.id === x.id))), 1800); }
        if (s.kind === "fail" || s.kind === "return" || s.kind === "dispatch") setFlashes((f) => ({ ...f, [s.agent]: { kind: s.kind as "fail" | "return" | "dispatch", at: Date.now() } }));
        setPulseKey((k) => k + 1);
        if (refresh) clearTimeout(refresh);
        refresh = setTimeout(() => { void load(); void loadTimeline(); }, 400);
      });
      es.onerror = () => { setLive("lost"); es?.close(); retry = setTimeout(connect, 5000); };
    };
    connect();
    return () => { es?.close(); if (retry) clearTimeout(retry); if (refresh) clearTimeout(refresh); };
  }, [load, loadTimeline]);

  const act = async (id: string, action: "cancel" | "retry" | "approve") => {
    setBusy(id);
    const r = await jobs.act(id, action);
    if (!r.ok) setErr(r.error);
    setBusy(null); void load(); void loadTimeline();
  };

  const send = (text: string) => {
    const t = text.trim(); if (!t || agent.streaming) return;
    setOverlay(true); setCmd("");
    void agent.send(t);
  };

  const latest = agent.activity[0];
  const phase: (typeof PHASES)[number] = agent.streaming
    ? /assigning the task|starting the build|working with friday|delegat|^assigned to|handing/i.test(latest?.label ?? "") ? "ROUTING"
      : latest?.kind === "tool" || (latest?.kind === "activity" && !/understanding request/i.test(latest.label)) ? "EXECUTING"
      : agent.messages[agent.messages.length - 1]?.role === "assistant" && agent.messages[agent.messages.length - 1]?.content ? "RESPONDING" : "THINKING"
    : "IDLE";
  const lastReply = [...agent.messages].reverse().find((m) => m.role === "assistant");
  const working = snap?.agents.filter((a) => a.state === "working").length ?? 0;
  const energy = Math.min(1, working * 0.3 + (agent.streaming ? 0.35 : 0));
  const selected = snap?.agents.find((a) => a.id === sel) ?? null;
  const nodes = useMemo(() => (snap?.agents ?? []).map((a) => ({ id: a.id, name: a.name, title: a.title, color: a.color, motif: a.motif, state: a.state, reason: a.reason, updatedAt: a.updatedAt, counts: a.counts })), [snap]);
  const pickedJob = timeline.find((j) => j.id === picked) ?? null;

  return (
    <div className="om nx">
      <style dangerouslySetInnerHTML={{ __html: OMEGA_CSS + NX_CSS }} />
      <header className="nx-head">
        <div>
          <div className="om-title">Dashboard B</div>
          <h1 className="om-h1">Agent Command Nexus</h1>
        </div>
        <div className="nx-status">
          <span className={`om-chip${live === "live" ? " on" : ""}`}><span className="om-dot" style={{ ["--c" as string]: live === "live" ? "#4ce0a6" : live === "lost" ? "#ff6b7a" : "#f4c35a" }} />{live === "live" ? "Live task stream" : live === "lost" ? "Stream lost — reconnecting" : "Connecting…"}</span>
          {snap && <span className="om-chip"><span className="om-dot" style={{ ["--c" as string]: snap.jarvis.offline ? "#ff6b7a" : "#5fe1ff" }} />JARVIS brain: {snap.jarvis.offline ? "not configured" : snap.jarvis.brain.join(" → ")}</span>}
          {snap && <span className="om-chip">Checked {new Date(snap.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>}
        </div>
      </header>
      {err && <div className="nx-err" role="alert">{err}</div>}

      <div className="nx-top-grid">
        <section className="om-glass nx-core-panel">
          <div className="om-title">Central AI neural core</div>
          <div className="nx-core-body">
            <div className="nx-core-text">
              <p className="om-sub">JARVIS interprets each request, picks the agents, plans the dependencies, stops for your approval before anything external, and collects the results.</p>
              <ul className="nx-core-stats">
                <li><b>{snap?.agents.filter((a) => a.state === "working").length ?? "—"}</b><span>working now</span></li>
                <li><b>{snap?.agents.reduce((n, a) => n + a.counts.queued, 0) ?? "—"}</b><span>queued</span></li>
                <li><b>{snap?.agents.reduce((n, a) => n + a.counts.approval, 0) ?? "—"}</b><span>awaiting approval</span></li>
                <li><b>{snap?.agents.reduce((n, a) => n + a.counts.completed24h, 0) ?? "—"}</b><span>done in 24 h</span></li>
              </ul>
              <div className="nx-phases" aria-label="JARVIS state">{PHASES.map((p) => <span key={p} className={p === phase ? "on" : ""}>{p}</span>)}</div>
            </div>
            <div className="nx-core-visual">
              <NeuralCore energy={energy} pulseKey={pulseKey} className="nx-core-big" />
              <span className="nx-core-name">JARVIS</span>
            </div>
          </div>
        </section>

        <section className="om-glass nx-entities">
          <div className="om-title">Agent entities</div>
          <div className="nx-cards">
            {(snap?.agents ?? []).map((a) => (
              <button key={a.id} className={`nx-card${sel === a.id ? " on" : ""}`} style={{ ["--ac" as string]: a.color }} onClick={() => setSel(sel === a.id ? null : a.id)} aria-pressed={sel === a.id}>
                <span className="nx-card-hex"><svg viewBox="-36 -36 72 72" aria-hidden><polygon points="0,-30 26,-15 26,15 0,30 -26,15 -26,-15" /></svg><span><AgentGlyph motif={a.motif} size={22} color={a.color} /></span></span>
                <span className="nx-card-txt">
                  <span className="nx-card-n">{a.name}</span>
                  <span className="nx-card-r">{a.title}</span>
                  <span className="nx-card-s"><span className="om-dot" style={{ ["--c" as string]: STATE_COLOR[a.state] }} />{STATE_LABEL[a.state]}{a.counts.queued ? ` · ${a.counts.queued} queued` : ""}</span>
                </span>
              </button>
            ))}
            {!snap && <div className="om-dim">Reading the agents…</div>}
          </div>
        </section>
      </div>

      <section className="om-glass nx-conn">
        <div className="nx-row between"><span className="om-title">Live neural connections</span><span className="om-dim">Pathways light only when a real task is dispatched, returns, fails or waits for approval.</span></div>
        <div className="nx-conn-body">
          <div className="nx-map">
            <NeuralCore energy={energy} pulseKey={pulseKey} className="nx-core" />
            {snap ? <Network agents={nodes} selected={sel} onSelect={setSel} pulses={pulses} reduced={reduced} narrow={narrow} flashes={flashes} /> : <div className="nx-loading">Reading the agents…</div>}
          </div>
          <div className="nx-feed">
            <span className="om-title">Signals</span>
            {events.length === 0 ? <div className="om-dim" style={{ marginTop: 8 }}>No task has changed since you opened the Nexus. Signals appear the moment a task is planned, dispatched, needs approval, returns or fails.</div>
              : <ul>{events.map((e, i) => <li key={i}><span className="om-dot" style={{ ["--c" as string]: SIGNAL_COLOR[e.kind] }} /><b>{e.kind}</b> · {snap?.agents.find((a) => a.id === e.agent)?.name ?? e.agent} · {e.title}{e.text ? <span className="om-dim"> — {e.text}</span> : null}<span className="om-dim"> · {new Date(e.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span></li>)}</ul>}
          </div>
        </div>
      </section>

      {selected && <div className="nx-drawer" onClick={(e) => { if (e.target === e.currentTarget) setSel(null); }}><AgentPanel a={selected} onClose={() => setSel(null)} onAct={act} busy={busy} /></div>}

      <form className="nx-cmd om-glass" onSubmit={(e) => { e.preventDefault(); send(cmd); }}>
        <span className="om-title">Command</span>
        <input className="om-input" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder={'e.g. "DARWIN, find verified clinics without websites in Indiranagar"'} aria-label="Command JARVIS" />
        <button className="om-btn primary" type="submit" disabled={agent.streaming || !cmd.trim()}>{agent.streaming ? "Working…" : "Send to JARVIS"}</button>
        {agent.messages.length > 0 && <button type="button" className="om-btn" onClick={() => setOverlay((v) => !v)}>{overlay ? "Hide" : "Show"} conversation</button>}
      </form>

      {overlay && (agent.streaming || lastReply) && (
        <div className="nx-overlay om-glass om-fade-in" aria-live="polite">
          <div className="nx-overlay-h"><span className="om-title">Execution</span><span className="nx-phase-now">{phase}</span>{agent.streaming && <button className="om-btn sm" onClick={() => agent.stop()}>Stop</button>}<button className="om-btn sm" onClick={() => setOverlay(false)} aria-label="Close">✕</button></div>
          {agent.activity.length > 0 && <ul className="nx-acts">{agent.activity.slice(0, 6).map((a) => <li key={a.id} className={a.kind}>{a.kind === "tool" ? (a.status === "error" ? "✕ " : "✓ ") : "› "}{a.label}</li>)}</ul>}
          {lastReply?.content && <div className="nx-reply">{lastReply.content}</div>}
          {(lastReply?.links ?? []).length > 0 && <div className="nx-row">{lastReply!.links!.map((l) => <a key={l.url} className="om-btn sm" href={l.url}>{l.label}</a>)}</div>}
        </div>
      )}

      <section className="nx-lower">
        <div className="om-glass nx-tl-wrap">
          <div className="nx-row between">
            <span className="om-title">Task orchestration timeline</span>
            <div className="nx-row">
              <select className="om-input sm" value={tlFilter.agent} onChange={(e) => setTlFilter({ ...tlFilter, agent: e.target.value })} aria-label="Filter by agent"><option value="">All agents</option>{snap?.agents.filter((a) => a.id !== "ruben").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <select className="om-input sm" value={tlFilter.status} onChange={(e) => setTlFilter({ ...tlFilter, status: e.target.value })} aria-label="Filter by status"><option value="">Any status</option>{["planning", "assigned", "running", "waiting_approval", "completed", "failed", "cancelled"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
              <select className="om-input sm" value={tlFilter.days} onChange={(e) => setTlFilter({ ...tlFilter, days: Number(e.target.value) })} aria-label="Period"><option value={1}>24 h</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={30}>30 days</option></select>
              <input className="om-input sm" placeholder="Search tasks" value={tlFilter.q} onChange={(e) => setTlFilter({ ...tlFilter, q: e.target.value })} aria-label="Search tasks" />
            </div>
          </div>
          <Timeline jobs={timeline} agents={snap?.agents ?? []} onPick={setPicked} picked={picked} />
          {pickedJob && (
            <div className="nx-pick om-fade-in">
              <div className="nx-row between"><b>{pickedJob.title}</b><button className="om-btn sm" onClick={() => setPicked(null)} aria-label="Close">✕</button></div>
              <div className="om-dim">{pickedJob.agentName} · {pickedJob.status.replace("_", " ")} · created {new Date(pickedJob.createdAt).toLocaleString("en-IN")}{pickedJob.dependsOn.length ? ` · depends on ${pickedJob.dependsOn.length} task(s)` : ""}</div>
              <ol className="nx-steps">{(pickedJob.progress ?? []).slice(-10).map((s, i) => <li key={i} className={`k-${s.kind ?? "info"}`}><span>{new Date(s.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span> {s.text}</li>)}</ol>
              {pickedJob.result && <div className="nx-result">{pickedJob.result.slice(0, 1200)}</div>}
              <div className="nx-row">
                {(pickedJob.resultData?.links ?? []).map((l) => <a key={l.url} className="om-btn sm" href={l.url}>{l.label}</a>)}
                {pickedJob.status === "waiting_approval" && <Link className="om-btn sm good" href="/dashboard/activity">Review approval</Link>}
                {["planning", "assigned", "running", "waiting_approval"].includes(pickedJob.status) && <button className="om-btn sm bad" disabled={busy === pickedJob.id} onClick={() => act(pickedJob.id, "cancel")}>Cancel</button>}
                {["failed", "cancelled"].includes(pickedJob.status) && <button className="om-btn sm" disabled={busy === pickedJob.id} onClick={() => act(pickedJob.id, "retry")}>Retry</button>}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
