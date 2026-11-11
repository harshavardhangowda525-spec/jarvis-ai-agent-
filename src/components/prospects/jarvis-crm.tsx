"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, MapPin, Phone, Laptop, Square, Star, X, Plus, CalendarClock, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, LOST_REASONS, type Status } from "@/lib/prospects/rules";
import { CallsPanel } from "./calls-panel";

interface Prospect {
  id: string; businessName: string; category: string | null; contactPerson: string | null; phone: string | null; whatsapp: string | null;
  address: string | null; area: string | null; city: string | null; mapsUrl: string | null; rating: number | null; reviews: number | null;
  websiteStatus: string; website: string | null; instagram: string | null; hours: string | null; signals: string[]; leadScore: number; source: string;
  status: Status; lostReason: string | null; nextAction: string | null; nextActionAt: string | null; interestedServices: string[];
  budgetRange: string | null; decisionMaker: string | null; value: number | null; doNotContact: boolean; createdAt: string;
}
interface Ev { id: string; kind: string; text: string; by: string; at: string; prospectId: string | null; name: string | null }
interface MapsSearch { id: string; category: string; area: string; city: string; limit: number; status: string; trigger: string; visited: number; withWebsite: number; kept: number; added: number; duplicates: number; currentText: string | null; error: string | null; createdAt: string }
interface Finder { paired: boolean; device: string | null; lastSeenAt: string | null; online: boolean; scheduleOn: boolean; scheduleDays: number[]; scheduleTime: string; dailyLimit: number; categories: string[]; areas: string[]; city: string }
interface Board {
  statuses: Status[]; prospects: Prospect[]; callList: string[]; followUpsDue: string[];
  wonThisMonth: { count: number; value: number }; lossReasons: { reason: string; count: number }[];
  events: Ev[]; searches: MapsSearch[]; finder: Finder; addedToday: number; maxDaily: number;
}

const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : new Date(iso).toLocaleDateString(); };
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LIVE = new Set(["queued", "running", "stopping"]);
const scoreTone = (s: number) => (s >= 70 ? "text-emerald-300 border-emerald-400/40" : s >= 45 ? "text-cyan-300 border-cyan-400/40" : "text-white/60 border-white/15");
const webLabel: Record<string, string> = { none: "No website", social_only: "Social page only", broken: "Site down", outdated: "Outdated site", ok: "Has website" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `Request failed (${r.status})`);
  return j.data as T;
}

/**
 * JARVIS CRM — JARVIS's own pipeline. JARVIS fills it from Google Maps (in the
 * visible browser on your laptop) and keeps it up to date; this screen follows
 * along live.
 */
export function JarvisCrm({ openLead }: { openLead?: string | null }) {
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(openLead ?? null);
  const [q, setQ] = useState("");
  const [find, setFind] = useState({ category: "", area: "", limit: "20" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showCalls, setShowCalls] = useState(false);

  const load = useCallback(async () => {
    try { setB(await api<Board>("/api/prospects")); setErr(null); } catch (e) { setErr((e as Error).message); }
  }, []);
  const live = !!b?.searches.some((s) => LIVE.has(s.status));
  useEffect(() => { void load(); }, [load]);
  // live while JARVIS works: every 3 s during a search, else every 15 s
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, live ? 3000 : 15000); return () => clearInterval(t); }, [load, live]);

  const act = async (key: string, f: () => Promise<unknown>, done?: string) => {
    setBusy(key); setMsg(null);
    try { await f(); if (done) setMsg({ ok: true, text: done }); await load(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  };

  const byId = useMemo(() => new Map((b?.prospects ?? []).map((p) => [p.id, p])), [b]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (b?.prospects ?? []).filter((p) => !t || [p.businessName, p.area, p.category, p.phone].some((x) => x?.toLowerCase().includes(t)));
  }, [b, q]);
  const columns = useMemo(() => (b?.statuses ?? []).map((s) => ({ s, items: shown.filter((p) => p.status === s) })), [b, shown]);
  const current = sel ? byId.get(sel) ?? null : null;

  if (!b) return <div className="p-6 text-sm text-white/60">{err ?? "Loading the CRM…"}</div>;
  const f = b.finder;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">CRM</h1>
          <p className="text-xs text-white/55">JARVIS finds leads on Google Maps and keeps this up to date by itself.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <span className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1", f.online ? "border-emerald-400/40 text-emerald-300" : f.paired ? "border-amber-400/40 text-amber-300" : "border-white/15 text-white/60")}>
            <Laptop className="h-3.5 w-3.5" />
            {f.online ? `Laptop connected${f.device ? ` · ${f.device.split(" (")[0]}` : ""}` : f.paired ? `Laptop offline${f.lastSeenAt ? ` · seen ${ago(f.lastSeenAt)}` : ""}` : "Laptop not connected"}
          </span>
          <Button size="sm" variant="outline" disabled={busy === "pair"} onClick={() => act("pair", async () => {
            const r = await api<{ token: string | null; connectedHere: boolean }>("/api/prospects/finder", { method: "POST", body: JSON.stringify({ action: "pair" }) });
            setToken(r.token);
            if (r.connectedHere) setMsg({ ok: true, text: "Connected — the JARVIS Operator on this laptop picks it up within 20 seconds." });
          })}>{f.paired ? "Reconnect laptop" : "Connect this laptop"}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowSchedule((v) => !v)}><CalendarClock className="h-3.5 w-3.5" /> Daily search{f.scheduleOn ? " · on" : ""}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowCalls((v) => !v)}><Phone className="h-3.5 w-3.5" /> Calls</Button>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add lead</Button>
        </div>
      </div>
      {token && (
        <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-3 text-xs text-white/80">
          JARVIS isn&apos;t running on the same laptop as the operator, so add these two lines to <code className="text-cyan-300">operator/.env</code> on the laptop and restart it (shown once):
          <pre className="mt-2 select-all overflow-x-auto rounded-lg bg-black/40 p-2 text-cyan-200">{`JARVIS_URL=${location.origin}\nJARVIS_FINDER_TOKEN=${token}`}</pre>
        </div>
      )}

      {/* find on Google Maps */}
      <form className="glass flex flex-wrap items-end gap-2 rounded-2xl p-3" onSubmit={(e) => { e.preventDefault(); void act("find", () => api("/api/prospects/finder", { method: "POST", body: JSON.stringify({ action: "search", category: find.category, area: find.area, limit: Number(find.limit) || 20 }) }), "Queued — JARVIS opens Google Maps on your laptop."); }}>
        <label className="text-xs text-white/60">Business type<Input value={find.category} onChange={(e) => setFind({ ...find, category: e.target.value })} placeholder="gyms" className="mt-1 w-40" /></label>
        <label className="text-xs text-white/60">Area<Input value={find.area} onChange={(e) => setFind({ ...find, area: e.target.value })} placeholder="Indiranagar" className="mt-1 w-40" /></label>
        <label className="text-xs text-white/60">New leads<Input value={find.limit} onChange={(e) => setFind({ ...find, limit: e.target.value.replace(/\D/g, "").slice(0, 2) })} className="mt-1 w-20" /></label>
        <Button type="submit" disabled={busy === "find" || !find.category.trim() || !find.area.trim()}><MapPin className="h-4 w-4" /> Find on Google Maps</Button>
        <span className="text-xs text-white/50">{b.addedToday}/{b.maxDaily} new leads today · only businesses without a working website</span>
        {msg && <span className={cn("basis-full text-xs", msg.ok ? "text-emerald-300" : "text-red-300")}>{msg.text}</span>}
      </form>

      {showSchedule && <Schedule finder={f} onSaved={load} />}
      {showCalls && <CallsPanel onChanged={load} />}

      {/* live + recent searches */}
      {b.searches.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {b.searches.slice(0, 5).map((s) => (
            <div key={s.id} className={cn("glass min-w-[260px] max-w-[320px] flex-none rounded-xl p-2.5 text-xs", LIVE.has(s.status) && "ring-1 ring-cyan-400/50")}>
              <div className="flex items-center gap-2">
                {LIVE.has(s.status) ? <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" /> : <span className={cn("h-2 w-2 rounded-full", s.status === "done" ? "bg-emerald-400" : s.status === "blocked" || s.status === "failed" ? "bg-red-400" : "bg-white/30")} />}
                <b className="truncate text-white">{s.category} in {s.area}</b>
                <span className="ml-auto text-white/45">{s.trigger === "schedule" ? "daily" : s.trigger === "jarvis" ? "JARVIS" : "you"}</span>
                {(s.status === "queued" || s.status === "running") && <button type="button" title="Stop" className="text-white/50 hover:text-red-300" onClick={() => act(`stop-${s.id}`, () => api("/api/prospects/finder", { method: "POST", body: JSON.stringify({ action: "stop", id: s.id }) }))}><Square className="h-3.5 w-3.5" /></button>}
              </div>
              <div className="mt-1 text-white/70">{s.status === "queued" ? (f.online ? "Starting…" : "Waiting for the laptop…") : `${s.visited} looked at · ${s.kept} without a working site · ${s.added} added${s.duplicates ? ` · ${s.duplicates} already in` : ""}`}</div>
              {(s.currentText || s.error) && <div className={cn("mt-0.5 truncate", s.error ? "text-red-300" : "text-white/50")} title={s.error ?? s.currentText ?? ""}>{s.error ?? s.currentText}</div>}
            </div>
          ))}
        </div>
      )}

      {/* stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Call today" value={b.callList.length} />
        <Stat label="Follow-ups due" value={b.followUpsDue.length} />
        <Stat label="Won this month" value={b.wonThisMonth.count ? `${b.wonThisMonth.count} · ${inr(b.wonThisMonth.value)}` : "0"} />
        <Stat label="Lost — why" value={b.lossReasons.length ? b.lossReasons.sort((x, y) => y.count - x.count).slice(0, 2).map((l) => `${l.reason.replace(/_/g, " ")} ${l.count}`).join(", ") : "—"} small />
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* pipeline */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-white/40" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, area, category, phone" className="pl-8" /></div>
          {!b.prospects.length ? (
            <div className="glass flex flex-1 items-center justify-center rounded-2xl p-8 text-center text-sm text-white/60">
              No leads yet. Connect the laptop, then ask JARVIS &ldquo;find gyms without websites in Indiranagar&rdquo; or use Find on Google Maps above.
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto pb-2">
              {columns.map(({ s, items }) => (
                <div key={s} className="glass flex w-64 flex-none flex-col rounded-2xl">
                  <div className="flex items-center justify-between px-3 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-white/60"><span>{STATUS_LABEL[s]}</span><span className="text-white/40">{items.length}</span></div>
                  <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
                    {items.map((p) => {
                      const fresh = Date.now() - Date.parse(p.createdAt) < 90_000;
                      return (
                        <button key={p.id} type="button" onClick={() => setSel(p.id)} className={cn("rounded-xl border border-white/10 bg-white/[0.03] p-2 text-left text-xs transition hover:border-cyan-400/40", sel === p.id && "border-cyan-400/60", fresh && "jarvis-lead-in border-cyan-400/60 shadow-[0_0_14px_-4px_rgba(34,211,238,.7)]")}>
                          <div className="flex items-start gap-1.5"><b className="line-clamp-2 flex-1 text-white">{p.businessName}</b><span className={cn("flex-none rounded-md border px-1 text-[10px] font-semibold", scoreTone(p.leadScore))}>{p.leadScore}</span></div>
                          <div className="mt-0.5 truncate text-white/55">{[p.category, p.area].filter(Boolean).join(" · ")}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <span className={cn("rounded px-1 text-[10px]", p.websiteStatus === "ok" ? "bg-white/10 text-white/60" : "bg-amber-400/15 text-amber-200")}>{webLabel[p.websiteStatus] ?? p.websiteStatus}</span>
                            {p.rating != null && <span className="flex items-center gap-0.5 rounded bg-white/10 px-1 text-[10px] text-white/70"><Star className="h-2.5 w-2.5" />{p.rating}{p.reviews != null ? ` (${p.reviews})` : ""}</span>}
                            {fresh && p.source === "google_maps" && <span className="flex items-center gap-0.5 rounded bg-cyan-400/15 px-1 text-[10px] text-cyan-200"><Sparkles className="h-2.5 w-2.5" />just added by JARVIS</span>}
                          </div>
                          {p.nextAction && <div className="mt-1 truncate text-[11px] text-white/50">Next: {p.nextAction}{p.nextActionAt ? ` · ${new Date(p.nextActionAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}</div>}
                          {p.status === "lost" && p.lostReason && <div className="mt-1 text-[11px] text-red-300/80">Lost: {p.lostReason.replace(/_/g, " ")}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* activity */}
        <div className="glass hidden w-72 flex-none flex-col rounded-2xl xl:flex">
          <div className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-white/60">What JARVIS did</div>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-xs">
            {b.events.map((e) => (
              <li key={e.id} className="border-l-2 border-white/10 pl-2">
                <div className="text-white/80">{e.name ? <button type="button" className="font-medium text-cyan-200 hover:underline" onClick={() => e.prospectId && setSel(e.prospectId)}>{e.name}: </button> : null}{e.text}</div>
                <div className="text-white/40">{e.by === "you" ? "You" : "JARVIS"} · {ago(e.at)}</div>
              </li>
            ))}
            {!b.events.length && <li className="text-white/50">Nothing yet.</li>}
          </ul>
        </div>
      </div>

      {current && <Drawer p={current} onClose={() => setSel(null)} onChanged={load} />}
      {adding && <AddLead onClose={() => setAdding(false)} onAdded={async () => { setAdding(false); await load(); }} />}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return <div className="glass rounded-xl px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-white/50">{label}</div><div className={cn("font-semibold text-white", small ? "truncate text-sm" : "text-lg")}>{value}</div></div>;
}

function Drawer({ p, onClose, onChanged }: { p: Prospect; onClose: () => void; onChanged: () => Promise<void> }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [note, setNote] = useState("");
  const [lost, setLost] = useState<string>(p.lostReason ?? "");
  const [next, setNext] = useState({ action: p.nextAction ?? "", at: p.nextActionAt ? p.nextActionAt.slice(0, 10) : "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadEvents = useCallback(async () => {
    const d = await api<{ events: { id: string; kind: string; text: string; by: string; createdAt: string }[] }>(`/api/prospects/${p.id}`).catch(() => null);
    if (d) setEvents(d.events.map((e) => ({ id: e.id, kind: e.kind, text: e.text, by: e.by, at: e.createdAt, prospectId: p.id, name: null })));
  }, [p.id]);
  useEffect(() => { void loadEvents(); setNext({ action: p.nextAction ?? "", at: p.nextActionAt ? p.nextActionAt.slice(0, 10) : "" }); setLost(p.lostReason ?? ""); }, [loadEvents, p.nextAction, p.nextActionAt, p.lostReason, p.status]);
  const patch = async (body: object) => {
    setBusy(true); setErr(null);
    try { await api(`/api/prospects/${p.id}`, { method: "PATCH", body: JSON.stringify(body) }); await onChanged(); await loadEvents(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div ref={ref} onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-md flex-col gap-3 overflow-y-auto border-l border-white/10 bg-[#07111c] p-4 text-sm text-white/85">
        <div className="flex items-start gap-2">
          <div className="flex-1"><h2 className="text-base font-semibold text-white">{p.businessName}</h2><div className="text-xs text-white/55">{[p.category, p.area, p.city].filter(Boolean).join(" · ")}</div></div>
          <span className={cn("rounded-md border px-1.5 text-xs font-semibold", scoreTone(p.leadScore))} title="Lead score (manual 4.3)">{p.leadScore}</span>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {p.phone && <a href={`tel:${p.phone}`} className="flex items-center gap-1 text-cyan-200 hover:underline"><Phone className="h-3.5 w-3.5" />{p.phone}</a>}
          {p.mapsUrl && <a href={p.mapsUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-cyan-200 hover:underline"><MapPin className="h-3.5 w-3.5" />Google Maps</a>}
          {p.website && <a href={p.website} target="_blank" rel="noreferrer" className="col-span-2 flex items-center gap-1 truncate text-white/70 hover:underline"><ExternalLink className="h-3.5 w-3.5" />{p.website} ({webLabel[p.websiteStatus]})</a>}
          {p.instagram && <a href={p.instagram} target="_blank" rel="noreferrer" className="col-span-2 truncate text-white/70 hover:underline">{p.instagram}</a>}
          {p.rating != null && <span>★ {p.rating}{p.reviews != null ? ` · ${p.reviews} reviews` : ""}</span>}
          {p.hours && <span className="col-span-2 text-white/55">{p.hours}</span>}
          {p.address && <span className="col-span-2 text-white/55">{p.address}</span>}
        </div>
        {p.signals.length > 0 && <div className="flex flex-wrap gap-1">{p.signals.map((s) => <span key={s} className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">{s}</span>)}</div>}

        <div className="rounded-xl border border-white/10 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Pipeline</div>
          <select value={p.status} disabled={busy} onChange={(e) => { const s = e.target.value as Status; if (s === "lost" && !lost) { setErr("Pick why it was lost first."); return; } void patch({ status: s, ...(s === "lost" ? { lostReason: lost } : {}) }); }}
            className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-sm">
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="mt-2 block text-xs text-white/55">Lost reason
            <select value={lost} onChange={(e) => setLost(e.target.value)} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-sm">
              <option value="">—</option>{LOST_REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          {p.status !== "won" && p.status !== "lost" && (
            <div className="mt-2 flex gap-2">
              <Input value={next.action} onChange={(e) => setNext({ ...next, action: e.target.value })} placeholder="Next action" />
              <Input type="date" value={next.at} onChange={(e) => setNext({ ...next, at: e.target.value })} className="w-40" />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => patch({ nextAction: next.action || null, nextActionAt: next.at ? new Date(`${next.at}T10:00:00`).toISOString() : null })}>Set</Button>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) { void patch({ note }); setNote(""); } }} />
          <Button size="sm" disabled={busy || !note.trim()} onClick={() => { void patch({ note }); setNote(""); }}>Add</Button>
        </div>
        {err && <div className="text-xs text-red-300">{err}</div>}

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 p-3 text-xs">
          <Button size="sm" variant="outline" disabled={busy || p.doNotContact || !p.phone || p.status === "won" || p.status === "lost"} onClick={async () => {
            setBusy(true); setErr(null);
            try {
              const r = await api<{ batchId: string | null; skipped: { reason: string }[] }>("/api/prospects/calls", { method: "POST", body: JSON.stringify({ action: "plan", prospectIds: [p.id] }) });
              if (!r.batchId) throw new Error(`Can't call: ${r.skipped[0]?.reason ?? "not eligible"}.`);
              await api("/api/prospects/calls", { method: "POST", body: JSON.stringify({ action: "approve", batchId: r.batchId }) });
              setErr(null); await onChanged(); await loadEvents();
              alert("Approved — the caller on your laptop rings them during calling hours (Calls must be on).");
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}><Phone className="h-3.5 w-3.5" /> Call this lead</Button>
          <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={p.doNotContact} disabled={busy} onChange={(e) => void patch({ doNotContact: e.target.checked })} /> Do not contact</label>
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/50">History</div>
          <ul className="space-y-2 text-xs">{events.map((e) => <li key={e.id} className="border-l-2 border-white/10 pl-2"><div>{e.text}</div><div className="text-white/40">{e.by === "you" ? "You" : "JARVIS"} · {ago(e.at)}</div></li>)}</ul>
        </div>
        <button type="button" className="mt-auto self-start text-xs text-red-300/70 hover:text-red-300" onClick={async () => { if (confirm(`Delete ${p.businessName} from the CRM?`)) { await api(`/api/prospects/${p.id}`, { method: "DELETE" }).catch(() => {}); onClose(); await onChanged(); } }}>Delete lead</button>
      </div>
    </div>
  );
}

function AddLead({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<void> }) {
  const [v, setV] = useState({ businessName: "", category: "", phone: "", area: "", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); try { await api("/api/prospects", { method: "POST", body: JSON.stringify(v) }); await onAdded(); } catch (x) { setErr((x as Error).message); } }}
        className="glass w-full max-w-sm space-y-2 rounded-2xl p-4">
        <h2 className="font-semibold text-white">Add a lead</h2>
        {(["businessName", "category", "phone", "area", "notes"] as const).map((k) => <Input key={k} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} placeholder={{ businessName: "Business name", category: "Category", phone: "Phone", area: "Area", notes: "Note" }[k]} />)}
        {err && <div className="text-xs text-red-300">{err}</div>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!v.businessName.trim()}>Add</Button></div>
      </form>
    </div>
  );
}

function Schedule({ finder, onSaved }: { finder: Finder; onSaved: () => Promise<void> }) {
  const [s, setS] = useState({ ...finder, cats: finder.categories.join(", "), areasT: finder.areas.join(", ") });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (over: Partial<typeof s> = {}) => {
    const n = { ...s, ...over }; setS(n); setMsg(null);
    try {
      await api("/api/prospects/finder", { method: "PATCH", body: JSON.stringify({ scheduleOn: n.scheduleOn, scheduleDays: n.scheduleDays, scheduleTime: n.scheduleTime, dailyLimit: n.dailyLimit, city: n.city, categories: n.cats.split(",").map((x) => x.trim()).filter(Boolean), areas: n.areasT.split(",").map((x) => x.trim()).filter(Boolean) }) });
      setMsg({ ok: true, text: n.scheduleOn ? "Saved — JARVIS runs it by itself, rotating through every type × area." : "Saved (daily search is off)." }); await onSaved();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <div className="glass space-y-2 rounded-2xl p-3 text-xs text-white/70">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={s.scheduleOn} onChange={(e) => void save({ scheduleOn: e.target.checked })} /> Daily Google Maps search</label>
        <div className="flex gap-1">{DAYS.map((d, i) => <button key={d} type="button" onClick={() => setS({ ...s, scheduleDays: s.scheduleDays.includes(i) ? s.scheduleDays.filter((x) => x !== i) : [...s.scheduleDays, i] })} className={cn("rounded-md border px-1.5 py-0.5", s.scheduleDays.includes(i) ? "border-cyan-400/50 text-cyan-200" : "border-white/10 text-white/40")}>{d}</button>)}</div>
        <label className="flex items-center gap-1">at <Input value={s.scheduleTime} onChange={(e) => setS({ ...s, scheduleTime: e.target.value })} className="h-8 w-20" /></label>
        <label className="flex items-center gap-1">leads/day <Input value={String(s.dailyLimit)} onChange={(e) => setS({ ...s, dailyLimit: Number(e.target.value.replace(/\D/g, "")) || 1 })} className="h-8 w-16" /></label>
        <label className="flex items-center gap-1">city <Input value={s.city} onChange={(e) => setS({ ...s, city: e.target.value })} className="h-8 w-32" /></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>Business types (comma-separated)<Input value={s.cats} onChange={(e) => setS({ ...s, cats: e.target.value })} placeholder="gyms, cafés, salons, dental clinics" className="mt-1" /></label>
        <label>Areas<Input value={s.areasT} onChange={(e) => setS({ ...s, areasT: e.target.value })} placeholder="Indiranagar, HSR Layout, Koramangala" className="mt-1" /></label>
      </div>
      <div className="flex items-center gap-2"><Button size="sm" onClick={() => void save()}>Save</Button>{msg && <span className={msg.ok ? "text-emerald-300" : "text-red-300"}>{msg.text}</span>}</div>
    </div>
  );
}
