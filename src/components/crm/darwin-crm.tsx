"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CrmRow } from "@/lib/crm/service";
import { CRM_STATUSES, statusLabel, type CrmStatus } from "@/lib/crm/status";
import { AddLeadDialog, DataDialog, GenerateDialog, ImportDialog } from "./dialogs";
import { LeadPanel } from "./lead-panel";
import { api, igHandle, safeHref, siteLabel } from "./net";
import { DC_CSS } from "./styles";

/**
 * DARWIN's CRM — the one CRM. The same screen is JARVIS's /dashboard/crm and
 * the pop-up in RUBEN's island: search, filters, a plain table (cards on a
 * phone), the lead panel, Generate leads, Add, Import, and Backups. Every
 * number on it comes from /api/crm; every change is answered by the server.
 */

export interface CrmHandle {
  refresh(): void;
  openLead(id: string): void;
  /** A voice command's results ("show my interested leads"). */
  showResults(title: string, leads: { id: string }[]): void;
  /** Follow-ups that are due (today + overdue). */
  showFollowups(): void;
}

interface Facets { total: number; status: Record<CrmStatus, number>; niches: { value: string; count: number }[]; locations: { value: string; count: number }[]; sources: { value: string; count: number }[] }
interface ListAnswer { leads: CrmRow[]; total: number; facets: Facets | null }
type Filters = { q: string; status: CrmStatus | "all" | "open"; niche: string; location: string; website: string; followUp: string; source: string; sort: string };
const EMPTY: Filters = { q: "", status: "all", niche: "", location: "", website: "", followUp: "", source: "", sort: "recent" };
const tone = (s: CrmStatus) => CRM_STATUSES.find((x) => x.id === s)?.tone ?? "gray";
const PAGE = 100;

interface Props {
  /** Inside RUBEN's pop-up: shows mic + close in the top bar. */
  embedded?: boolean;
  onClose?: () => void;
  onMic?: () => void;
  micOn?: boolean;
  /** The lead "this lead" means for voice commands. */
  onSelectLead?: (id: string | null) => void;
  /** RUBEN's own settings (embedded). */
  onSettings?: () => void;
  active?: boolean;
}

export const DarwinCrm = forwardRef<CrmHandle, Props>(function DarwinCrm({ embedded, onClose, onMic, micOn, onSelectLead, onSettings, active = true }, ref) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [results, setResults] = useState<{ title: string; ids: string[] } | null>(null);
  const [data, setData] = useState<ListAnswer | null>(null);
  const [rows, setRows] = useState<CrmRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "generate" | "add" | "import" | "data">(null);
  const seq = useRef(0);

  const query = useCallback((x: Filters, r: typeof results, offset = 0) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(x)) if (v && !(k === "status" && v === "all")) p.set(k, String(v));
    if (r) p.set("ids", r.ids.join(","));
    p.set("limit", String(PAGE)); p.set("offset", String(offset));
    if (offset) p.set("facets", "0");
    return `/api/crm?${p}`;
  }, []);

  const load = useCallback(async (x = f, r = results) => {
    const my = ++seq.current;
    setLoading(true);
    const a = await api<ListAnswer>(query(x, r));
    if (my !== seq.current) return;
    setLoading(false);
    if (a.ok) { setData(a.data); setRows(a.data.leads); setError(null); } else setError(a.error);
  }, [f, results, query]);

  const more = async () => {
    const a = await api<ListAnswer>(query(f, results, rows.length));
    if (a.ok) setRows((xs) => [...xs, ...a.data.leads]);
  };

  // filters and search (debounced) reload the list
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void load(), f.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [f, results, active]); // eslint-disable-line react-hooks/exhaustive-deps
  // fresh while open
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => void load(), 60_000);
    return () => clearInterval(iv);
  }, [active, load]);
  useEffect(() => { onSelectLead?.(leadId); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    refresh: () => void load(),
    openLead: (id) => setLeadId(id),
    showResults: (title, leads) => { setLeadId(null); setF(EMPTY); setResults({ title, ids: leads.map((l) => l.id) }); },
    showFollowups: () => { setLeadId(null); setResults(null); setF({ ...EMPTY, status: "open", followUp: "due", sort: "followup" }); },
  }), [load]);

  const set = (patch: Partial<Filters>) => { setResults(null); setF((x) => ({ ...x, ...patch })); };
  const filtered = results || Object.entries(f).some(([k, v]) => k !== "sort" && v && !(k === "status" && v === "all"));
  const fc = data?.facets;
  const changed = (m: { ok: boolean; text: string }) => { setFlash(m); void load(); };

  return (
    <div className="dc" onKeyDown={(e) => { if (e.key === "Escape" && leadId && !dialog) { e.stopPropagation(); setLeadId(null); } }}>
      <style dangerouslySetInnerHTML={{ __html: DC_CSS }} />
      <header className="dc-top">
        <div className="dc-brand">DARWIN CRM <small>{fc ? `${fc.total} lead${fc.total === 1 ? "" : "s"}` : ""}</small></div>
        <label className="dc-search">
          <span aria-hidden>⌕</span>
          <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search name, phone, email, Instagram, website, city, #number…" aria-label="Search leads" />
          {loading && <i className="dc-spin" aria-label="Loading" />}
        </label>
        <button type="button" className="dc-btn pri" onClick={() => setDialog("generate")}>Generate leads</button>
        <button type="button" className="dc-btn ghost" onClick={() => setDialog("add")}>+ Add</button>
        <button type="button" className="dc-btn ghost dc-hide-sm" onClick={() => setDialog("import")}>Import</button>
        <button type="button" className="dc-btn ghost" onClick={() => setDialog("data")} title="Backups & clearing" aria-label="Backups and clearing">⋯</button>
        {embedded && onMic && <button type="button" className={`dc-btn ${micOn ? "pri" : "ghost"}`} onClick={onMic} aria-label={micOn ? "Stop listening" : "Speak a command"} title="Speak to RUBEN">🎤</button>}
        {embedded && onSettings && <button type="button" className="dc-btn ghost" onClick={onSettings} aria-label="RUBEN settings" title="RUBEN settings">⚙</button>}
        {embedded && onClose && <button type="button" className="dc-btn ghost" onClick={onClose} aria-label="Close CRM">✕</button>}
      </header>

      <div className="dc-filters">
        <div className="dc-chips" role="tablist" aria-label="Lead status">
          <button type="button" role="tab" aria-selected={f.status === "all" && !results} className={`dc-chip ${f.status === "all" && !results ? "on" : ""}`} onClick={() => set({ status: "all" })}>All <b>{fc?.total ?? "–"}</b></button>
          {CRM_STATUSES.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={f.status === s.id} className={`dc-chip ${f.status === s.id ? "on" : ""}`} onClick={() => set({ status: s.id })}>{s.label} <b>{fc?.status[s.id] ?? "–"}</b></button>
          ))}
        </div>
        <div className="dc-selects">
          <select className="dc-sel" value={f.niche} onChange={(e) => set({ niche: e.target.value })} aria-label="Niche">
            <option value="">All niches</option>{fc?.niches.map((n) => <option key={n.value} value={n.value}>{n.value} ({n.count})</option>)}
          </select>
          <select className="dc-sel" value={f.location} onChange={(e) => set({ location: e.target.value })} aria-label="Location">
            <option value="">All locations</option>{fc?.locations.map((n) => <option key={n.value} value={n.value}>{n.value} ({n.count})</option>)}
          </select>
          <select className="dc-sel" value={f.website} onChange={(e) => set({ website: e.target.value })} aria-label="Website">
            <option value="">Any website</option><option value="has">Has a website</option><option value="none">No website (verified)</option><option value="unknown">Website unknown</option>
          </select>
          <select className="dc-sel" value={f.followUp} onChange={(e) => set({ followUp: e.target.value })} aria-label="Next follow-up">
            <option value="">Any follow-up</option><option value="due">Due (today + overdue)</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="week">Next 7 days</option><option value="none">None scheduled</option>
          </select>
          {fc && fc.sources.length > 1 && (
            <select className="dc-sel" value={f.source} onChange={(e) => set({ source: e.target.value })} aria-label="Source">
              <option value="">All sources</option>{fc.sources.map((n) => <option key={n.value} value={n.value}>{n.value.replace(/^import:/, "imported · ")} ({n.count})</option>)}
            </select>
          )}
          {filtered && <button type="button" className="dc-clear" onClick={() => { setResults(null); setF(EMPTY); }}>Clear filters</button>}
        </div>
      </div>

      {flash && <p className={`dc-flash ${flash.ok ? "ok" : "bad"}`} role="status">{flash.text}<button type="button" onClick={() => setFlash(null)} aria-label="Dismiss">✕</button></p>}
      {error && <p className="dc-flash bad" role="alert">{error}<button type="button" onClick={() => void load()}>Retry</button></p>}

      <main className="dc-main">
        <div className="dc-meta">
          <span>{results ? <><b>{results.title}</b> · </> : null}{data ? `${data.total} lead${data.total === 1 ? "" : "s"}${filtered ? " match" : ""}` : "Loading…"}</span>
          <select className="dc-sel dc-sort" value={f.sort} onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))} aria-label="Sort">
            <option value="recent">Recently updated</option><option value="followup">Next follow-up</option><option value="name">Name A–Z</option>
          </select>
        </div>
        {data && !rows.length ? (
          <div className="dc-empty">
            {filtered ? "No lead matches these filters." : <>Your CRM is empty. <button type="button" className="dc-clear" onClick={() => setDialog("generate")}>Generate leads</button> or <button type="button" className="dc-clear" onClick={() => setDialog("import")}>import your existing CRM</button>.</>}
          </div>
        ) : (
          <>
            <table className="dc-table">
              <thead><tr><th>Business</th><th>Phone</th><th>Website</th><th>Instagram</th><th className="c-src">Source</th><th>Status</th><th>Next action</th></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className={leadId === l.id ? "sel" : ""} onClick={() => setLeadId(l.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setLeadId(l.id); }}>
                    <td className="dc-name"><b>{l.number != null && <span style={{ color: "#94A3B8", fontWeight: 500 }}>#{l.number} </span>}{l.businessName}</b><small>{[l.category, l.city].filter(Boolean).join(" · ") || "—"}</small></td>
                    <td className="nw">{l.phone ?? <span className="dc-unk">Unknown</span>}</td>
                    <td>{l.website && safeHref(l.website, "web") ? <a href={safeHref(l.website, "web")!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{siteLabel(l.website)}</a> : l.websiteStatus === "no_website" ? "None (verified)" : <span className="dc-unk">Unknown</span>}</td>
                    <td>{l.instagram && safeHref(l.instagram, "ig") ? <a href={safeHref(l.instagram, "ig")!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>@{igHandle(l.instagram)}</a> : <span className="dc-unk">Unknown</span>}</td>
                    <td className="c-src">{l.source.replace(/^import:/, "imported · ")}</td>
                    <td><span className={`dc-pill t-${tone(l.status)}`}>{statusLabel(l.status)}</span></td>
                    <td className={`dc-next ${l.overdue ? "late" : ""}`}>{l.nextAction}{l.nextFollowUp ? <small style={{ display: "block", color: l.overdue ? undefined : "#64748B", fontWeight: 400 }}>{l.nextFollowUp}</small> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dc-cards">
              {rows.map((l) => (
                <button key={l.id} type="button" className="dc-card" onClick={() => setLeadId(l.id)}>
                  <span className="r"><b>{l.businessName}</b><span className={`dc-pill t-${tone(l.status)}`}>{statusLabel(l.status)}</span></span>
                  <small style={{ color: "#64748B" }}>{[l.category, l.city, l.phone ?? "phone unknown"].filter(Boolean).join(" · ")}</small>
                  <span className={`dc-next ${l.overdue ? "late" : ""}`}>{l.nextAction}{l.nextFollowUp ? ` · ${l.nextFollowUp}` : ""}</span>
                </button>
              ))}
            </div>
            {data && rows.length < data.total && <div className="dc-more"><button type="button" className="dc-btn" onClick={() => void more()}>Show more ({data.total - rows.length} left)</button></div>}
          </>
        )}
      </main>

      {leadId && <LeadPanel id={leadId} onClose={() => setLeadId(null)} onChanged={changed} />}
      {dialog === "generate" && <GenerateDialog onClose={() => setDialog(null)} onDone={() => void load()} />}
      {dialog === "add" && <AddLeadDialog onClose={() => setDialog(null)} flash={setFlash} onDone={(id) => { setDialog(null); void load(); setLeadId(id); }} />}
      {dialog === "import" && <ImportDialog onClose={() => setDialog(null)} onDone={() => void load()} />}
      {dialog === "data" && <DataDialog onClose={() => setDialog(null)} flash={setFlash} onDone={() => void load()} />}
    </div>
  );
});
