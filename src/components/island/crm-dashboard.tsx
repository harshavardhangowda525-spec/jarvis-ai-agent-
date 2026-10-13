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
  /** The mic in the header (same as Ctrl+Shift+R). */
  onMic: () => void;
  micOn: boolean;
  onSettings: () => void;
  onClose: () => void;
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

export const CrmDashboard = forwardRef<CrmHandle, Props>(function CrmDashboard({ active, onSelectLead, onCommand, onMic, micOn, onSettings, onClose }, ref) {
  const [page, setPage] = useState<"overview" | "leads">("overview");
  const [fuIdx, setFuIdx] = useState(0);
  const [menu, setMenu] = useState<"call" | "status" | null>(null);
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
    // results land where you're looking: the overview's business panel, or the lead list
    showResults: (title, leads) => { setResults({ title, leads }); setView("leads"); },
    showFollowups: () => { setView("followups"); setResults(null); void load(); setFuIdx(0); setLeadId(null); setLead(null); onSelectLead(null); },
  }), [load, loadLead, leadId]);

  // load when opened, then keep fresh while open (the last state stays while collapsed)
  useEffect(() => {
    if (!active) return;
    void load();
    const iv = setInterval(() => void load(), 60_000);
    return () => clearInterval(iv);
  }, [active, load]);

  // the overview always shows a lead: the most recently touched one until you pick another
  useEffect(() => {
    if (!leadId && dash?.recent[0]) void loadLead(dash.recent[0].id);
  }, [dash, leadId, loadLead]);

  const logCall = async (outcome: string, label: string) => {
    if (!lead) return;
    setMenu(null); setBusy(true);
    const r = await getJson(`/api/robin/leads/${lead.id}/interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "call", direction: "outbound", outcome, source: "user" }) });
    setBusy(false);
    setNote(r.ok ? { ok: true, text: `Call logged for ${lead.name} — ${label}.` } : { ok: false, text: `Not logged: ${r.error}` });
    void loadLead(lead.id); void load();
  };

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

  const leadsView = (
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

  // ---------------- the overview (the reference layout) ----------------
  const pendingFu = lead ? lead.followUpsAll.filter((f) => f.status === "pending").slice().reverse() : [];
  const fuList = lead ? pendingFu.map((f) => ({ id: f.id, when: f.when, action: f.action })) : (dash?.followups ?? []).map((f) => ({ id: f.id, when: f.when, action: `${f.name} — ${f.action}` }));
  const fu = fuList.length ? fuList[Math.min(fuIdx, fuList.length - 1)] : null;
  const history = lead ? lead.interactions.map((i) => ({ id: i.id, title: `${chan(i.channel)}${i.outcome ? ` · ${i.outcome.replace(/_/g, " ")}` : ""}`, sub: i.notes ?? (i.direction === "inbound" ? "Received" : "Logged"), when: i.when, channel: i.channel }))
    : (dash?.interactions ?? []).map((i) => ({ id: i.id, title: `${i.name} · ${chan(i.channel)}`, sub: i.notes ?? (i.outcome ?? "").replace(/_/g, " "), when: i.when, channel: i.channel }));
  const searching = q.trim().length > 0;

  const overview = (
    <div className="ov">
      <section className="ov-kpis ov-box" aria-label="Lead overview">
        {[["Total Leads", c?.total], ["New", c?.new], ["In Progress", c?.inProgress], ["Qualified", c?.qualified]].map(([k, v]) => (
          <div key={k as string} className="kpi"><span>{k}</span><b>{v ?? "–"}</b></div>
        ))}
      </section>

      <section className="ov-recent ov-box" aria-label="Recent businesses">
        <h4>{results ? <>{results.title} <button type="button" className="clr" onClick={() => setResults(null)} aria-label="Back to recent businesses">✕</button></> : "Recent Businesses"}</h4>
        <ul>
          {(results ? results.leads.map((l) => ({ id: l.id, name: l.name, email: null, phone: l.phone, instagram: null, website: null })) : dash?.recent ?? []).map((r) => (
            <li key={r.id}>
              <button type="button" className={leadId === r.id ? "sel" : ""} onClick={() => void loadLead(r.id)}>
                <i className="ic"><IconBuilding /></i>
                <span className="t"><b>{r.name}</b><small>{r.email ?? r.phone ?? (r.instagram ? `@${handle(r.instagram)}` : null) ?? r.website ?? "no contact on record"}</small></span>
              </button>
            </li>
          ))}
          {dash && !(results ? results.leads.length : dash.recent.length) && <li className="mut">No leads yet.</li>}
        </ul>
      </section>

      <section className="ov-status ov-box" aria-label="Lead statuses">
        <h4>Lead Statuses</h4>
        <div className="cols">
          {([["ready", "Ready to Purchase", c?.ready], ["interested", "Interested (Follow Up)", c?.interested], ["rejected", "Rejected", c?.rejected]] as const).map(([id, label, n]) => (
            <div key={id} className={`col c-${id}`}>
              <button type="button" className="col-h" onClick={() => { pickTab(id); setPage("leads"); }}><i />{label}<em>{n ?? "–"}</em></button>
              <div className="col-b">
                {(dash?.columns[id] ?? []).map((l) => (
                  <button key={l.id} type="button" className={`chip ${leadId === l.id ? "sel" : ""}`} onClick={() => void loadLead(l.id)}>{l.name}</button>
                ))}
                {dash && !dash.columns[id].length && <span className="mut">None</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="ov-prog ov-box" aria-label="Progress tracking">
        <h4>Progress Tracking</h4>
        <div className="tiles">
          <div className="kpi"><span>Demos Scheduled</span><b>{dash?.progress.demosUpcoming ?? "–"}</b></div>
          <div className="kpi"><span>Proposals Sent</span><b>{dash?.progress.proposalsOut ?? "–"}</b></div>
          <div className="kpi"><span>Win Rate</span><b>{dash?.winRate.pct != null ? `${dash.winRate.pct}%` : "–"}</b>
            <i className="bar"><i style={{ width: `${dash?.winRate.pct ?? 0}%` }} /></i>
            <small>{dash ? `${dash.progress.clients} client${dash.progress.clients === 1 ? "" : "s"}` : ""}</small></div>
        </div>
      </section>

      <section className="ov-detail ov-box" aria-label="Lead details">
        <h4>Lead Details</h4>
        {lead ? (
          <>
            <h3 className="nm">{lead.name}</h3>
            <p className="stg"><span className={`pill s-${lead.stage}`}>{lead.stageLabel}</span>{lead.category ? ` ${lead.category}` : ""}</p>
            <dl>
              <div><dt><IconPhone /></dt><dd><small>Phone</small>{lead.phone ?? <span className="mut">—</span>}</dd></div>
              {lead.email && <div><dt><IconMail /></dt><dd><small>Email</small>{lead.email}</dd></div>}
              <div><dt><IconInsta /></dt><dd><small>Instagram</small>{lead.instagram && safeHref(lead.instagram, "ig") ? <a href={safeHref(lead.instagram, "ig")!} target="_blank" rel="noreferrer">@{handle(lead.instagram)}</a> : <span className="mut">—</span>}</dd></div>
              <div><dt><IconGlobe /></dt><dd><small>Website</small>{lead.website && safeHref(lead.website, "web") ? <a href={safeHref(lead.website, "web")!} target="_blank" rel="noreferrer">{lead.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a> : <span className="mut">none</span>}</dd></div>
            </dl>
          </>
        ) : <p className="mut">{dash ? "Pick a business to see its details." : "Loading…"}</p>}
      </section>

      <section className="ov-fu ov-box" aria-label="Follow-up schedule and interaction history">
        <h4>Follow-up Schedule &amp; Interaction History</h4>
        <div className="next">
          <span>Next Follow-up: <b>{fu ? fu.when : "none"}</b>{fu ? <small> · {fu.action}</small> : null}</span>
          <span className="arrows">
            <button type="button" aria-label="Previous follow-up" disabled={fuIdx <= 0} onClick={() => setFuIdx((i) => Math.max(0, i - 1))}>‹</button>
            <button type="button" aria-label="Next follow-up" disabled={fuIdx >= fuList.length - 1} onClick={() => setFuIdx((i) => i + 1)}>›</button>
          </span>
        </div>
        <ul className="hist">
          {history.map((h) => (
            <li key={h.id}><i className="ic">{h.channel === "email" ? <IconMail /> : h.channel === "call" ? <IconPhone /> : h.channel === "instagram" ? <IconInsta /> : <IconNote />}</i>
              <span className="t"><b>{h.title}</b><small>{h.sub}</small></span><em>{h.when}</em></li>
          ))}
          {!history.length && <li className="mut">{lead ? "No interactions logged for this business yet." : "No interactions yet."}</li>}
        </ul>
      </section>

      <section className="ov-act ov-box" aria-label="CRM actions and activity">
        <h4>CRM Actions &amp; Activity Summaries</h4>
        <div className="btns">
          <button type="button" className="pri" disabled={!lead || busy} onClick={() => setMenu(menu === "call" ? null : "call")} aria-expanded={menu === "call"}>Log Call</button>
          {lead?.email
            ? <a className="btn" href={`mailto:${encodeURIComponent(lead.email)}`} title="Opens a draft in your mail app — you send it yourself">Draft Email</a>
            : <button type="button" disabled title="No email on record">Draft Email</button>}
          <button type="button" disabled={!lead || busy} onClick={() => setMenu(menu === "status" ? null : "status")} aria-expanded={menu === "status"}>Update Status</button>
        </div>
        {menu === "call" && lead && (
          <div className="menu" role="menu" aria-label="How did the call go?">
            {[["spoke", "spoke"], ["interested", "interested"], ["no_answer", "no answer"], ["call_later", "call later"], ["not_interested", "not interested"]].map(([o, l]) => (
              <button key={o} type="button" role="menuitem" onClick={() => void logCall(o, l)}>{l}</button>
            ))}
          </div>
        )}
        {menu === "status" && lead && (
          <div className="menu" role="menu" aria-label="New status">
            {[["ready_to_purchase", "Ready to purchase"], ["interested", "Interested"], ["lost", "Rejected"], ["won", "Won"]].map(([st, l]) => (
              <button key={st} type="button" role="menuitem" onClick={() => { setMenu(null); void move(st, l); }}>{l}</button>
            ))}
          </div>
        )}
        {askConfirm && lead && (
          <div className="cd-confirm" role="alertdialog" aria-label="Confirm">
            Mark {lead.name} as <b>{askConfirm.label}</b>?
            <button type="button" className="yes" onClick={() => void move(askConfirm.stage, askConfirm.label, true)}>Yes</button>
            <button type="button" onClick={() => setAskConfirm(null)}>Cancel</button>
          </div>
        )}
        <h5>Today&apos;s Activity</h5>
        <ul className="today">
          {(dash?.activity ?? []).slice(0, 4).map((a) => <li key={a.id}>{a.text}</li>)}
          {dash && !dash.activity.length && <li className="mut">{dash.today}</li>}
        </ul>
      </section>
    </div>
  );

  return (
    <div className="crm">
      <nav className="rail" aria-label="RUBEN">
        <span className="logo" aria-hidden>R</span>
        <button type="button" className={page === "overview" ? "on" : ""} onClick={() => setPage("overview")} aria-label="Overview" title="Overview"><IconHome /></button>
        <button type="button" className={page === "leads" && view === "leads" ? "on" : ""} onClick={() => { setPage("leads"); setView("leads"); }} aria-label="All leads" title="All leads"><IconLeads /></button>
        <button type="button" className={page === "leads" && view === "followups" ? "on" : ""} onClick={() => { setPage("leads"); setView("followups"); }} aria-label="Follow-ups" title="Follow-ups"><IconCalendar /></button>
        <button type="button" onClick={onSettings} aria-label="Settings" title="Settings"><IconGear /></button>
        <span className="grow" />
        <button type="button" onClick={onClose} aria-label="Close CRM" title="Close CRM"><IconExit /></button>
      </nav>
      <div className="crm-main">
        <header className="crm-head">
          <h2>{page === "overview" ? "Lead Overview" : view === "followups" ? "Follow-ups" : "Leads"}</h2>
          <div className="srch">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Businesses, Contacts…" aria-label="Search businesses and contacts" />
            <button type="button" className={`mic ${micOn ? "on" : ""}`} onClick={onMic} aria-label={micOn ? "Stop listening" : "Speak a command"}><IconMic /></button>
            {searching && page === "overview" && (
              <ul className="drop" role="listbox" aria-label="Search results">
                {(dash?.list.leads ?? []).slice(0, 8).map((l) => (
                  <li key={l.id}><button type="button" onClick={() => { void loadLead(l.id); setQ(""); }}><b>{l.name}</b><small>{[l.category, l.city, l.phone].filter(Boolean).join(" · ")}</small></button></li>
                ))}
                {dash && !dash.list.leads.length && <li className="mut">No business matches “{q}”.</li>}
              </ul>
            )}
          </div>
        </header>
        {error && <p className="cd-err" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
        {note && <p className={`cd-note ${note.ok ? "ok" : "bad"}`} role="status">{note.text} <button type="button" aria-label="Dismiss" onClick={() => setNote(null)}>✕</button></p>}
        {page === "overview" ? overview : leadsView}
      </div>
    </div>
  );
});


const chan = (c: string) => ({ call: "Call", email: "Email", whatsapp: "WhatsApp", instagram: "Instagram" } as Record<string, string>)[c] ?? c;
const handle = (ig: string) => ig.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
const Svg = ({ d }: { d: string }) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const IconHome = () => <Svg d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />;
const IconLeads = () => <Svg d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />;
const IconCalendar = () => <Svg d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />;
const IconGear = () => <Svg d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z" />;
const IconExit = () => <Svg d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11" />;
const IconMic = () => <Svg d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />;
const IconBuilding = () => <Svg d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3M3 21h18" />;
const IconPhone = () => <Svg d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />;
const IconMail = () => <Svg d="M3 6h18v12H3zM3 7l9 6 9-6" />;
const IconInsta = () => <Svg d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01" />;
const IconGlobe = () => <Svg d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />;
const IconNote = () => <Svg d="M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h4" />;

export const CRM_CSS = `
.crm { display: flex; flex: 1; min-height: 0; }
.rail { flex: none; width: 52px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 0 12px; border-right: 1px solid rgba(147,197,253,.1); background: rgba(3,12,26,.35); }
.rail .logo { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; font-weight: 800; font-size: 15px; color: #fff; margin-bottom: 10px;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8); box-shadow: 0 0 16px #2563EB66; }
.rail button { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; border: 1px solid transparent; background: none; color: #94a3b8; cursor: pointer; }
.rail button:hover, .rail button:focus-visible { color: #e0ecff; background: rgba(37,99,235,.14); outline: none; }
.rail button.on { color: #e0ecff; background: rgba(37,99,235,.24); border-color: rgba(96,165,250,.35); }
.rail .grow { flex: 1; }
.crm-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px 14px; min-height: 0; }
.crm-head { display: flex; align-items: center; gap: 12px; }
.crm-head h2 { margin: 0; font-size: 16px; font-weight: 600; color: #f1f5f9; letter-spacing: .01em; flex: 1; }
.srch { position: relative; display: flex; align-items: center; width: min(320px, 48%); }
.srch input { width: 100%; font: inherit; font-size: 12.5px; padding: 7px 38px 7px 12px; border-radius: 10px; border: 1px solid rgba(148,163,184,.2); background: rgba(2,8,20,.55); color: #f1f5f9; }
.srch input:focus { outline: none; border-color: #2563EB; }
.srch .mic { position: absolute; right: 4px; width: 28px; height: 26px; border-radius: 8px; border: 0; background: rgba(37,99,235,.18); color: #bfdbfe; cursor: pointer; display: grid; place-items: center; }
.srch .mic.on { background: #2563EB; color: #fff; box-shadow: 0 0 0 3px #2563EB55; }
.drop { position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 5; list-style: none; margin: 0; padding: 6px; border-radius: 12px; max-height: 260px; overflow: auto;
  background: rgba(6,20,40,.97); border: 1px solid rgba(147,197,253,.22); box-shadow: 0 12px 30px rgba(0,0,0,.5); }
.drop button { width: 100%; text-align: left; display: grid; padding: 6px 8px; border-radius: 8px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.drop button:hover, .drop button:focus-visible { background: rgba(37,99,235,.2); outline: none; }
.drop b { font-size: 12.5px; } .drop small { font-size: 11px; color: #94a3b8; }
.ov { flex: 1; min-height: 0; overflow: auto; display: grid; gap: 10px; grid-template-columns: 1fr 1fr 1fr 1.4fr;
  grid-template-areas: "k k k r" "s s s r" "s s s p" "d f f a"; grid-template-rows: auto auto auto minmax(150px, 1fr); }
.ov-detail, .ov-fu, .ov-act { overflow: auto; min-height: 0; }
.ov-box { border-radius: 14px; padding: 9px 11px; background: linear-gradient(160deg, rgba(20,48,84,.42), rgba(5,16,34,.5)); border: 1px solid rgba(147,197,253,.12);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05); min-width: 0; }
.ov-box h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #e2e8f0; letter-spacing: .01em; }
.ov-box h5 { margin: 12px 0 6px; font-size: 11.5px; font-weight: 600; color: #cbd5e1; }
.ov .mut, .ov-box .mut { color: #64748b; font-size: 12px; }
.ov-kpis { grid-area: k; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; background: none; border: 0; box-shadow: none; padding: 0; }
.kpi { border-radius: 12px; padding: 9px 11px; background: linear-gradient(160deg, rgba(20,48,84,.5), rgba(5,16,34,.55)); border: 1px solid rgba(147,197,253,.14); display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.kpi span { font-size: 11px; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kpi b { font-size: 20px; font-weight: 600; color: #f8fafc; font-variant-numeric: tabular-nums; line-height: 1.1; }
.kpi small { font-size: 10.5px; color: #94a3b8; }
.kpi .bar { display: block; height: 3px; border-radius: 3px; background: rgba(148,163,184,.2); overflow: hidden; } .kpi .bar i { display: block; height: 100%; background: linear-gradient(90deg, #2563EB, #60a5fa); }
.ov-recent { grid-area: r; } .ov-recent h4 { display: flex; align-items: center; gap: 8px; } .ov-recent .clr { margin-left: auto; background: none; border: 0; color: #94a3b8; cursor: pointer; font-size: 11px; }
.ov-recent ul, .ov-fu ul, .ov-act ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.ov-recent li > button { width: 100%; display: flex; gap: 9px; align-items: center; padding: 5px 7px; border-radius: 9px; border: 1px solid transparent; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.ov-recent li > button:hover, .ov-recent li > button:focus-visible, .ov-recent li > button.sel { background: rgba(37,99,235,.18); border-color: rgba(96,165,250,.3); outline: none; }
.ic { flex: none; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; color: #93c5fd; background: rgba(37,99,235,.14); font-style: normal; }
.t { min-width: 0; display: flex; flex-direction: column; } .t b { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.t small { font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-status { grid-area: s; }
.cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.col-h { display: flex; align-items: center; gap: 6px; width: 100%; font: inherit; font-size: 11.5px; color: #dbeafe; padding: 4px 8px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(147,197,253,.18); background: rgba(10,37,64,.5); text-align: left; }
.col-h i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; } .col-h em { margin-left: auto; font-style: normal; font-weight: 600; }
.c-ready .col-h { border-color: #2563EB; background: rgba(37,99,235,.28); color: #e0ecff; } .c-ready .col-h i { background: #60a5fa; }
.c-interested .col-h i { background: #93c5fd; } .c-rejected .col-h i { background: #f87171; } .c-rejected .col-h { color: #fecaca; }
.col-b { margin-top: 6px; min-height: 46px; max-height: 92px; overflow: auto; border-radius: 9px; padding: 6px; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 4px; border: 1px solid rgba(147,197,253,.12); background: rgba(37,99,235,.08); }
.c-ready .col-b { background: rgba(37,99,235,.16); border-color: rgba(96,165,250,.35); } .c-rejected .col-b { background: rgba(127,29,29,.18); border-color: rgba(248,113,113,.28); }
.chip { font: inherit; font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(147,197,253,.22); background: rgba(2,8,20,.45); color: #e2e8f0; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip:hover, .chip.sel, .chip:focus-visible { border-color: #60a5fa; background: rgba(37,99,235,.3); outline: none; }
.ov-prog { grid-area: p; } .ov-prog .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; } .ov-prog .kpi b { font-size: 18px; } .ov-prog .kpi { padding: 8px 9px; } .ov-prog .kpi span { white-space: normal; line-height: 1.2; font-size: 10.5px; overflow: visible; }
.ov-detail { grid-area: d; } .ov-detail .nm { margin: 0; font-size: 16px; font-weight: 600; color: #f8fafc; } .ov-detail .stg { margin: 3px 0 6px; font-size: 11.5px; color: #94a3b8; }
.ov-detail .pill { grid-row: auto; }
.ov-detail dl { margin: 0; display: flex; flex-direction: column; gap: 5px; } .ov-detail dl > div { display: flex; gap: 9px; align-items: flex-start; }
.ov-detail dt { color: #93c5fd; padding-top: 2px; } .ov-detail dd { margin: 0; display: flex; flex-direction: column; font-size: 12.5px; color: #e2e8f0; min-width: 0; overflow-wrap: anywhere; user-select: text; }
.ov-detail dd small { font-size: 10.5px; color: #64748b; } .ov-detail a { color: #93c5fd; text-decoration: none; } .ov-detail a:hover { text-decoration: underline; }
.ov-fu { grid-area: f; } .ov-fu .next { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #cbd5e1; margin-bottom: 8px; } .ov-fu .next b { color: #f1f5f9; } .ov-fu .next small { color: #94a3b8; }
.ov-fu .arrows { margin-left: auto; display: flex; gap: 4px; } .ov-fu .arrows button { width: 24px; height: 22px; border-radius: 6px; border: 1px solid rgba(147,197,253,.22); background: rgba(10,37,64,.5); color: #dbeafe; cursor: pointer; }
.ov-fu .arrows button:disabled { opacity: .35; cursor: default; }
.hist li { display: flex; gap: 9px; align-items: center; padding: 4px 0; } .hist em { margin-left: auto; flex: none; font-style: normal; font-size: 10.5px; color: #64748b; }
.ov-act { grid-area: a; } .btns { display: flex; flex-wrap: wrap; gap: 6px; }
.btns button, .btns .btn, .menu button { font: inherit; font-size: 11.5px; padding: 5px 10px; border-radius: 8px; border: 1px solid rgba(147,197,253,.25); background: rgba(10,37,64,.6); color: #dbeafe; cursor: pointer; text-decoration: none; }
.btns .pri { background: #2563EB; border-color: #3b82f6; color: #fff; box-shadow: 0 0 14px #2563EB55; }
.btns button:disabled { opacity: .45; cursor: default; } .btns button:hover:not(:disabled), .btns .btn:hover, .menu button:hover { filter: brightness(1.2); }
.menu { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; padding: 6px; border-radius: 10px; background: rgba(2,8,20,.5); border: 1px solid rgba(147,197,253,.15); }
.today li { position: relative; padding-left: 12px; font-size: 11.5px; color: #cbd5e1; line-height: 1.35; } .today li::before { content: ""; position: absolute; left: 0; top: 6px; width: 5px; height: 5px; border-radius: 50%; background: #60a5fa; }
.today li.mut::before { display: none; } .today li.mut { padding-left: 0; }
@media (max-width: 780px) {
  .ov { grid-template-columns: 1fr 1fr; grid-template-areas: "k k" "r p" "s s" "d f" "a a"; grid-template-rows: none; }
  .ov-kpis { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 520px) { .ov { grid-template-columns: 1fr; grid-template-areas: "k" "r" "s" "p" "d" "f" "a"; grid-template-rows: none; } .rail { display: none; } }

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
