"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, X, Square, RotateCcw, Check, Send, Maximize2, Minimize2, Users } from "lucide-react";
import type { JobView } from "@/lib/jobs/engine";
import { JOB_AGENTS, type JobAgent } from "@/lib/jobs/brief";
import { NEXUS_AGENTS } from "@/lib/nexus/agents";
import { CHAT_AGENTS } from "@/lib/agents/catalog";
import { AgentGlyph } from "@/components/omega/glyphs";
import { Markdown } from "@/components/chat/markdown";
import { StudioMini } from "./studio-mini";
import { DISPLAY_COLOR, DISPLAY_LABEL, displayState, isActive, isFinished, planGroups, planSummary } from "./state";

/**
 * JARVIS's agents as floating chat pop-ups over the console. Each agent has one
 * window holding its tasks as a conversation: what it was asked, its real
 * progress steps, what it's writing right now, and the verified result. Every
 * instruction runs as a tracked task on the server (the jobs engine), so a
 * closed window, a refresh or a restart never loses it — the window is only a
 * view. Closing hides it; Stop cancels the task.
 */

export interface DockApi {
  /** Open an agent's window; with `ask`, send it that instruction right away. */
  openAgent: (agent: JobAgent, ask?: string) => void;
  /** Show a task in its agent's window (opens the window). */
  openJob: (jobId: string, agent?: string) => void;
  /** Bring back every window that has active tasks. */
  showWorking: () => void;
}

type Thread = { jobIds: string[]; open: boolean; min: boolean; at: number };
type Store = { threads: Partial<Record<JobAgent, Thread>>; reported: string[] };
type Cap = { tool: string; label: string; description: string; needsApproval: boolean };
const KEY = "jarvis-agent-dock-v1";
/** Tool-call markup a model sometimes leaves in its answer isn't for you. */
const clean = (t: string) => t.replace(/<(?:invoke|parameter|function_calls|antml:[a-z_]+)[^>]*>[\s\S]*?<\/(?:invoke|parameter|function_calls|antml:[a-z_]+)>/g, "").replace(/<\/?(?:invoke|parameter|function_calls)[^>]*>/g, "").trim();
const meta = (a: string) => NEXUS_AGENTS.find((n) => n.id === a);
const asAgent = (a: string | undefined): JobAgent | null => ((JOB_AGENTS as readonly string[]).includes(a ?? "") ? (a as JobAgent) : null);

const loadStore = (): Store => {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (s && typeof s === "object" && s.threads) return { threads: s.threads, reported: Array.isArray(s.reported) ? s.reported.slice(-100) : [] }; } catch { /* storage blocked */ }
  return { threads: {}, reported: [] };
};

export const AgentDock = forwardRef<DockApi, { liveJobs: JobView[]; onReport: (text: string) => void; onChanged: () => void }>(function AgentDock({ liveJobs, onReport, onChanged }, ref) {
  const [store, setStore] = useState<Store>({ threads: {}, reported: [] });
  const [jobs, setJobs] = useState<Record<string, JobView>>({});
  const [caps, setCaps] = useState<Record<string, Cap[]>>({});
  const [wide, setWide] = useState<string | null>(null);
  const loaded = useRef(false);
  const mountedAt = useRef(Date.now());
  const seen = useRef(new Set<string>());
  const jobsRef = useRef(jobs); jobsRef.current = jobs;
  const liveRef = useRef(liveJobs); liveRef.current = liveJobs;

  // restore the windows (their tasks live on the server)
  useEffect(() => { setStore(loadStore()); loaded.current = true; }, []);
  useEffect(() => { if (loaded.current) try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage blocked */ } }, [store]);

  const merge = useCallback((list: JobView[]) => {
    if (!list.length) return;
    setJobs((m) => { const n = { ...m }; for (const j of list) n[j.id] = j; return n; });
  }, []);
  const fetchJob = useCallback(async (id: string) => {
    const j = await fetch(`/api/jobs/${id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (j?.ok) merge([j.data.job]);
    return j?.ok ? (j.data.job as JobView) : null;
  }, [merge]);

  const touch = useCallback((agent: JobAgent, f: (t: Thread) => Thread) => {
    setStore((s) => ({ ...s, threads: { ...s.threads, [agent]: f(s.threads[agent] ?? { jobIds: [], open: true, min: false, at: Date.now() }) } }));
  }, []);
  const addJob = useCallback((agent: JobAgent, id: string) => {
    seen.current.add(id);
    touch(agent, (t) => ({ ...t, jobIds: t.jobIds.includes(id) ? t.jobIds : [...t.jobIds, id].slice(-12), open: true, min: false, at: Date.now() }));
  }, [touch]);

  const send = useCallback(async (agent: JobAgent, text: string) => {
    touch(agent, (t) => ({ ...t, open: true, min: false, at: Date.now() }));
    const r = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent, text }) }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) return r?.error ?? "Couldn't reach JARVIS.";
    merge([r.data.job]); addJob(agent, r.data.job.id); onChanged();
    return null;
  }, [touch, merge, addJob, onChanged]);

  useImperativeHandle(ref, () => ({
    openAgent: (agent, ask) => {
      // the window also shows what that agent is already working on (or waiting for your OK on)
      const busy = liveRef.current.filter((j) => j.agent === agent && isActive(j.status)).map((j) => j.id);
      for (const id of busy) seen.current.add(id);
      touch(agent, (t) => ({ ...t, jobIds: [...t.jobIds, ...busy.filter((id) => !t.jobIds.includes(id))].slice(-12), open: true, min: false, at: Date.now() }));
      if (ask?.trim()) void send(agent, ask.trim());
    },
    openJob: (id, agent) => {
      const a = asAgent(agent) ?? asAgent(jobsRef.current[id]?.agent);
      if (a) { addJob(a, id); void fetchJob(id); return; }
      void fetchJob(id).then((j) => { const b = asAgent(j?.agent); if (b) addJob(b, id); });
    },
    showWorking: () => setStore((s) => {
      const threads = { ...s.threads };
      for (const [a, t] of Object.entries(threads) as [JobAgent, Thread][]) if (t.jobIds.some((id) => isActive(jobsRef.current[id]?.status ?? ""))) threads[a] = { ...t, open: true, min: false };
      return { ...s, threads };
    }),
  }), [touch, send, addJob, fetchJob]);

  // tasks JARVIS dispatched while you were here open their agent's window
  useEffect(() => {
    merge(liveJobs);
    for (const j of liveJobs) {
      if (seen.current.has(j.id)) continue;
      seen.current.add(j.id);
      const a = asAgent(j.agent);
      if (a && Date.parse(j.createdAt) >= mountedAt.current - 5000) addJob(a, j.id);
    }
  }, [liveJobs, merge, addJob]);

  // live: every task shown in a window that isn't finished is refreshed every few seconds
  const shownIds = Object.values(store.threads).flatMap((t) => t?.jobIds ?? []);
  const shownKey = shownIds.join(",");
  useEffect(() => {
    const ids = shownKey ? shownKey.split(",") : [];
    const tick = () => { for (const id of ids) { const j = jobsRef.current[id]; if (!j || !isFinished(j.status) || !j.result && !j.error && j.status !== "cancelled") void fetchJob(id); } };
    tick();
    const iv = setInterval(tick, 2500);
    return () => clearInterval(iv);
  }, [shownKey, fetchJob]);

  // what each agent can really do (from its registered tools)
  const openAgents = Object.entries(store.threads).filter(([, t]) => t?.open).map(([a]) => a);
  useEffect(() => {
    if (!openAgents.some((a) => !caps[a])) return;
    void fetch("/api/nexus", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j?.ok) setCaps(Object.fromEntries((j.data.agents as { id: string; capabilities: Cap[] }[]).map((a) => [a.id, a.capabilities])));
    }).catch(() => {});
  }, [openAgents.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // a multi-agent request reports once in the main chat when all of its tasks have finished
  useEffect(() => {
    const known = shownIds.map((id) => jobs[id]).filter(Boolean) as JobView[];
    for (const g of planGroups(known)) {
      const key = g.slice().sort().join("+");
      if (store.reported.includes(key)) continue;
      const list = g.map((id) => jobs[id]);
      const text = planSummary(list);
      if (!text) continue;
      setStore((s) => ({ ...s, reported: [...s.reported, key].slice(-100) }));
      onReport(text);
    }
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: string, action: "cancel" | "retry" | "approve", note?: string) => {
    await fetch(`/api/jobs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(note ? { note } : {}) }) }).catch(() => {});
    void fetchJob(id); onChanged();
  };

  const statusOf = (id: string) => jobs[id]?.status ?? liveJobs.find((j) => j.id === id)?.status;
  const windows = (Object.entries(store.threads) as [JobAgent, Thread][]).filter(([, t]) => t.open).sort((a, b) => b[1].at - a[1].at);
  const hidden = (Object.entries(store.threads) as [JobAgent, Thread][]).filter(([, t]) => !t.open && t.jobIds.length);
  const working = hidden.filter(([, t]) => t.jobIds.some((id) => isActive(jobs[id]?.status ?? "")));

  // on <body>, so no transformed or clipped ancestor in the console can hide the windows
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.body); }, []);
  if (!host) return null;
  return createPortal(
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ad-row" aria-label="Agent windows">
        {windows.map(([agent, t], i) => (
          <AgentWindow key={agent} agent={agent} thread={t} compact={i > 0} jobs={jobs} caps={caps[agent] ?? null} statusOf={statusOf} wide={wide === agent}
            onWide={() => setWide((w) => (w === agent ? null : agent))}
            onMin={() => touch(agent, (x) => ({ ...x, min: !x.min }))}
            onClose={() => touch(agent, (x) => ({ ...x, open: false }))}
            onFocus={() => touch(agent, (x) => ({ ...x, min: false, at: Date.now() }))}
            onSend={(text) => send(agent, text)} onAct={act} />
        ))}
      </div>
      {hidden.length > 0 && (
        <div className="ad-hidden" aria-label="Closed agent windows">
          <Users className="h-3.5 w-3.5" />
          {hidden.map(([agent, t]) => {
            const m = meta(agent); const on = t.jobIds.some((id) => isActive(jobs[id]?.status ?? ""));
            return <button key={agent} onClick={() => touch(agent, (x) => ({ ...x, open: true, min: false, at: Date.now() }))} style={{ ["--ac" as string]: m?.color }} title={`Reopen ${m?.name ?? agent}`}><i className={on ? "on" : ""} />{m?.name ?? agent}</button>;
          })}
          {working.length > 0 && <span className="ad-hidden-n">{working.length} working</span>}
        </div>
      )}
    </>,
    host,
  );
});

function AgentWindow({ agent, thread, compact, jobs, caps, statusOf, wide, onWide, onMin, onClose, onFocus, onSend, onAct }: {
  agent: JobAgent; thread: Thread; compact: boolean; jobs: Record<string, JobView>; caps: Cap[] | null; statusOf: (id: string) => string | undefined; wide: boolean;
  onWide: () => void; onMin: () => void; onClose: () => void; onFocus: () => void; onSend: (text: string) => Promise<string | null>; onAct: (id: string, a: "cancel" | "retry" | "approve", note?: string) => void;
}) {
  const m = meta(agent); const chat = CHAT_AGENTS[agent];
  const list = (thread.jobIds.map((id) => jobs[id]).filter(Boolean) as JobView[]).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const current = [...list].reverse().find((j) => isActive(j.status)) ?? list.at(-1) ?? null;
  const ds = current ? displayState(current, statusOf) : null;
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const shownTyped = useRef(new Set<string>());
  const studio = list.some((j) => j.payload?.mode === "studio");

  // the instruction JARVIS sent shows up in the input as it's sent (the task on the server is what runs)
  const lastId = list.at(-1)?.id;
  useEffect(() => {
    const j = lastId ? jobs[lastId] : null;
    if (!j || shownTyped.current.has(j.id)) return;
    shownTyped.current.add(j.id);
    if (Date.now() - Date.parse(j.createdAt) > 60_000) return;
    const text = j.request.replace(/\s+/g, " ").trim();
    let i = 0; const step = Math.max(2, Math.ceil(text.length / 28));
    const iv = setInterval(() => {
      i += step; setTyping(text.slice(0, i));
      if (i >= text.length) { clearInterval(iv); setTimeout(() => { setTyping(null); setSentNote(`Sent to ${m?.name ?? agent} — running on the server`); setTimeout(() => setSentNote(null), 3500); }, 350); }
    }, 30);
    return () => clearInterval(iv);
  }, [lastId, jobs[lastId ?? ""]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const el = bodyRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; });

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = input.trim(); if (t.length < 3 || busy) return;
    setBusy(true); setErr(null);
    const r = await onSend(t);
    setBusy(false);
    if (r) setErr(r); else setInput("");
  };

  return (
    <section className={`ad-win${thread.min || compact ? " min" : ""}${wide && !compact ? " wide" : ""}`} style={{ ["--ac" as string]: m?.color ?? "#5fe1ff" }} aria-label={`${m?.name ?? agent} window`}>
      <header className="ad-h" onClick={compact ? onFocus : undefined} title={compact ? `Show ${m?.name ?? agent}` : undefined} style={compact ? { cursor: "pointer" } : undefined}>
        <span className="ad-glyph"><AgentGlyph motif={m?.motif ?? ""} size={16} color={m?.color} /></span>
        <span className="ad-id"><b>{m?.name ?? agent}</b><small>{current ? current.title : chat?.role ?? m?.title}</small></span>
        {ds && <span className="ad-state" style={{ color: DISPLAY_COLOR[ds], borderColor: DISPLAY_COLOR[ds] }}><i style={{ background: DISPLAY_COLOR[ds] }} className={ds === "running" ? "pulse" : ""} />{DISPLAY_LABEL[ds]}</span>}
        {studio && !compact && <button className="ad-ic" onClick={onWide} aria-label={wide ? "Narrower" : "Wider"} title={wide ? "Narrower" : "Wider — code and preview side by side"}>{wide ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button>}
        <button className="ad-ic" onClick={(e) => { e.stopPropagation(); if (compact) onFocus(); else onMin(); }} aria-label={thread.min || compact ? "Expand" : "Minimize"} title={thread.min || compact ? "Expand" : "Minimize"}>{thread.min || compact ? <Maximize2 className="h-3 w-3" /> : <Minus className="h-3.5 w-3.5" />}</button>
        <button className="ad-ic" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Close (the task keeps running)" title="Close — the task keeps running"><X className="h-3.5 w-3.5" /></button>
      </header>
      {!thread.min && !compact && (
        <>
          <div className="ad-body" ref={bodyRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
            {!list.length && (
              <div className="ad-empty">
                <p>{chat?.role ?? m?.purpose}. Tell {m?.name} what to do, here or to JARVIS. It runs as a tracked task, and approvals are asked before anything external.</p>
                {caps && caps.length > 0 && <div className="ad-caps">{caps.slice(0, 8).map((c) => <span key={c.tool} title={c.description}>{c.label}{c.needsApproval ? " · approval" : ""}</span>)}</div>}
                {caps && caps.length === 0 && <p className="ad-dim">No tools are registered for {m?.name} right now.</p>}
                <div className="ad-sugg">{(chat?.suggestions ?? []).slice(0, 3).map((s) => <button key={s} onClick={() => setInput(s)}>{s}</button>)}</div>
              </div>
            )}
            {list.map((j) => <TaskBlock key={j.id} j={j} agentName={m?.name ?? agent} statusOf={statusOf} wide={wide} onAct={onAct} />)}
          </div>
          <form className="ad-in" onSubmit={submit}>
            <input value={typing ?? input} readOnly={typing !== null} onChange={(e) => setInput(e.target.value)} placeholder={`Message ${m?.name ?? agent}…`} aria-label={`Message ${m?.name ?? agent}`} />
            <button type="submit" disabled={busy || typing !== null || input.trim().length < 3} aria-label="Send"><Send className="h-3.5 w-3.5" /></button>
          </form>
          {(sentNote || err) && <div className={`ad-note${err ? " err" : ""}`}>{err ?? sentNote}</div>}
        </>
      )}
    </section>
  );
}

function TaskBlock({ j, agentName, statusOf, wide, onAct }: { j: JobView; agentName: string; statusOf: (id: string) => string | undefined; wide: boolean; onAct: (id: string, a: "cancel" | "retry" | "approve", note?: string) => void }) {
  const ds = displayState(j, statusOf);
  const [all, setAll] = useState(false);
  const [note, setNote] = useState("");
  const steps = j.progress ?? [];
  const shown = all ? steps : steps.slice(-5);
  const projectId = j.payload?.mode === "studio" ? j.payload.projectId : undefined;
  const fromJarvis = j.brief?.objective && j.brief.objective.trim() !== j.request.trim();
  return (
    <div className="ad-task">
      <div className="ad-msg you"><span>{fromJarvis ? "JARVIS → " + agentName : "You"}</span><p>{j.request}</p></div>
      {projectId && <StudioMini projectId={projectId} wide={wide} />}
      <ol className="ad-steps">
        {steps.length > 5 && !all && <li className="more"><button onClick={() => setAll(true)}>{steps.length - 5} earlier steps</button></li>}
        {shown.map((s, i) => <li key={`${s.at}-${i}`} className={s.kind}><time>{new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>{s.text}</li>)}
        {ds === "waiting_dependency" && <li className="info">Waiting for the task it depends on to finish.</li>}
      </ol>
      {j.status === "running" && j.liveText && <div className="ad-msg ag live"><span>{agentName} · writing</span><Markdown text={clean(j.liveText.slice(-1500))} /></div>}
      {(isFinished(j.status) || j.status === "waiting_approval") && j.result && <div className="ad-msg ag"><span>{agentName}{j.status === "completed" ? " · verified" : j.status === "waiting_approval" ? " · draft, waiting for your approval" : ""}</span><Markdown text={clean(j.result.slice(0, 6000))} /></div>}
      {j.resultData?.links?.length ? <div className="ad-links">{j.resultData.links.slice(0, 6).map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}</div> : null}
      {j.error && j.status === "failed" && <div className="ad-err">Failed: {j.error}{j.attempts > 1 ? ` (after ${j.attempts} attempts)` : ""}</div>}
      <div className="ad-acts">
        {["assigned", "running", "planning"].includes(j.status) && <button onClick={() => onAct(j.id, "cancel")} title={j.status === "running" ? "Stops at the agent's next step; a step already running finishes first" : "Cancel"}><Square className="h-3 w-3" />{j.status === "running" ? (j.cancelRequested ? "Stopping…" : "Stop") : "Cancel"}</button>}
        {j.status === "waiting_approval" && (
          <>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Approval note" />
            <button className="go" onClick={() => onAct(j.id, "approve", note || undefined)}><Check className="h-3 w-3" />Approve</button>
            <button onClick={() => onAct(j.id, "cancel")}><X className="h-3 w-3" />Reject</button>
          </>
        )}
        {(j.status === "failed" || j.status === "cancelled") && <button onClick={() => onAct(j.id, "retry")}><RotateCcw className="h-3 w-3" />Retry</button>}
        <a href={`/dashboard/jobs?task=${j.id}`} target="_blank" rel="noreferrer">Details ↗</a>
      </div>
    </div>
  );
}

const CSS = `
.ad-row{position:fixed;right:12px;bottom:12px;z-index:60;display:flex;flex-direction:column-reverse;align-items:flex-end;gap:6px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);pointer-events:none}
.ad-win{pointer-events:auto;width:min(380px,calc(100vw - 24px));height:min(560px,72dvh);display:flex;flex-direction:column;border-radius:16px;overflow:hidden;font-family:Barlow,system-ui,sans-serif;color:#e8f3ff;
  background:linear-gradient(160deg,color-mix(in srgb,var(--ac) 10%,rgba(10,22,42,.72)),rgba(4,10,22,.78));border:1px solid color-mix(in srgb,var(--ac) 35%,rgba(140,200,255,.18));
  box-shadow:0 24px 70px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.07),0 0 30px color-mix(in srgb,var(--ac) 14%,transparent);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);
  animation:ad-in .32s cubic-bezier(.2,.8,.2,1) both;flex:none}
.ad-win.min{height:auto;width:min(300px,calc(100vw - 24px))}
@media (max-width:640px){.ad-win.min{width:100%}}
.ad-win.wide{width:min(760px,calc(100vw - 24px))}
@keyframes ad-in{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}
.ad-h{display:flex;align-items:center;gap:8px;padding:9px 10px;border-bottom:1px solid rgba(140,200,255,.12);flex:none;cursor:default}
.ad-glyph{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:1px solid var(--ac);box-shadow:0 0 12px color-mix(in srgb,var(--ac) 40%,transparent);flex:none}
.ad-id{display:flex;flex-direction:column;min-width:0;flex:1}
.ad-id b{font:600 12px "Barlow Condensed",sans-serif;letter-spacing:.24em;color:var(--ac)}
.ad-id small{font-size:11px;color:#9fb7d0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ad-state{display:flex;align-items:center;gap:4px;font-size:10px;border:1px solid;border-radius:99px;padding:1px 7px;white-space:nowrap;flex:none}
.ad-state i{width:6px;height:6px;border-radius:50%}.ad-state i.pulse{animation:ad-p 1.2s ease-in-out infinite}
@keyframes ad-p{50%{opacity:.3}}
.ad-ic{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;color:#8fa9c4;flex:none}.ad-ic:hover{background:rgba(255,255,255,.07);color:#fff}
.ad-body{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain}
.ad-empty p{margin:0 0 8px;font-size:12px;color:#b8cbe0;line-height:1.5}.ad-dim{color:#6f87a0!important}
.ad-caps{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}.ad-caps span{font-size:10px;padding:2px 7px;border-radius:99px;border:1px solid rgba(140,200,255,.18);color:#cfe2f5;background:rgba(255,255,255,.03)}
.ad-sugg{display:flex;flex-direction:column;gap:4px}.ad-sugg button{text-align:left;font-size:11.5px;padding:6px 8px;border-radius:9px;border:1px solid color-mix(in srgb,var(--ac) 25%,transparent);background:rgba(255,255,255,.03);color:#dcecff}.ad-sugg button:hover{border-color:var(--ac)}
.ad-task{display:flex;flex-direction:column;gap:7px}
.ad-msg{border-radius:12px;padding:7px 9px;font-size:12px;line-height:1.5}
.ad-msg>span{display:block;font:600 9.5px "Barlow Condensed",sans-serif;letter-spacing:.18em;text-transform:uppercase;margin-bottom:2px;color:#8fa9c4}
.ad-msg p{margin:0;white-space:pre-wrap;word-break:break-word;max-height:9em;overflow:auto}
.ad-msg.you{align-self:flex-end;max-width:92%;background:rgba(95,225,255,.08);border:1px solid rgba(95,225,255,.18)}
.ad-msg.ag{background:rgba(255,255,255,.04);border:1px solid color-mix(in srgb,var(--ac) 25%,transparent);max-height:320px;overflow:auto}
.ad-msg.ag>span{color:var(--ac)}.ad-msg.live>span::after{content:" ▍";animation:ad-p 1s steps(1) infinite}
.ad-msg :is(h1,h2,h3){font-size:12.5px;margin:4px 0}.ad-msg ul{padding-left:16px;margin:2px 0}.ad-msg a{color:#5fe1ff}
.ad-steps{list-style:none;margin:0;padding:0 0 0 8px;border-left:1px solid color-mix(in srgb,var(--ac) 30%,transparent);display:flex;flex-direction:column;gap:3px}
.ad-steps li{font-size:11px;color:#b8cbe0;line-height:1.35}.ad-steps li time{color:#5d7590;margin-right:6px;font-size:10px}
.ad-steps li.error{color:#ff9aa5}.ad-steps li.approval{color:#f4c35a}.ad-steps li.tool{color:#cfe8ff}
.ad-steps li.more button{font-size:10.5px;color:#7f97b2;text-decoration:underline}
.ad-links{display:flex;flex-wrap:wrap;gap:5px}.ad-links a{font-size:10.5px;color:#5fe1ff;border:1px solid rgba(95,225,255,.25);border-radius:99px;padding:1px 8px}
.ad-err{font-size:11.5px;color:#ff9aa5;background:rgba(255,107,122,.08);border:1px solid rgba(255,107,122,.25);border-radius:9px;padding:6px 8px}
.ad-acts{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.ad-acts button,.ad-acts a{display:flex;align-items:center;gap:4px;font-size:10.5px;padding:3px 8px;border-radius:8px;border:1px solid rgba(140,200,255,.2);color:#dcecff;background:rgba(255,255,255,.03)}
.ad-acts button:hover,.ad-acts a:hover{border-color:var(--ac)}
.ad-acts button.go{background:linear-gradient(135deg,rgba(40,140,230,.55),rgba(120,90,240,.5));border-color:transparent}
.ad-acts input{flex:1;min-width:90px;font-size:11px;padding:3px 7px;border-radius:8px;border:1px solid rgba(140,200,255,.2);background:rgba(0,0,0,.25);color:#fff;outline:none}
.ad-in{display:flex;gap:6px;padding:8px;border-top:1px solid rgba(140,200,255,.12);flex:none}
.ad-in input{flex:1;min-width:0;font-size:12.5px;padding:7px 10px;border-radius:10px;border:1px solid rgba(140,200,255,.18);background:rgba(0,0,0,.25);color:#fff;outline:none}
.ad-in input:focus{border-color:var(--ac)}.ad-in input[readonly]{color:color-mix(in srgb,var(--ac) 70%,#fff)}
.ad-in button{display:flex;align-items:center;justify-content:center;width:32px;border-radius:10px;background:color-mix(in srgb,var(--ac) 35%,rgba(20,40,70,.8));color:#fff}.ad-in button:disabled{opacity:.4}
.ad-note{font-size:10.5px;color:#4ce0a6;padding:0 10px 7px}.ad-note.err{color:#ff9aa5}
.ad-hidden{position:fixed;left:12px;bottom:12px;z-index:61;display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:99px;background:rgba(4,12,24,.75);border:1px solid rgba(140,200,255,.18);backdrop-filter:blur(12px);color:#9fb7d0;font:500 10.5px Barlow,sans-serif;max-width:calc(100vw - 24px);overflow-x:auto}
.ad-hidden button{display:flex;align-items:center;gap:4px;padding:2px 7px;border-radius:99px;border:1px solid color-mix(in srgb,var(--ac) 35%,transparent);color:var(--ac);font:600 9.5px "Barlow Condensed",sans-serif;letter-spacing:.16em;white-space:nowrap}
.ad-hidden button i{width:5px;height:5px;border-radius:50%;background:#5d7590}.ad-hidden button i.on{background:#5fe1ff;box-shadow:0 0 6px #5fe1ff;animation:ad-p 1.2s infinite}
.ad-hidden-n{white-space:nowrap}
.ad-studio{position:relative;display:grid;grid-template-columns:1fr;gap:6px}
.ad-studio.wide{grid-template-columns:1fr 1fr}
.ad-studio-code,.ad-studio-prev{border:1px solid rgba(140,200,255,.15);border-radius:10px;overflow:hidden;background:rgba(0,0,0,.3);display:flex;flex-direction:column}
.ad-studio-h{display:flex;justify-content:space-between;gap:6px;font-size:10px;color:#9fb7d0;padding:4px 7px;border-bottom:1px solid rgba(140,200,255,.1)}
.ad-studio-h em{font-style:normal;color:#5fe1ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ad-studio-code pre{margin:0;height:150px;overflow:auto;padding:6px 8px;font:10.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cfe8ff;white-space:pre}
.ad-studio.wide .ad-studio-code pre{height:300px}
.ad-studio-prev iframe{width:100%;height:170px;border:0;background:#fff}
.ad-studio.wide .ad-studio-prev iframe{height:300px}
.ad-studio-wait{height:80px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#6f87a0;padding:8px;text-align:center}
.ad-studio-full{justify-self:end;font-size:10.5px;color:#5fe1ff}
@media (max-width:640px){
  .ad-row{left:8px;right:8px;bottom:8px;align-items:stretch;max-height:calc(100dvh - 16px)}
  .ad-win{width:100%;height:min(70dvh,560px)}
  .ad-studio.wide{grid-template-columns:1fr}
  .ad-hidden{bottom:auto;top:44px;left:8px}
}
@media (prefers-reduced-motion:reduce){.ad-win{animation:none}.ad-state i.pulse,.ad-hidden button i.on{animation:none}}
`;
