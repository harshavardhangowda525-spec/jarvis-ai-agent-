"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import type { IslandDashboard, IslandLead, IslandLeadFull, IslandStatus } from "@/lib/robin/island-types";
import { CONFIRM_STAGES, STAGES, STAGE_LABEL, type Stage } from "@/lib/robin/types";

/**
 * The CRM inside RUBEN's liquid-glass pop-up, laid out like a classic sales
 * CRM: a dark sidebar (views, smart views with live counts), a light work
 * area with a top bar (back / forward, search, mic), the lead list, and the
 * lead page — status pill, Note / Email / WhatsApp / Call / Follow-up, the
 * lead's tasks, opportunities, contacts and fields on the left, and a
 * summary plus a filterable activity timeline on the right.
 *
 * Everything is read from /api/robin/island/dashboard. Every change goes
 * through the CRM's own endpoints, and the result shown is what the server
 * answered. Decisions (Won / Rejected / Do not contact) ask first. Nothing
 * here contacts a lead: Email opens a draft in your mail app and WhatsApp
 * opens the chat in your app — you send them yourself.
 */

export interface CrmHandle {
  refresh(): void;
  openLead(id: string): void;
  showResults(title: string, leads: IslandLead[]): void;
  showFollowups(): void;
}

interface Props {
  active: boolean;
  /** The mic in the top bar (same as Ctrl+Shift+R). */
  onMic: () => void;
  micOn: boolean;
  onSettings: () => void;
  onClose: () => void;
  onSelectLead: (id: string | null) => void;
  /** Hand a command to RUBEN (pitch, schedule …) about a lead. */
  onCommand: (text: string, leadId?: string) => void;
}

type Route = { v: "list" } | { v: "followups" } | { v: "activities" } | { v: "reporting" } | { v: "lead"; id: string };
const same = (a: Route, b: Route) => a.v === b.v && (a.v !== "lead" || a.id === (b as { id: string }).id);

const SMART: { id: IslandStatus; label: string; count: (c: IslandDashboard["counts"]) => number }[] = [
  { id: "ready", label: "Ready to Purchase", count: (c) => c.ready },
  { id: "interested", label: "Interested (Follow Up)", count: (c) => c.interested },
  { id: "open", label: "Open pipeline", count: (c) => c.open },
  { id: "won", label: "Won", count: (c) => c.won },
  { id: "rejected", label: "Rejected", count: (c) => c.rejected },
  { id: "all", label: "All leads", count: (c) => c.total },
];

const stageLabel = (s: string) => (s === "lost" ? "Rejected" : (STAGE_LABEL as Record<string, string>)[s] ?? s);
const CALL_OUTCOMES: [string, string][] = [["spoke", "Spoke"], ["interested", "Interested"], ["wants_demo", "Wants a demo"], ["wants_quotation", "Wants a quotation"], ["call_later", "Call later"], ["no_answer", "No answer"], ["busy", "Busy"], ["not_interested", "Not interested"], ["wrong_number", "Wrong number"]];

async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return { ok: false, error: j?.error || `RUBEN answered ${r.status}.`, status: r.status };
    return { ok: true, data: j.data as T };
  } catch {
    return { ok: false, error: "RUBEN's server isn't reachable — nothing was changed.", status: 0 };
  }
}
const post = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const safeHref = (raw: string | null, kind: "web" | "ig"): string | null => {
  if (!raw) return null;
  const s = raw.trim();
  if (kind === "ig" && !/^https?:/i.test(s)) return `https://instagram.com/${s.replace(/^@/, "").replace(/[^\w.]/g, "")}`;
  const u = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
};
const waHref = (n: string | null) => { const d = (n ?? "").replace(/\D/g, ""); return d.length >= 8 ? `https://wa.me/${d}` : null; };
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };

/** One entry on the lead's timeline, built only from what the CRM recorded. */
interface Ev { id: string; at: string; when: string; kind: "call" | "message" | "stage" | "task" | "note" | "deal"; title: ReactNode; /** plain text for the activity search */ s: string; body?: string | null; tag?: string | null; late?: boolean }

export function timeline(l: IslandLeadFull): Ev[] {
  const ev: Ev[] = [];
  for (const i of l.interactions) {
    ev.push({ id: `i${i.id}`, at: i.at, when: i.when, kind: i.channel === "call" ? "call" : "message", s: `${i.direction} ${chan(i.channel)}`,
      title: <>{i.direction === "inbound" ? "Inbound" : "Outbound"} {chan(i.channel).toLowerCase()}</>, tag: i.outcome?.replace(/_/g, " ") ?? null, body: i.notes });
  }
  for (const m of l.stageHistory) ev.push({ id: `s${m.at}${m.to}`, at: m.at, when: m.when, kind: "stage", s: `status changed ${m.from ?? ""} ${m.to}`, title: <>Status changed {m.from ? <><b>{m.from}</b> → </> : "to "}<b>{m.to}</b></> });
  for (const f of l.followUpsAll) {
    if (f.status === "completed") ev.push({ id: `f${f.id}`, at: f.doneAt ?? f.at, when: f.doneAt ? day(f.doneAt) : f.when, kind: "task", s: `task completed ${f.action}`, title: <>Task completed: {f.action}</>, body: f.notes });
    else if (f.status === "pending") ev.push({ id: `f${f.id}`, at: f.at, when: f.when, kind: "task", s: `follow-up due ${f.action}`, title: <>Follow-up due: {f.action}</>, body: f.notes, late: f.overdue, tag: f.overdue ? "overdue" : "pending" });
    else ev.push({ id: `f${f.id}`, at: f.at, when: f.when, kind: "task", s: `follow-up ${f.status} ${f.action}`, title: <>Follow-up {f.status}: {f.action}</>, body: f.notes });
  }
  for (const d of l.demos) ev.push({ id: `d${d.id}`, at: d.at, when: d.when, kind: "deal", s: `demo ${d.type}`, title: <>Demo ({d.type})</>, tag: d.status });
  for (const x of l.quotations) ev.push({ id: `q${x.id}`, at: x.at, when: x.when, kind: "deal", s: `quotation ${x.number} ${x.currency} ${x.total}`, title: <>Quotation {x.number} · {x.currency} {x.total.toLocaleString()}</>, tag: x.status });
  // notes saved on the lead are stamped "YYYY-MM-DD: text"
  (l.notes ?? "").split("\n").map((s) => s.trim()).filter(Boolean).forEach((line, k) => {
    const m = /^(\d{4}-\d{2}-\d{2}):\s*(.*)$/.exec(line);
    const at = m ? `${m[1]}T12:00:00.000Z` : l.createdAt;
    ev.push({ id: `n${k}`, at, when: day(at), kind: "note", s: "note", title: "Note", body: m ? m[2] : line });
  });
  ev.push({ id: "created", at: l.createdAt, when: day(l.createdAt), kind: "stage", s: "lead added", title: "Lead added to the CRM" });
  return ev.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

const FILTERS: { id: "all" | Ev["kind"] | "comms"; label: string }[] = [
  { id: "all", label: "All" }, { id: "comms", label: "Calls & messages" }, { id: "stage", label: "Status changes" }, { id: "task", label: "Tasks" }, { id: "note", label: "Notes" },
];

export const CrmDashboard = forwardRef<CrmHandle, Props>(function CrmDashboard({ active, onSelectLead, onCommand, onMic, micOn, onSettings, onClose }, ref) {
  const [hist, setHist] = useState<{ stack: Route[]; i: number }>({ stack: [{ v: "list" }], i: 0 });
  const route = hist.stack[hist.i];
  const [collapsed, setCollapsed] = useState(false);
  const [dash, setDash] = useState<IslandDashboard | null>(null);
  const [status, setStatus] = useState<IslandStatus>("open");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ title: string; leads: IslandLead[] } | null>(null);
  const [lead, setLead] = useState<IslandLeadFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [askConfirm, setAskConfirm] = useState<{ stage: string; label: string } | null>(null);
  const [menu, setMenu] = useState<"status" | "call" | "more" | null>(null);
  const [composer, setComposer] = useState(false);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"details" | "notes">("details");
  const [closedSecs, setClosedSecs] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [tq, setTq] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const leadId = route.v === "lead" ? route.id : null;

  const go = useCallback((r: Route) => {
    setHist((h) => (same(h.stack[h.i], r) ? h : { stack: [...h.stack.slice(0, h.i + 1), r].slice(-30), i: Math.min(h.i + 1, 29) }));
    setMenu(null); setAskConfirm(null);
  }, []);

  const load = useCallback(async (s = status, query = q) => {
    const my = ++seq.current;
    setLoading(true);
    const r = await getJson<IslandDashboard>(`/api/robin/island/dashboard?status=${s}&q=${encodeURIComponent(query)}`);
    if (my !== seq.current) return;
    setLoading(false);
    if (r.ok) { setDash(r.data); setError(null); } else setError(r.error);
  }, [status, q]);

  const loadLead = useCallback(async (id: string) => {
    const r = await getJson<{ lead: IslandLeadFull }>(`/api/robin/island/dashboard?lead=${encodeURIComponent(id)}`);
    if (r.ok) setLead(r.data.lead); else { setLead(null); setNote({ ok: false, text: r.error }); }
  }, []);

  // the page follows the route; RUBEN's "this lead" follows the page
  useEffect(() => {
    onSelectLead(leadId);
    if (leadId) { if (lead?.id !== leadId) setLead(null); void loadLead(leadId); setComposer(false); setTq(""); }
  }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    refresh: () => { void load(); if (leadId) void loadLead(leadId); },
    openLead: (id) => { go({ v: "lead", id }); void load(); },
    showResults: (title, leads) => { setResults({ title, leads }); go({ v: "list" }); },
    showFollowups: () => { go({ v: "followups" }); void load(); },
  }), [load, loadLead, leadId, go]);

  // load when opened, then keep fresh while open (the last state stays while collapsed)
  useEffect(() => {
    if (!active) return;
    void load();
    const iv = setInterval(() => void load(), 60_000);
    return () => clearInterval(iv);
  }, [active, load]);

  // search as you type — results show in the list
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { setResults(null); void load(status, q); if (q.trim()) go({ v: "list" }); }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickView = (s: IslandStatus) => { setStatus(s); setResults(null); go({ v: "list" }); void load(s, q); };
  const after = () => { if (leadId) void loadLead(leadId); void load(); };

  const move = async (stage: string, label: string, confirmed = false) => {
    if (!lead) return;
    setMenu(null);
    if (!confirmed && (CONFIRM_STAGES as readonly string[]).includes(stage)) { setAskConfirm({ stage, label }); return; }
    setAskConfirm(null); setBusy(true);
    const r = await getJson<{ moved: { changed: boolean } | null }>(`/api/robin/leads/${lead.id}`, post({ stage, confirm: confirmed || undefined, source: "user" }, "PATCH"));
    setBusy(false);
    if (r.ok) setNote({ ok: true, text: r.data.moved?.changed === false ? `${lead.name} is already ${label}.` : `Saved — ${lead.name} is now ${label}.` });
    else setNote({ ok: false, text: `Not saved: ${r.error}` });
    after();
  };

  const logCall = async (outcome: string, label: string) => {
    if (!lead) return;
    setMenu(null); setBusy(true);
    const r = await getJson(`/api/robin/leads/${lead.id}/interactions`, post({ channel: "call", direction: "outbound", outcome, source: "user" }));
    setBusy(false);
    setNote(r.ok ? { ok: true, text: `Call logged for ${lead.name} — ${label.toLowerCase()}.` } : { ok: false, text: `Not logged: ${r.error}` });
    after();
  };

  const saveNote = async () => {
    if (!lead || !draft.trim()) return;
    setBusy(true);
    const r = await getJson<{ on: "lead" | "followup" }>(`/api/robin/leads/${lead.id}/notes`, post({ text: draft, source: "user" }));
    setBusy(false);
    if (r.ok) { setDraft(""); setComposer(false); setNote({ ok: true, text: r.data.on === "followup" ? "Note saved on the next follow-up." : "Note saved." }); }
    else setNote({ ok: false, text: `Not saved: ${r.error}` });
    after();
  };

  const completeFollowUp = async (id: string) => {
    setBusy(true);
    const r = await getJson(`/api/robin/followups/${id}`, post({ action: "complete", source: "user" }, "PATCH"));
    setBusy(false);
    setNote(r.ok ? { ok: true, text: "Follow-up marked done." } : { ok: false, text: `Not saved: ${r.error}` });
    after();
  };

  const c = dash?.counts;
  const events = useMemo(() => (lead ? timeline(lead) : []), [lead]);
  const shown = events.filter((e) => (filter === "all" || (filter === "comms" ? e.kind === "call" || e.kind === "message" : e.kind === filter))
    && (!tq.trim() || `${e.s} ${e.body ?? ""} ${e.tag ?? ""} ${e.kind}`.toLowerCase().includes(tq.trim().toLowerCase())));
  const toggle = (k: string) => setClosedSecs((s) => ({ ...s, [k]: !s[k] }));

  // ---------------- sidebar ----------------
  const sidebar = (
    <nav className="sb" aria-label="RUBEN CRM">
      <div className="sb-me"><span className="sb-av" aria-hidden>R</span><span className="sb-l"><b>RUBEN</b><small>Sales CRM</small></span></div>
      <NavBtn on={route.v === "list" && !results && status === "all"} icon={<IconLeads />} label="Leads" n={c?.total} onClick={() => pickView("all")} />
      <NavBtn on={route.v === "followups"} icon={<IconCheck />} label="Follow-ups" n={c ? c.dueToday + c.overdue : undefined} warn={!!c?.overdue} onClick={() => { go({ v: "followups" }); void load(); }} />
      <NavBtn on={route.v === "activities"} icon={<IconPulse />} label="Activities" onClick={() => { go({ v: "activities" }); void load(); }} />
      <NavBtn on={route.v === "reporting"} icon={<IconChart />} label="Reporting" onClick={() => { go({ v: "reporting" }); void load(); }} />
      <div className="sb-h">Smart views</div>
      {SMART.filter((s) => s.id !== "all").map((s) => (
        <NavBtn key={s.id} on={route.v === "list" && !results && status === s.id} icon={<i className={`dot d-${s.id}`} />} label={s.label} n={c ? s.count(c) : undefined} onClick={() => pickView(s.id)} />
      ))}
      <span className="sb-grow" />
      <NavBtn on={false} icon={<IconGear />} label="Settings" onClick={onSettings} />
      <NavBtn on={false} icon={<IconCollapse />} label={collapsed ? "Expand" : "Collapse"} onClick={() => setCollapsed((v) => !v)} />
      <NavBtn on={false} icon={<IconExit />} label="Close CRM" onClick={onClose} />
    </nav>
  );

  // ---------------- top bar ----------------
  const topbar = (
    <header className="tb">
      <button type="button" className="tb-b" disabled={hist.i <= 0} onClick={() => setHist((h) => ({ ...h, i: Math.max(0, h.i - 1) }))} aria-label="Back">‹</button>
      <button type="button" className="tb-b" disabled={hist.i >= hist.stack.length - 1} onClick={() => setHist((h) => ({ ...h, i: Math.min(h.stack.length - 1, h.i + 1) }))} aria-label="Forward">›</button>
      <label className="tb-s"><IconSearch /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads — name, phone, Instagram, website, city…" aria-label="Search leads" />{loading && <i className="spin" aria-label="Loading" />}</label>
      <button type="button" className={`tb-b mic ${micOn ? "on" : ""}`} onClick={onMic} aria-label={micOn ? "Stop listening" : "Speak a command"} title="Speak to RUBEN"><IconMic /></button>
    </header>
  );

  // ---------------- lead list ----------------
  const rows = results?.leads ?? dash?.list.leads ?? [];
  const listTitle = results ? results.title : q.trim() ? `Search · “${q.trim()}”` : SMART.find((s) => s.id === status)?.label ?? "Leads";
  const listView = (
    <div className="pg">
      <div className="pg-h"><h2>{listTitle}</h2><span className="mut">{results ? `${results.leads.length} result${results.leads.length === 1 ? "" : "s"}` : dash ? `${Math.min(dash.list.total, dash.list.leads.length)} of ${dash.list.total}` : ""}</span>
        {results && <button type="button" className="lnk" onClick={() => setResults(null)}>Clear</button>}</div>
      <div className="tbl" role="table" aria-label="Leads">
        <div className="tr th" role="row"><span role="columnheader">Lead</span><span role="columnheader">Status</span><span role="columnheader">Last contact</span><span role="columnheader">Next follow-up</span></div>
        {rows.map((l) => (
          <button key={l.id} type="button" className="tr" role="row" onClick={() => go({ v: "lead", id: l.id })}>
            <span className="nm"><i className="lg" aria-hidden>{initial(l.name)}</i><span><b>{l.name}</b><small>{[l.number != null ? `#${l.number}` : null, l.category, l.city].filter(Boolean).join(" · ")}</small></span></span>
            <span><i className={`pill s-${l.stage}`}>{l.stageLabel}</i></span>
            <span className="mut">{l.lastContact ?? "never"}</span>
            <span className="mut">{l.nextFollowUp ?? "—"}</span>
          </button>
        ))}
        {dash && !rows.length && <p className="empty">{q ? "No lead matches that search." : "No leads in this view."}</p>}
        {!dash && !error && <p className="empty">Loading…</p>}
      </div>
    </div>
  );

  const followupsView = (
    <div className="pg">
      <div className="pg-h"><h2>Follow-ups</h2><span className="mut">{c ? `${c.overdue} overdue · ${c.dueToday} due today` : ""}</span></div>
      <ul className="cards">
        {(dash?.followups ?? []).map((f) => (
          <li key={f.id} className={f.overdue ? "late" : ""}>
            <span className="chk" aria-hidden><IconCheck /></span>
            <button type="button" className="grow" onClick={() => go({ v: "lead", id: f.leadId })}><b>{f.action}</b> — {f.name}<small>{f.overdue ? "Overdue · " : ""}{f.when}{f.notes ? ` · ${f.notes.slice(0, 80)}` : ""}</small></button>
            <button type="button" className="btn sm" disabled={busy} onClick={() => void completeFollowUp(f.id)}>Done</button>
          </li>
        ))}
        {dash && !dash.followups.length && <p className="empty">No follow-ups pending.</p>}
      </ul>
    </div>
  );

  const activitiesView = (
    <div className="pg">
      <div className="pg-h"><h2>Activities</h2><span className="mut">{dash?.today}</span></div>
      <h3 className="sec-t">Today</h3>
      <ul className="tl">
        {(dash?.activity ?? []).map((a) => (
          <li key={a.id} className="k-stage"><span className="tl-ic"><IconPulse /></span>
            <div className="tl-b">{a.leadId ? <button type="button" className="lnk" onClick={() => go({ v: "lead", id: a.leadId! })}>{a.text}</button> : a.text}</div><em>{a.when}</em></li>
        ))}
        {dash && !dash.activity.length && <p className="empty">Nothing yet today.</p>}
      </ul>
      <h3 className="sec-t">Latest calls &amp; messages</h3>
      <ul className="tl">
        {(dash?.interactions ?? []).map((i) => (
          <li key={i.id} className={i.channel === "call" ? "k-call" : "k-message"}><span className="tl-ic">{i.channel === "call" ? <IconPhone /> : i.channel === "email" ? <IconMail /> : <IconChat />}</span>
            <div className="tl-b"><button type="button" className="lnk" onClick={() => go({ v: "lead", id: i.leadId })}><b>{i.name}</b></button> · {i.direction === "inbound" ? "inbound" : "outbound"} {chan(i.channel).toLowerCase()}
              {i.outcome && <i className="tag">{i.outcome.replace(/_/g, " ")}</i>}{i.notes && <p>{i.notes}</p>}</div><em>{i.when}</em></li>
        ))}
        {dash && !dash.interactions.length && <p className="empty">No calls or messages logged yet.</p>}
      </ul>
    </div>
  );

  const reportingView = (
    <div className="pg">
      <div className="pg-h"><h2>Reporting</h2><span className="mut">{dash?.today}</span></div>
      <div className="kpis">
        {([["Total leads", c?.total], ["New", c?.new], ["In progress", c?.inProgress], ["Qualified", c?.qualified], ["Ready to purchase", c?.ready], ["Won", c?.won],
          ["Win rate", dash?.winRate.pct != null ? `${dash.winRate.pct}%` : "–"], ["Demos upcoming", dash?.progress.demosUpcoming], ["Proposals out", dash?.progress.proposalsOut], ["Clients", dash?.progress.clients]] as [string, number | string | undefined][]).map(([k, v]) => (
          <div key={k} className="kpi"><span>{k}</span><b>{v ?? "–"}</b></div>
        ))}
      </div>
      <h3 className="sec-t">Pipeline</h3>
      <ul className="bars">
        {(dash?.pipeline ?? []).map((p) => {
          const max = Math.max(1, ...(dash?.pipeline ?? []).map((x) => x.count));
          return <li key={p.id}><span>{p.label}</span><i><i className={`seg s-${p.id}`} style={{ width: `${(p.count / max) * 100}%` }} /></i><b>{p.count}</b></li>;
        })}
      </ul>
      {dash && <p className="mut small">Win rate = won ÷ decided ({dash.winRate.won} of {dash.winRate.decided}). Demos done {dash.progress.demosDone} · proposals accepted {dash.progress.proposalsAccepted}.</p>}
    </div>
  );

  // ---------------- the lead page ----------------
  const leadView = lead ? (() => {
    const pending = lead.followUpsAll.filter((f) => f.status === "pending").slice().sort((a, b) => (a.at < b.at ? -1 : 1));
    const wa = waHref(lead.whatsapp ?? lead.phone);
    const web = safeHref(lead.website, "web"), ig = safeHref(lead.instagram, "ig");
    const opps = lead.quotations.length + lead.demos.length + (lead.client ? 1 : 0) + (lead.potentialValue != null ? 1 : 0);
    const summary = [
      `${lead.stageLabel} since ${day(lead.stageSince)}.`,
      lead.interactions.length ? `${lead.interactions.length} call${lead.interactions.length === 1 ? "" : "s"} / message${lead.interactions.length === 1 ? "" : "s"} logged, last contact ${lead.lastContact ?? lead.interactions[0].when}.` : "No calls or messages logged yet.",
      pending.length ? `Next follow-up ${pending[0].when} (${pending[0].action})${pending.some((f) => f.overdue) ? " — overdue" : ""}.` : "No follow-up scheduled.",
      lead.client ? `Client · ${lead.client.status}, payment ${lead.client.paymentStatus}.` : lead.quotations[0] ? `Quotation ${lead.quotations[0].number} is ${lead.quotations[0].status}.` : null,
    ].filter(Boolean).join(" ");
    return (
      <div className="ld">
        <header className="ld-h">
          <i className="lg big" aria-hidden>{initial(lead.name)}</i>
          <div className="ld-t"><h2>{lead.name}</h2><small>{[lead.number != null ? `#${lead.number}` : null, lead.category, lead.city].filter(Boolean).join(" · ")}</small></div>
          <div className="dd">
            <button type="button" className={`pill big s-${lead.stage}`} disabled={busy} onClick={() => setMenu(menu === "status" ? null : "status")} aria-haspopup="menu" aria-expanded={menu === "status"}>{lead.stageLabel} <span aria-hidden>▾</span></button>
            {menu === "status" && (
              <div className="pop right" role="menu" aria-label="Change status">
                {(STAGES as readonly Stage[]).map((s) => (
                  <button key={s} type="button" role="menuitem" className={s === lead.stage ? "on" : ""} onClick={() => void move(s, stageLabel(s))}><i className={`pill s-${s}`}>{stageLabel(s)}</i></button>
                ))}
              </div>
            )}
          </div>
          <div className="dd">
            <button type="button" className="tb-b" onClick={() => setMenu(menu === "more" ? null : "more")} aria-label="More actions" aria-haspopup="menu" aria-expanded={menu === "more"}>…</button>
            {menu === "more" && (
              <div className="pop right" role="menu" aria-label="More actions">
                <button type="button" role="menuitem" onClick={() => { setMenu(null); onCommand("prepare a pitch for this business", lead.id); }}>Prepare a pitch</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(null); onCommand("schedule a follow-up for next week", lead.id); }}>Follow up next week</button>
                {lead.mapsUrl && safeHref(lead.mapsUrl, "web") && <a role="menuitem" href={safeHref(lead.mapsUrl, "web")!} target="_blank" rel="noreferrer">Open in Maps</a>}
              </div>
            )}
          </div>
        </header>

        <div className="acts">
          <button type="button" className={composer ? "on" : ""} onClick={() => { setComposer((v) => !v); setTab("notes"); }}><IconNote />Note</button>
          {lead.email
            ? <a href={`mailto:${encodeURIComponent(lead.email)}`} target="_blank" rel="noreferrer" title="Opens a draft in your mail app — you send it yourself"><IconMail />Email</a>
            : <button type="button" disabled title="No email on record"><IconMail />Email</button>}
          {wa
            ? <a href={wa} target="_blank" rel="noreferrer" title="Opens the chat in WhatsApp — you send the message yourself"><IconChat />WhatsApp</a>
            : <button type="button" disabled title="No WhatsApp or phone number on record"><IconChat />WhatsApp</button>}
          <div className="dd">
            <button type="button" disabled={busy} className={menu === "call" ? "on" : ""} onClick={() => setMenu(menu === "call" ? null : "call")} aria-haspopup="menu" aria-expanded={menu === "call"} title="Log how a call went"><IconPhone />Call</button>
            {menu === "call" && (
              <div className="pop" role="menu" aria-label="How did the call go?">
                <span className="pop-t">Log the call — how did it go?</span>
                {CALL_OUTCOMES.map(([o, l]) => <button key={o} type="button" role="menuitem" onClick={() => void logCall(o, l)}>{l}</button>)}
              </div>
            )}
          </div>
          <button type="button" disabled={busy} onClick={() => onCommand("schedule a follow-up for tomorrow", lead.id)} title="RUBEN schedules a follow-up for tomorrow"><IconCalendar />Follow-up</button>
        </div>

        {askConfirm && (
          <div className="confirm" role="alertdialog" aria-label="Confirm">
            Mark <b>{lead.name}</b> as <b>{askConfirm.label}</b>?
            <button type="button" className="btn pri sm" onClick={() => void move(askConfirm.stage, askConfirm.label, true)}>Yes, mark it</button>
            <button type="button" className="btn sm" onClick={() => setAskConfirm(null)}>Cancel</button>
          </div>
        )}

        <div className="ld-cols">
          <aside className="ld-l">
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "details"} className={tab === "details" ? "on" : ""} onClick={() => setTab("details")}>Details</button>
              <button type="button" role="tab" aria-selected={tab === "notes"} className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>Notes</button>
            </div>
            {tab === "details" ? (
              <>
                <Sec k="tasks" closed={closedSecs} onToggle={toggle} title="Tasks" n={pending.length}>
                  {pending.length ? pending.map((f) => (
                    <div key={f.id} className={`task ${f.overdue ? "late" : ""}`}>
                      <button type="button" className="chk" disabled={busy} onClick={() => void completeFollowUp(f.id)} aria-label={`Mark "${f.action}" done`} title="Mark done"><IconCheck /></button>
                      <span><b>{f.action}</b><small>{f.overdue ? "Overdue · " : "Due "}{f.when}</small>{f.notes && <small className="nt">{f.notes}</small>}</span>
                    </div>
                  )) : <p className="mut">No open tasks.</p>}
                </Sec>
                <Sec k="opps" closed={closedSecs} onToggle={toggle} title="Opportunities" n={opps}>
                  {lead.potentialValue != null && <div className="kv"><span>Potential value</span><b>{lead.potentialValue.toLocaleString()}</b></div>}
                  {lead.serviceInterest && <div className="kv"><span>Interested in</span><b>{lead.serviceInterest}</b></div>}
                  {lead.quotations.map((x) => <div key={x.id} className="kv"><span>Quotation {x.number}</span><b>{x.currency} {x.total.toLocaleString()} <i className="tag">{x.status}</i></b></div>)}
                  {lead.demos.map((d) => <div key={d.id} className="kv"><span>Demo · {d.type}</span><b>{d.when} <i className="tag">{d.status}</i></b></div>)}
                  {lead.client && <div className="kv"><span>Client</span><b>{lead.client.currency} {lead.client.amount.toLocaleString()} <i className="tag">{lead.client.paymentStatus}</i>{lead.client.project ? ` · ${lead.client.project}` : ""}</b></div>}
                  {!opps && !lead.serviceInterest && <p className="mut">No quotation, demo or deal yet.</p>}
                </Sec>
                <Sec k="contacts" closed={closedSecs} onToggle={toggle} title="Contacts">
                  <div className="ct"><IconPhone /><span>{lead.phone ?? <i className="mut">no phone</i>}</span></div>
                  {lead.whatsapp && lead.whatsapp !== lead.phone && <div className="ct"><IconChat /><span>{lead.whatsapp}</span></div>}
                  <div className="ct"><IconMail /><span>{lead.email ?? <i className="mut">no email</i>}</span></div>
                  <div className="ct"><IconInsta /><span>{ig ? <a href={ig} target="_blank" rel="noreferrer">@{handle(lead.instagram!)}</a> : <i className="mut">no Instagram</i>}</span></div>
                  <div className="ct"><IconGlobe /><span>{web ? <a href={web} target="_blank" rel="noreferrer">{lead.website!.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a> : <i className="mut">no website</i>}</span></div>
                </Sec>
                <Sec k="fields" closed={closedSecs} onToggle={toggle} title="Custom fields">
                  {([["Category", lead.category], ["City", lead.city], ["Address", lead.address], ["Priority", lead.priority.replace(/_/g, " ")], ["Score", String(lead.score)], ["Added", day(lead.createdAt)]] as [string, string | null][])
                    .map(([k, v]) => <div key={k} className="kv"><span>{k}</span><b>{v || <i className="mut">—</i>}</b></div>)}
                </Sec>
              </>
            ) : (
              <div className="notes">
                {composer || !lead.notes ? (
                  <form onSubmit={(e) => { e.preventDefault(); void saveNote(); }}>
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} rows={4} placeholder="Write a note about this lead…" aria-label="New note" autoFocus={composer} />
                    <div className="row"><span className="mut small">{pending.length ? "Saved on the next follow-up" : "Saved on the lead"}</span>
                      <button type="submit" className="btn pri sm" disabled={busy || !draft.trim()}>Save note</button></div>
                  </form>
                ) : <button type="button" className="btn sm" onClick={() => setComposer(true)}>+ New note</button>}
                {events.filter((e) => e.kind === "note" || (e.kind === "task" && e.body)).map((e) => (
                  <div key={e.id} className="note"><small>{e.when}{e.kind === "task" ? " · on a follow-up" : ""}</small><p>{e.body}</p></div>
                ))}
              </div>
            )}
          </aside>

          <section className="ld-r" aria-label="Activity">
            <div className="sum"><b>Summary</b><p>{summary}</p></div>
            <div className="flt">
              <div className="chips" role="tablist" aria-label="Filter activity">
                {FILTERS.map((f) => <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>{f.label}</button>)}
              </div>
              <label className="tb-s sm"><IconSearch /><input type="search" value={tq} onChange={(e) => setTq(e.target.value)} placeholder="Search activity" aria-label="Search activity" /></label>
            </div>
            <ul className="tl">
              {shown.map((e) => (
                <li key={e.id} className={`k-${e.kind} ${e.late ? "late" : ""}`}>
                  <span className="tl-ic">{e.kind === "call" ? <IconPhone /> : e.kind === "message" ? <IconChat /> : e.kind === "task" ? <IconCheck /> : e.kind === "note" ? <IconNote /> : e.kind === "deal" ? <IconChart /> : <IconFlag />}</span>
                  <div className="tl-b"><span>{e.title}</span>{e.tag && <i className="tag">{e.tag}</i>}{e.body && <p>{e.body}</p>}</div>
                  <em>{e.when}</em>
                </li>
              ))}
              {!shown.length && <p className="empty">{tq ? "Nothing matches that search." : "Nothing here yet."}</p>}
            </ul>
          </section>
        </div>
      </div>
    );
  })() : <div className="pg"><p className="empty">Loading the lead…</p></div>;

  return (
    <div className={`crm ${collapsed ? "mini" : ""}`} onKeyDown={(e) => { if (e.key === "Escape" && (menu || askConfirm)) { e.stopPropagation(); setMenu(null); setAskConfirm(null); } }}>
      {sidebar}
      <div className="wk">
        {topbar}
        {error && <p className="flash bad" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
        {note && <p className={`flash ${note.ok ? "ok" : "bad"}`} role="status">{note.text} <button type="button" aria-label="Dismiss" onClick={() => setNote(null)}>✕</button></p>}
        <div className="wk-b">
          {route.v === "lead" ? leadView : route.v === "followups" ? followupsView : route.v === "activities" ? activitiesView : route.v === "reporting" ? reportingView : listView}
        </div>
      </div>
    </div>
  );
});

function NavBtn({ on, icon, label, n, onClick, warn }: { on: boolean; icon: ReactNode; label: string; n?: number | string; onClick: () => void; warn?: boolean }) {
  return (
    <button type="button" className={`sb-i ${on ? "on" : ""}`} onClick={onClick} title={label} aria-current={on ? "page" : undefined}>
      <span className="sb-ic">{icon}</span><span className="sb-l">{label}</span>{n != null && <em className={warn ? "warn" : ""}>{n}</em>}
    </button>
  );
}

/** A collapsible section of the lead's left column (TASKS, CONTACTS …). */
function Sec({ k, title, n, closed, onToggle, children }: { k: string; title: string; n?: number; closed: Record<string, boolean>; onToggle: (k: string) => void; children: ReactNode }) {
  return (
    <section className="sec">
      <button type="button" className="sec-h" onClick={() => onToggle(k)} aria-expanded={!closed[k]}><i className={closed[k] ? "" : "open"} aria-hidden>›</i>{title}{n != null && <em>{n}</em>}</button>
      {!closed[k] && <div className="sec-b">{children}</div>}
    </section>
  );
}

const chan = (c: string) => ({ call: "Call", email: "Email", whatsapp: "WhatsApp", instagram: "Instagram DM" } as Record<string, string>)[c] ?? c;
const handle = (ig: string) => ig.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
const initial = (name: string) => (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "•").toUpperCase();
const Svg = ({ d }: { d: string }) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const IconLeads = () => <Svg d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />;
const IconCalendar = () => <Svg d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />;
const IconCheck = () => <Svg d="M20 6 9 17l-5-5" />;
const IconPulse = () => <Svg d="M3 12h4l3-8 4 16 3-8h4" />;
const IconChart = () => <Svg d="M4 20V10M10 20V4M16 20v-7M22 20H2" />;
const IconFlag = () => <Svg d="M5 21V4M5 4h11l-2 4 2 4H5" />;
const IconCollapse = () => <Svg d="M4 4h16v16H4zM9 4v16M15 10l-2 2 2 2" />;
const IconSearch = () => <Svg d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5" />;
const IconChat = () => <Svg d="M4 5h16v11H9l-5 4z" />;
const IconGear = () => <Svg d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z" />;
const IconExit = () => <Svg d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11" />;
const IconMic = () => <Svg d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />;
const IconPhone = () => <Svg d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />;
const IconMail = () => <Svg d="M3 6h18v12H3zM3 7l9 6 9-6" />;
const IconInsta = () => <Svg d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01" />;
const IconGlobe = () => <Svg d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />;
const IconNote = () => <Svg d="M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h4" />;

export const CRM_CSS = `
.crm { display: flex; flex: 1; min-height: 0; font-size: 13px; color: #0f172a; }
/* the dark sidebar */
.sb { flex: none; width: 184px; display: flex; flex-direction: column; gap: 1px; padding: 12px 8px; overflow-y: auto; overflow-x: hidden;
  background: linear-gradient(180deg, rgba(15,23,42,.94), rgba(8,13,28,.96)); border-right: 1px solid rgba(148,163,184,.12); color: #cbd5e1; }
.sb-me { display: flex; align-items: center; gap: 9px; padding: 4px 6px 12px; }
.sb-av { flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; font-weight: 800; color: #fff; background: linear-gradient(135deg, #3b82f6, #1d4ed8); box-shadow: 0 0 14px #2563EB66; }
.sb-me .sb-l { display: flex; flex-direction: column; line-height: 1.15; } .sb-me b { color: #f8fafc; font-size: 13px; letter-spacing: .06em; } .sb-me small { color: #64748b; font-size: 11px; }
.sb-i { display: flex; align-items: center; gap: 9px; width: 100%; padding: 6px 8px; border-radius: 8px; border: 0; background: none; color: inherit; font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; white-space: nowrap; }
.sb-i:hover, .sb-i:focus-visible { background: rgba(148,163,184,.12); color: #f1f5f9; outline: none; }
.sb-i.on { background: rgba(37,99,235,.28); color: #fff; }
.sb-ic { flex: none; width: 16px; display: grid; place-items: center; color: #94a3b8; } .sb-i.on .sb-ic { color: #bfdbfe; }
.sb-l { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.sb-i em { font-style: normal; font-size: 11px; color: #94a3b8; font-variant-numeric: tabular-nums; } .sb-i em.warn { color: #fca5a5; }
.sb-h { margin: 14px 8px 4px; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: #64748b; white-space: nowrap; }
.sb-grow { flex: 1; min-height: 10px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; display: block; }
.d-ready { background: #10b981; } .d-interested { background: #3b82f6; } .d-open { background: #a78bfa; } .d-won { background: #22c55e; } .d-rejected { background: #ef4444; }
.crm.mini .sb { width: 50px; } .crm.mini .sb-l, .crm.mini .sb-i em, .crm.mini .sb-h { display: none; } .crm.mini .sb-i { justify-content: center; padding: 8px 0; } .crm.mini .sb-me { justify-content: center; padding: 4px 0 12px; }
/* the light work area */
.wk { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; background: rgba(248,250,252,.97); }
.tb { flex: none; display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; background: #fff; }
.tb-b { flex: none; width: 30px; height: 30px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; color: #334155; font: inherit; font-size: 17px; line-height: 1; cursor: pointer; display: grid; place-items: center; }
.tb-b:hover:not(:disabled), .tb-b:focus-visible { background: #f1f5f9; outline: none; } .tb-b:disabled { opacity: .35; cursor: default; }
.tb-b.mic.on { background: #2563EB; border-color: #2563EB; color: #fff; box-shadow: 0 0 0 3px #2563EB33; }
.tb-s { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; padding: 0 10px; height: 30px; border-radius: 8px; border: 1px solid #e2e8f0; background: #f8fafc; color: #94a3b8; }
.tb-s:focus-within { border-color: #2563EB; background: #fff; }
.tb-s input { flex: 1; min-width: 0; border: 0; background: none; font: inherit; font-size: 12.5px; color: #0f172a; outline: none; }
.tb-s.sm { flex: 1 1 100%; height: 28px; }
.spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #bfdbfe; border-top-color: #2563EB; animation: crm-rot .8s linear infinite; }
@keyframes crm-rot { to { transform: rotate(360deg); } }
.flash { margin: 8px 12px 0; font-size: 12.5px; padding: 7px 10px; border-radius: 8px; display: flex; gap: 8px; align-items: center; }
.flash.ok { color: #166534; background: #dcfce7; border: 1px solid #bbf7d0; } .flash.bad { color: #991b1b; background: #fee2e2; border: 1px solid #fecaca; }
.flash button { margin-left: auto; font: inherit; font-size: 11.5px; background: none; border: 0; color: inherit; cursor: pointer; }
.wk-b { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.pg { padding: 14px 16px; }
.pg-h { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; } .pg-h h2 { margin: 0; font-size: 17px; font-weight: 650; color: #0f172a; }
.mut { color: #94a3b8; } .small { font-size: 11.5px; } .empty { color: #94a3b8; padding: 14px 4px; margin: 0; font-size: 12.5px; }
.lnk { background: none; border: 0; padding: 0; font: inherit; color: #2563EB; cursor: pointer; text-align: left; } .lnk:hover { text-decoration: underline; }
.btn { font: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; cursor: pointer; }
.btn.sm { font-size: 12px; padding: 4px 10px; white-space: nowrap; } .btn.pri { background: #2563EB; border-color: #2563EB; color: #fff; } .btn:disabled { opacity: .45; cursor: default; }
.btn:hover:not(:disabled) { filter: brightness(.97); }
/* the lead table */
.tbl { border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; overflow: hidden; }
.tr { display: grid; grid-template-columns: minmax(0, 1.6fr) 132px minmax(0, 1fr) minmax(0, 1fr); gap: 10px; align-items: center; width: 100%;
  padding: 8px 12px; border: 0; border-top: 1px solid #f1f5f9; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.tr.th { cursor: default; border-top: 0; background: #f8fafc; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #64748b; }
button.tr:hover, button.tr:focus-visible { background: #eff6ff; outline: none; }
.tr > span:nth-child(2) { overflow: visible; }
.tr > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.nm { display: flex; align-items: center; gap: 9px; } .nm > span { display: flex; flex-direction: column; min-width: 0; } .nm b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; } .nm small { color: #94a3b8; font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
.lg { flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; font-style: normal; font-weight: 700; font-size: 13px; color: #1d4ed8; background: #dbeafe; }
.lg.big { width: 40px; height: 40px; border-radius: 10px; font-size: 18px; }
.pill { display: inline-flex; align-items: center; gap: 4px; font-style: normal; font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; white-space: nowrap; }
.pill.big { font: inherit; font-size: 12px; font-weight: 600; padding: 5px 12px; cursor: pointer; }
.pill.s-new, .pill.s-contacted { background: #f1f5f9; color: #475569; } .pill.s-qualified { background: #e0e7ff; color: #3730a3; border-color: #c7d2fe; }
.pill.s-interested, .pill.s-follow_up, .pill.s-demo_scheduled, .pill.s-demo_completed { background: #dbeafe; color: #1d4ed8; border-color: #bfdbfe; }
.pill.s-quotation_sent, .pill.s-negotiating { background: #ede9fe; color: #6d28d9; border-color: #ddd6fe; }
.pill.s-ready_to_purchase { background: #d1fae5; color: #047857; border-color: #a7f3d0; } .pill.s-won { background: #dcfce7; color: #15803d; border-color: #86efac; }
.pill.s-lost, .pill.s-not_interested, .pill.s-do_not_contact { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
/* follow-ups, activities, reporting */
.cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cards li { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; }
.cards li.late { border-color: #fecaca; background: #fff7f7; }
.cards .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: left; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; font-size: 12.5px; }
.cards .grow small { color: #64748b; font-size: 11.5px; } .cards li.late .grow small { color: #b91c1c; }
.chk { flex: none; width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid #cbd5e1; background: #fff; color: transparent; display: grid; place-items: center; padding: 0; cursor: pointer; }
.chk svg { width: 12px; height: 12px; } button.chk:hover:not(:disabled), button.chk:focus-visible { border-color: #16a34a; color: #16a34a; outline: none; }
span.chk { color: #94a3b8; cursor: default; }
.sec-t { margin: 16px 0 8px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #64748b; font-weight: 600; }
.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
.kpi { padding: 10px 12px; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; display: flex; flex-direction: column; gap: 3px; }
.kpi span { font-size: 11.5px; color: #64748b; } .kpi b { font-size: 20px; font-weight: 650; font-variant-numeric: tabular-nums; }
.bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.bars li { display: grid; grid-template-columns: 120px 1fr 36px; gap: 10px; align-items: center; font-size: 12px; color: #334155; }
.bars li > i { height: 8px; border-radius: 4px; background: #e2e8f0; overflow: hidden; } .bars b { text-align: right; font-variant-numeric: tabular-nums; }
.seg { display: block; height: 100%; border-radius: 4px; background: #2563EB; min-width: 2px; } .seg.s-won { background: #22c55e; } .seg.s-lost { background: #ef4444; } .seg.s-proposal { background: #8b5cf6; } .seg.s-new, .seg.s-contacted { background: #94a3b8; }
/* the lead page */
.ld { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px; min-height: 100%; box-sizing: border-box; }
.ld-h { display: flex; align-items: center; gap: 11px; }
.ld-t { flex: 1; min-width: 0; } .ld-t h2 { margin: 0; font-size: 18px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .ld-t small { color: #64748b; font-size: 12px; }
.dd { position: relative; }
.pop { position: absolute; top: calc(100% + 4px); left: 0; z-index: 10; min-width: 190px; max-height: 300px; overflow: auto; padding: 5px; border-radius: 10px; background: #fff; border: 1px solid #e2e8f0; box-shadow: 0 12px 32px rgba(15,23,42,.18); display: flex; flex-direction: column; }
.pop.right { left: auto; right: 0; }
.pop button, .pop a { text-align: left; padding: 6px 8px; border-radius: 6px; border: 0; background: none; font: inherit; font-size: 12.5px; color: #0f172a; cursor: pointer; text-decoration: none; }
.pop button:hover, .pop a:hover, .pop button:focus-visible { background: #f1f5f9; outline: none; } .pop button.on { background: #eff6ff; }
.pop-t { font-size: 11px; color: #64748b; padding: 4px 8px; }
.acts { display: flex; gap: 6px; flex-wrap: wrap; }
.acts > button, .acts > a, .acts .dd > button { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 12.5px; font-weight: 500; padding: 6px 12px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; color: #1e293b; cursor: pointer; text-decoration: none; }
.acts > button:hover:not(:disabled), .acts > a:hover, .acts .dd > button:hover:not(:disabled), .acts .on { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
.acts button:disabled { opacity: .45; cursor: default; }
.confirm { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-radius: 10px; background: #fffbeb; border: 1px solid #fde68a; color: #78350f; font-size: 12.5px; }
.ld-cols { flex: 1; display: grid; grid-template-columns: minmax(230px, 38%) 1fr; gap: 12px; min-height: 0; align-items: start; }
.ld-l, .ld-r { border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; min-width: 0; }
.tabs { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid #e2e8f0; }
.tabs button { font: inherit; font-size: 12.5px; padding: 9px 8px; border: 0; border-bottom: 2px solid transparent; background: none; color: #64748b; cursor: pointer; margin-bottom: -1px; }
.tabs button.on { color: #0f172a; border-bottom-color: #2563EB; font-weight: 600; }
.sec { border-bottom: 1px solid #f1f5f9; } .sec:last-child { border-bottom: 0; }
.sec-h { display: flex; align-items: center; gap: 7px; width: 100%; padding: 9px 12px; border: 0; background: none; font: inherit; font-size: 11px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: #475569; cursor: pointer; text-align: left; }
.sec-h > i { font-style: normal; display: inline-block; transition: transform .15s; color: #94a3b8; } .sec-h > i.open { transform: rotate(90deg); }
.sec-h em { margin-left: auto; font-style: normal; font-size: 11px; color: #94a3b8; letter-spacing: 0; }
.sec-b { padding: 0 12px 10px; display: flex; flex-direction: column; gap: 6px; } .sec-b .mut { margin: 0; font-size: 12px; }
.task { display: flex; gap: 9px; align-items: flex-start; } .task > span { display: flex; flex-direction: column; min-width: 0; font-size: 12.5px; }
.task small { color: #64748b; font-size: 11.5px; } .task.late small { color: #b91c1c; } .task .nt { color: #475569; overflow-wrap: anywhere; }
.kv { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; } .kv span { color: #64748b; flex: none; } .kv b { font-weight: 500; text-align: right; min-width: 0; overflow-wrap: anywhere; user-select: text; }
.ct { display: flex; gap: 9px; align-items: center; font-size: 12.5px; color: #94a3b8; } .ct span { color: #0f172a; min-width: 0; overflow-wrap: anywhere; user-select: text; }
.ct a, .ld a { color: #2563EB; text-decoration: none; } .ct a:hover { text-decoration: underline; }
.tag { display: inline-block; font-style: normal; font-size: 10.5px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: #f1f5f9; color: #475569; margin-left: 6px; text-transform: capitalize; vertical-align: 1px; }
.notes { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.notes textarea { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 12.5px; padding: 8px 10px; border-radius: 8px; border: 1px solid #cbd5e1; color: #0f172a; background: #fff; }
.notes textarea:focus { outline: none; border-color: #2563EB; } .notes .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.note { padding: 8px 10px; border-radius: 8px; background: #fefce8; border: 1px solid #fef08a; } .note small { color: #854d0e; font-size: 11px; } .note p { margin: 2px 0 0; font-size: 12.5px; white-space: pre-wrap; user-select: text; }
.ld-r { padding: 10px 12px; }
.sum { padding: 10px 12px; border-radius: 10px; background: linear-gradient(135deg, #eff6ff, #f5f3ff); border: 1px solid #dbeafe; }
.sum b { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #1d4ed8; } .sum p { margin: 4px 0 0; font-size: 12.5px; color: #1e293b; line-height: 1.45; }
.flt { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0 6px; }
.chips { display: flex; gap: 4px; flex-wrap: wrap; }
.chips button { font: inherit; font-size: 11.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer; }
.chips button.on { background: #0f172a; border-color: #0f172a; color: #fff; }
.tl { list-style: none; margin: 0; padding: 0; position: relative; }
.tl li { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; }
.tl li:not(:last-child)::after { content: ""; position: absolute; left: 13px; top: 34px; bottom: -4px; width: 1px; background: #e2e8f0; }
.tl-ic { flex: none; width: 27px; height: 27px; border-radius: 50%; display: grid; place-items: center; background: #f1f5f9; color: #475569; }
.k-call .tl-ic { background: #dcfce7; color: #15803d; } .k-message .tl-ic { background: #dbeafe; color: #1d4ed8; } .k-stage .tl-ic { background: #ede9fe; color: #6d28d9; }
.k-task .tl-ic { background: #fef3c7; color: #b45309; } .k-note .tl-ic { background: #fefce8; color: #a16207; } .k-deal .tl-ic { background: #e0f2fe; color: #0369a1; }
.tl li.late .tl-ic { background: #fee2e2; color: #b91c1c; }
.tl-b { flex: 1; min-width: 0; font-size: 12.5px; color: #1e293b; padding-top: 4px; } .tl-b p { margin: 3px 0 0; color: #475569; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.tl li > em { flex: none; font-style: normal; font-size: 11px; color: #94a3b8; padding-top: 6px; white-space: nowrap; }
@media (max-width: 860px) { .sb { width: 50px; } .sb-l, .sb-i em, .sb-h { display: none; } .sb-i { justify-content: center; padding: 8px 0; } .sb-me { justify-content: center; padding: 4px 0 12px; }
  .tr { grid-template-columns: minmax(0, 1.6fr) 132px minmax(0, 1fr); } .tr > span:nth-child(n+4) { display: none; } }
@media (max-width: 680px) { .ld-cols { grid-template-columns: 1fr; } }
@media (max-width: 520px) { .sb { display: none; } .tr { grid-template-columns: 1fr auto; } .tr > span:nth-child(n+3) { display: none; } }
`;
