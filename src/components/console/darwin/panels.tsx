"use client";

import { useState } from "react";
import { Loader2, Search, Sparkles, AlertTriangle, CheckCircle2, Info, CalendarClock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEAD_FILTERS, type FindLeadsResult, type LeadDTO, type LeadFilter } from "@/lib/darwin/types";
import { GlassPanel, PhoneActions, fmtDate } from "./ui";

export interface SearchForm { category: string; location: string; limit: number; filter: LeadFilter; radiusKm: number }

const SUGGESTIONS = ["Gyms", "Cafes", "Salons", "Dentists", "Restaurants", "Coaching centres", "Real estate agents", "Clothing stores"];

/* ================= LEAD SEARCH ================= */
export function LeadSearchPanel({ form, setForm, onSearch, searching, geoapifyReady }: {
  form: SearchForm; setForm: (f: SearchForm) => void; onSearch: () => void; searching: boolean; geoapifyReady: boolean | null;
}) {
  const set = <K extends keyof SearchForm>(k: K, v: SearchForm[K]) => setForm({ ...form, [k]: v });
  const canSearch = form.category.trim().length >= 2 && form.location.trim().length >= 2 && !searching;
  return (
    <GlassPanel title="LEAD SEARCH">
      <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); if (canSearch) onSearch(); }}>
        <Field label="Category">
          <input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="gyms, cafes, tattoo studios…" className="dw-input w-full" maxLength={80} />
        </Field>
        <div className="flex flex-wrap gap-1">
          {SUGGESTIONS.map((c) => (
            <button type="button" key={c} onClick={() => set("category", c)}
              className={cn("rounded-full border px-2 py-0.5 text-[9px] transition", form.category.toLowerCase() === c.toLowerCase() ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:border-accent/50")}>{c}</button>
          ))}
        </div>
        <Field label="Location">
          <input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Bangalore · Indiranagar · 560038 · 12.97,77.59" className="dw-input w-full" maxLength={120} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Leads">
            <input type="number" min={1} max={50} value={form.limit} onChange={(e) => set("limit", Math.min(Math.max(+e.target.value || 1, 1), 50))} className="dw-input w-full text-right" />
          </Field>
          <Field label="Radius km">
            <input type="number" min={1} max={50} value={form.radiusKm} onChange={(e) => set("radiusKm", Math.min(Math.max(+e.target.value || 1, 1), 50))} className="dw-input w-full text-right" />
          </Field>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Requirements</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {LEAD_FILTERS.map((f) => (
              <button type="button" key={f.id} onClick={() => set("filter", f.id)}
                className={cn("rounded-md border px-2 py-1 text-[10px] transition", form.filter === f.id ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:border-accent/50")}>
                {form.filter === f.id ? "✓ " : ""}{f.label}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" disabled={!canSearch}
          className="relative mt-1 flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg border border-accent/50 bg-accent/15 px-3 py-2.5 text-xs font-semibold tracking-[0.25em] text-accent-bright transition hover:bg-accent/25 disabled:opacity-40"
          style={{ boxShadow: "0 0 24px -8px hsl(var(--accent))" }}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {searching ? "SCANNING…" : "FIND NEW LEADS"}
        </button>
        {geoapifyReady === false && (
          <p className="text-[10px] leading-snug text-warning">Geoapify API key is not configured. Add GEOAPIFY_API_KEY to the server environment (Vercel → Settings → Environment Variables) and redeploy.</p>
        )}
        <p className="text-[9px] leading-snug text-muted-foreground/80">Real Geoapify businesses only. Leads you&apos;ve already seen are skipped automatically.</p>
      </form>
    </GlassPanel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>;
}

/* ================= NEW LEADS (this session) ================= */
export interface SessionStats { newFound: number; skipped: number; searches: number }

export function NewLeadsPanel({ session, last, onMore, searching }: { session: SessionStats; last: SearchForm | null; onMore: () => void; searching: boolean }) {
  return (
    <GlassPanel title="NEW LEADS">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Discovered this session" value={session.newFound} tone="text-success" />
        <Stat label="Already seen · skipped" value={session.skipped} tone="text-muted-foreground" />
      </div>
      {last && (
        <button onClick={onMore} disabled={searching}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1.5 text-[10px] tracking-wider text-accent-bright transition hover:bg-accent/20 disabled:opacity-40">
          {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          FIND {last.limit} MORE · {last.category.toUpperCase()} · {last.location.toUpperCase()}
        </button>
      )}
    </GlassPanel>
  );
}

/* ================= CRM metrics ================= */
export interface CrmMetrics { total: number; new: number; noWebsite: number; withPhone: number; contacted: number; followUps: number; followUpsDue: number; interested: number; converted: number; notInterested: number }

export function CrmPanel({ crm, onPick }: { crm: CrmMetrics | null; onPick: (p: { stage?: string; filter?: LeadFilter }) => void }) {
  const tiles: { label: string; value: number; tone?: string; pick: { stage?: string; filter?: LeadFilter } }[] = [
    { label: "Total", value: crm?.total ?? 0, pick: {} },
    { label: "New", value: crm?.new ?? 0, tone: "text-accent-bright", pick: { stage: "new" } },
    { label: "No website", value: crm?.noWebsite ?? 0, tone: "text-warning", pick: { filter: "no_website" } },
    { label: "With phone", value: crm?.withPhone ?? 0, tone: "text-success", pick: { filter: "phone" } },
    { label: "Contacted", value: crm?.contacted ?? 0, tone: "text-sky-300", pick: { stage: "contacted" } },
    { label: "Follow-ups", value: crm?.followUps ?? 0, tone: "text-warning", pick: { stage: "follow_up" } },
    { label: "Interested", value: crm?.interested ?? 0, tone: "text-fuchsia-300", pick: { stage: "interested" } },
    { label: "Converted", value: crm?.converted ?? 0, tone: "text-success", pick: { stage: "converted" } },
  ];
  return (
    <GlassPanel title="CRM">
      <div className="grid grid-cols-4 gap-1.5">
        {tiles.map((t) => (
          <button key={t.label} onClick={() => onPick(t.pick)} title={`Show ${t.label.toLowerCase()} leads`}
            className="rounded-lg border border-white/5 bg-white/[0.02] px-1 py-1.5 text-center transition hover:border-accent/30 hover:bg-accent/5">
            <div className={cn("text-lg font-light leading-none", t.tone ?? "text-foreground/90")}>{t.value}</div>
            <div className="mt-1 truncate text-[8px] uppercase tracking-wider text-muted-foreground">{t.label}</div>
          </button>
        ))}
      </div>
    </GlassPanel>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-2 py-1.5">
      <div className={cn("text-2xl font-light leading-none", tone)}>{value}</div>
      <div className="mt-1 text-[8px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

/* ================= FOLLOW-UPS ================= */
export function FollowUpsPanel({ items, dueCount, onOpen }: { items: LeadDTO[]; dueCount: number; onOpen: (l: LeadDTO) => void }) {
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  return (
    <GlassPanel title="FOLLOW-UPS" right={dueCount > 0 ? <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] text-warning">{dueCount} due</span> : null}>
      {items.length === 0 ? (
        <p className="py-1 text-[10px] leading-snug text-muted-foreground">No follow-ups scheduled. Set a follow-up date on any lead in the table below.</p>
      ) : (
        <div className="space-y-1.5">
          {items.slice(0, 5).map((l) => {
            const due = l.nextFollowUpAt && new Date(l.nextFollowUpAt) <= endOfToday;
            return (
              <div key={l.id} className="rounded-lg border border-white/5 bg-white/[0.02] px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <CalendarClock className={cn("h-3 w-3 shrink-0", due ? "text-warning" : "text-muted-foreground")} />
                  <button onClick={() => onOpen(l)} className="min-w-0 flex-1 truncate text-left text-[11px] text-foreground/90 hover:text-accent">{l.businessName}</button>
                  <span className={cn("shrink-0 text-[9px]", due ? "text-warning" : "text-muted-foreground")}>{fmtDate(l.nextFollowUpAt)}</span>
                </div>
                <div className="mt-1 pl-4"><PhoneActions lead={l} compact /></div>
              </div>
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}

/* ================= result banner ================= */
export type BannerState = { kind: "ok"; result: FindLeadsResult } | { kind: "error"; message: string } | null;

export function ResultBanner({ state, onClose }: { state: BannerState; onClose: () => void }) {
  if (!state) return null;
  if (state.kind === "error") {
    return (
      <Shell tone="error" onClose={onClose}>
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="text-xs text-foreground/90">{state.message}</span>
      </Shell>
    );
  }
  const r = state.result;
  const tone = r.newCount > 0 ? "ok" : r.stoppedReason === "rate_limit" ? "error" : "info";
  return (
    <Shell tone={tone} onClose={onClose}>
      {r.newCount > 0 ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : r.stoppedReason === "rate_limit" ? <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" /> : <Info className="h-4 w-4 shrink-0 text-accent" />}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground/95">{r.message}</p>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[9px] uppercase tracking-wider">
          <Pill className="text-success">{r.newCount} new</Pill>
          <Pill className="text-muted-foreground">{r.skippedDuplicates} previously discovered</Pill>
          <Pill className="text-muted-foreground">near {r.center.label.split(",").slice(0, 2).join(",")}</Pill>
          <Pill className="text-muted-foreground">radius {r.radiusKm} km</Pill>
          <Pill className="text-muted-foreground">{r.requests} API request{r.requests === 1 ? "" : "s"}</Pill>
          {r.exhausted && <Pill className="text-warning">area exhausted</Pill>}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ tone, onClose, children }: { tone: "ok" | "error" | "info"; onClose: () => void; children: React.ReactNode }) {
  const border = tone === "ok" ? "border-success/30" : tone === "error" ? "border-destructive/40" : "border-accent/30";
  return (
    <div className={cn("relative flex items-start gap-2.5 rounded-2xl border bg-white/[0.04] px-4 py-2.5 backdrop-blur-xl", border)} style={{ animation: "dw-pop-in .45s cubic-bezier(.2,.9,.25,1.15) both" }}>
      {children}
      <button onClick={onClose} aria-label="Dismiss" className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}
function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-0.5", className)}>{children}</span>;
}
