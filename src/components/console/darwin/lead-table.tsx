"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, MapPin, Save, Search as SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEAD_FILTERS, type LeadDTO, type LeadFilter } from "@/lib/darwin/types";
import {
  GlassPanel, PhoneActions, WebsiteBadge, STATUS_OPTIONS, statusTone, normStage, fmtDate, fmtDistance, toDateInput,
} from "./ui";

export type TableTab = "search" | "all";
/** An outside request to show a slice of the table (from the CRM tiles / follow-ups). */
export interface TableRequest { tab?: TableTab; stage?: string; filter?: LeadFilter; q?: string; nonce: number }

const matchesFilter = (l: LeadDTO, f: LeadFilter) =>
  f === "no_website" ? !l.website : f === "has_website" ? !!l.website : f === "phone" ? !!l.phone : f === "no_phone" ? !l.phone : true;

export async function patchLead(id: string, body: Record<string, unknown>): Promise<LeadDTO> {
  const res = await fetch(`/api/darwin/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Update failed (HTTP ${res.status}).`);
  return j.data.lead as LeadDTO;
}

export function LeadTable({ searchLeads, freshIds, request, onLeadUpdated, refreshKey }: {
  searchLeads: LeadDTO[];
  freshIds: Set<string>;
  request: TableRequest | null;
  onLeadUpdated: (l: LeadDTO) => void;
  refreshKey: number;
}) {
  const [tab, setTab] = useState<TableTab>("search");
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [stage, setStage] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState<{ leads: LeadDTO[]; total: number; next: string | null }>({ leads: [], total: 0, next: null });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Outside requests (CRM tile / follow-up click) switch to the full history.
  useEffect(() => {
    if (!request) return;
    setTab(request.tab ?? "all");
    setFilter(request.filter ?? "all");
    setStage(request.stage ?? "");
    setQ(request.q ?? "");
    setDebouncedQ(request.q ?? "");
  }, [request]);
  // New search results → show them.
  useEffect(() => { if (searchLeads.length) setTab("search"); }, [searchLeads]);
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const loadAll = useCallback(async (cursor?: string) => {
    setLoading(true); setErr("");
    try {
      const sp = new URLSearchParams({ filter, limit: "50" });
      if (stage) sp.set("stage", stage);
      if (debouncedQ) sp.set("q", debouncedQ);
      if (cursor) sp.set("cursor", cursor);
      const res = await fetch(`/api/darwin/leads?${sp}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setAll((prev) => ({ leads: cursor ? [...prev.leads, ...j.data.leads] : j.data.leads, total: j.data.total, next: j.data.nextCursor }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load leads.");
    } finally { setLoading(false); }
  }, [filter, stage, debouncedQ]);
  useEffect(() => { if (tab === "all") loadAll(); }, [tab, loadAll, refreshKey]);

  const rows = useMemo(() => {
    if (tab === "all") return all.leads;
    const needle = debouncedQ.toLowerCase();
    return searchLeads.filter((l) =>
      matchesFilter(l, filter) &&
      (!stage || normStage(l.stage) === stage) &&
      (!needle || [l.businessName, l.category, l.address, l.phone, l.notes].some((v) => v?.toLowerCase().includes(needle))));
  }, [tab, all.leads, searchLeads, filter, stage, debouncedQ]);

  const update = useCallback((l: LeadDTO) => {
    setAll((prev) => ({ ...prev, leads: prev.leads.map((x) => (x.id === l.id ? l : x)) }));
    onLeadUpdated(l);
  }, [onLeadUpdated]);

  const setStatus = async (l: LeadDTO, s: string) => {
    try { update(await patchLead(l.id, { stage: s })); } catch (e) { setErr(e instanceof Error ? e.message : "Update failed."); }
  };

  return (
    <GlassPanel title="LEADS" right={
      <div className="flex rounded-full border border-white/10 p-0.5 text-[9px] uppercase tracking-wider">
        {(["search", "all"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-full px-2.5 py-0.5 transition", tab === t ? "bg-accent/20 text-accent-bright" : "text-muted-foreground hover:text-foreground")}>
            {t === "search" ? `This search (${searchLeads.length})` : `All leads${tab === "all" ? ` (${all.total})` : ""}`}
          </button>
        ))}
      </div>
    }>
      {/* toolbar */}
      <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative md:w-64">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, area, phone, notes…" className="dw-input w-full pl-7" />
        </div>
        <div className="flex flex-wrap gap-1">
          {LEAD_FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={cn("rounded-full border px-2 py-0.5 text-[9px] transition", filter === f.id ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:border-accent/50")}>
              {f.id === "all" ? "All" : f.label}
            </button>
          ))}
        </div>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="dw-input md:ml-auto md:w-40">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {err && <p className="mb-2 text-[11px] text-destructive">{err}</p>}

      {rows.length === 0 ? (
        <div className="py-8 text-center text-[11px] text-muted-foreground">
          {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            : tab === "search"
              ? searchLeads.length ? "No leads in this search match the current filters." : "Run FIND NEW LEADS to discover real businesses. Results appear here."
              : "No saved leads match these filters."}
        </div>
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden max-h-[72vh] overflow-auto md:block" style={{ scrollbarWidth: "thin" }}>
            <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                  {["Business", "Category", "Phone", "Website", "Location", "Web status", "Lead status", "Discovered", ""].map((h) => (
                    <th key={h} className="sticky top-0 z-10 border-b border-white/10 bg-[#070b16]/95 px-2 py-2 font-normal backdrop-blur">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((l, i) => (
                  <Fragment key={l.id}>
                    <tr className={cn("group align-top transition hover:bg-white/[0.03]", freshIds.has(l.id) && tab === "search" && "bg-accent/[0.03]")}
                      style={freshIds.has(l.id) && tab === "search" ? { animation: `dw-row-in .45s ${Math.min(i * 0.035, 0.8)}s ease-out both` } : undefined}>
                      <td className="border-b border-white/5 px-2 py-2">
                        <div className="max-w-[220px] text-[12px] font-medium text-foreground/95">{l.businessName}</div>
                        <div className="max-w-[220px] truncate text-[10px] text-muted-foreground" title={l.address ?? ""}>{l.address ?? "Address not listed"}</div>
                      </td>
                      <td className="border-b border-white/5 px-2 py-2 text-[11px] text-foreground/80">{l.category ?? "—"}</td>
                      <td className="border-b border-white/5 px-2 py-2"><PhoneActions lead={l} compact /></td>
                      <td className="border-b border-white/5 px-2 py-2"><WebsiteBadge lead={l} /></td>
                      <td className="border-b border-white/5 px-2 py-2"><LocationCell lead={l} /></td>
                      <td className="border-b border-white/5 px-2 py-2 text-[10px]">
                        {l.website ? <span className="text-success">Listed</span> : <span className="text-warning">None listed</span>}
                      </td>
                      <td className="border-b border-white/5 px-2 py-2"><StatusSelect lead={l} onChange={(s) => setStatus(l, s)} /></td>
                      <td className="whitespace-nowrap border-b border-white/5 px-2 py-2 text-[10px] text-muted-foreground" title={new Date(l.discoveredAt).toLocaleString()}>{fmtDate(l.discoveredAt, true)}</td>
                      <td className="border-b border-white/5 px-2 py-2">
                        <button onClick={() => setOpen(open === l.id ? null : l.id)} className="flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground hover:border-accent/50 hover:text-accent">
                          CRM <ChevronDown className={cn("h-3 w-3 transition", open === l.id && "rotate-180")} />
                        </button>
                      </td>
                    </tr>
                    {open === l.id && (
                      <tr><td colSpan={9} className="border-b border-white/5 px-2 py-2"><CrmEditor lead={l} onSaved={update} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((l, i) => (
              <div key={l.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                style={freshIds.has(l.id) && tab === "search" ? { animation: `dw-card-in .5s ${Math.min(i * 0.05, 1)}s both` } : undefined}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-foreground/95">{l.businessName}</div>
                    <div className="text-[10px] text-muted-foreground">{[l.category, fmtDistance(l.distanceM)].filter(Boolean).join(" · ")}</div>
                  </div>
                  <WebsiteBadge lead={l} />
                </div>
                <div className="mt-2"><PhoneActions lead={l} /></div>
                <div className="mt-1.5 text-[10px] text-muted-foreground">{l.address ?? "Address not listed"}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusSelect lead={l} onChange={(s) => setStatus(l, s)} />
                  <LocationCell lead={l} inline />
                  <span className="text-[9px] text-muted-foreground">Found {fmtDate(l.discoveredAt)}</span>
                  <button onClick={() => setOpen(open === l.id ? null : l.id)} className="ml-auto rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">CRM</button>
                </div>
                {open === l.id && <div className="mt-2"><CrmEditor lead={l} onSaved={update} /></div>}
              </div>
            ))}
          </div>

          {tab === "all" && all.next && (
            <button onClick={() => loadAll(all.next!)} disabled={loading} className="mx-auto mt-3 flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[10px] text-muted-foreground hover:border-accent/50 hover:text-accent">
              {loading && <Loader2 className="h-3 w-3 animate-spin" />} Load more ({all.leads.length} of {all.total})
            </button>
          )}
        </>
      )}
    </GlassPanel>
  );
}

function StatusSelect({ lead, onChange }: { lead: LeadDTO; onChange: (s: string) => void }) {
  return (
    <select value={normStage(lead.stage)} onChange={(e) => onChange(e.target.value)}
      className={cn("cursor-pointer rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider outline-none", statusTone(lead.stage))}>
      {STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id} className="bg-[#0b1020] text-foreground">{s.label}</option>)}
    </select>
  );
}

function LocationCell({ lead, inline }: { lead: LeadDTO; inline?: boolean }) {
  const dist = fmtDistance(lead.distanceM);
  if (!lead.mapsUrl) return <span className="text-[10px] text-muted-foreground">—</span>;
  return (
    <div className={cn("text-[10px]", inline ? "flex items-center gap-2" : "space-y-0.5")}>
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <MapPin className="h-3 w-3 text-accent/70" />
        <a href={lead.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Maps</a>
        {lead.osmUrl && <a href={lead.osmUrl} target="_blank" rel="noopener noreferrer" className="text-accent/80 hover:underline">OSM</a>}
        {dist && <span className="text-muted-foreground">· {dist}</span>}
      </div>
      {!inline && <div className="font-mono text-[9px] text-muted-foreground/70">{lead.latitude?.toFixed(5)}, {lead.longitude?.toFixed(5)}</div>}
    </div>
  );
}

const SERVICES = ["Website", "Mobile app", "E-commerce store", "SEO", "Social media", "Booking system", "Branding"];

function CrmEditor({ lead, onSaved }: { lead: LeadDTO; onSaved: (l: LeadDTO) => void }) {
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [next, setNext] = useState(toDateInput(lead.nextFollowUpAt));
  const [last, setLast] = useState(toDateInput(lead.lastContactedAt));
  const [value, setValue] = useState(lead.salesValue != null ? String(lead.salesValue) : "");
  const [service, setService] = useState(lead.serviceInterest ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const save = async () => {
    setSaving(true); setMsg("");
    try {
      const v = value.trim() === "" ? null : Number(value);
      if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error("Sales value must be a positive number.");
      const updated = await patchLead(lead.id, {
        notes: notes.trim() || null,
        nextFollowUpAt: next || null,
        lastContactedAt: last || null,
        salesValue: v,
        serviceInterest: service.trim() || null,
      });
      onSaved(updated);
      setMsg("Saved");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  };

  return (
    <div className="grid gap-2 rounded-xl border border-accent/15 bg-accent/[0.03] p-3 md:grid-cols-[1fr_auto]" style={{ animation: "dw-reveal .35s ease both" }}>
      <label className="block">
        <span className="mb-0.5 block text-[9px] uppercase tracking-wider text-muted-foreground">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={8000} placeholder="Call notes, decision maker, objections…" className="dw-input w-full resize-y" />
      </label>
      <div className="grid grid-cols-2 gap-2 md:w-[380px]">
        <Mini label="Next follow-up"><input type="date" value={next} onChange={(e) => setNext(e.target.value)} className="dw-input w-full" /></Mini>
        <Mini label="Last contacted"><input type="date" value={last} onChange={(e) => setLast(e.target.value)} className="dw-input w-full" /></Mini>
        <Mini label="Sales value"><input type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 25000" className="dw-input w-full" /></Mini>
        <Mini label="Service interested in">
          <input list="darwin-services" value={service} onChange={(e) => setService(e.target.value)} maxLength={120} placeholder="Website" className="dw-input w-full" />
          <datalist id="darwin-services">{SERVICES.map((s) => <option key={s} value={s} />)}</datalist>
        </Mini>
        <div className="col-span-2 flex items-center justify-end gap-2">
          {msg && <span className={cn("text-[10px]", msg === "Saved" ? "text-success" : "text-destructive")}>{msg}</span>}
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1 text-[10px] uppercase tracking-wider text-accent-bright hover:bg-accent/25 disabled:opacity-50">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>;
}
