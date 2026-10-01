"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Phone, MessageCircle, Instagram, Mail, CalendarClock, Presentation, FileText, ArrowRightLeft, Globe, MapPin, Loader2, Check, Download, Send, Crown, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadWorkspace } from "@/lib/robin/workspace";
import { STAGES, STAGE_LABEL, CALL_OUTCOMES, OUTCOME_LABEL, PRIORITIES, PRIORITY_LABEL, CONFIRM_STAGES, money, type Stage, type Priority } from "@/lib/robin/types";
import { rapi, localInput, when, ago } from "./api";

/**
 * One lead, everything about it: business, qualification (with the reasons),
 * sales state, full timeline — and the actions. Robin never contacts anyone:
 * CALL opens your dialer, WHATSAPP opens WhatsApp; afterwards Robin asks how it
 * went and records only what you tell it.
 */

type W = LeadWorkspace & { links: { call: string | null; whatsapp: string | null; instagram: string | null; email: string | null; maps: string | null; website: string | null } };
type Sheet = null | "call" | "message" | "followup" | "demo" | "quote" | "stage" | "convert" | "next";

interface Props {
  leadId: string;
  tz: string;
  onClose: () => void;
  onChanged: (e?: { moved?: { name: string; from: string; to: string }; kind?: "followup" | "demo" | "quotation" | "won" | "contact" }) => void;
  ask: (question: string, run: () => Promise<void>) => void;
  say: (text: string) => void;
  externalSheet?: { sheet: Sheet; at: number } | null;
}

const field = "w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-300/50";

export function LeadPanel({ leadId, tz, onClose, onChanged, ask, say, externalSheet }: Props) {
  const [w, setW] = useState<W | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [msgChannel, setMsgChannel] = useState<"whatsapp" | "instagram" | "email">("whatsapp");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await rapi<W>(`leads/${leadId}`);
    if (r.ok && r.data) { setW(r.data); setErr(null); } else setErr(r.error ?? "Couldn't load this lead.");
  }, [leadId]);
  useEffect(() => { setW(null); void load(); }, [load]);
  useEffect(() => { if (externalSheet) setSheet(externalSheet.sheet); }, [externalSheet]);

  const patch = useCallback(async (body: Record<string, unknown>, confirm = false): Promise<boolean> => {
    setBusy(true);
    const r = await rapi<W & { moved: { changed: boolean; from: string } | null }>(`leads/${leadId}`, "PATCH", { ...body, ...(confirm ? { confirm: true } : {}) });
    setBusy(false);
    if (r.code === "needs_confirmation") { ask(r.error ?? "Are you sure?", async () => { await patch(body, true); }); return false; }
    if (!r.ok || !r.data) { say(r.error ?? "That didn't work."); return false; }
    setW(r.data);
    if (body.stage && r.data.moved?.changed) {
      const to = body.stage as Stage;
      onChanged({ moved: { name: r.data.lead.businessName, from: r.data.moved.from, to }, kind: to === "won" ? "won" : undefined });
      if (to === "won" && !r.data.client) setSheet("convert");
    } else onChanged();
    return true;
  }, [leadId, ask, say, onChanged]);

  if (err) return <Shell onClose={onClose}><p className="p-6 text-sm text-slate-300">{err}</p></Shell>;
  if (!w) return <Shell onClose={onClose}><div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-cyan-300" /></div></Shell>;
  const l = w.lead;
  const q = w.qualification;

  const openAndAsk = (url: string | null, next: Sheet, channel?: "whatsapp" | "instagram" | "email") => {
    if (!url) return;
    // tel:/mailto: hand off to the phone dialer / mail app; web links open in a new tab
    const link = document.createElement("a");
    link.href = url;
    if (!/^(tel|mailto):/.test(url)) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
    link.click();
    if (channel) setMsgChannel(channel);
    // give the dialer / app a moment, then ask how it went (nothing is recorded until you answer)
    setTimeout(() => setSheet(next), 600);
  };

  return (
    <Shell onClose={onClose}>
      {/* header */}
      <div className="border-b border-white/[0.06] px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3 pr-8">
          <div className="min-w-0">
            <h2 className="robin-type truncate text-lg font-semibold tracking-wide text-white">{l.businessName}</h2>
            <p className="text-xs text-slate-400">{[l.category, l.city].filter(Boolean).join(" · ") || "—"}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold leading-none text-cyan-200">{q.score}</p>
            <p className="text-[9px] tracking-[0.2em] text-slate-500">LEAD SCORE</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-0.5 text-[10px] tracking-[0.16em] text-cyan-100">{STAGE_LABEL[l.stage as Stage]?.toUpperCase()}</span>
          <select aria-label="Priority" value={l.priorityOverride ?? "auto"} onChange={(e) => void patch({ priority: e.target.value === "auto" ? null : e.target.value })} className={cn("rounded-full border bg-transparent px-2 py-0.5 text-[10px] tracking-[0.12em] outline-none", l.priority === "high" ? "border-cyan-300/50 text-cyan-200" : l.priority === "medium" ? "border-sky-300/30 text-sky-200" : "border-white/15 text-slate-300")}>
            <option className="bg-slate-900" value="auto">{PRIORITY_LABEL[l.priority as Priority]} (Robin)</option>
            {PRIORITIES.map((p) => <option className="bg-slate-900" key={p} value={p}>{PRIORITY_LABEL[p]} (yours)</option>)}
          </select>
          {w.client && <span className="rounded-full border border-emerald-300/40 bg-emerald-300/10 px-2.5 py-0.5 text-[10px] tracking-[0.16em] text-emerald-200">CLIENT</span>}
        </div>
        {/* actions */}
        <div className="mt-4 grid grid-cols-4 gap-1.5">
          <Act icon={Phone} label="CALL" disabled={!w.links.call} onClick={() => openAndAsk(w.links.call, "call")} />
          <Act icon={MessageCircle} label="WHATSAPP" disabled={!w.links.whatsapp} onClick={() => openAndAsk(w.links.whatsapp, "message", "whatsapp")} />
          <Act icon={Instagram} label="DM" disabled={!w.links.instagram} onClick={() => openAndAsk(w.links.instagram, "message", "instagram")} />
          <Act icon={Mail} label="EMAIL" disabled={!w.links.email} onClick={() => openAndAsk(w.links.email, "message", "email")} />
          <Act icon={CalendarClock} label="FOLLOW-UP" onClick={() => setSheet("followup")} />
          <Act icon={Presentation} label="DEMO" onClick={() => setSheet("demo")} />
          <Act icon={FileText} label="QUOTE" onClick={() => setSheet("quote")} />
          <Act icon={ArrowRightLeft} label="STAGE" onClick={() => setSheet("stage")} />
        </div>
      </div>

      {/* action sheets */}
      {sheet && (
        <div className="robin-sheet border-b border-white/[0.06] bg-white/[0.02] px-5 py-4">
          {sheet === "call" && <CallSheet name={l.businessName} tz={tz} busy={busy} onCancel={() => setSheet(null)} onSave={async (b) => {
            setBusy(true);
            const r = await rapi(`leads/${l.id}/interactions`, "POST", { channel: "call", ...b });
            setBusy(false);
            if (!r.ok) return say(r.error ?? "Couldn't log the call.");
            setSheet(null); await load(); onChanged({ kind: b.followUp ? "followup" : "contact" });
            say(`Call logged — ${OUTCOME_LABEL[b.outcome]}.${b.followUp ? " Follow-up scheduled." : ""}`);
          }} />}
          {sheet === "message" && <MessageSheet name={l.businessName} channel={msgChannel} busy={busy} onCancel={() => setSheet(null)} onSave={async (b) => {
            setBusy(true);
            const r = await rapi(`leads/${l.id}/interactions`, "POST", { channel: msgChannel, ...b });
            setBusy(false);
            if (!r.ok) return say(r.error ?? "Couldn't log that.");
            setSheet(null); await load(); onChanged({ kind: "contact" });
            say(b.direction === "inbound" ? "Reply recorded." : "Logged. I'll keep it in the timeline.");
          }} />}
          {sheet === "followup" && <FollowUpSheet busy={busy} onCancel={() => setSheet(null)} onSave={async (b) => {
            setBusy(true);
            const r = await rapi("followups", "POST", { leadId: l.id, ...b });
            setBusy(false);
            if (!r.ok) return say(r.error ?? "Couldn't schedule that.");
            setSheet(null); await load(); onChanged({ kind: "followup" });
            say(`Follow-up with ${l.businessName} scheduled for ${when(b.dueAt, tz)}.`);
          }} />}
          {sheet === "demo" && <DemoSheet busy={busy} onCancel={() => setSheet(null)} onSave={async (b) => {
            setBusy(true);
            const r = await rapi("demos", "POST", { leadId: l.id, ...b });
            setBusy(false);
            if (!r.ok) return say(r.error ?? "Couldn't schedule the demo.");
            setSheet(null); await load(); onChanged({ kind: "demo" });
            say(`Demo with ${l.businessName} scheduled for ${when(b.at, tz)}.`);
          }} />}
          {sheet === "quote" && <QuoteSheet leadId={l.id} currency={w.currency} busy={busy} setBusy={setBusy} onCancel={() => setSheet(null)} onDone={async (total) => {
            setSheet(null); await load(); onChanged({ kind: "quotation" });
            say(`Quotation prepared — ${total}. Review it, then send it when you're ready.`);
          }} say={say} />}
          {sheet === "stage" && (
            <div>
              <p className="mb-2 text-[10px] tracking-[0.2em] text-slate-400">MOVE {l.businessName.toUpperCase()} TO</p>
              <div className="flex flex-wrap gap-1.5">
                {STAGES.map((s) => (
                  <button key={s} type="button" disabled={s === l.stage || busy} onClick={async () => { if (await patch({ stage: s })) setSheet((x) => (x === "stage" ? null : x)); }}
                    className={cn("robin-btn rounded-full border px-2.5 py-1 text-[10px] tracking-[0.1em]", s === l.stage ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100" : CONFIRM_STAGES.includes(s) ? "border-amber-300/25 text-amber-100/90" : "border-white/10 text-slate-200")}>
                    {STAGE_LABEL[s]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">Won, Lost and Do Not Contact ask for your confirmation.</p>
            </div>
          )}
          {sheet === "convert" && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-100">Convert this lead into a client?</p>
              <div className="flex gap-2">
                <button type="button" className="robin-btn rounded-full border border-white/10 px-3 py-1 text-[11px] text-slate-300" onClick={() => setSheet(null)}>Not now</button>
                <button type="button" disabled={busy} className="robin-btn rounded-full border border-emerald-300/50 bg-emerald-300/15 px-3 py-1 text-[11px] text-emerald-100" onClick={async () => {
                  setBusy(true);
                  const r = await rapi("clients", "POST", { leadId: l.id, confirm: true });
                  setBusy(false);
                  if (!r.ok) return say(r.error ?? "Couldn't convert it.");
                  setSheet(null); await load(); onChanged({ kind: "won", moved: l.stage !== "won" ? { name: l.businessName, from: l.stage, to: "won" } : undefined });
                  say(`${l.businessName} is now a client.`);
                }}>Yes, convert</button>
              </div>
            </div>
          )}
          {sheet === "next" && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-100">Follow-up completed. Schedule the next one?</p>
              <div className="flex gap-2">
                <button type="button" className="robin-btn rounded-full border border-white/10 px-3 py-1 text-[11px] text-slate-300" onClick={() => setSheet(null)}>No</button>
                <button type="button" className="robin-btn rounded-full border border-cyan-300/50 bg-cyan-300/15 px-3 py-1 text-[11px] text-cyan-100" onClick={() => setSheet("followup")}>Yes</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="robin-scroll flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <Section title="BUSINESS">
          <Row k="Phone" v={l.phone ? <a className="text-cyan-200 hover:underline" href={w.links.call ?? undefined}>{l.phone}</a> : null} />
          <Row k="WhatsApp" v={w.links.whatsapp ? <a className="text-cyan-200 hover:underline" href={w.links.whatsapp} target="_blank" rel="noopener noreferrer">{l.whatsapp ?? `${l.phone} (mobile)`}</a> : null} />
          <Row k="Email" v={l.email} />
          <Row k="Website" v={l.website ? <a className="inline-flex items-center gap-1 text-cyan-200 hover:underline" href={l.website} target="_blank" rel="noopener noreferrer"><Globe className="h-3 w-3" />{l.website.replace(/^https?:\/\//, "")}</a> : null} />
          <Row k="Instagram" v={w.links.instagram ? <a className="text-cyan-200 hover:underline" href={w.links.instagram} target="_blank" rel="noopener noreferrer">{l.instagram?.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@")}</a> : null} />
          <Row k="Location" v={l.address || l.city ? <span>{l.address ?? l.city}{w.links.maps && <a className="ml-1.5 inline-flex items-center gap-0.5 text-cyan-200 hover:underline" href={w.links.maps} target="_blank" rel="noopener noreferrer"><MapPin className="h-3 w-3" />Maps</a>}</span> : null} />
          <Row k="Source" v={l.source === "darwin" ? `DARWIN${l.discoveredAt ? ` · found ${new Date(l.discoveredAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}` : l.source} />
        </Section>

        <Section title="QUALIFICATION">
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-200">{q.explanation}</pre>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Row k="Website" v={({ no_website: "No website", has_website: "Has a website", outdated: "Outdated", poor: "Poor", unknown: "Unknown" } as Record<string, string>)[l.websiteStatus ?? "unknown"]} />
            <Row k="Opportunity" v={l.opportunityType?.replace(/_/g, " ") ?? null} />
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-500">The score only orders your work. It isn&apos;t a prediction of who will buy.</p>
        </Section>

        <Section title="SALES">
          <div className="grid gap-y-0.5">
            <Row k="Stage" v={STAGE_LABEL[l.stage as Stage]} />
            <Row k="Last contact" v={l.lastContactAt ? `${when(l.lastContactAt, tz)}` : "Not contacted yet"} />
            <Row k="Next follow-up" v={w.sales.nextFollowUp ? when(w.sales.nextFollowUp.dueAt, tz) : null} />
            <Row k="Demo" v={w.sales.nextDemo ? when(w.sales.nextDemo.scheduledAt, tz) : w.demos[0] ? `${w.demos[0].status}` : null} />
            <Row k="Quotation" v={w.sales.latestQuotation ? `${w.sales.latestQuotation.number} · ${w.sales.latestQuotation.status}` : null} />
            <Row k="Assigned" v={<InlineEdit value={l.assignedTo ?? ""} placeholder="You" onSave={(v) => void patch({ fields: { assignedTo: v || null } })} />} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] tracking-[0.18em] text-slate-500">POTENTIAL VALUE</span>
            <InlineEdit value={l.potentialValue != null ? String(l.potentialValue) : ""} placeholder="set" numeric onSave={(v) => void patch({ fields: { potentialValue: v ? Number(v) : null } })} render={(v) => (v ? money(Number(v), w.currency) : "not set")} />
          </div>
          {(l.stage === "negotiating" || w.quotations.some((x) => x.status === "accepted")) && !w.client && (
            <button type="button" onClick={() => setSheet("convert")} className="robin-btn mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-300/40 px-3 py-1 text-[11px] text-emerald-100"><Crown className="h-3.5 w-3.5" />Convert to client</button>
          )}
          {w.client && <p className="mt-2 text-xs text-emerald-200">Client since {new Date(w.client.convertedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {money(w.client.amount, w.client.currency)} · {w.client.paymentStatus}</p>}
        </Section>

        {w.quotations.length > 0 && (
          <Section title="QUOTATIONS">
            {w.quotations.map((qt) => <QuoteRow key={qt.id} q={qt} email={l.email} ask={ask} say={say} onChanged={async (accepted) => { await load(); onChanged({ kind: "quotation" }); if (accepted && !w.client) setSheet("convert"); }} />)}
          </Section>
        )}

        {w.followUps.length > 0 && (
          <Section title="FOLLOW-UPS">
            {w.followUps.slice(0, 8).map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 py-1 text-xs">
                <span className={cn("text-slate-200", f.status !== "pending" && "text-slate-500 line-through")}>{f.action} · {when(f.dueAt, tz)}{f.notes ? ` — ${f.notes}` : ""}</span>
                {f.status === "pending" && <button type="button" className="robin-btn rounded-full border border-cyan-300/30 px-2 py-0.5 text-[10px] text-cyan-100" onClick={async () => {
                  const r = await rapi(`followups/${f.id}`, "PATCH", { action: "complete" });
                  if (!r.ok) return say(r.error ?? "Couldn't complete it.");
                  await load(); onChanged(); setSheet("next"); say("Follow-up completed. Would you like to schedule the next one?");
                }}><Check className="mr-0.5 inline h-3 w-3" />Done</button>}
              </div>
            ))}
          </Section>
        )}

        {w.demos.length > 0 && (
          <Section title="DEMOS">
            {w.demos.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 py-1 text-xs">
                <span className="text-slate-200">{d.demoType.replace("_", " ")} · {when(d.scheduledAt, tz)} · <span className="text-slate-400">{d.status}</span></span>
                {["scheduled", "rescheduled"].includes(d.status) && (
                  <span className="flex gap-1">
                    <button type="button" className="robin-btn rounded-full border border-emerald-300/30 px-2 py-0.5 text-[10px] text-emerald-100" onClick={async () => { const r = await rapi(`demos/${d.id}`, "PATCH", { status: "completed" }); if (!r.ok) return say(r.error ?? ""); await load(); onChanged({ kind: "demo" }); say("Demo marked completed."); }}>Completed</button>
                    <button type="button" className="robin-btn rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-300" onClick={() => ask("Cancel this demo?", async () => { await rapi(`demos/${d.id}`, "PATCH", { status: "cancelled" }); await load(); onChanged(); })}>Cancel</button>
                  </span>
                )}
              </div>
            ))}
          </Section>
        )}

        <Section title="NOTES">
          <Notes value={l.notes ?? ""} onSave={(v) => void patch({ fields: { notes: v || null } })} />
        </Section>

        <Section title="TIMELINE">
          <ol className="relative space-y-2 border-l border-white/10 pl-3">
            {w.activities.map((a) => (
              <li key={a.id} className="relative text-xs">
                <span className="absolute -left-[15.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-cyan-300/80" />
                <span className="text-slate-200">{a.detail}</span>
                <span className="ml-1.5 text-[10px] text-slate-500">{ago(a.createdAt)}</span>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <aside className="robin-panel fixed inset-y-0 right-0 z-[70] flex w-full max-w-[460px] flex-col border-l border-cyan-300/15 bg-slate-950/85 shadow-[0_0_60px_rgba(8,145,178,0.25)] backdrop-blur-2xl" role="dialog" aria-label="Lead">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
      <div className="robin-scan pointer-events-none absolute inset-x-0 top-0 h-24" />
      {children}
    </aside>
  );
}
function Act({ icon: Icon, label, onClick, disabled }: { icon: typeof Phone; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={disabled ? "Not available for this lead" : label}
      className="robin-btn flex flex-col items-center gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] py-2 text-[8.5px] tracking-[0.14em] text-slate-300 disabled:cursor-not-allowed disabled:opacity-30">
      <Icon className="h-3.5 w-3.5 text-cyan-200" />{label}
    </button>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><p className="mb-2 text-[9.5px] tracking-[0.28em] text-cyan-200/70">{title}</p>{children}</section>;
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs"><span className="shrink-0 text-slate-500">{k}</span><span className="min-w-0 truncate text-right text-slate-200">{v ?? <span className="text-slate-600">—</span>}</span></div>;
}
function InlineEdit({ value, placeholder, onSave, numeric, render }: { value: string; placeholder: string; onSave: (v: string) => void; numeric?: boolean; render?: (v: string) => string }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!edit) return <button type="button" className="text-xs text-slate-200 underline decoration-white/20 decoration-dotted underline-offset-2 hover:text-white" onClick={() => setEdit(true)}>{render ? render(value) : value || placeholder}</button>;
  return <input autoFocus className={cn(field, "w-28 py-0.5")} inputMode={numeric ? "decimal" : undefined} value={v} onChange={(e) => setV(numeric ? e.target.value.replace(/[^\d.]/g, "") : e.target.value)} onBlur={() => { setEdit(false); if (v !== value) onSave(v); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(value); setEdit(false); } }} />;
}
function Notes({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div>
      <textarea className={cn(field, "min-h-[64px]")} value={v} onChange={(e) => setV(e.target.value)} placeholder="Notes about this lead…" />
      {v !== value && <button type="button" onClick={() => onSave(v)} className="robin-btn mt-1.5 rounded-full border border-cyan-300/40 px-3 py-0.5 text-[10px] text-cyan-100">Save note</button>}
    </div>
  );
}
function Btns({ busy, onCancel, label = "Save", disabled }: { busy: boolean; onCancel: () => void; label?: string; disabled?: boolean }) {
  return (
    <div className="mt-3 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="robin-btn rounded-full border border-white/10 px-3 py-1 text-[11px] text-slate-300">Cancel</button>
      <button type="submit" disabled={busy || disabled} className="robin-btn inline-flex items-center gap-1 rounded-full border border-cyan-300/50 bg-cyan-300/15 px-3 py-1 text-[11px] text-cyan-50 disabled:opacity-40">{busy && <Loader2 className="h-3 w-3 animate-spin" />}{label}</button>
    </div>
  );
}
const tomorrowAt = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d; };

function CallSheet({ name, busy, onCancel, onSave }: { name: string; tz: string; busy: boolean; onCancel: () => void; onSave: (b: { outcome: (typeof CALL_OUTCOMES)[number]; notes: string; followUp?: { dueAt: string; action: string } }) => void }) {
  const [outcome, setOutcome] = useState<(typeof CALL_OUTCOMES)[number] | null>(null);
  const [notes, setNotes] = useState("");
  const [fu, setFu] = useState(false);
  const [due, setDue] = useState(localInput(tomorrowAt(11)));
  useEffect(() => { if (outcome && ["call_later", "busy", "no_answer", "wants_demo", "wants_quotation", "interested"].includes(outcome)) setFu(true); }, [outcome]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (outcome) onSave({ outcome, notes, ...(fu ? { followUp: { dueAt: new Date(due).toISOString(), action: "call" } } : {}) }); }}>
      <p className="mb-2 text-sm text-slate-100">How did the call with {name} go?</p>
      <div className="flex flex-wrap gap-1.5">
        {CALL_OUTCOMES.map((o) => <button key={o} type="button" onClick={() => setOutcome(o)} className={cn("robin-btn rounded-full border px-2.5 py-1 text-[10.5px]", outcome === o ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-50" : "border-white/10 text-slate-300")}>{OUTCOME_LABEL[o]}</button>)}
      </div>
      <textarea className={cn(field, "mt-2 min-h-[48px]")} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={fu} onChange={(e) => setFu(e.target.checked)} />Next follow-up</label>
      {fu && <input type="datetime-local" className={cn(field, "mt-1.5")} value={due} onChange={(e) => setDue(e.target.value)} />}
      <p className="mt-2 text-[10px] text-slate-500">Nothing is recorded unless you save — Robin never assumes a call happened.</p>
      <Btns busy={busy} onCancel={onCancel} label="Log call" disabled={!outcome} />
    </form>
  );
}
function MessageSheet({ name, channel, busy, onCancel, onSave }: { name: string; channel: "whatsapp" | "instagram" | "email"; busy: boolean; onCancel: () => void; onSave: (b: { outcome: string; notes: string; direction: "outbound" | "inbound" }) => void }) {
  const label = { whatsapp: "WhatsApp message", instagram: "Instagram DM", email: "email" }[channel];
  const [notes, setNotes] = useState("");
  const [dir, setDir] = useState<"outbound" | "inbound">("outbound");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ outcome: dir === "inbound" ? "replied" : "sent", notes, direction: dir }); }}>
      <p className="mb-2 text-sm text-slate-100">Record the {label} with {name}?</p>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => setDir("outbound")} className={cn("robin-btn rounded-full border px-2.5 py-1 text-[10.5px]", dir === "outbound" ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-50" : "border-white/10 text-slate-300")}>I sent it</button>
        <button type="button" onClick={() => setDir("inbound")} className={cn("robin-btn rounded-full border px-2.5 py-1 text-[10.5px]", dir === "inbound" ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-50" : "border-white/10 text-slate-300")}>They replied</button>
      </div>
      <textarea className={cn(field, "mt-2 min-h-[48px]")} placeholder="What was said (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <p className="mt-2 text-[10px] text-slate-500">Recorded as &quot;logged by you&quot; — not as delivered (no API confirmed it).</p>
      <Btns busy={busy} onCancel={onCancel} label="Record" />
    </form>
  );
}
function FollowUpSheet({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (b: { dueAt: string; action: string; priority: string; notes: string }) => void }) {
  const [due, setDue] = useState(localInput(tomorrowAt(11)));
  const [action, setAction] = useState("call");
  const [priority, setPriority] = useState("medium");
  const [notes, setNotes] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ dueAt: new Date(due).toISOString(), action, priority, notes }); }}>
      <p className="mb-2 text-sm text-slate-100">Schedule a follow-up</p>
      <div className="grid grid-cols-2 gap-2">
        <input type="datetime-local" className={cn(field, "col-span-2")} value={due} onChange={(e) => setDue(e.target.value)} required />
        <select className={field} value={action} onChange={(e) => setAction(e.target.value)}>{["call", "whatsapp", "email", "instagram", "meeting", "task"].map((a) => <option className="bg-slate-900" key={a} value={a}>{a}</option>)}</select>
        <select className={field} value={priority} onChange={(e) => setPriority(e.target.value)}>{["high", "medium", "low"].map((a) => <option className="bg-slate-900" key={a} value={a}>{a} priority</option>)}</select>
      </div>
      <input className={cn(field, "mt-2")} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Btns busy={busy} onCancel={onCancel} label="Schedule" />
    </form>
  );
}
function DemoSheet({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (b: { at: string; demoType: string; notes: string }) => void }) {
  const [at, setAt] = useState(localInput(tomorrowAt(15)));
  const [type, setType] = useState("online");
  const [notes, setNotes] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ at: new Date(at).toISOString(), demoType: type, notes }); }}>
      <p className="mb-2 text-sm text-slate-100">Schedule a demo</p>
      <div className="grid grid-cols-2 gap-2">
        <input type="datetime-local" className={field} value={at} onChange={(e) => setAt(e.target.value)} required />
        <select className={field} value={type} onChange={(e) => setType(e.target.value)}><option className="bg-slate-900" value="online">Online</option><option className="bg-slate-900" value="in_person">In person</option><option className="bg-slate-900" value="phone">Phone</option></select>
      </div>
      <input className={cn(field, "mt-2")} placeholder="What to show (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Btns busy={busy} onCancel={onCancel} label="Schedule demo" />
    </form>
  );
}

interface Svc { id: string; name: string; price: number | null; description: string | null; unit: string | null; active: boolean }
function QuoteSheet({ leadId, currency, busy, setBusy, onCancel, onDone, say }: { leadId: string; currency: string; busy: boolean; setBusy: (b: boolean) => void; onCancel: () => void; onDone: (total: string) => void; say: (t: string) => void }) {
  const [services, setServices] = useState<Svc[]>([]);
  const [tax, setTax] = useState(18);
  const [items, setItems] = useState<{ service: string; price: string; qty: string; description: string }[]>([]);
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { void rapi<{ services: Svc[]; settings: { taxPct: number } }>("settings").then((r) => { if (r.data) { setServices(r.data.services.filter((s) => s.active)); setTax(r.data.settings.taxPct); } }); }, []);
  const add = (s: Svc) => setItems((x) => [...x, { service: s.name, price: s.price != null ? String(s.price) : "", qty: "1", description: s.description ?? "" }]);
  const sub = items.reduce((a, i) => a + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const d = Math.min(Number(discount) || 0, sub);
  const total = (sub - d) * (1 + tax / 100);
  const missing = items.some((i) => i.price === "");
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await rapi<{ total: number }>("quotations", "POST", { leadId, items: items.map((i) => ({ service: i.service, unitPrice: Number(i.price), quantity: Number(i.qty) || 1, description: i.description || null })), discount: d, taxPct: tax, notes: notes || null });
      setBusy(false);
      if (!r.ok) return say(r.error ?? "Couldn't create the quotation.");
      onDone(money(r.data!.total, currency));
    }}>
      <p className="mb-2 text-sm text-slate-100">Prepare a quotation</p>
      <div className="flex flex-wrap gap-1.5">
        {services.map((s) => <button key={s.id} type="button" onClick={() => add(s)} className="robin-btn inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[10.5px] text-slate-200"><Plus className="h-3 w-3" />{s.name}{s.price != null ? ` · ${money(s.price, currency)}` : ""}</button>)}
      </div>
      {items.map((i, k) => (
        <div key={k} className="mt-2 grid grid-cols-[1fr_70px_44px_24px] items-center gap-1.5">
          <input className={field} value={i.service} onChange={(e) => setItems((x) => x.map((y, j) => (j === k ? { ...y, service: e.target.value } : y)))} />
          <input className={cn(field, i.price === "" && "border-amber-300/50")} placeholder="price" inputMode="decimal" value={i.price} onChange={(e) => setItems((x) => x.map((y, j) => (j === k ? { ...y, price: e.target.value.replace(/[^\d.]/g, "") } : y)))} />
          <input className={field} inputMode="decimal" value={i.qty} onChange={(e) => setItems((x) => x.map((y, j) => (j === k ? { ...y, qty: e.target.value.replace(/[^\d.]/g, "") } : y)))} />
          <button type="button" aria-label="Remove" onClick={() => setItems((x) => x.filter((_, j) => j !== k))} className="text-slate-500 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      {missing && <p className="mt-1.5 text-[10px] text-amber-200">Type a price for each service (Robin never invents one). Set default prices in Settings.</p>}
      {items.length > 0 && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input className={field} placeholder="Discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} />
            <input className={field} placeholder="Tax %" inputMode="decimal" value={String(tax)} onChange={(e) => setTax(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} />
          </div>
          <input className={cn(field, "mt-2")} placeholder="Notes on the quotation (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <p className="mt-2 text-right text-xs text-slate-300">Total <span className="text-base font-semibold text-cyan-100">{money(total, currency)}</span> <span className="text-[10px] text-slate-500">incl. {tax}% tax</span></p>
        </>
      )}
      <Btns busy={busy} onCancel={onCancel} label="Create draft" disabled={!items.length || missing} />
    </form>
  );
}

function QuoteRow({ q, email, ask, say, onChanged }: { q: LeadWorkspace["quotations"][number]; email: string | null; ask: Props["ask"]; say: Props["say"]; onChanged: (accepted?: boolean) => void }) {
  const act = async (body: Record<string, unknown>) => {
    const r = await rapi(`quotations/${q.id}`, "PATCH", body);
    if (r.code === "needs_confirmation") return ask(r.error ?? "Sure?", async () => { await act({ ...body, confirm: true }); });
    if (!r.ok) return say(r.error ?? "That didn't work.");
    say(body.action === "accept" ? "Quotation accepted. Convert this lead into a client?" : body.action === "send" ? (body.via === "gmail" ? "Emailed — Gmail confirmed it." : "Marked as sent.") : "Updated.");
    onChanged(body.action === "accept");
  };
  const statusTone = useMemo(() => ({ draft: "text-slate-300", sent: "text-sky-300", accepted: "text-emerald-300", rejected: "text-rose-300", expired: "text-amber-300" } as Record<string, string>)[q.status], [q.status]);
  return (
    <div className="mb-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-100">{q.number}</span>
        <span className={cn("text-[10px] tracking-[0.16em]", statusTone)}>{q.status.toUpperCase()}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400">{q.items.map((i) => i.service).join(" + ")} · <span className="text-slate-100">{money(q.total, q.currency)}</span></p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <a href={`/api/robin/quotations/${q.id}/pdf`} className="robin-btn inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-0.5 text-[10px] text-slate-200"><Download className="h-3 w-3" />PDF</a>
        {["draft", "expired"].includes(q.status) && <button type="button" onClick={() => void act({ action: "send", via: "manual" })} className="robin-btn rounded-full border border-white/10 px-2.5 py-0.5 text-[10px] text-slate-200">I sent it</button>}
        {["draft", "sent", "expired"].includes(q.status) && email && <button type="button" onClick={() => void act({ action: "send", via: "gmail", to: email })} className="robin-btn inline-flex items-center gap-1 rounded-full border border-cyan-300/30 px-2.5 py-0.5 text-[10px] text-cyan-100"><Send className="h-3 w-3" />Email PDF</button>}
        {["sent", "draft", "expired"].includes(q.status) && <button type="button" onClick={() => void act({ action: "accept" })} className="robin-btn rounded-full border border-emerald-300/30 px-2.5 py-0.5 text-[10px] text-emerald-100">Accepted</button>}
        {["sent", "draft"].includes(q.status) && <button type="button" onClick={() => void act({ action: "reject" })} className="robin-btn rounded-full border border-white/10 px-2.5 py-0.5 text-[10px] text-slate-400">Rejected</button>}
      </div>
    </div>
  );
}
