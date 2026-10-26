"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OMEGA_CSS } from "@/components/omega/tokens";
import { AgentGlyph } from "@/components/omega/glyphs";
import { NEXUS_AGENTS } from "@/lib/nexus/agents";
import type { CenterItem, Decision } from "@/lib/approvals/center";

/**
 * APPROVAL & ACTIVITY CENTER — what each agent proposes, what it will do, and
 * which permission applies. Opening this page approves nothing: only your
 * button press does, and every decision is recorded.
 */
type Data = { approvals: CenterItem[]; attention: CenterItem[]; review: CenterItem[]; decisions: { id: string; kind: string; decision: string; note: string | null; outcome: string; detail: string | null; at: string }[] };
const KIND_LABEL: Record<string, string> = { job: "Task checkpoint", darwin_message: "External message", ev_daily: "Publishing", proposal: "Proposal from EVIE", failed_job: "Failed task", review: "Finished task" };
const ACTION_LABEL: Record<Decision, string> = { approve: "Approve", reject: "Reject", revise: "Revise", retry: "Retry", reviewed: "Mark reviewed" };
const agentOf = (id: string) => NEXUS_AGENTS.find((a) => a.id === id);
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Card({ it, onDecide, busy }: { it: CenterItem; onDecide: (it: CenterItem, d: Decision, note?: string) => void; busy: boolean }) {
  const [mode, setMode] = useState<null | "revise" | "reject">(null);
  const [note, setNote] = useState(it.kind === "darwin_message" ? it.preview?.find((p) => p.label === "Message")?.text ?? "" : "");
  const a = agentOf(it.agent);
  return (
    <article className="ac-card om-glass om-fade-in" style={{ ["--ac" as string]: a?.color ?? "#5fe1ff" }}>
      <div className="ac-visual" aria-hidden>
        <span className="ac-visual-ring"><AgentGlyph motif={a?.motif ?? ""} size={30} color={a?.color} /></span>
        <span className="ac-visual-k">{KIND_LABEL[it.kind]}</span>
      </div>
      <header>
        <div><div className="ac-kind">{a?.name ?? it.agent}</div><h3>{it.title}</h3></div>
        <span className="om-dim ac-when">{when(it.createdAt)}</span>
      </header>
      <dl>
        <dt>{it.kind === "review" ? "Result" : it.kind === "failed_job" ? "Error" : "Proposes"}</dt><dd>{it.proposes.replace(/\*\*|__|^#+\s*/gm, "")}</dd>
        <dt>Effect</dt><dd>{it.effect}</dd>
        <dt>Permission</dt><dd>{it.permission}</dd>
      </dl>
      {it.preview?.length ? <div className="ac-preview">{it.preview.map((p, i) => <div key={i}><span>{p.label}</span><pre>{p.text}</pre></div>)}</div> : null}
      {mode && (
        <textarea className="om-input ac-note" value={note} onChange={(e) => setNote(e.target.value)} rows={mode === "revise" && it.kind === "darwin_message" ? 6 : 3}
          placeholder={mode === "revise" ? (it.kind === "darwin_message" ? "The message as it should be sent" : "What should change?") : "Why (optional — guides the next version)"} aria-label="Note" />
      )}
      <div className="ac-actions">
        {(it.links ?? []).map((l) => <Link key={l.url} className="om-btn sm" href={l.url}>{l.label}</Link>)}
        <span className="ac-spacer" />
        {mode ? (
          <>
            <button className="om-btn sm" onClick={() => setMode(null)} disabled={busy}>Back</button>
            <button className={`om-btn sm ${mode === "reject" ? "bad" : "good"}`} disabled={busy || (mode === "revise" && note.trim().length < 3)} onClick={() => onDecide(it, mode, note)}>{mode === "reject" ? "Confirm reject" : it.kind === "darwin_message" ? "Save revision" : "Approve with changes"}</button>
          </>
        ) : it.actions.map((d) => (
          <button key={d} className={`om-btn sm ${d === "approve" ? "good primary" : d === "reject" ? "bad" : ""}`} disabled={busy}
            onClick={() => (d === "revise" || (d === "reject" && it.kind !== "proposal")) ? setMode(d) : onDecide(it, d)}>{ACTION_LABEL[d]}</button>
        ))}
      </div>
    </article>
  );
}

export function ActivityCenter() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await fetch("/api/approvals", { cache: "no-store" }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setData(j.data); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  const decide = async (it: CenterItem, decision: Decision, note?: string) => {
    setBusy(it.id); setMsg(null); setErr(null);
    try {
      const r = await fetch("/api/approvals/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: it.kind, id: it.id, decision, note }) });
      const j = await r.json();
      if (!r.ok || !j.ok) setErr(j.error ?? `HTTP ${r.status}`); else setMsg(j.data.detail);
    } catch (e) { setErr((e as Error).message); }
    setBusy(null); void load();
  };
  return (
    <div className="om ac">
      <style dangerouslySetInnerHTML={{ __html: OMEGA_CSS + AC_CSS }} />
      <header className="ac-head">
        <div><div className="om-title">Actions waiting for you</div><h1 className="om-h1">Approval &amp; Activity Center</h1></div>
        <p className="om-sub">Nothing here happens until you press a button. Each decision is carried out by the agent&apos;s own system and recorded below.</p>
      </header>
      {err && <div className="ac-err" role="alert">{err}</div>}
      {msg && <div className="ac-msg" role="status">{msg}</div>}
      {!data ? <div className="om-dim">Loading…</div> : (
        <div className="ac-grid">
          <section>
            <h2 className="om-title">Pending approvals ({data.approvals.length})</h2>
            {data.approvals.length ? <div className="ac-cards">{data.approvals.map((it) => <Card key={`${it.kind}-${it.id}`} it={it} onDecide={decide} busy={busy === it.id} />)}</div> : <div className="ac-empty om-glass">Nothing is waiting for your approval.</div>}
            <h2 className="om-title">Needs intervention ({data.attention.length})</h2>
            {data.attention.length ? <div className="ac-cards">{data.attention.map((it) => <Card key={it.id} it={it} onDecide={decide} busy={busy === it.id} />)}</div> : <div className="ac-empty om-glass">No failed tasks in the last 7 days.</div>}
            <h2 className="om-title">Finished — awaiting your review ({data.review.length})</h2>
            {data.review.length ? <div className="ac-cards">{data.review.map((it) => <Card key={it.id} it={it} onDecide={decide} busy={busy === it.id} />)}</div> : <div className="ac-empty om-glass">Nothing new to review.</div>}
          </section>
          <aside className="ac-log om-glass">
            <h2 className="om-title">Decision log</h2>
            {data.decisions.length ? <ul>{data.decisions.map((d) => <li key={d.id} className={d.outcome}><b>{d.decision}</b> · {KIND_LABEL[d.kind] ?? d.kind}<div className="om-dim">{d.detail}{d.note ? ` — “${d.note.slice(0, 120)}”` : ""}</div><div className="om-dim">{when(d.at)} · {d.outcome === "ok" ? "done" : "failed"}</div></li>)}</ul> : <div className="om-dim">No decisions yet.</div>}
          </aside>
        </div>
      )}
    </div>
  );
}

const AC_CSS = `
.ac{padding:14px clamp(12px,2vw,28px) 40px}
.ac-top{display:flex;justify-content:center;margin-bottom:14px}
.ac-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:12px}
.ac-head p{max-width:520px;margin:0}
.ac-err,.ac-msg{margin:8px 0;padding:8px 12px;border-radius:10px;font-size:13px}
.ac-err{border:1px solid rgba(255,107,122,.4);background:rgba(255,107,122,.08);color:#ffc5cc}
.ac-msg{border:1px solid rgba(76,224,166,.4);background:rgba(76,224,166,.08);color:#c6f7e2}
.ac-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,340px);gap:16px;align-items:start}
.ac-grid h2{margin:18px 0 8px}
.ac-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;align-items:start}
.ac-card{padding:0 14px 14px;overflow:hidden;border-color:color-mix(in srgb,var(--ac) 35%,transparent);display:flex;flex-direction:column}
.ac-visual{position:relative;height:96px;margin:0 -14px 12px;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 120%,color-mix(in srgb,var(--ac) 45%,transparent),transparent 70%),linear-gradient(180deg,rgba(10,26,48,.9),rgba(4,10,20,.6));border-bottom:1px solid color-mix(in srgb,var(--ac) 30%,transparent);overflow:hidden}
.ac-visual::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(140,200,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(140,200,255,.07) 1px,transparent 1px);background-size:18px 18px;mask-image:radial-gradient(ellipse at center,#000 30%,transparent 75%)}
.ac-visual-ring{position:relative;width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1px solid var(--ac);box-shadow:0 0 24px color-mix(in srgb,var(--ac) 45%,transparent),inset 0 0 14px color-mix(in srgb,var(--ac) 30%,transparent);background:rgba(3,10,20,.7)}
.ac-visual-k{position:absolute;left:12px;bottom:8px;font:500 9.5px "Barlow Condensed",sans-serif;letter-spacing:.22em;text-transform:uppercase;color:color-mix(in srgb,var(--ac) 80%,#fff)}
.ac-card .ac-actions{margin-top:auto;padding-top:10px}
.ac-card header{display:flex;gap:10px;align-items:flex-start}
.ac-glyph{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;border:1px solid color-mix(in srgb,var(--ac) 45%,transparent);flex:none}
.ac-kind{font:500 10.5px "Barlow Condensed",sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--ac)}
.ac-card h3{margin:2px 0 0;font-size:15px;font-weight:600}
.ac-when{margin-left:auto;white-space:nowrap}
.ac-card dl{display:grid;grid-template-columns:84px 1fr;gap:4px 10px;margin:10px 0;font-size:13px}
.ac-card dt{color:#8fd8ff;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding-top:2px}
.ac-card dd{margin:0;color:var(--om-ink-2);line-height:1.45}
.ac-preview{border:1px solid var(--om-line);border-radius:10px;padding:8px 10px;background:rgba(3,10,20,.55);display:grid;gap:6px;max-height:150px;overflow:auto}
.ac-preview span{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--om-ink-3)}
.ac-preview pre{margin:2px 0 0;white-space:pre-wrap;font:400 13px Barlow,sans-serif;color:var(--om-ink)}
.ac-note{width:100%;margin-top:8px;resize:vertical}
.ac-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px}
.ac-spacer{flex:1}
.ac-empty{padding:16px;color:var(--om-ink-3);font-size:13px}
.ac-log{padding:14px;position:sticky;top:12px;max-height:calc(100dvh - 8rem);overflow:auto}
.ac-log ul{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:10px;font-size:12.5px}
.ac-log li{border-left:2px solid #4ce0a6;padding-left:8px}.ac-log li.failed{border-color:#ff6b7a}
@media (max-width:900px){.ac-grid{grid-template-columns:1fr}.ac-log{position:static;max-height:none}.ac-card dl{grid-template-columns:1fr}}
`;
