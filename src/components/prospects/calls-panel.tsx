"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Settings { enabled: boolean; dailyCap: number; hoursFrom: string; hoursTo: string; days: number[]; recordingNotice: boolean; callerName: string; company: string; ownerName: string; city: string }
interface Call { id: string; batchId: string; status: string; to: string; prospectId: string; name: string; category: string | null; area: string | null; outcome: string | null; summary: string | null; error: string | null; transcript: { who: string; text: string }[]; startedAt: string | null; endedAt: string | null; createdAt: string }
interface Board { settings: Settings; windowOpen: boolean; callsToday: number; calls: Call[] }

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LIVE = new Set(["dialing", "in_call"]);
const tone: Record<string, string> = { completed: "text-emerald-300", no_answer: "text-amber-300", failed: "text-red-300", skipped: "text-white/45", cancelled: "text-white/45", approved: "text-cyan-200", proposed: "text-white/70", dialing: "text-cyan-200", in_call: "text-cyan-200" };

async function api<T>(body: object): Promise<T> {
  const r = await fetch("/api/prospects/calls", { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `Request failed (${r.status})`);
  return j.data as T;
}

/** CRM → Calls: JARVIS plans, you approve the batch, the caller on your laptop dials (Phone Link, your number). */
export function CallsPanel({ onChanged }: { onChanged: () => void }) {
  const [b, setB] = useState<Board | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/prospects/calls"); const j = await r.json().catch(() => null);
    if (j?.ok) setB(j.data);
  }, []);
  const live = !!b?.calls.some((c) => LIVE.has(c.status));
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, live ? 2500 : 10000); return () => clearInterval(t); }, [load, live]);

  const act = async (body: object, done?: string) => {
    setBusy(true); setMsg(null);
    try { await api(body); if (done) setMsg({ ok: true, text: done }); await load(); onChanged(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };

  const batches = useMemo(() => {
    const m = new Map<string, Call[]>();
    for (const c of b?.calls ?? []) if (c.status === "proposed") m.set(c.batchId, [...(m.get(c.batchId) ?? []), c]);
    return [...m.entries()];
  }, [b]);
  if (!b) return <div className="glass rounded-2xl p-3 text-xs text-white/60">Loading calls…</div>;
  const s = b.settings;
  const queued = b.calls.filter((c) => c.status === "approved").length;
  const done = b.calls.filter((c) => !["proposed", "approved"].includes(c.status));

  return (
    <div className="glass space-y-3 rounded-2xl p-3 text-xs text-white/75">
      <div className="flex flex-wrap items-center gap-2">
        <Phone className="h-4 w-4 text-cyan-300" /><b className="text-sm text-white">Calls</b>
        <span className="text-white/50">from your number via Phone Link · {b.callsToday}/{s.dailyCap} today · {s.hoursFrom}–{s.hoursTo} {s.days.map((d) => DAYS[d]).join(" ")} · {b.windowOpen ? "calling hours now" : "outside calling hours"}</span>
        <label className="ml-auto flex items-center gap-1.5 text-white"><input type="checkbox" checked={s.enabled} disabled={busy} onChange={(e) => void act({ action: "settings", enabled: e.target.checked }, e.target.checked ? "Calling is on — approved calls go out from the laptop during calling hours." : "Calling is off.")} /> Calling on</label>
        <Button size="sm" variant="outline" onClick={() => setShowSettings((v) => !v)}>Settings</Button>
        <Button size="sm" disabled={busy} onClick={() => act({ action: "plan" }, "Planned — check the list and approve it below.")}>Plan today&apos;s calls</Button>
      </div>
      {msg && <div className={msg.ok ? "text-emerald-300" : "text-red-300"}>{msg.text}</div>}
      {showSettings && <CallSettingsForm s={s} onSave={(x) => act({ action: "settings", ...x }, "Saved.")} />}

      {batches.map(([batchId, calls]) => (
        <div key={batchId} className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-2.5">
          <div className="mb-1.5 flex items-center gap-2"><b className="text-white">{calls.length} call{calls.length === 1 ? "" : "s"} waiting for your approval</b>
            <Button size="sm" className="ml-auto" disabled={busy} onClick={() => act({ action: "approve", batchId }, `Approved ${calls.length} call${calls.length === 1 ? "" : "s"}.${s.enabled ? "" : " Turn on \"Calling on\" so they go out."}`)}><Check className="h-3.5 w-3.5" /> Approve</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "cancel", batchId })}><X className="h-3.5 w-3.5" /> Cancel</Button>
          </div>
          <ul className="grid gap-1 sm:grid-cols-2">{calls.map((c) => <li key={c.id} className="flex items-center gap-2"><span className="truncate text-white">{c.name}</span><span className="text-white/45">{c.to}</span><button type="button" title="Leave this one out" className="ml-auto text-white/40 hover:text-red-300" onClick={() => act({ action: "cancel", id: c.id })}><X className="h-3 w-3" /></button></li>)}</ul>
        </div>
      ))}
      {queued > 0 && <div className="text-cyan-200">{queued} approved call{queued === 1 ? "" : "s"} waiting for the laptop. On the laptop: orb tray icon → <b>Prospect calls</b> → <b>Start calling</b>.</div>}

      {done.length > 0 && (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {done.map((c) => (
            <li key={c.id} className={cn("rounded-lg border border-white/10 p-2", LIVE.has(c.status) && "border-cyan-400/50")}>
              <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
                {open === c.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {LIVE.has(c.status) && <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />}
                <b className="truncate text-white">{c.name}</b>
                <span className={cn("ml-auto flex-none", tone[c.status])}>{c.status === "in_call" ? "on the call" : c.status.replace(/_/g, " ")}{c.outcome && c.status !== "in_call" ? ` · ${c.outcome.replace(/_/g, " ")}` : ""}</span>
              </button>
              {(c.summary || c.error) && <div className={cn("mt-1 pl-5", c.error ? "text-red-300/80" : "text-white/65")}>{c.error ?? c.summary}</div>}
              {open === c.id && c.transcript.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 pl-5">{c.transcript.map((l, i) => <li key={i} className={l.who === "jarvis" ? "text-cyan-200" : "text-white"}>{l.who === "jarvis" ? "JARVIS" : "Them"}: {l.text}</li>)}</ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {!batches.length && !queued && !done.length && <div className="text-white/50">No calls yet. <b>Plan today&apos;s calls</b> picks the leads due for a call (new, callback, not reachable; max 3 tries, one a day, never do-not-contact) — nothing is dialled until you approve.</div>}
    </div>
  );
}

function CallSettingsForm({ s, onSave }: { s: Settings; onSave: (x: Partial<Settings>) => void }) {
  const [v, setV] = useState(s);
  return (
    <div className="space-y-2 rounded-xl border border-white/10 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">from <Input value={v.hoursFrom} onChange={(e) => setV({ ...v, hoursFrom: e.target.value })} className="h-8 w-20" /></label>
        <label className="flex items-center gap-1">to <Input value={v.hoursTo} onChange={(e) => setV({ ...v, hoursTo: e.target.value })} className="h-8 w-20" /></label>
        <div className="flex gap-1">{DAYS.map((d, i) => <button key={d} type="button" onClick={() => setV({ ...v, days: v.days.includes(i) ? v.days.filter((x) => x !== i) : [...v.days, i] })} className={cn("rounded-md border px-1.5 py-0.5", v.days.includes(i) ? "border-cyan-400/50 text-cyan-200" : "border-white/10 text-white/40")}>{d}</button>)}</div>
        <label className="flex items-center gap-1">calls/day <Input value={String(v.dailyCap)} onChange={(e) => setV({ ...v, dailyCap: Number(e.target.value.replace(/\D/g, "")) || 1 })} className="h-8 w-16" /></label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={v.recordingNotice} onChange={(e) => setV({ ...v, recordingNotice: e.target.checked })} /> say &ldquo;this call may be recorded&rdquo;</label>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label>JARVIS&apos;s name<Input value={v.callerName} onChange={(e) => setV({ ...v, callerName: e.target.value })} className="mt-1 h-8" /></label>
        <label>Company<Input value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} className="mt-1 h-8" /></label>
        <label>On behalf of<Input value={v.ownerName} onChange={(e) => setV({ ...v, ownerName: e.target.value })} className="mt-1 h-8" /></label>
        <label>City<Input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} className="mt-1 h-8" /></label>
      </div>
      <p className="text-white/50">JARVIS opens every call with: &ldquo;Hi, is this …? This is {v.callerName}, an AI assistant calling from {v.company} here in {v.city}, on behalf of {v.ownerName}.{v.recordingNotice ? " This call may be recorded for quality." : ""} Is this a good time for two minutes?&rdquo;</p>
      <Button size="sm" onClick={() => onSave({ hoursFrom: v.hoursFrom, hoursTo: v.hoursTo, days: v.days, dailyCap: v.dailyCap, recordingNotice: v.recordingNotice, callerName: v.callerName, company: v.company, ownerName: v.ownerName, city: v.city })}>Save</Button>
    </div>
  );
}
