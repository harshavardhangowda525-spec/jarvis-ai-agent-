"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Instagram, Loader2, Play, Search as SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CONTACT_LABEL, CONTACT_STATUSES, FOLLOW_UP_LABEL, FOLLOW_UP_STATUSES,
  type IgLeadDTO, type IgSummaryDTO, type IgView,
} from "@/lib/darwin/instagram/types";
import { GlassPanel, PhoneActions } from "./ui";

/**
 * DARWIN's "Instagram + No Website" section: the separate daily task's
 * summary and its verified leads — never mixed into the daily leads.
 */

export function useIgView(active = true) {
  const [view, setView] = useState<IgView | null>(null);
  const [q, setQ] = useState("");
  const load = useCallback(async (query = q) => {
    const r = await fetch(`/api/darwin/instagram${query ? `?q=${encodeURIComponent(query)}` : ""}`).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    if (j?.data) setView(j.data as IgView);
  }, [q]);
  useEffect(() => {
    if (!active) return;
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => clearInterval(t);
  }, [active, load]);
  return { view, load, q, setQ, setView };
}

const STATUS_TEXT: Record<string, string> = { running: "SEARCHING", completed: "COMPLETE", partial: "ENDED EARLY", needs_setup: "NEEDS SETUP" };

/** The small pill on the map: today's task at a glance. */
export function IgPill({ onOpen }: { onOpen: () => void }) {
  const { view } = useIgView();
  if (!view?.enabled) return null;
  const run = view.run;
  const waiting = !run;
  return (
    <button onClick={onOpen} data-darwin-ig-pill={run?.status ?? "waiting"} title='"Instagram + No Website Leads" — runs after the daily target is complete'
      className="dw-glass mt-2 flex w-[228px] items-center gap-2 rounded-2xl px-3 py-2 text-left">
      <Instagram className={cn("h-4 w-4 shrink-0", run?.status === "completed" ? "text-emerald-300" : run?.status === "running" ? "text-pink-300" : "text-white/40")} />
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] tracking-[0.26em] text-white/55">INSTAGRAM + NO WEBSITE</span>
        <span className="block truncate text-[11px] text-white/80">
          {waiting ? "Starts when the daily target is complete" : `${run.summary.saved} / ${run.target} · ${STATUS_TEXT[run.status] ?? run.status}`}
        </span>
      </span>
      {run?.status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pink-300" />}
    </button>
  );
}

const METRICS: [keyof IgSummaryDTO, string, string?][] = [
  ["businessesFound", "Businesses found"], ["instagramVerified", "Instagram verified", "text-pink-200"], ["noWebsiteVerified", "No website verified", "text-amber-200/90"],
  ["contactable", "Contactable leads", "text-emerald-200"], ["highPotential", "High-potential leads", "text-cyan-200"], ["duplicatesRemoved", "Duplicates removed"], ["unverifiedExcluded", "Unverified excluded", "text-rose-200/80"],
];

async function patchIg(id: string, body: Record<string, unknown>): Promise<IgLeadDTO> {
  const res = await fetch(`/api/darwin/instagram/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Update failed (HTTP ${res.status}).`);
  return j.data.lead as IgLeadDTO;
}

/** The section in the CRM: summary + the verified leads. */
export function IgSection() {
  const { view, load, q, setQ, setView } = useIgView();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => void load(q), 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const runNow = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/darwin/instagram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) }).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (!r?.ok) setMsg(j?.error ?? "Couldn't start it."); else if (j?.data?.lastError) setMsg(j.data.lastError);
    await load(); setBusy(false);
  };
  const update = async (l: IgLeadDTO, body: Record<string, unknown>) => {
    try {
      const n = await patchIg(l.id, body);
      setView((v) => (v ? { ...v, leads: v.leads.map((x) => (x.id === n.id ? n : x)) } : v));
    } catch (e) { setMsg((e as Error).message); }
  };

  if (!view) return <div className="flex items-center gap-2 p-4 text-sm text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  const run = view.run, s = run?.summary;
  const primaryDone = view.primary?.status === "completed";
  return (
    <div className="space-y-3" data-darwin-ig-section>
      <GlassPanel title="INSTAGRAM + NO WEBSITE LEADS" right={
        <button onClick={runNow} disabled={busy || !primaryDone || run?.status === "completed" || !view.enabled}
          title={primaryDone ? "Work on today's task now" : "Starts once today's daily target is complete"}
          className="flex items-center gap-1 rounded-full border border-pink-300/30 px-2.5 py-1 text-[10px] tracking-[0.18em] text-pink-100 disabled:opacity-40">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} RUN NOW
        </button>
      }>
        <p className="text-[11px] leading-relaxed text-white/55">
          A separate task that starts only after the daily target is complete. It keeps a business only when its Instagram is
          <b className="text-pink-200"> VERIFIED</b> (the account exists, carries the business&apos;s name and is tied to its area, phone or listing)
          and <b className="text-amber-200/90">NO OFFICIAL WEBSITE</b> is found. Anything it can&apos;t confirm is left out.
        </p>
        <div className="mt-2 text-[11px] text-white/70">
          {!view.enabled ? "Turned off (DARWIN_INSTAGRAM=off)."
            : !run ? (primaryDone ? "Starting on the next run…" : `Waiting for today's daily target${view.primary ? ` (${view.primary.verified}/${view.primary.target})` : ""} — it never runs ahead of it.`)
            : <>Today: <span className="text-white">{s!.saved} / {run.target}</span> · {STATUS_TEXT[run.status] ?? run.status}{run.completedAt ? ` · finished ${new Date(run.completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</>}
        </div>
        {(run?.lastError || msg) && <div className="mt-1 text-[11px] text-amber-200/90">{msg ?? run?.lastError}</div>}
        {s && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {METRICS.map(([k, label, tone]) => (
              <div key={k} className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
                <div className={cn("text-xl font-extralight tabular-nums", tone ?? "text-white/90")}>{s[k]}</div>
                <div className="text-[9px] uppercase tracking-[0.14em] text-white/45">{label}</div>
              </div>
            ))}
          </div>
        )}
        {s && <div className="mt-2 text-[10px] text-white/40">Also looked at: {s.noInstagram} with no Instagram · {s.websiteFound} with a website.</div>}
        {view.history.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-white/45">
            {view.history.map((h) => <span key={h.date} className="rounded-full border border-white/10 px-2 py-0.5">{h.date.slice(5)} · {h.saved}/{h.target}</span>)}
          </div>
        )}
      </GlassPanel>

      <GlassPanel title={`VERIFIED LEADS · ${view.total}`} right={
        <label className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5">
          <SearchIcon className="h-3 w-3 text-white/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, @handle, area" className="w-36 bg-transparent text-[11px] text-white outline-none placeholder:text-white/30" />
        </label>
      }>
        {view.leads.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-white/45">{q ? "No matching leads." : "No verified Instagram + No Website leads yet."}</div>
        ) : (
          <div className="divide-y divide-white/5">
            {view.leads.map((l) => (
              <div key={l.id} className="py-2.5" data-ig-lead={l.instagramUsername}>
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-[200px] flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-white/90">{l.businessName}</span>
                      {l.highPotential && <span className="rounded border border-cyan-300/30 px-1 text-[8px] tracking-wider text-cyan-200">HIGH POTENTIAL</span>}
                    </div>
                    <div className="text-[10px] text-white/45">{l.category}{l.location ? ` · ${l.location}` : ""} · found {l.foundDate}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                      <a href={l.instagramUrl} target="_blank" rel="noreferrer" className="text-pink-200 hover:underline">@{l.instagramUsername}</a>
                      <span className="rounded border border-emerald-300/30 px-1 text-[8px] tracking-wider text-emerald-300/90">INSTAGRAM VERIFIED</span>
                      <span className="rounded border border-amber-300/25 px-1 text-[8px] tracking-wider text-amber-200/90">NO OFFICIAL WEBSITE</span>
                      <span className="text-white/55">{l.instagramActivity ?? "—"}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <PhoneActions lead={l} compact />
                    <span className="text-[10px] text-white/45">Lead score <span className="font-mono text-white/85">{l.qualityScore}</span></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[9px] uppercase tracking-wider text-white/40">Contact
                      <select value={l.contactStatus} onChange={(e) => update(l, { contactStatus: e.target.value })} aria-label="Contact status"
                        className="mt-0.5 block rounded-md border border-white/10 bg-black/40 px-1 py-0.5 text-[11px] normal-case tracking-normal text-white/85">
                        {CONTACT_STATUSES.map((c) => <option key={c} value={c}>{CONTACT_LABEL[c]}</option>)}
                      </select>
                    </label>
                    <label className="text-[9px] uppercase tracking-wider text-white/40">Follow-up
                      <select value={l.followUpStatus} onChange={(e) => update(l, { followUpStatus: e.target.value })} aria-label="Follow-up status"
                        className="mt-0.5 block rounded-md border border-white/10 bg-black/40 px-1 py-0.5 text-[11px] normal-case tracking-normal text-white/85">
                        {FOLLOW_UP_STATUSES.map((c) => <option key={c} value={c}>{FOLLOW_UP_LABEL[c]}</option>)}
                      </select>
                    </label>
                    <button onClick={() => setOpen(open === l.id ? null : l.id)} aria-label="Details" aria-expanded={open === l.id} className="mt-3 rounded p-1 text-white/45 hover:bg-white/10 hover:text-white">
                      <ChevronDown className={cn("h-3.5 w-3.5 transition", open === l.id && "rotate-180")} />
                    </button>
                  </div>
                </div>
                {open === l.id && (
                  <div className="mt-2 grid gap-3 rounded-lg bg-white/[0.02] p-2.5 text-[11px] text-white/70 md:grid-cols-3">
                    <div>
                      <div className="mb-1 text-[9px] uppercase tracking-[0.16em] text-pink-200/80">Instagram verification</div>
                      {l.instagramEvidence.map((e) => <div key={e}>✓ {e}</div>)}
                    </div>
                    <div>
                      <div className="mb-1 text-[9px] uppercase tracking-[0.16em] text-amber-200/80">Website check</div>
                      {l.websiteReasons.map((e) => <div key={e}>· {e}</div>)}
                      <div className="mt-1 text-white/40">Source: {l.source}</div>
                    </div>
                    <NotesBox lead={l} onSave={(notes) => update(l, { notes })} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

function NotesBox({ lead, onSave }: { lead: IgLeadDTO; onSave: (notes: string) => void }) {
  const [v, setV] = useState(lead.notes ?? "");
  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-[0.16em] text-white/50">Notes</div>
      <textarea value={v} onChange={(e) => setV(e.target.value)} rows={3} maxLength={4000}
        className="w-full rounded-md border border-white/10 bg-black/30 p-1.5 text-[11px] text-white/85 outline-none focus:border-cyan-300/40" />
      <button onClick={() => onSave(v)} disabled={v === (lead.notes ?? "")} className="mt-1 rounded-md border border-cyan-300/30 px-2 py-0.5 text-[10px] text-cyan-100 disabled:opacity-40">Save notes</button>
    </div>
  );
}
