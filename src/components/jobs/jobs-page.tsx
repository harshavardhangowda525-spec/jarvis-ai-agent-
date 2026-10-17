"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { JOB_STATUS_LABEL, type JobStatus } from "@/lib/jobs/brief";
import type { JobView } from "@/lib/jobs/engine";
import { Markdown } from "@/components/chat/markdown";
import { useJobs } from "./use-jobs";

/**
 * Tasks JARVIS delegated: who has each one, its status, the brief, every real
 * step with its time, the result or error — and cancel / retry / approve.
 */

const TONE: Record<JobStatus, string> = { planning: "gray", assigned: "slate", running: "blue", waiting_approval: "amber", completed: "green", failed: "red", cancelled: "gray" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const dur = (a: string | null, b: string | null) => {
  if (!a) return null;
  const s = Math.round(((b ? new Date(b) : new Date()).getTime() - new Date(a).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export function JobsPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"active" | "finished" | "all">("all");
  const { jobs, error, loaded, act } = useJobs({ status: tab });
  const [open, setOpen] = useState<string | null>(params.get("task"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState("");
  const job = jobs.find((j) => j.id === open) ?? null;
  useEffect(() => { setNote(""); }, [open]);

  const run = async (id: string, action: "cancel" | "retry" | "approve", n?: string) => {
    const r = await act(id, action, n);
    setMsg(r.ok ? { ok: true, text: action === "cancel" ? "Cancelling." : action === "retry" ? "Retrying — it starts in a moment." : "Approved — the agent carries on." } : { ok: false, text: r.error });
  };

  return (
    <div className="jb">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="jb-top">
        <b>Agent tasks</b>
        <span className="jb-sub">Work JARVIS delegated to DARWIN, RUBIN, EV and MIKE — tracked until it really finishes.</span>
        <nav className="jb-tabs">
          {(["all", "active", "finished"] as const).map((t) => <button key={t} type="button" className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "all" ? "All" : t === "active" ? "Active" : "Finished"}</button>)}
        </nav>
      </header>
      {msg && <p className={`jb-flash ${msg.ok ? "ok" : "bad"}`}>{msg.text}<button type="button" onClick={() => setMsg(null)}>✕</button></p>}
      {error && <p className="jb-flash bad">{error}</p>}
      <main className="jb-main">
        <ul className="jb-list">
          {jobs.map((j) => (
            <li key={j.id}>
              <button type="button" className={`jb-row ${open === j.id ? "sel" : ""}`} onClick={() => setOpen(j.id)}>
                <span className="jb-agent">{j.agentName}</span>
                <span className="jb-t"><b>{j.title}</b><small>{j.progress.at(-1)?.text ?? ""}</small></span>
                <span className={`jb-pill t-${TONE[j.status]}`}>{JOB_STATUS_LABEL[j.status]}</span>
                <small className="jb-when">{when(j.createdAt)}</small>
              </button>
            </li>
          ))}
          {loaded && !jobs.length && <li className="jb-empty">No tasks yet. Ask JARVIS for something like “find 20 gyms in Indiranagar without a website” and it hands it to DARWIN.</li>}
        </ul>
        {job && (
          <section className="jb-detail" aria-label={`Task ${job.title}`}>
            <div className="jb-dh">
              <div><h2>{job.title}</h2><small>{job.agentName} · task {job.id.slice(-6)} · attempt {job.attempts || 0}</small></div>
              <button type="button" className="jb-btn" onClick={() => setOpen(null)} aria-label="Close">✕</button>
            </div>
            <div className="jb-row2">
              <span className={`jb-pill t-${TONE[job.status]}`}>{JOB_STATUS_LABEL[job.status]}{job.cancelRequested && job.status === "running" ? " · stopping" : ""}</span>
              <span>Created {when(job.createdAt)}</span>
              {job.startedAt && <span>Started {when(job.startedAt)}</span>}
              {job.finishedAt && <span>Finished {when(job.finishedAt)}</span>}
              {dur(job.startedAt, job.finishedAt) && <span>{job.finishedAt ? "Took" : "Running for"} {dur(job.startedAt, job.finishedAt)}</span>}
            </div>
            <div className="jb-acts">
              {["assigned", "running", "planning", "waiting_approval"].includes(job.status) && !job.cancelRequested && <button type="button" className="jb-btn" onClick={() => void run(job.id, "cancel")}>Cancel</button>}
              {["failed", "cancelled"].includes(job.status) && <button type="button" className="jb-btn pri" onClick={() => void run(job.id, "retry")}>Retry</button>}
              {job.conversationId && <Link className="jb-btn" href={`/dashboard/chat/${job.agent}`}>Open {job.agentName}&apos;s chat</Link>}
            </div>
            {job.status === "waiting_approval" && (
              <form className="jb-approve" onSubmit={(e) => { e.preventDefault(); void run(job.id, "approve", note || "go ahead"); }}>
                <b>{job.agentName} is waiting for your approval</b>
                <span>{job.progress.at(-1)?.text.replace(/^Waiting for your approval:\s*/, "")}</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: what you approve (e.g. send the 3 messages)" maxLength={300} />
                <button type="submit" className="jb-btn pri">Approve and continue</button>
              </form>
            )}
            {job.error && <p className="jb-flash bad">{job.error}</p>}
            {job.result && <div className="jb-sec"><h3>Result</h3><div className="jb-result"><Markdown text={job.result} /></div></div>}
            {!!job.resultData?.links?.length && <div className="jb-sec"><h3>Links</h3>{job.resultData.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}</div>}
            <div className="jb-sec"><h3>Progress</h3>
              <ol className="jb-steps">{job.progress.map((s, i) => <li key={i} className={`k-${s.kind}`}><span>{s.text}</span><small>{when(s.at)}</small></li>)}</ol>
            </div>
            <div className="jb-sec"><h3>Brief JARVIS wrote for {job.agentName}</h3>
              <dl className="jb-brief">
                <dt>You asked</dt><dd>{job.request}</dd>
                <dt>Objective</dt><dd>{job.brief.objective}</dd>
                <dt>Expected outcome</dt><dd>{job.brief.expectedOutcome}</dd>
                {job.brief.context?.length ? <><dt>Known</dt><dd><ul>{job.brief.context.map((x) => <li key={x}>{x}</li>)}</ul></dd></> : null}
                {job.brief.requirements?.length ? <><dt>Requirements</dt><dd><ul>{job.brief.requirements.map((x) => <li key={x}>{x}</li>)}</ul></dd></> : null}
                {job.brief.constraints?.length ? <><dt>Constraints</dt><dd><ul>{job.brief.constraints.map((x) => <li key={x}>{x}</li>)}</ul></dd></> : null}
                {job.brief.outputFormat && <><dt>Output</dt><dd>{job.brief.outputFormat}</dd></>}
                <dt>Done when</dt><dd><ul>{job.brief.acceptance.map((x) => <li key={x}>{x}</li>)}</ul></dd>
                {job.brief.approvals?.length ? <><dt>Needs approval</dt><dd><ul>{job.brief.approvals.map((x) => <li key={x}>{x}</li>)}</ul></dd></> : null}
                {job.dependsOn.length ? <><dt>After</dt><dd>{job.dependsOn.map((d) => <button key={d} type="button" className="jb-link" onClick={() => setOpen(d)}>task {d.slice(-6)}</button>)}</dd></> : null}
              </dl>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

const CSS = `
.jb { --navy: #0A2540; --blue: #2563EB; --line: #E3E8EF; --mute: #64748B; height: calc(100dvh - 4rem); display: flex; flex-direction: column; background: #F5F7FA; color: #0F172A; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; min-width: 0; }
.jb * { box-sizing: border-box; }
.jb-top { background: var(--navy); color: #fff; padding: 10px 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.jb-sub { color: #9FB3C8; font-size: 12px; flex: 1; min-width: 200px; }
.jb-tabs { display: flex; gap: 4px; } .jb-tabs button { border: 1px solid rgba(255,255,255,.25); background: none; color: #fff; border-radius: 999px; padding: 4px 12px; cursor: pointer; font: inherit; } .jb-tabs button.on { background: #fff; color: var(--navy); }
.jb-flash { margin: 8px 14px 0; padding: 8px 12px; border-radius: 8px; display: flex; gap: 8px; } .jb-flash.ok { background: #ECFDF3; color: #067647; } .jb-flash.bad { background: #FEF3F2; color: #B42318; }
.jb-flash button { margin-left: auto; border: 0; background: none; cursor: pointer; color: inherit; }
.jb-main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(280px, 1fr) minmax(0, 1.3fr); gap: 12px; padding: 12px 14px; }
.jb-list { list-style: none; margin: 0; padding: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.jb-row { width: 100%; text-align: left; display: grid; grid-template-columns: auto 1fr auto; gap: 2px 10px; align-items: center; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; cursor: pointer; font: inherit; color: inherit; }
.jb-row.sel, .jb-row:hover { border-color: #BFD3F5; background: #F7FAFF; }
.jb-agent { font-size: 11px; font-weight: 700; letter-spacing: .06em; color: var(--navy); background: #EEF3FB; border-radius: 6px; padding: 2px 6px; }
.jb-t { min-width: 0; } .jb-t b { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .jb-t small { display: block; color: var(--mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jb-when { grid-column: 2 / 4; color: #94A3B8; }
.jb-empty { padding: 24px; text-align: center; color: var(--mute); background: #fff; border: 1px dashed var(--line); border-radius: 10px; }
.jb-pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
.t-gray { background: #F2F4F7; color: #475467; } .t-slate { background: #EEF2F6; color: #364152; } .t-blue { background: #EFF4FF; color: #1D4ED8; } .t-amber { background: #FFFAEB; color: #B54708; } .t-green { background: #ECFDF3; color: #067647; } .t-red { background: #FEF3F2; color: #B42318; }
.jb-detail { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.jb-dh { display: flex; gap: 10px; align-items: flex-start; } .jb-dh h2 { margin: 0; font-size: 17px; } .jb-dh small { color: var(--mute); } .jb-dh .jb-btn { margin-left: auto; }
.jb-row2 { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; color: var(--mute); font-size: 12.5px; }
.jb-acts { display: flex; gap: 6px; flex-wrap: wrap; }
.jb-btn { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line); background: #fff; color: #0F172A; cursor: pointer; font: inherit; display: inline-flex; align-items: center; text-decoration: none; }
.jb-btn.pri { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 600; }
.jb-approve { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 10px; background: #FFFAEB; border: 1px solid #FEDF89; color: #93370D; }
.jb-approve input { border: 1px solid #FEDF89; border-radius: 8px; padding: 7px 9px; font: inherit; } .jb-approve .jb-btn { align-self: flex-start; }
.jb-sec h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--mute); }
.jb-sec a { display: block; color: var(--blue); }
.jb-result { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; background: #FAFBFD; user-select: text; }
.jb-result .md p { margin: .4em 0; } .jb-result .md-ul { list-style: disc; padding-left: 1.2em; } .jb-result .md-ol { list-style: decimal; padding-left: 1.2em; }
.jb-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.jb-steps li { display: flex; gap: 10px; justify-content: space-between; padding-left: 10px; border-left: 2px solid var(--line); } .jb-steps small { color: #94A3B8; white-space: nowrap; }
.jb-steps .k-tool { border-color: #84CAA4; } .jb-steps .k-error { border-color: #F04438; color: #B42318; } .jb-steps .k-approval { border-color: #F79009; }
.jb-brief { display: grid; grid-template-columns: 130px 1fr; gap: 6px 12px; margin: 0; } .jb-brief dt { color: var(--mute); } .jb-brief dd { margin: 0; overflow-wrap: anywhere; } .jb-brief ul { margin: 0; padding-left: 1.1em; }
.jb-link { border: 0; background: none; color: var(--blue); cursor: pointer; padding: 0 6px 0 0; font: inherit; }
@media (max-width: 760px) { .jb-main { grid-template-columns: 1fr; } .jb-detail { position: fixed; inset: 4rem 0 0 0; z-index: 30; border-radius: 0; } .jb-brief { grid-template-columns: 1fr; } }
`;
