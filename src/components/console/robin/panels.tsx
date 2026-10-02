"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Loader2, Check, Download, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RobinAnalytics } from "@/lib/robin/analytics";
import { STAGE_LABEL, money, type RobinSettings, type Stage, CLIENT_STATUSES } from "@/lib/robin/types";
import { rapi, when, localInput } from "./api";
import { Count } from "./anim";

/** Glass drawers around the chart: follow-ups, demos, quotations, clients, leads, analytics, settings. */

export function Drawer({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cn("robin-drawer relative flex max-h-[88vh] w-full flex-col rounded-t-2xl border border-cyan-300/15 bg-slate-950/90 shadow-[0_0_80px_rgba(8,145,178,0.2)] backdrop-blur-2xl sm:rounded-2xl", wide ? "sm:max-w-5xl" : "sm:max-w-2xl")} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <p className="text-[11px] tracking-[0.3em] text-cyan-100">{title}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="robin-scroll flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
const Spin = () => <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-cyan-300" /></div>;
const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-8 text-center text-sm text-slate-400">{children}</p>;
const field = "w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-300/50";

// ---------------------------------------------------------------- follow-ups
interface FU { id: string; action: string; dueAt: string; priority: string; notes: string | null; lead: { id: string; number?: number | null; businessName: string; stage: string; priority: string } }
const Num = ({ n }: { n?: number | null }) => (n != null ? <span className="mr-1.5 rounded bg-cyan-300/10 px-1 text-[10.5px] font-semibold text-cyan-200">#{n}</span> : null);
export function FollowUpsPanel({ tz, onOpenLead, onChanged, say, onClose }: { tz: string; onOpenLead: (id: string) => void; onChanged: () => void; say: (t: string) => void; onClose: () => void }) {
  const [q, setQ] = useState<{ overdue: FU[]; today: FU[]; upcoming: FU[] } | null>(null);
  const [asked, setAsked] = useState<FU | null>(null);
  const load = useCallback(async () => { const r = await rapi("followups"); if (r.data) setQ(r.data); }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (f: FU, action: "complete" | "cancel") => {
    const r = await rapi(`followups/${f.id}`, "PATCH", { action });
    if (!r.ok) return say(r.error ?? "That didn't work.");
    await load(); onChanged();
    if (action === "complete") { setAsked(f); say("Follow-up completed. Would you like to schedule the next one?"); }
  };
  const group = (title: string, rows: FU[], tone: string) => rows.length ? (
    <div className="mb-4">
      <p className={cn("mb-1.5 text-[10px] tracking-[0.28em]", tone)}>{title} · {rows.length}</p>
      {rows.map((f, i) => (
        <div key={f.id} className="robin-row flex items-center gap-3 border-b border-white/[0.04] py-2 text-xs" style={{ animationDelay: `${i * 30}ms` }}>
          <button type="button" onClick={() => onOpenLead(f.lead.id)} className="min-w-0 flex-1 text-left">
            <Num n={f.lead.number} /><span className="font-medium text-slate-100 hover:text-cyan-200">{f.lead.businessName}</span>
            <span className="ml-2 text-slate-400">{f.action} · {when(f.dueAt, tz)}</span>
            {f.notes ? <span className="mt-0.5 block whitespace-pre-line text-[11px] leading-snug text-slate-300/80">📝 {f.notes}</span> : <span className="block text-[10.5px] italic text-slate-600">No note — say &quot;note for {f.lead.number ?? f.lead.businessName}: …&quot;</span>}
          </button>
          <span className={cn("rounded-full border px-2 py-0.5 text-[9px] tracking-[0.12em]", f.priority === "high" ? "border-cyan-300/40 text-cyan-200" : "border-white/10 text-slate-400")}>{f.priority.toUpperCase()}</span>
          <span className="text-[10px] text-slate-500">{STAGE_LABEL[f.lead.stage as Stage]}</span>
          <button type="button" onClick={() => void act(f, "complete")} className="robin-btn rounded-full border border-emerald-300/30 px-2 py-0.5 text-[10px] text-emerald-100"><Check className="mr-0.5 inline h-3 w-3" />Done</button>
          <button type="button" onClick={() => void act(f, "cancel")} className="text-[10px] text-slate-500 hover:text-slate-300">Cancel</button>
        </div>
      ))}
    </div>
  ) : null;
  return (
    <Drawer title="FOLLOW-UPS" onClose={onClose}>
      {asked && (
        <div className="robin-sheet mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.04] px-3 py-2">
          <p className="text-xs text-slate-100">Follow-up with {asked.lead.businessName} completed. Schedule the next one?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAsked(null)} className="robin-btn rounded-full border border-white/10 px-3 py-0.5 text-[11px] text-slate-300">No</button>
            <button type="button" onClick={() => { const id = asked.lead.id; setAsked(null); onOpenLead(id); }} className="robin-btn rounded-full border border-cyan-300/50 bg-cyan-300/15 px-3 py-0.5 text-[11px] text-cyan-50">Yes</button>
          </div>
        </div>
      )}
      {!q ? <Spin /> : !q.overdue.length && !q.today.length && !q.upcoming.length ? <Empty>No follow-ups scheduled. Schedule one from any lead.</Empty> : (
        <>
          {group("OVERDUE", q.overdue, "text-amber-300")}
          {group("TODAY", q.today, "text-emerald-300")}
          {group("UPCOMING", q.upcoming, "text-slate-400")}
          <p className="mt-2 text-[10px] text-slate-500">These are your tasks. Robin never contacts anyone automatically.</p>
        </>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- demos
interface Demo { id: string; scheduledAt: string; demoType: string; status: string; notes: string | null; lead: { id: string; businessName: string; category: string | null } }
export function DemosPanel({ tz, onOpenLead, onChanged, say, onClose }: { tz: string; onOpenLead: (id: string) => void; onChanged: () => void; say: (t: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Demo[] | null>(null);
  const [resched, setResched] = useState<{ id: string; at: string } | null>(null);
  const load = useCallback(async () => { const r = await rapi<{ demos: Demo[] }>("demos"); if (r.data) setRows(r.data.demos); }, []);
  useEffect(() => { void load(); }, [load]);
  const set = async (id: string, status: string, at?: string) => {
    const r = await rapi(`demos/${id}`, "PATCH", { status, ...(at ? { at: new Date(at).toISOString() } : {}) });
    if (!r.ok) return say(r.error ?? "That didn't work.");
    setResched(null); await load(); onChanged();
  };
  const upcoming = (rows ?? []).filter((d) => ["scheduled", "rescheduled"].includes(d.status));
  const past = (rows ?? []).filter((d) => !["scheduled", "rescheduled"].includes(d.status));
  return (
    <Drawer title="DEMOS" onClose={onClose}>
      {!rows ? <Spin /> : !rows.length ? <Empty>No demos yet.</Empty> : (
        [["SCHEDULED", upcoming], ["HISTORY", past]].map(([t, list]) => (list as Demo[]).length ? (
          <div key={t as string} className="mb-4">
            <p className="mb-1.5 text-[10px] tracking-[0.28em] text-slate-400">{t as string}</p>
            {(list as Demo[]).map((d) => (
              <div key={d.id} className="robin-row flex flex-wrap items-center gap-2 border-b border-white/[0.04] py-2 text-xs">
                <button type="button" onClick={() => onOpenLead(d.lead.id)} className="min-w-0 flex-1 text-left"><span className="font-medium text-slate-100">{d.lead.businessName}</span><span className="ml-2 text-slate-400">{d.demoType.replace("_", " ")} · {when(d.scheduledAt, tz)}</span></button>
                <span className="text-[10px] tracking-[0.14em] text-slate-400">{d.status.toUpperCase()}</span>
                {["scheduled", "rescheduled"].includes(d.status) && (
                  resched?.id === d.id ? (
                    <span className="flex gap-1"><input type="datetime-local" className={cn(field, "w-auto py-0.5")} value={resched.at} onChange={(e) => setResched({ id: d.id, at: e.target.value })} /><button type="button" onClick={() => void set(d.id, "rescheduled", resched.at)} className="robin-btn rounded-full border border-cyan-300/40 px-2 py-0.5 text-[10px] text-cyan-100">Save</button></span>
                  ) : (
                    <span className="flex gap-1">
                      <button type="button" onClick={() => void set(d.id, "completed")} className="robin-btn rounded-full border border-emerald-300/30 px-2 py-0.5 text-[10px] text-emerald-100">Completed</button>
                      <button type="button" onClick={() => setResched({ id: d.id, at: localInput(new Date(d.scheduledAt)) })} className="robin-btn rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-300">Reschedule</button>
                      <button type="button" onClick={() => void set(d.id, "cancelled")} className="text-[10px] text-slate-500 hover:text-slate-300">Cancel</button>
                    </span>
                  )
                )}
              </div>
            ))}
          </div>
        ) : null)
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- quotations
interface Quote { id: string; number: string; status: string; total: number; currency: string; createdAt: string; validUntil: string | null; items: { service: string }[]; lead: { id: string; businessName: string } }
export function QuotationsPanel({ onOpenLead, onClose }: { onOpenLead: (id: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Quote[] | null>(null);
  useEffect(() => { void rapi<{ quotations: Quote[] }>("quotations").then((r) => setRows(r.data?.quotations ?? [])); }, []);
  const tone: Record<string, string> = { draft: "text-slate-300", sent: "text-sky-300", accepted: "text-emerald-300", rejected: "text-rose-300", expired: "text-amber-300" };
  return (
    <Drawer title="QUOTATIONS" onClose={onClose}>
      {!rows ? <Spin /> : !rows.length ? <Empty>No quotations yet. Prepare one from a lead (QUOTE).</Empty> : rows.map((q, i) => (
        <div key={q.id} className="robin-row flex flex-wrap items-center gap-3 border-b border-white/[0.04] py-2.5 text-xs" style={{ animationDelay: `${i * 25}ms` }}>
          <button type="button" onClick={() => onOpenLead(q.lead.id)} className="min-w-0 flex-1 text-left">
            <span className="font-medium text-slate-100">{q.lead.businessName}</span>
            <span className="ml-2 text-slate-500">{q.number} · {q.items.map((x) => x.service).join(" + ")}</span>
          </button>
          <span className="font-medium text-slate-100">{money(q.total, q.currency)}</span>
          <span className={cn("w-20 text-right text-[10px] tracking-[0.14em]", tone[q.status])}>{q.status.toUpperCase()}</span>
          <a href={`/api/robin/quotations/${q.id}/pdf`} className="robin-btn inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-200"><Download className="h-3 w-3" />PDF</a>
        </div>
      ))}
    </Drawer>
  );
}

// ---------------------------------------------------------------- clients
interface Client { id: string; leadId: string; businessName: string; contactName: string | null; project: string | null; service: string | null; amount: number; currency: string; paymentStatus: string; status: string; startDate: string | null; deliveryDate: string | null; notes: string | null; paid: number; payments: { id: string; amount: number; paidAt: string; method: string | null }[] }
export function ClientsPanel({ onOpenLead, onClose, say }: { onOpenLead: (id: string) => void; onClose: () => void; say: (t: string) => void }) {
  const [rows, setRows] = useState<Client[] | null>(null);
  const [pay, setPay] = useState<{ id: string; amount: string; method: string } | null>(null);
  const load = useCallback(async () => { const r = await rapi<{ clients: Client[] }>("clients"); setRows(r.data?.clients ?? []); }, []);
  useEffect(() => { void load(); }, [load]);
  const patch = async (id: string, body: Record<string, unknown>) => { const r = await rapi(`clients/${id}`, "PATCH", body); if (!r.ok) say(r.error ?? "That didn't work."); await load(); };
  const titles: Record<string, string> = { active: "ACTIVE CLIENTS", completed: "COMPLETED PROJECTS", maintenance: "MAINTENANCE CLIENTS", inactive: "INACTIVE CLIENTS" };
  return (
    <Drawer title="CLIENTS" onClose={onClose} wide>
      {!rows ? <Spin /> : !rows.length ? <Empty>No clients yet. A lead becomes a client when you convert it after its quotation is accepted.</Empty> : CLIENT_STATUSES.map((st) => {
        const list = rows.filter((c) => c.status === st);
        if (!list.length) return null;
        return (
          <div key={st} className="mb-5">
            <p className="mb-2 text-[10px] tracking-[0.28em] text-cyan-200/70">{titles[st]} · {list.length}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((c) => (
                <div key={c.id} className="robin-row rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => onOpenLead(c.leadId)} className="text-left"><p className="font-semibold text-slate-100">{c.businessName}</p><p className="text-slate-400">{c.project ?? c.service ?? "—"}</p></button>
                    <div className="text-right"><p className="font-semibold text-slate-100">{money(c.amount, c.currency)}</p><p className={cn("text-[10px] tracking-[0.12em]", c.paymentStatus === "paid" ? "text-emerald-300" : c.paymentStatus === "partial" ? "text-amber-300" : "text-slate-400")}>{c.paymentStatus.toUpperCase()} · {money(c.paid, c.currency)} paid</p></div>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">{c.contactName ? `${c.contactName} · ` : ""}Started {c.startDate ? new Date(c.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}{c.deliveryDate ? ` · Delivery ${new Date(c.deliveryDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <select aria-label="Client status" value={c.status} onChange={(e) => void patch(c.id, { status: e.target.value })} className="rounded-full border border-white/10 bg-transparent px-2 py-0.5 text-[10px] text-slate-200 outline-none">
                      {CLIENT_STATUSES.map((s) => <option className="bg-slate-900" key={s} value={s}>{s}</option>)}
                    </select>
                    <input type="date" aria-label="Delivery date" value={c.deliveryDate ? c.deliveryDate.slice(0, 10) : ""} onChange={(e) => void patch(c.id, { deliveryDate: e.target.value || null })} className="rounded-full border border-white/10 bg-transparent px-2 py-0.5 text-[10px] text-slate-200 outline-none" />
                    {pay?.id === c.id ? (
                      <span className="flex items-center gap-1">
                        <input autoFocus className={cn(field, "w-24 py-0.5")} placeholder="amount" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/[^\d.]/g, "") })} />
                        <input className={cn(field, "w-20 py-0.5")} placeholder="UPI…" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} />
                        <button type="button" disabled={!Number(pay.amount)} onClick={async () => { await patch(c.id, { payment: { amount: Number(pay.amount), method: pay.method || null } }); setPay(null); say("Payment recorded."); }} className="robin-btn rounded-full border border-emerald-300/40 px-2 py-0.5 text-[10px] text-emerald-100">Save</button>
                      </span>
                    ) : <button type="button" onClick={() => setPay({ id: c.id, amount: "", method: "" })} className="robin-btn rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-200">+ Payment</button>}
                  </div>
                  {c.payments.length > 0 && <p className="mt-1.5 text-[10px] text-slate-500">{c.payments.slice(0, 3).map((p) => `${money(p.amount, c.currency)} ${new Date(p.paidAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}${p.method ? ` (${p.method})` : ""}`).join(" · ")}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </Drawer>
  );
}

// ---------------------------------------------------------------- leads list (filters, voice results)
interface LeadRow { id: string; number?: number | null; businessName: string; category: string | null; stage: string; priority: string; score: number; potentialValue: number | null; city: string | null; lastContactAt: string | null }
export function LeadsPanel({ title, query, currency, onOpenLead, onClose }: { title: string; query: string; currency: string; onOpenLead: (id: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { setRows(null); void rapi<{ leads: LeadRow[] }>(`leads?${query}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then((r) => setRows(r.data?.leads ?? [])); }, [query, q]);
  return (
    <Drawer title={title} onClose={onClose}>
      <input className={cn(field, "mb-3")} placeholder="Search by name, category or city…" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows && rows.length > 0 && <p className="mb-2 text-[10px] tracking-[0.18em] text-slate-500">{rows.length} LEAD{rows.length === 1 ? "" : "S"}</p>}
      {!rows ? <Spin /> : !rows.length ? <Empty>No leads match.</Empty> : rows.map((l, i) => (
        <button key={l.id} type="button" onClick={() => onOpenLead(l.id)} className="robin-row flex w-full items-center gap-3 border-b border-white/[0.04] py-2 text-left text-xs hover:bg-white/[0.02]" style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}>
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", l.priority === "high" ? "bg-cyan-300 shadow-[0_0_8px_#67e8f9]" : l.priority === "medium" ? "bg-sky-400/70" : "bg-slate-500")} />
          <span className="min-w-0 flex-1"><Num n={l.number} /><span className="font-medium text-slate-100">{l.businessName}</span><span className="ml-2 text-slate-500">{[l.category, l.city].filter(Boolean).join(" · ")}</span></span>
          <span className="text-slate-400">{STAGE_LABEL[l.stage as Stage]}</span>
          <span className="w-8 text-right font-semibold text-cyan-200">{l.score}</span>
          <span className="w-20 text-right text-emerald-300">{l.potentialValue != null ? money(l.potentialValue, currency, true) : "—"}</span>
        </button>
      ))}
    </Drawer>
  );
}

// ---------------------------------------------------------------- add a lead by hand
export function AddLeadPanel({ onClose, onCreated, say }: { onClose: () => void; onCreated: (id: string, duplicate: boolean) => void; say: (t: string) => void }) {
  const [f, setF] = useState({ businessName: "", category: "", phone: "", email: "", instagram: "", city: "", websiteStatus: "unknown" });
  const [busy, setBusy] = useState(false);
  return (
    <Drawer title="ADD A LEAD" onClose={onClose}>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        const r = await rapi<{ lead: { id: string }; duplicate: boolean }>("leads", "POST", { ...f, email: f.email || null });
        setBusy(false);
        if (!r.ok || !r.data) return say(r.error ?? "Couldn't add it.");
        onCreated(r.data.lead.id, r.data.duplicate);
      }}>
        {([["businessName", "Business name *"], ["category", "Category (e.g. Cafe)"], ["phone", "Phone"], ["email", "Email"], ["instagram", "Instagram"], ["city", "City / area"]] as const).map(([k, ph]) => (
          <input key={k} className={field} placeholder={ph} required={k === "businessName"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        ))}
        <select className={field} value={f.websiteStatus} onChange={(e) => setF({ ...f, websiteStatus: e.target.value })}>
          {[["unknown", "Website: unknown"], ["no_website", "No website"], ["has_website", "Has a website"], ["outdated", "Outdated website"], ["poor", "Poor website"]].map(([v, t]) => <option className="bg-slate-900" key={v} value={v}>{t}</option>)}
        </select>
        <p className="text-[10px] text-slate-500 sm:col-span-2">DARWIN's leads arrive automatically — use this for referrals and walk-ins. Robin checks for duplicates first.</p>
        <div className="flex justify-end sm:col-span-2"><button type="submit" disabled={busy} className="robin-btn rounded-full border border-cyan-300/50 bg-cyan-300/15 px-4 py-1 text-[11px] text-cyan-50">{busy ? "Adding…" : "Add lead"}</button></div>
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------- settings (services + prices)
interface Svc { id?: string; name: string; description: string | null; price: number | null; unit: string | null; active: boolean }
export function SettingsPanel({ onClose, say, onSaved }: { onClose: () => void; say: (t: string) => void; onSaved: () => void }) {
  const [s, setS] = useState<RobinSettings | null>(null);
  const [svc, setSvc] = useState<Svc[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void rapi<{ settings: RobinSettings; services: Svc[] }>("settings").then((r) => { if (r.data) { setS(r.data.settings); setSvc(r.data.services); } }); }, []);
  if (!s) return <Drawer title="ROBIN SETTINGS" onClose={onClose}><Spin /></Drawer>;
  const set = <K extends keyof RobinSettings>(k: K, v: RobinSettings[K]) => setS({ ...s, [k]: v });
  return (
    <Drawer title="ROBIN SETTINGS" onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2.5">
          <p className="text-[10px] tracking-[0.28em] text-cyan-200/70">DARWIN → ROBIN</p>
          <label className="flex items-center gap-2 text-xs text-slate-200"><input type="checkbox" checked={s.autoImport} onChange={(e) => set("autoImport", e.target.checked)} />Receive DARWIN&apos;s new leads automatically</label>
          <label className="flex items-center gap-2 text-xs text-slate-200"><input type="checkbox" checked={s.morningReport} onChange={(e) => set("morningReport", e.target.checked)} />Morning sales briefing when Robin first opens each day</label>
          <p className="pt-2 text-[10px] tracking-[0.28em] text-cyan-200/70">QUOTATIONS</p>
          {([["companyName", "Company name"], ["companyPhone", "Company phone"], ["companyEmail", "Company email"], ["companyAddress", "Company address"]] as const).map(([k, ph]) => (
            <input key={k} className={field} placeholder={ph} value={s[k]} onChange={(e) => set(k, e.target.value)} />
          ))}
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[10px] text-slate-400">Currency<input className={field} value={s.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></label>
            <label className="text-[10px] text-slate-400">Tax %<input className={field} inputMode="decimal" value={String(s.taxPct)} onChange={(e) => set("taxPct", Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} /></label>
            <label className="text-[10px] text-slate-400">Valid (days)<input className={field} inputMode="numeric" value={String(s.quoteValidityDays)} onChange={(e) => set("quoteValidityDays", Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))} /></label>
          </div>
          <textarea className={cn(field, "min-h-[56px]")} placeholder="Payment terms" value={s.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
        </div>
        <div>
          <p className="mb-2 text-[10px] tracking-[0.28em] text-cyan-200/70">SERVICES &amp; PRICES</p>
          <p className="mb-2 text-[10px] text-slate-500">Robin never sets or changes a price — these are yours. Empty = Robin asks for a price when quoting.</p>
          {svc.map((x, i) => (
            <div key={x.id ?? `n${i}`} className="mb-1.5 grid grid-cols-[1fr_90px_80px_24px] items-center gap-1.5">
              <input className={field} value={x.name} onChange={(e) => setSvc(svc.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <input className={field} placeholder="price" inputMode="decimal" value={x.price ?? ""} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); setSvc(svc.map((y, j) => (j === i ? { ...y, price: v === "" ? null : Number(v) } : y))); }} />
              <input className={field} placeholder="unit" value={x.unit ?? ""} onChange={(e) => setSvc(svc.map((y, j) => (j === i ? { ...y, unit: e.target.value || null } : y)))} />
              <button type="button" aria-label="Remove service" onClick={() => { if (x.id) setRemoved([...removed, x.id]); setSvc(svc.filter((_, j) => j !== i)); }} className="text-slate-500 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setSvc([...svc, { name: "", description: null, price: null, unit: null, active: true }])} className="robin-btn mt-1 inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-0.5 text-[10px] text-slate-200"><Plus className="h-3 w-3" />Service</button>
        </div>
      </div>
      <VoiceSection say={say} />
      <div className="mt-5 flex justify-end">
        <button type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await rapi("settings", "PATCH", { settings: s, services: svc.filter((x) => x.name.trim()), removeServices: removed });
          setBusy(false);
          if (!r.ok) return say(r.error ?? "Couldn't save the settings.");
          say("Settings saved."); onSaved(); onClose();
        }} className="robin-btn rounded-full border border-cyan-300/50 bg-cyan-300/15 px-4 py-1 text-[11px] text-cyan-50">{busy ? "Saving…" : "Save settings"}</button>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------- Robin's own voice
interface VoiceStatus { voiceId: string | null; description: string; createdAt: string | null; error: string | null; creating: boolean; using: "env" | "designed" | "default"; elevenLabs: boolean }
function VoiceSection({ say }: { say: (t: string) => void }) {
  const [v, setV] = useState<VoiceStatus | null>(null);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await rapi<VoiceStatus>("voice"); if (r.data) { setV(r.data); setDesc((d) => d || r.data!.description); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!v?.creating) return; const t = setInterval(() => void load(), 4000); return () => clearInterval(t); }, [v?.creating, load]);
  const play = (src: string) => { try { void new Audio(src).play(); } catch { /* ignore */ } };
  const hear = async () => {
    const r = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hey! It's Robin. Ready when you are — let's turn some leads into clients today.", agent: "robin" }) });
    if (!r.ok) return say((await r.json().catch(() => ({})))?.error ?? "Couldn't play the voice.");
    play(URL.createObjectURL(await r.blob()));
  };
  if (!v) return null;
  return (
    <div className="mt-5 border-t border-white/[0.06] pt-4">
      <p className="mb-1 text-[10px] tracking-[0.28em] text-cyan-200/70">ROBIN&apos;S VOICE</p>
      <p className="mb-2 text-[11px] text-slate-400">
        {v.using === "env" ? "Using the voice set in ROBIN_VOICE_ID." : v.using === "designed" ? `Robin's own voice, designed ${v.createdAt ? new Date(v.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""} from the description below.` : v.creating ? "Designing Robin's voice…" : "Using the stock voice (Eric) until Robin's own voice is created."}
        {!v.elevenLabs && " Needs ELEVENLABS_API_KEY."}
      </p>
      {v.error && <p className="mb-2 text-[11px] text-amber-200">Last try: {v.error}</p>}
      <textarea className={cn(field, "min-h-[60px]")} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Describe the voice — age, accent, tone, energy…" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy || v.creating || !v.elevenLabs} onClick={async () => {
          setBusy(true); setV({ ...v, creating: true });
          const r = await rapi<VoiceStatus & { preview: string | null }>("voice", "POST", { action: "create", description: desc });
          setBusy(false); await load();
          if (!r.ok) return say(r.error ?? "Couldn't create the voice.");
          if (r.data?.preview) play(`data:audio/mpeg;base64,${r.data.preview}`);
          say("Here's my new voice — how do I sound?");
        }} className="robin-btn inline-flex items-center gap-1 rounded-full border border-cyan-300/50 bg-cyan-300/15 px-3 py-1 text-[11px] text-cyan-50 disabled:opacity-40">
          {(busy || v.creating) && <Loader2 className="h-3 w-3 animate-spin" />}{v.using === "designed" ? "Create a new voice" : "Create Robin's voice"}
        </button>
        <button type="button" disabled={!v.elevenLabs} onClick={() => void hear()} className="robin-btn rounded-full border border-white/10 px-3 py-1 text-[11px] text-slate-200 disabled:opacity-40">Hear it</button>
      </div>
      <p className="mt-1.5 text-[10px] text-slate-500">ElevenLabs designs a brand-new voice from your description and saves it to your ElevenLabs account (it uses one custom-voice slot; the previous Robin voice is removed).</p>
    </div>
  );
}

// ---------------------------------------------------------------- analytics
// Colors: validated dark-mode reference palette — slot 1 blue (won revenue), slot 2 orange (received).
const C = { won: "#3987e5", received: "#d95926", bar: "#3987e5", grid: "rgba(148,163,184,0.15)", ink2: "#c3c2b7" };
type Tip = { x: number; y: number; text: string } | null;

export function AnalyticsPanel({ onClose }: { onClose: () => void }) {
  const [range, setRange] = useState<"today" | "7d" | "30d" | "90d" | "custom">("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [a, setA] = useState<RobinAnalytics | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    if (range === "custom" && (!from || !to)) return;
    setA(null);
    void rapi<RobinAnalytics>(`analytics?range=${range}${range === "custom" ? `&from=${from}&to=${to}` : ""}`).then((r) => setA(r.data ?? null));
  }, [range, from, to]);
  return (
    <Drawer title="SALES ANALYTICS" onClose={onClose} wide>
      {/* filters: one row above the charts */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {(["today", "7d", "30d", "90d", "custom"] as const).map((r) => (
          <button key={r} type="button" onClick={() => setRange(r)} className={cn("robin-btn rounded-full border px-3 py-0.5 text-[10.5px] tracking-[0.12em]", range === r ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-50" : "border-white/10 text-slate-300")}>{{ today: "TODAY", "7d": "7 DAYS", "30d": "30 DAYS", "90d": "90 DAYS", custom: "CUSTOM" }[r]}</button>
        ))}
        {range === "custom" && <><input type="date" aria-label="From" className={cn(field, "w-auto py-0.5")} value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" aria-label="To" className={cn(field, "w-auto py-0.5")} value={to} onChange={(e) => setTo(e.target.value)} /></>}
        <button type="button" onClick={() => setTable(!table)} className="ml-auto text-[10px] tracking-[0.16em] text-slate-400 hover:text-white">{table ? "CHARTS" : "TABLE VIEW"}</button>
      </div>
      {!a ? <Spin /> : table ? <AnalyticsTable a={a} /> : (
        <div className="space-y-6">
          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile k="Leads" v={<Count value={a.totals.leads} />} sub={`${a.totals.qualified} qualified`} />
            <Tile k="Won deals" v={<Count value={a.totals.won} />} sub={`${a.totals.lost} lost`} />
            <Tile k="Revenue" v={money(a.totals.revenue, a.currency)} sub={`${money(a.totals.received, a.currency)} received`} />
            <Tile k="Average deal" v={a.totals.avgDeal != null ? money(a.totals.avgDeal, a.currency) : "—"} sub="per won deal" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([["Contact rate", a.rates.contact], ["Response rate", a.rates.response], ["Interested rate", a.rates.interested], ["Demo rate", a.rates.demo], ["Quotation rate", a.rates.quotation], ["Conversion rate", a.rates.conversion], ["Follow-up completion", a.rates.followUpCompletion]] as const).map(([k, r]) => (
              <Tile key={k} k={k} v={r.value != null ? `${r.value}%` : "—"} sub={r.den ? `${r.num} of ${r.den}` : "no data yet"} small />
            ))}
          </div>
          <Funnel a={a} />
          <RevenueLine a={a} />
          <ActivityMultiples a={a} />
          <div className="grid gap-5 md:grid-cols-2">
            <Breakdown title="LEAD SOURCES" rows={a.sources} />
            <Breakdown title="CATEGORIES" rows={a.categories} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile k="Follow-ups scheduled" v={a.followUps.scheduled} small />
            <Tile k="Completed" v={a.followUps.completed} sub={`${a.followUps.onTime} on time`} small />
            <Tile k="Missed (overdue)" v={a.followUps.missed} small />
            <Tile k="Won / lost" v={`${a.wonLost.won} / ${a.wonLost.lost}`} small />
          </div>
          <p className="text-[10px] text-slate-500">Rates are plain ratios of CRM records for {a.range.from} → {a.range.to} (leads that arrived in the period). Nothing is estimated.</p>
        </div>
      )}
    </Drawer>
  );
}
function Tile({ k, v, sub, small }: { k: string; v: React.ReactNode; sub?: string; small?: boolean }) {
  return (
    <div className="robin-row rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[9.5px] tracking-[0.18em] text-slate-400">{k.toUpperCase()}</p>
      <p className={cn("mt-0.5 font-semibold text-slate-50", small ? "text-base" : "text-xl")}>{v}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}
function Chart({ title, children, legend }: { title: string; children: React.ReactNode; legend?: React.ReactNode }) {
  return <div><div className="mb-2 flex items-center justify-between"><p className="text-[10px] tracking-[0.28em] text-cyan-200/70">{title}</p>{legend}</div>{children}</div>;
}
function TipBox({ tip }: { tip: Tip }) {
  return tip ? <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-white/10 bg-slate-900/95 px-2 py-1 text-[10.5px] text-slate-100 shadow-lg" style={{ left: tip.x, top: tip.y - 6 }}>{tip.text}</div> : null;
}
function Funnel({ a }: { a: RobinAnalytics }) {
  const rows = a.funnel.filter((f) => f.id !== "lost");
  const max = Math.max(1, ...rows.map((r) => r.count));
  const [tip, setTip] = useState<Tip>(null);
  return (
    <Chart title="FUNNEL">
      <div className="relative space-y-1" onMouseLeave={() => setTip(null)}>
        {rows.map((r, i) => {
          const pct = i && rows[i - 1].count ? Math.round((r.count / rows[i - 1].count) * 100) : null;
          return (
            <div key={r.id} className="grid items-center gap-2 text-[10.5px]" style={{ gridTemplateColumns: "96px 1fr 120px" }}
              onMouseMove={(e) => { const b = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); setTip({ x: e.clientX - b.left, y: e.clientY - b.top, text: `${r.label}: ${r.count}${pct != null ? ` (${pct}% of previous)` : ""}` }); }}>
              <span className="text-right tracking-[0.16em] text-slate-300">{i === 0 ? "ALL LEADS" : r.label}</span>
              <div className="h-4"><div className="h-full rounded-r-[4px] transition-all duration-700" style={{ width: `${r.count ? Math.max(1.5, (r.count / max) * 100) : 0}%`, background: C.bar, transitionDelay: `${i * 60}ms` }} /></div>
              <span className="text-slate-200">{r.count}<span className="ml-1 text-slate-500">{pct != null ? `· ${pct}%` : ""}</span></span>
            </div>
          );
        })}
        <TipBox tip={tip} />
      </div>
    </Chart>
  );
}
function useWidth() {
  const [w, setW] = useState(600);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
  }, []);
  return [w, ref] as const;
}
function RevenueLine({ a }: { a: RobinAnalytics }) {
  const [W, ref] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 160, pl = 54, pr = 12, pt = 10, pb = 22;
  const n = a.revenueSeries.labels.length;
  const max = Math.max(1, ...a.revenueSeries.won, ...a.revenueSeries.received);
  const x = (i: number) => pl + (n <= 1 ? 0 : (i / (n - 1)) * (W - pl - pr));
  const y = (v: number) => pt + (1 - v / max) * (H - pt - pb);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const any = a.revenueSeries.won.some(Boolean) || a.revenueSeries.received.some(Boolean);
  const ticks = [0, 0.5, 1].map((t) => t * max);
  return (
    <Chart title={`REVENUE${a.range.weekly ? " (WEEKLY)" : ""}`} legend={<span className="flex gap-3 text-[10px] text-slate-300"><span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3" style={{ background: C.won }} />Won (deal value)</span><span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3" style={{ background: C.received }} />Received</span></span>}>
      <div ref={ref} className="relative">
        {!any ? <p className="py-6 text-center text-xs text-slate-500">No revenue in this period yet.</p> : (
          <svg width={W} height={H} onMouseLeave={() => setHover(null)} onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const i = Math.round(((e.clientX - r.left - pl) / Math.max(1, W - pl - pr)) * (n - 1)); setHover(Math.max(0, Math.min(n - 1, i))); }} role="img" aria-label="Revenue over time">
            {ticks.map((t) => <g key={t}><line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke={C.grid} /><text x={pl - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill={C.ink2}>{money(t, a.currency, true)}</text></g>)}
            <path d={line(a.revenueSeries.won)} fill="none" stroke={C.won} strokeWidth={2} pathLength={1} className="robin-curve" />
            <path d={line(a.revenueSeries.received)} fill="none" stroke={C.received} strokeWidth={2} pathLength={1} className="robin-curve" />
            <text x={pl} y={H - 6} fontSize="9" fill={C.ink2}>{a.revenueSeries.labels[0]}</text>
            <text x={W - pr} y={H - 6} textAnchor="end" fontSize="9" fill={C.ink2}>{a.revenueSeries.labels[n - 1]}</text>
            {hover != null && <><line x1={x(hover)} x2={x(hover)} y1={pt} y2={H - pb} stroke="rgba(226,232,240,0.35)" /><circle cx={x(hover)} cy={y(a.revenueSeries.won[hover])} r={4} fill={C.won} stroke="#0b1220" strokeWidth={2} /><circle cx={x(hover)} cy={y(a.revenueSeries.received[hover])} r={4} fill={C.received} stroke="#0b1220" strokeWidth={2} /></>}
          </svg>
        )}
        {hover != null && any && <TipBox tip={{ x: x(hover), y: pt + 10, text: `${a.revenueSeries.labels[hover]} · won ${money(a.revenueSeries.won[hover], a.currency)} · received ${money(a.revenueSeries.received[hover], a.currency)}` }} />}
      </div>
    </Chart>
  );
}
function ActivityMultiples({ a }: { a: RobinAnalytics }) {
  const series = [["Calls", a.activity.calls], ["WhatsApp", a.activity.whatsapp], ["Instagram DMs", a.activity.instagram], ["Emails", a.activity.email], ["Follow-ups done", a.activity.followUps], ["Demos", a.activity.demos], ["Quotations", a.activity.quotations], ["Conversions", a.activity.conversions]] as const;
  const max = Math.max(1, ...series.flatMap(([, v]) => v)); // one shared scale so the panels compare
  const [tip, setTip] = useState<Tip>(null);
  return (
    <Chart title="LEAD ACTIVITY">
      <div className="relative grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4" onMouseLeave={() => setTip(null)}>
        {series.map(([label, vals]) => {
          const total = vals.reduce((s, v) => s + v, 0);
          return (
            <div key={label}>
              <div className="flex items-baseline justify-between text-[10px]"><span className="text-slate-300">{label}</span><span className="font-semibold text-slate-100">{total}</span></div>
              <div className="mt-1 flex h-10 items-end gap-[2px] border-b border-white/10">
                {vals.map((v, i) => (
                  <div key={i} className="flex-1 rounded-t-[2px]" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0, background: C.bar }}
                    onMouseMove={(e) => { const b = (e.currentTarget.closest(".grid") as HTMLElement).getBoundingClientRect(); setTip({ x: e.clientX - b.left, y: e.clientY - b.top, text: `${label} · ${a.activity.labels[i]}: ${v}` }); }} />
                ))}
              </div>
            </div>
          );
        })}
        <TipBox tip={tip} />
      </div>
    </Chart>
  );
}
function Breakdown({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Chart title={title}>
      {!rows.length ? <p className="text-xs text-slate-500">No leads in this period.</p> : rows.slice(0, 8).map((r) => (
        <div key={r.label} className="mb-1 grid items-center gap-2 text-[10.5px]" style={{ gridTemplateColumns: "110px 1fr 32px" }} title={`${r.label}: ${r.count}`}>
          <span className="truncate text-slate-300">{r.label === "darwin" ? "DARWIN" : r.label}</span>
          <div className="h-3"><div className="h-full rounded-r-[4px]" style={{ width: `${(r.count / max) * 100}%`, background: C.bar }} /></div>
          <span className="text-right text-slate-200">{r.count}</span>
        </div>
      ))}
    </Chart>
  );
}
function AnalyticsTable({ a }: { a: RobinAnalytics }) {
  const rows = useMemo(() => [
    ...Object.entries(a.totals).map(([k, v]) => [k, typeof v === "number" && /revenue|received|avg/i.test(k) ? money(v, a.currency) : String(v ?? "—")]),
    ...Object.entries(a.rates).map(([k, r]) => [`${k} rate`, r.value != null ? `${r.value}% (${r.num}/${r.den})` : "—"]),
    ...a.funnel.map((f) => [`funnel: ${f.label}`, String(f.count)]),
  ], [a]);
  return (
    <table className="w-full text-xs">
      <tbody>{rows.map(([k, v]) => <tr key={k} className="border-b border-white/[0.05]"><td className="py-1.5 text-slate-400">{k}</td><td className="py-1.5 text-right text-slate-100">{v}</td></tr>)}</tbody>
    </table>
  );
}
