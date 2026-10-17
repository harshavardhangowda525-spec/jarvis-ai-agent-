"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Teleprompter } from "./teleprompter";
import { planSections, type Plan } from "@/lib/plans/schema";

type PlanV = { id: string; date: string; status: string; niche: string | null; plan: Plan | null; error: string | null; attempts: number; link: string | null; shared: boolean; notifiedAt: string | null; notifyLog: { channel: string; status: string; detail?: string; at: string }[] };
type Data = {
  date: string; today: string; plan: PlanV | null; history: { id: string; date: string; niche: string | null; status: string }[];
  settings: { enabled: boolean; deliveryTime: string; notifyEmail: boolean; notifyWhatsapp: boolean; due: boolean };
  channels: { whatsapp: boolean; email: boolean };
};

const post = async (body: unknown) => {
  const r = await fetch("/api/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  return r.ok && j?.ok ? { ok: true as const, data: j.data } : { ok: false as const, error: (j?.error as string) ?? `HTTP ${r.status}` };
};

/** Today's plan (or an earlier day's) in the teleprompter, plus schedule, notifications and share link. */
export function PlanHome() {
  const params = useSearchParams();
  const router = useRouter();
  const date = params.get("date") ?? "";
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"settings" | "history" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/plans${date ? `?date=${date}` : ""}`, { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !j?.ok) { setErr(r?.status === 423 ? "JARVIS is locked — unlock it first." : j?.error ?? "Couldn't load the plan."); return; }
    setD(j.data); setErr(null);
  }, [date]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (d?.plan?.status !== "generating") return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [d?.plan?.status, load]);

  const generate = async () => {
    setBusy(true); setNote("ASTON is writing today's plan — this takes up to a minute.");
    const r = await post({ action: "generate" });
    setBusy(false);
    setNote(r.ok ? (r.data.plan.status === "ready" ? null : `It didn't finish: ${r.data.plan.error ?? "unknown error"}`) : r.error);
    void load();
  };
  const share = async () => {
    if (!d?.plan?.link) return;
    const url = `${location.origin}${d.plan.link}`;
    try {
      if (navigator.share) await navigator.share({ title: `Plan — ${d.plan.niche}`, url });
      else { await navigator.clipboard.writeText(url); setNote("Link copied."); }
    } catch { /* cancelled */ }
  };

  const sections = useMemo(() => (d?.plan?.plan ? planSections(d.plan.plan) : null), [d?.plan?.plan]);
  const dayLabel = d ? new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";

  const toolbar = d && (
    <div className="ph-tools">
      <button type="button" onClick={() => setPanel(panel === "history" ? null : "history")}>History</button>
      {d.plan?.link && <button type="button" onClick={share}>Share</button>}
      <button type="button" onClick={() => setPanel(panel === "settings" ? null : "settings")}>Settings</button>
    </div>
  );

  return (
    <div className="ph" style={{ ["--tp-offset" as string]: "4rem" }}>
      <style dangerouslySetInnerHTML={{ __html: PH_CSS }} />
      {err && <div className="ph-empty"><p>{err}</p><button type="button" onClick={() => void load()}>Try again</button></div>}
      {!err && !d && <div className="ph-empty"><p>Loading…</p></div>}
      {d && sections && d.plan && (
        <Teleprompter sections={sections} heading={`ASTON · ${d.plan.niche}`} sub={`${d.date === d.today ? "Today" : dayLabel} · daily marketing plan`} toolbar={toolbar} />
      )}
      {d && !sections && (
        <div className="ph-empty">
          <div className="ph-top">{toolbar}</div>
          <h1>{d.date === d.today ? "Today's plan" : dayLabel}</h1>
          {!d.plan && d.date === d.today && <p>Today&apos;s plan hasn&apos;t been made yet. It&apos;s prepared automatically on the server before {d.settings.deliveryTime} (India time){d.settings.enabled ? "" : " — but the daily plan is switched off in Settings"}.</p>}
          {!d.plan && d.date !== d.today && <p>There&apos;s no plan for this day.</p>}
          {d.plan?.status === "generating" && <p>ASTON is writing it right now…</p>}
          {d.plan?.status === "failed" && <p className="ph-bad">It couldn&apos;t be made ({d.plan.attempts} attempt{d.plan.attempts === 1 ? "" : "s"}): {d.plan.error}</p>}
          {d.date === d.today && d.plan?.status !== "generating" && <button type="button" className="ph-pri" disabled={busy} onClick={generate}>{busy ? "Writing…" : d.plan?.status === "failed" ? "Try again" : "Make today's plan now"}</button>}
        </div>
      )}
      {note && <div className="ph-note" role="status">{note}<button type="button" onClick={() => setNote(null)} aria-label="Dismiss">×</button></div>}
      {d && panel === "history" && (
        <aside className="ph-panel" aria-label="Previous plans">
          <header><strong>Previous plans</strong><button type="button" onClick={() => setPanel(null)} aria-label="Close">×</button></header>
          {!d.history.length && <p className="ph-mute">No plans yet.</p>}
          <ul>{d.history.map((h) => (
            <li key={h.id}><button type="button" className={h.date === d.date ? "on" : ""} onClick={() => { setPanel(null); router.push(h.date === d.today ? "/dashboard/teleprompter" : `/dashboard/teleprompter?date=${h.date}`); }}>
              <span>{h.date}</span><strong>{h.niche ?? "—"}</strong><small>{h.status}</small></button></li>
          ))}</ul>
        </aside>
      )}
      {d && panel === "settings" && <SettingsPanel d={d} onClose={() => setPanel(null)} onChanged={load} setNote={setNote} />}
    </div>
  );
}

function SettingsPanel({ d, onClose, onChanged, setNote }: { d: Data; onClose: () => void; onChanged: () => void; setNote: (s: string | null) => void }) {
  const [s, setS] = useState(d.settings);
  const [saving, setSaving] = useState(false);
  const [log, setLog] = useState<{ channel: string; status: string; detail?: string }[] | null>(null);
  const save = async (patch: Partial<typeof s>) => {
    const next = { ...s, ...patch };
    setS(next); setSaving(true);
    const r = await post({ action: "settings", ...patch });
    setSaving(false);
    if (!r.ok) setNote(r.error); else onChanged();
  };
  const plan = d.plan;
  return (
    <aside className="ph-panel" aria-label="Plan settings">
      <header><strong>Daily plan settings</strong><button type="button" onClick={onClose} aria-label="Close">×</button></header>
      <label className="ph-row"><input type="checkbox" checked={s.enabled} onChange={(e) => void save({ enabled: e.target.checked })} /> Make a plan every day</label>
      <label className="ph-row">Ready by (India time) <input type="time" value={s.deliveryTime} onChange={(e) => setS({ ...s, deliveryTime: e.target.value })} onBlur={() => void save({ deliveryTime: s.deliveryTime })} /></label>
      <p className="ph-mute">The cloud schedule checks every hour from 4:30 to 10:30 AM and prepares the plan at the last check before this time (up to ~35 min early) — your PC can be off.</p>
      <h3>Tell me when it&apos;s ready</h3>
      <label className="ph-row"><input type="checkbox" checked={s.notifyWhatsapp} onChange={(e) => void save({ notifyWhatsapp: e.target.checked })} /> WhatsApp {d.channels.whatsapp ? <em className="ok">set up</em> : <em className="no">not set up on the server</em>}</label>
      <label className="ph-row"><input type="checkbox" checked={s.notifyEmail} onChange={(e) => void save({ notifyEmail: e.target.checked })} /> Email (your Gmail) {d.channels.email ? <em className="ok">connected</em> : <em className="no">Gmail not connected</em>}</label>
      {!d.channels.whatsapp && <p className="ph-mute">WhatsApp needs WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_NOTIFY_TO and an approved template name in WHATSAPP_PLAN_TEMPLATE, set in your Vercel environment variables (never paste them in a chat).</p>}
      <button type="button" disabled={saving || !plan || plan.status !== "ready" || (!s.notifyEmail && !s.notifyWhatsapp)} onClick={async () => { setLog(null); const r = await post({ action: "test_notify" }); if (r.ok) setLog(r.data.log); else setNote(r.error); }}>Send a test now</button>
      {log && <ul className="ph-log">{log.map((l, i) => <li key={i} className={l.status}><strong>{l.channel}</strong> {l.status.replace("_", " ")}{l.detail ? ` — ${l.detail}` : ""}</li>)}</ul>}
      {plan?.notifyLog?.length ? <><h3>Today&apos;s notification</h3><ul className="ph-log">{plan.notifyLog.map((l, i) => <li key={i} className={l.status}><strong>{l.channel}</strong> {l.status.replace("_", " ")}{l.detail ? ` — ${l.detail}` : ""}</li>)}</ul></> : null}
      {plan && <>
        <h3>Share link</h3>
        {plan.link ? <p className="ph-mute">Anyone with the link can read this plan (it has no customer data). <a href={plan.link} target="_blank" rel="noreferrer">Open</a></p> : <p className="ph-mute">This plan&apos;s link is switched off.</p>}
        <div className="ph-btns">
          <button type="button" onClick={async () => { const r = await post({ action: "rotate", id: plan.id }); setNote(r.ok ? "New link made — the old one no longer works." : r.error); onChanged(); }}>New link</button>
          {plan.link && <button type="button" onClick={async () => { const r = await post({ action: "revoke", id: plan.id }); setNote(r.ok ? "Link switched off." : r.error); onChanged(); }}>Switch link off</button>}
        </div>
      </>}
    </aside>
  );
}

const PH_CSS = `
.ph{position:relative;background:#05070c;color:#f8fafc;min-height:calc(100dvh - 4rem);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.ph button{font:inherit;cursor:pointer}
.ph-tools{display:flex;gap:6px}.ph-tools button,.ph-panel button,.ph-empty button{min-height:40px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#121a2b;color:#f8fafc}
.ph-empty{max-width:640px;margin:0 auto;padding:24px 18px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}.ph-empty h1{font-size:24px;margin:8px 0 0}.ph-top{align-self:flex-end}
.ph-pri{background:#f59e0b!important;color:#111!important;border-color:#f59e0b!important;font-weight:800}.ph-bad{color:#fca5a5}
.ph-note{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:30;background:#1e293b;border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:10px 14px;display:flex;gap:10px;align-items:center;max-width:calc(100vw - 32px)}
.ph-note button{background:none;border:0;color:#94a3b8;font-size:18px}
.ph-panel{position:fixed;right:12px;top:calc(4rem + 12px);bottom:12px;z-index:40;width:min(380px,calc(100vw - 24px));overflow-y:auto;background:#0b1220;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:14px;box-shadow:0 30px 60px -20px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:10px}
.ph-panel header{display:flex;justify-content:space-between;align-items:center}.ph-panel header button{min-height:36px;min-width:36px;padding:0}
.ph-panel h3{margin:8px 0 0;font-size:14px;color:#f59e0b}.ph-panel ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.ph-panel li > button{width:100%;display:grid;grid-template-columns:90px 1fr auto;gap:8px;text-align:left;align-items:center}.ph-panel li > button.on{border-color:#f59e0b}
.ph-panel small,.ph-mute{color:#94a3b8;font-size:13px;margin:0}.ph-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ph-row input[type=time]{background:#121a2b;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 8px}
.ph-row input[type=checkbox]{width:18px;height:18px;accent-color:#f59e0b}.ph-row em{font-style:normal;font-size:12px;padding:2px 8px;border-radius:999px}.ph-row em.ok{background:#14532d;color:#bbf7d0}.ph-row em.no{background:#3f1d1d;color:#fecaca}
.ph-btns{display:flex;gap:8px;flex-wrap:wrap}.ph-log li{font-size:13px;padding:6px 8px;border-radius:8px;background:#121a2b}.ph-log li.sent strong{color:#86efac}.ph-log li.failed strong,.ph-log li.not_configured strong{color:#fca5a5}
.ph a{color:#fbbf24}
`;
