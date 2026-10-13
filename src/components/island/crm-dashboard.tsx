"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { IslandDashboard, IslandLead, IslandLeadFull, IslandStatus } from "@/lib/robin/island-types";

/**
 * The CRM dashboard inside RUBEN's liquid-glass pop-up: the three sales
 * statuses with live counts, a searchable lead list, the lead's full record
 * (contacts, Instagram, website, follow-ups, interaction history, demo →
 * proposal → client progress), follow-ups and today's activity.
 *
 * Everything is read from /api/robin/island/dashboard. Every change goes
 * through the CRM's own endpoints, and the result shown is what the server
 * answered. Rejected / Won ask first. Nothing here contacts a lead.
 */

export interface CrmHandle {
  refresh(): void;
  openLead(id: string): void;
  showResults(title: string, leads: IslandLead[]): void;
  showFollowups(): void;
}

interface Props {
  active: boolean;
  onSelectLead: (id: string | null) => void;
  /** Hand a command to RUBEN (pitch, schedule …) about a lead. */
  onCommand: (text: string, leadId?: string) => void;
}

const TABS: { id: IslandStatus; label: string; count: (c: IslandDashboard["counts"]) => number }[] = [
  { id: "open", label: "Open", count: (c) => c.open },
  { id: "ready", label: "Ready to purchase", count: (c) => c.ready },
  { id: "interested", label: "Interested (follow up)", count: (c) => c.interested },
  { id: "rejected", label: "Rejected", count: (c) => c.rejected },
  { id: "won", label: "Won", count: (c) => c.won },
  { id: "all", label: "All", count: (c) => c.total },
];

const STEPS: { label: string; stages: string[] }[] = [
  { label: "Contacted", stages: ["contacted", "qualified"] },
  { label: "Interested", stages: ["interested"] },
  { label: "Follow-up / demo", stages: ["follow_up", "demo_scheduled", "demo_completed"] },
  { label: "Proposal", stages: ["quotation_sent", "negotiating"] },
  { label: "Ready to purchase", stages: ["ready_to_purchase"] },
  { label: "Client", stages: ["won"] },
];

async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return { ok: false, error: j?.error || `JARVIS answered ${r.status}.`, status: r.status };
    return { ok: true, data: j.data as T };
  } catch {
    return { ok: false, error: "JARVIS isn't reachable — nothing was changed.", status: 0 };
  }
}

const safeHref = (raw: string | null, kind: "web" | "ig"): string | null => {
  if (!raw) return null;
  const s = raw.trim();
  if (kind === "ig" && !/^https?:/i.test(s)) return `https://instagram.com/${s.replace(/^@/, "").replace(/[^\w.]/g, "")}`;
  const u = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
};

export const CrmDashboard = forwardRef<CrmHandle, Props>(function CrmDashboard({ active, onSelectLead, onCommand }, ref) {
  const [dash, setDash] = useState<IslandDashboard | null>(null);
  const [status, setStatus] = useState<IslandStatus>("open");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ title: string; leads: IslandLead[] } | null>(null);
  const [view, setView] = useState<"leads" | "followups">("leads");
  const [lead, setLead] = useState<IslandLeadFull | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [askConfirm, setAskConfirm] = useState<{ stage: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (s = status, query = q) => {
    const my = ++seq.current;
    setLoading(true);
    const r = await getJson<IslandDashboard>(`/api/robin/island/dashboard?status=${s}&q=${encodeURIComponent(query)}`);
    if (my !== seq.current) return;
    setLoading(false);
    if (r.ok) { setDash(r.data); setError(null); } else setError(r.error);
  }, [status, q]);

  const loadLead = useCallback(async (id: string) => {
    setLeadId(id);
    onSelectLead(id);
    const r = await getJson<{ lead: IslandLeadFull }>(`/api/robin/island/dashboard?lead=${encodeURIComponent(id)}`);
    if (r.ok) setLead(r.data.lead); else { setLead(null); setNote({ ok: false, text: r.error }); }
  }, [onSelectLead]);

  useImperativeHandle(ref, () => ({
    refresh: () => { void load(); if (leadId) void loadLead(leadId); },
    openLead: (id) => { setView("leads"); void loadLead(id); void load(); },
    showResults: (title, leads) => { setResults({ title, leads }); setView("leads"); },
    showFollowups: () => { setView("followups"); setResults(null); void load(); },
  }), [load, loadLead, leadId]);

  // load when opened, then keep fresh while open (the last state stays while collapsed)
  useEffect(() => {
    if (!active) return;
    void load();
    const iv = setInterval(() => void load(), 60_000);
    return () => clearInterval(iv);
  }, [active, load]);

  // search as you type
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { setResults(null); void load(status, q); }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickTab = (s: IslandStatus) => { setStatus(s); setResults(null); setView("leads"); void load(s, q); };

  const move = async (stage: string, label: string, confirmed = false) => {
    if (!lead) return;
    if (!confirmed && (stage === "lost" || stage === "won")) { setAskConfirm({ stage, label }); return; }
    setAskConfirm(null);
    setBusy(true);
    const r = await getJson<{ moved: { changed: boolean } | null }>(`/api/robin/leads/${lead.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, confirm: confirmed || undefined, source: "user" }),
    });
    setBusy(false);
    if (r.ok) setNote({ ok: true, text: r.data.moved?.changed === false ? `${lead.name} is already ${label}.` : `Saved — ${lead.name} is now ${label}.` });
    else setNote({ ok: false, text: `Not saved: ${r.error}` });
    void loadLead(lead.id); void load();
  };

  const completeFollowUp = async (id: string) => {
    setBusy(true);
    const r = await getJson(`/api/robin/followups/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete", source: "user" }) });
    setBusy(false);
    setNote(r.ok ? { ok: true, text: "Follow-up marked done." } : { ok: false, text: `Not saved: ${r.error}` });
    if (leadId) void loadLead(leadId);
    void load();
  };

  const listLeads = results?.leads ?? dash?.list.leads ?? [];
  const listTitle = results ? results.title : `${TABS.find((t) => t.id === status)?.label ?? ""}${q ? ` · “${q}”` : ""}`;
  const c = dash?.counts;
  const stepIdx = lead ? STEPS.findIndex((s) => s.stages.includes(lead.stage)) : -1;

  return (
    <div className="cd">
      {/* statuses with live counts — they also filter the list */}
      <nav className="cd-tabs" aria-label="Lead status">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`cd-tab ${status === t.id && !results && view === "leads" ? "on" : ""} t-${t.id}`} onClick={() => pickTab(t.id)} aria-pressed={status === t.id && !results}>
            <span>{t.label}</span><b>{c ? t.count(c) : "–"}</b>
          </button>
        ))}
        <button type="button" className={`cd-tab ${view === "followups" ? "on" : ""} t-fu`} onClick={() => { setView("followups"); setResults(null); }} aria-pressed={view === "followups"}>
          <span>Follow-ups</span><b>{c ? c.dueToday + c.overdue : "–"}</b>{c && c.overdue > 0 && <i className="cd-late">{c.overdue} late</i>}
        </button>
      </nav>

      {dash && (
        <div className="cd-pipe" aria-label="Pipeline">
          <div className="cd-bar">
            {dash.pipeline.filter((p) => p.count > 0).map((p) => (
              <span key={p.id} className={`seg s-${p.id}`} style={{ flexGrow: p.count }} title={`${p.label}: ${p.count}`} />
            ))}
          </div>
          <div className="cd-prog">
            Demos <b>{dash.progress.demosUpcoming}</b> upcoming · <b>{dash.progress.demosDone}</b> done
            <span className="dot">•</span>Proposals <b>{dash.progress.proposalsOut}</b> out · <b>{dash.progress.proposalsAccepted}</b> accepted
            <span className="dot">•</span>Clients <b>{dash.progress.clients}</b>
            <span className="dot">•</span>{dash.today}
          </div>
        </div>
      )}

      {error && <p className="cd-err" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
      {note && <p className={`cd-note ${note.ok ? "ok" : "bad"}`} role="status">{note.text} <button type="button" aria-label="Dismiss" onClick={() => setNote(null)}>✕</button></p>}

      <div className={`cd-main ${leadId ? "has-lead" : ""}`}>
        {/* left: leads or follow-ups */}
        <section className="cd-left" aria-label={view === "followups" ? "Follow-ups" : "Leads"}>
          {view === "leads" ? (
            <>
              <input className="cd-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, Instagram, website, city…" aria-label="Search leads" />
              <div className="cd-lt">{listTitle} <span>{results ? results.leads.length : dash ? `${Math.min(dash.list.total, dash.list.leads.length)} of ${dash.list.total}` : ""}</span>{loading && <i className="cd-spin" aria-label="Loading" />}</div>
              <ul className="cd-rows">
                {listLeads.map((l) => (
                  <li key={l.id}>
                    <button type="button" className={`cd-row ${leadId === l.id ? "sel" : ""}`} onClick={() => void loadLead(l.id)}>
                      <span className="n">{l.number != null && <em>#{l.number}</em>}{l.name}</span>
                      <span className={`pill s-${l.stage}`}>{l.stageLabel}</span>
                      <span className="m">{[l.category, l.city].filter(Boolean).join(" · ")}{l.nextFollowUp ? ` · next ${l.nextFollowUp}` : ""}</span>
                    </button>
                  </li>
                ))}
                {dash && !listLeads.length && <li className="cd-empty">{q ? "No lead matches that search." : "No leads here yet."}</li>}
              </ul>
            </>
          ) : (
            <>
              <div className="cd-lt">Follow-ups <span>{dash ? `${dash.counts.overdue} overdue · ${dash.counts.dueToday} today` : ""}</span></div>
              <ul className="cd-rows">
                {(dash?.followups ?? []).map((f) => (
                  <li key={f.id}>
                    <div className={`cd-row fu ${f.overdue ? "late" : ""}`}>
                      <button type="button" className="fu-open" onClick={() => void loadLead(f.leadId)}>
                        <span className="n">{f.number != null && <em>#{f.number}</em>}{f.name}</span>
                        <span className="m">{f.overdue ? "Overdue · " : ""}{f.when} — {f.action}{f.notes ? ` · ${f.notes.slice(0, 60)}` : ""}</span>
                      </button>
                      <button type="button" className="mini" disabled={busy} onClick={() => void completeFollowUp(f.id)}>Done</button>
                    </div>
                  </li>
                ))}
                {dash && !dash.followups.length && <li className="cd-empty">No follow-ups pending.</li>}
              </ul>
            </>
          )}
        </section>

        {/* right: the lead, or today's activity */}
        <section className="cd-right" aria-label={lead ? `Lead ${lead.name}` : "Today"}>
          {lead ? (
            <div className="cd-lead">
              <button type="button" className="cd-back" onClick={() => { setLead(null); setLeadId(null); onSelectLead(null); }}>‹ Back</button>
              <header>
                <h2>{lead.number != null && <em>#{lead.number}</em>}{lead.name}</h2>
                <p>{[lead.category, lead.city].filter(Boolean).join(" · ")} — <span className={`pill s-${lead.stage}`}>{lead.stageLabel}</span> <span className="pr">priority {lead.priority} · score {lead.score}</span></p>
              </header>

              <ol className="cd-steps" aria-label="Progress">
                {STEPS.map((s, i) => <li key={s.label} className={i < stepIdx ? "done" : i === stepIdx ? "now" : ""}>{s.label}</li>)}
              </ol>

              <dl className="cd-dl">
                {lead.phone && <><dt>Phone</dt><dd>{lead.phone}</dd></>}
                {lead.whatsapp && lead.whatsapp !== lead.phone && <><dt>WhatsApp</dt><dd>{lead.whatsapp}</dd></>}
                {lead.email && <><dt>Email</dt><dd>{lead.email}</dd></>}
                {lead.instagram && <><dt>Instagram</dt><dd>{safeHref(lead.instagram, "ig") ? <a href={safeHref(lead.instagram, "ig")!} target="_blank" rel="noreferrer">{lead.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@").replace(/\/$/, "")}</a> : lead.instagram}</dd></>}
                <dt>Website</dt><dd>{lead.website ? (safeHref(lead.website, "web") ? <a href={safeHref(lead.website, "web")!} target="_blank" rel="noreferrer">{lead.website.replace(/^https?:\/\//, "")}</a> : lead.website) : <span className="mut">none on record</span>}</dd>
                {lead.address && <><dt>Address</dt><dd>{lead.address}</dd></>}
                {lead.lastContact && <><dt>Last contact</dt><dd>{lead.lastContact}</dd></>}
                {lead.potentialValue != null && <><dt>Value</dt><dd>{lead.potentialValue.toLocaleString()}</dd></>}
              </dl>

              <div className="cd-acts">
                <button type="button" disabled={busy} className="a-ready" onClick={() => void move("ready_to_purchase", "Ready to purchase")}>Ready to purchase</button>
                <button type="button" disabled={busy} className="a-int" onClick={() => void move("interested", "Interested")}>Interested</button>
                <button type="button" disabled={busy} className="a-rej" onClick={() => void move("lost", "Rejected")}>Rejected</button>
                <button type="button" disabled={busy} onClick={() => void move("won", "Won (client)")}>Won</button>
                <button type="button" disabled={busy} onClick={() => onCommand("schedule a follow-up for tomorrow", lead.id)}>Follow up tomorrow</button>
                <button type="button" disabled={busy} onClick={() => onCommand("prepare a pitch for this business", lead.id)}>Prepare pitch</button>
              </div>
              {askConfirm && (
                <div className="cd-confirm" role="alertdialog" aria-label="Confirm">
                  Mark {lead.name} as <b>{askConfirm.label}</b>?
                  <button type="button" className="yes" onClick={() => void move(askConfirm.stage, askConfirm.label, true)}>Yes</button>
                  <button type="button" onClick={() => setAskConfirm(null)}>Cancel</button>
                </div>
              )}

              {lead.notes && <p className="cd-notes">{lead.notes}</p>}

              <h3>Follow-ups</h3>
              {lead.followUpsAll.length ? (
                <ul className="cd-tl">{lead.followUpsAll.map((f) => (
                  <li key={f.id} className={f.overdue ? "late" : f.status !== "pending" ? "mut" : ""}>
                    <span>{f.when}</span> {f.action} — {f.status === "pending" ? (f.overdue ? "overdue" : "pending") : f.status}
                    {f.status === "pending" && <button type="button" className="mini" disabled={busy} onClick={() => void completeFollowUp(f.id)}>Done</button>}
                  </li>
                ))}</ul>
              ) : <p className="mut">None scheduled.</p>}

              <h3>Interaction history</h3>
              {lead.interactions.length ? (
                <ul className="cd-tl">{lead.interactions.map((i) => (
                  <li key={i.id}><span>{i.when}</span> {i.direction === "inbound" ? "←" : "→"} {i.channel}{i.outcome ? ` · ${i.outcome.replace(/_/g, " ")}` : ""}{i.notes ? ` — ${i.notes.slice(0, 140)}` : ""}</li>
                ))}</ul>
              ) : <p className="mut">No interactions logged.</p>}

              {(lead.demos.length > 0 || lead.quotations.length > 0 || lead.client) && <h3>Demo, proposal, client</h3>}
              <ul className="cd-tl">
                {lead.demos.map((d) => <li key={d.id}><span>{d.when}</span> Demo ({d.type}) — {d.status}</li>)}
                {lead.quotations.map((x) => <li key={x.id}><span>{x.when}</span> Quotation {x.number} — {x.status} · {x.currency} {x.total.toLocaleString()}</li>)}
                {lead.client && <li><span>Client</span> {lead.client.status} · payment {lead.client.paymentStatus} · {lead.client.currency} {lead.client.amount.toLocaleString()}{lead.client.project ? ` · ${lead.client.project}` : ""}</li>}
              </ul>

              {lead.stageHistory.length > 0 && <>
                <h3>Stage history</h3>
                <ul className="cd-tl">{lead.stageHistory.map((m, i) => <li key={i}><span>{m.when}</span> {m.from ? `${m.from} → ` : ""}{m.to}</li>)}</ul>
              </>}
            </div>
          ) : (
            <div className="cd-today">
              <h3>Today&apos;s activity</h3>
              {dash?.activity.length ? (
                <ul className="cd-tl">{dash.activity.map((a) => (
                  <li key={a.id}>{a.leadId ? <button type="button" className="link" onClick={() => void loadLead(a.leadId!)}><span>{a.when}</span> {a.text}</button> : <><span>{a.when}</span> {a.text}</>}</li>
                ))}</ul>
              ) : <p className="mut">{dash ? "Nothing yet today." : "Loading…"}</p>}
              <h3>Next follow-ups</h3>
              {dash?.followups.length ? (
                <ul className="cd-tl">{dash.followups.slice(0, 6).map((f) => (
                  <li key={f.id} className={f.overdue ? "late" : ""}><button type="button" className="link" onClick={() => void loadLead(f.leadId)}><span>{f.when}</span> {f.name} — {f.action}</button></li>
                ))}</ul>
              ) : <p className="mut">{dash ? "Nothing pending." : ""}</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
});

export const CRM_CSS = `
.cd { display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1; }
.cd-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.cd-tab { display: inline-flex; align-items: center; gap: 7px; font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 999px; cursor: pointer;
  color: #cbd5e1; background: rgba(10,37,64,.45); border: 1px solid rgba(148,163,184,.18); transition: background .15s, border-color .15s; }
.cd-tab b { font-weight: 600; color: #f8fafc; font-variant-numeric: tabular-nums; }
.cd-tab:hover, .cd-tab:focus-visible { border-color: #2563EB99; outline: none; }
.cd-tab.on { background: #2563EB33; border-color: #2563EB; color: #e0ecff; }
.cd-tab.t-ready b { color: #6ee7b7; } .cd-tab.t-rejected b { color: #fca5a5; } .cd-tab.t-interested b { color: #93c5fd; }
.cd-late { font-style: normal; font-size: 10.5px; color: #fca5a5; }
.cd-pipe { display: flex; flex-direction: column; gap: 6px; }
.cd-bar { display: flex; height: 4px; border-radius: 4px; overflow: hidden; gap: 2px; background: rgba(148,163,184,.12); }
.cd-bar .seg { min-width: 4px; background: #2563EB; } .cd-bar .s-new { background: #475569; } .cd-bar .s-contacted { background: #64748b; } .cd-bar .s-qualified { background: #3b82f6; }
.cd-bar .s-interested { background: #60a5fa; } .cd-bar .s-follow_up { background: #2563EB; } .cd-bar .s-proposal { background: #a78bfa; } .cd-bar .s-won { background: #34d399; } .cd-bar .s-lost { background: #f87171aa; }
.cd-prog { font-size: 11.5px; color: #94a3b8; } .cd-prog b { color: #e2e8f0; font-weight: 600; } .cd-prog .dot { margin: 0 7px; opacity: .5; }
.cd-err, .cd-note { margin: 0; font-size: 12.5px; padding: 6px 10px; border-radius: 10px; display: flex; gap: 8px; align-items: center; }
.cd-err { color: #fecaca; background: #7f1d1d40; } .cd-note.ok { color: #bbf7d0; background: #14532d40; } .cd-note.bad { color: #fecaca; background: #7f1d1d40; }
.cd-err button, .cd-note button { margin-left: auto; font: inherit; font-size: 11px; background: none; border: 0; color: inherit; cursor: pointer; opacity: .8; }
.cd-main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(250px, 40%) 1fr; gap: 12px; }
.cd-left, .cd-right { min-height: 0; overflow: auto; border-radius: 16px; background: rgba(2,10,24,.28); border: 1px solid rgba(148,163,184,.1); padding: 10px; }
.cd-search { width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 7px 12px; border-radius: 999px; border: 1px solid rgba(148,163,184,.22); background: rgba(2,6,23,.5); color: #f1f5f9; }
.cd-search:focus { outline: none; border-color: #2563EB; }
.cd-lt { display: flex; align-items: center; gap: 8px; margin: 10px 2px 6px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #93c5fd; }
.cd-lt span { margin-left: auto; letter-spacing: 0; text-transform: none; color: #64748b; }
.cd-spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #2563EB55; border-top-color: #60a5fa; animation: cd-rot .8s linear infinite; }
@keyframes cd-rot { to { transform: rotate(360deg); } }
.cd-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.cd-row { width: 100%; box-sizing: border-box; text-align: left; display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; padding: 7px 9px; border-radius: 10px;
  border: 1px solid transparent; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.cd-row:hover, .cd-row:focus-visible, .cd-row.sel { background: #2563EB1f; border-color: #2563EB66; outline: none; }
.cd-row .n { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-row em, .cd-lead h2 em { font-style: normal; color: #64748b; font-weight: 500; margin-right: 6px; }
.cd-row .m { grid-column: 1; font-size: 11.5px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-row.fu { display: flex; align-items: center; cursor: default; } .cd-row.fu.late .m { color: #fca5a5; }
.fu-open { flex: 1; min-width: 0; display: grid; text-align: left; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; padding: 0; }
.pill { grid-column: 2; grid-row: 1 / span 2; align-self: center; font-size: 10.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(148,163,184,.3); color: #cbd5e1; white-space: nowrap; }
.pill.s-ready_to_purchase { border-color: #34d39988; color: #6ee7b7; } .pill.s-interested, .pill.s-follow_up { border-color: #2563EBaa; color: #93c5fd; }
.pill.s-lost, .pill.s-not_interested, .pill.s-do_not_contact { border-color: #f8717188; color: #fca5a5; } .pill.s-won { border-color: #34d399; color: #a7f3d0; }
.cd-empty, .mut { color: #64748b; font-size: 12.5px; padding: 8px 4px; margin: 0; }
.mini { font: inherit; font-size: 11px; padding: 3px 9px; border-radius: 999px; border: 1px solid #2563EB77; background: #2563EB1a; color: #dbeafe; cursor: pointer; margin-left: 8px; }
.cd-back { display: none; font: inherit; font-size: 12px; background: none; border: 0; color: #93c5fd; cursor: pointer; padding: 0 0 6px; }
.cd-lead header h2 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: .01em; }
.cd-lead header p { margin: 4px 0 0; font-size: 12px; color: #94a3b8; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.cd-lead header .pill { grid-row: auto; } .cd-lead .pr { color: #64748b; }
.cd-steps { list-style: none; display: flex; gap: 4px; padding: 0; margin: 12px 0 4px; }
.cd-steps li { flex: 1; font-size: 10px; color: #64748b; padding-top: 6px; border-top: 2px solid rgba(148,163,184,.18); text-align: center; }
.cd-steps li.done { border-color: #2563EB88; color: #93c5fd; } .cd-steps li.now { border-color: #60a5fa; color: #e0ecff; font-weight: 600; }
.cd-dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 12px 0 0; font-size: 12.5px; }
.cd-dl dt { color: #94a3b8; } .cd-dl dd { margin: 0; overflow-wrap: anywhere; user-select: text; } .cd-dl a { color: #93c5fd; text-decoration: none; } .cd-dl a:hover { text-decoration: underline; }
.cd-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.cd-acts button, .cd-confirm button { font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 999px; border: 1px solid #2563EB77; background: #2563EB1a; color: #dbeafe; cursor: pointer; }
.cd-acts button:hover:not(:disabled), .cd-acts button:focus-visible { background: #2563EB40; outline: none; } .cd-acts button:disabled { opacity: .45; cursor: default; }
.cd-acts .a-ready { border-color: #34d39988; } .cd-acts .a-rej { border-color: #f8717188; }
.cd-confirm { margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: rgba(10,37,64,.7); border: 1px solid #2563EB66; font-size: 12.5px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cd-confirm .yes { background: #2563EB; color: #fff; }
.cd-notes { font-size: 12.5px; color: #cbd5e1; white-space: pre-wrap; margin: 12px 0 0; user-select: text; }
.cd-right h3 { margin: 16px 0 6px; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #93c5fd; font-weight: 500; }
.cd-today h3:first-child { margin-top: 2px; }
.cd-tl { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: #cbd5e1; }
.cd-tl li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; } .cd-tl li > span, .cd-tl .link > span { color: #64748b; font-size: 11.5px; min-width: 92px; }
.cd-tl li.late { color: #fca5a5; } .cd-tl li.mut { color: #64748b; }
.cd-tl .link { background: none; border: 0; padding: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; display: flex; gap: 6px; } .cd-tl .link:hover { color: #e0ecff; }
@media (max-width: 640px) {
  .cd-main { grid-template-columns: 1fr; }
  .cd-main.has-lead .cd-left { display: none; } .cd-main:not(.has-lead) .cd-right { display: none; }
  .cd-back { display: inline-block; }
}
`;
