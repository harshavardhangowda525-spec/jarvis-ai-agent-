"use client";

import Link from "next/link";
import { AgentGlyph } from "@/components/omega/glyphs";
import { STATE_COLOR } from "@/components/omega/tokens";
import { STATE_LABEL } from "@/lib/nexus/agents";
import type { AgentStatus } from "@/lib/nexus/status";

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

/** One agent's workspace — everything here is the agent's real record. */
export function AgentPanel({ a, onClose, onAct, busy }: { a: AgentStatus; onClose: () => void; onAct: (id: string, action: "cancel" | "retry" | "approve") => void; busy: string | null }) {
  const cur = a.current;
  const steps = (cur?.progress ?? []).slice(-8);
  const sc = STATE_COLOR[a.state] ?? "#5d7590";
  return (
    <aside className="nx-panel om-glass om-fade-in" style={{ ["--ac" as string]: a.color }} aria-label={`${a.name} workspace`}>
      <header className="nx-panel-h">
        <div className="nx-panel-id"><span className="nx-panel-glyph"><AgentGlyph motif={a.motif} size={28} color={a.color} /></span>
          <div><div className="om-title" style={{ color: a.color }}>{a.name}</div><div className="om-sub">{a.title}</div></div></div>
        <button className="om-btn sm" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <p className="om-sub">{a.purpose}</p>
      <div className="nx-state-row"><span className="om-dot" style={{ ["--c" as string]: sc }} /> <b>{STATE_LABEL[a.state]}</b> <span className="om-dim">— {a.reason}{a.updatedAt ? ` · updated ${when(a.updatedAt)}` : ""}</span></div>
      {a.brain && <div className="om-dim">Brain: {a.brain.length ? a.brain.join(" → ") : "none configured"}</div>}

      <section>
        <h4>Current task</h4>
        {cur ? (
          <div className="nx-task">
            <div className="nx-task-t">{cur.title}</div>
            <div className="om-dim">{cur.status.replace("_", " ")} · created {when(cur.createdAt)}{cur.startedAt ? ` · started ${when(cur.startedAt)}` : ""}</div>
            <ol className="nx-steps">{steps.map((s, i) => <li key={i} className={`k-${s.kind ?? "info"}`}><span>{when(s.at)}</span> {s.text}</li>)}</ol>
            <div className="nx-row">
              {cur.status === "waiting_approval" && <Link className="om-btn sm good" href="/dashboard/activity">Review in Activity Center</Link>}
              {["planning", "assigned", "running", "waiting_approval"].includes(cur.status) && <button className="om-btn sm bad" disabled={busy === cur.id} onClick={() => onAct(cur.id, "cancel")}>Cancel</button>}
              <Link className="om-btn sm" href={`/dashboard/jobs?task=${cur.id}`}>Details</Link>
            </div>
          </div>
        ) : a.ownRuns.length ? <ul className="nx-list">{a.ownRuns.map((r, i) => <li key={i}>{r.label} <span className="om-dim">· {when(r.at)}</span></li>)}</ul>
          : <div className="om-dim">No task in progress.</div>}
      </section>

      {a.queue.length > 0 && <section><h4>Queue ({a.queue.length})</h4><ul className="nx-list">{a.queue.map((j) => <li key={j.id}>{j.title} <span className="om-dim">· {j.dependsOn.length ? "waits for another task" : "ready to start"}</span></li>)}</ul></section>}

      <section>
        <h4>Recent work (24 h)</h4>
        {a.recent.length ? <ul className="nx-list">{a.recent.map((j) => (
          <li key={j.id}><span className={`nx-badge s-${j.status}`}>{j.status}</span> {j.title} <span className="om-dim">· {when(j.finishedAt)}</span>
            {(j.resultData?.links ?? []).slice(0, 2).map((l) => <a key={l.url} href={l.url} className="nx-link">{l.label}</a>)}
            {j.status === "failed" && <button className="om-btn sm" disabled={busy === j.id} onClick={() => onAct(j.id, "retry")}>Retry</button>}
          </li>))}</ul> : <div className="om-dim">Nothing finished in the last 24 hours.</div>}
      </section>

      {a.errors.length > 0 && <section><h4>Errors & diagnostics</h4><ul className="nx-list err">{a.errors.map((e) => <li key={e.id}>{e.title}: {e.error} <span className="om-dim">· {when(e.at)}</span></li>)}</ul></section>}

      <section>
        <h4>Integrations</h4>
        <ul className="nx-list">{a.integrations.map((i) => <li key={i.name}><span className="om-dot" style={{ ["--c" as string]: i.ok ? "#4ce0a6" : "#ff6b7a" }} /> {i.name} <span className="om-dim">— {i.detail}</span></li>)}</ul>
      </section>

      <section>
        <h4>Capabilities ({a.capabilities.length})</h4>
        <ul className="nx-caps">{a.capabilities.map((c) => <li key={c.tool} title={c.description}><b>{c.label}</b>{c.needsApproval && <span className="nx-perm">needs your approval</span>}<span className="om-dim">{c.description}</span></li>)}</ul>
        <div className="om-dim">Permissions: anything that sends, publishes, deploys or contacts someone stops for your approval first.</div>
      </section>
      {a.chat && <Link className="om-btn primary" href={a.chat}>Open {a.name}</Link>}
    </aside>
  );
}
