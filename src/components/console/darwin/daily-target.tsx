"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileText, Loader2, Play, Settings2, X, Database, Eye, Mail, Sheet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DarwinDailyView } from "@/lib/darwin/daily/run";

/**
 * DARWIN's daily target — a small holographic ring on the map, not a CRM
 * dashboard. Every number is read from today's run (the leads it actually saved
 * and its own counters). While the run is going, this keeps it moving.
 */

export function useDarwinDaily() {
  const [view, setView] = useState<DarwinDailyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ticking = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/darwin/daily", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error || `HTTP ${r.status}`); return null; }
      setView(j.data); setError(null);
      return j.data as DarwinDailyView;
    } catch { setError("Couldn't reach the server."); return null; }
  }, []);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch("/api/darwin/daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    setView(j.data);
    return j.data as DarwinDailyView;
  }, []);

  const tick = useCallback(async () => {
    if (ticking.current) return;
    ticking.current = true;
    try { await post({ action: "tick" }); } catch { /* next poll */ } finally { ticking.current = false; }
  }, [post]);

  const act = useCallback(async (body: Record<string, unknown>) => {
    setBusy(String(body.action));
    try { await post(body); return null; } catch (e) { return (e as Error).message; } finally { setBusy(null); }
  }, [post]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const loop = async () => {
      const v = await load();
      const running = v?.run?.status === "running";
      if (running) void tick();
      if (alive) t = setTimeout(loop, running ? 6000 : 60_000);
    };
    void loop();
    return () => { alive = false; clearTimeout(t); };
  }, [load, tick]);

  return { view, error, busy, act, reload: load };
}

const STATUS: Record<string, string> = {
  running: "SEARCHING", completed: "DAILY TARGET COMPLETE", partial: "DAILY SEARCH DONE", needs_setup: "NEEDS SETUP", paused: "PAUSED", failed: "FAILED",
};

export function DailyTarget({ daily, onViewLeads, onOpenCrm }: {
  daily: ReturnType<typeof useDarwinDaily>;
  onViewLeads: (ids: string[]) => void;
  onOpenCrm: () => void;
}) {
  const { view, busy } = daily;
  const [report, setReport] = useState(false);
  const [settings, setSettings] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!view) return null;
  const run = view.run;
  const target = run?.target ?? view.config.target;
  const verified = run?.verified ?? 0;
  const pct = Math.min(1, verified / Math.max(target, 1));
  const complete = run?.status === "completed";
  const R = 34, C = 2 * Math.PI * R;
  return (
    <>
      <div className={cn("dw-glass w-[228px] rounded-2xl p-3", complete && "dw-daily-complete")} data-darwin-daily={run?.status ?? "not_started"} style={{ animation: "ultron-emerge .8s ease .3s both" }}>
        <div className="flex items-center justify-between">
          <span className="text-[9px] tracking-[0.34em] text-white/55">DAILY TARGET</span>
          <button onClick={() => setSettings((s) => !s)} title="Daily search settings" aria-label="Daily search settings" className="flex h-6 w-6 items-center justify-center rounded-full text-white/45 hover:bg-white/10 hover:text-white">
            <Settings2 className="h-3 w-3" />
          </button>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <svg width="84" height="84" viewBox="0 0 84 84" className="shrink-0 -rotate-90">
            <circle cx="42" cy="42" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3" />
            <circle cx="42" cy="42" r={R} fill="none" stroke={complete ? "url(#dw-done)" : "url(#dw-prog)"} strokeWidth="3.2" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)", filter: "drop-shadow(0 0 6px rgba(120,220,255,.6))" }} />
            {run?.status === "running" && <circle cx="42" cy="42" r={R + 5} fill="none" stroke="rgba(160,230,255,.25)" strokeWidth="1" strokeDasharray="2 7" className="dw-daily-scan" />}
            <defs>
              <linearGradient id="dw-prog" x1="0" x2="1"><stop offset="0" stopColor="#7dd3fc" /><stop offset="1" stopColor="#a5f3fc" /></linearGradient>
              <linearGradient id="dw-done" x1="0" x2="1"><stop offset="0" stopColor="#6ee7b7" /><stop offset="1" stopColor="#a5f3fc" /></linearGradient>
            </defs>
          </svg>
          <div className="min-w-0">
            <div className="font-extralight tabular-nums text-white" data-darwin-daily-count><span className="text-[28px] leading-none">{verified}</span><span className="text-[15px] text-white/45"> / {target}</span></div>
            <div className={cn("mt-1 text-[9px] tracking-[0.22em]", complete ? "text-emerald-200" : run?.status === "partial" ? "text-amber-100/80" : run?.status === "needs_setup" ? "text-amber-200" : "text-cyan-100/70")}>
              {run ? (STATUS[run.status] ?? run.status.toUpperCase()) : view.due ? "STARTING" : `STARTS ${view.startLabel}`}
              {run?.status === "running" && <Loader2 className="ml-1 inline h-2.5 w-2.5 animate-spin" />}
            </div>
            {!complete && run?.status !== "partial" && <div className="mt-0.5 text-[9px] tracking-[0.16em] text-white/40" data-darwin-deadline>GOAL {target}{view.config.requirePhone ? " WITH PHONES" : ""} BY {view.deadlineLabel}</div>}
          </div>
        </div>

        {run && run.status !== "needs_setup" && (
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
            <Stat k="Verified leads" v={verified} />
            <Stat k="Remaining" v={run.remaining} />
            <Stat k="Duplicates removed" v={run.duplicates} />
            <Stat k="Websites rejected" v={run.websiteRejected} />
            <Stat k="Contactable" v={run.contactable} />
            <Stat k="High-potential" v={run.highPotential} hot />
          </div>
        )}

        {run && run.emailTarget > 0 && run.status !== "needs_setup" && (
          <div className="mt-2 rounded-lg border border-cyan-200/15 bg-cyan-200/[0.05] px-2 py-1.5 text-[10px]" data-darwin-email-goal>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 tracking-[0.16em] text-cyan-50/80"><Mail className="h-3 w-3" />EMAIL GOAL</span>
              <span className="text-white/45">ALL SENT BY {view.emailDeadlineLabel}</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3">
              <Stat k="With an email" v={run.withEmail} />
              <Stat k="Emailed" v={run.emailed} hot />
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
              <div className="h-full rounded bg-gradient-to-r from-cyan-300 to-emerald-300 transition-[width] duration-700" style={{ width: `${Math.min(100, (run.emailed / run.emailTarget) * 100)}%` }} />
            </div>
            <div className="mt-0.5 text-[9px] text-white/40">{run.emailed}/{run.emailTarget} businesses without a website emailed today</div>
          </div>
        )}
        {view.email.enabled && <EmailLine e={view.email} />}

        {run?.status === "needs_setup" && <p className="mt-2 text-[11px] leading-snug text-amber-100/80">{run.lastError}</p>}
        {run?.status === "running" && run.lastError && <p className="mt-2 text-[10px] leading-snug text-amber-100/70">{run.lastError}</p>}
        {run?.status === "running" && run.log.length > 0 && <p className="mt-2 truncate text-[10px] text-white/40" title={run.log[run.log.length - 1].text}>{run.log[run.log.length - 1].text}</p>}

        {(complete || run?.status === "partial") && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Btn onClick={() => onViewLeads(run!.leadIds)} icon={<Eye className="h-3 w-3" />}>VIEW LEADS</Btn>
            <Btn onClick={onOpenCrm} icon={<Database className="h-3 w-3" />}>OPEN CRM</Btn>
            <Btn onClick={() => setReport(true)} icon={<FileText className="h-3 w-3" />}>DAILY REPORT</Btn>
          </div>
        )}
        {view.sheetUrl && (
          <a href={view.sheetUrl} target="_blank" rel="noreferrer" data-darwin-sheet
            className="mt-1.5 flex w-fit items-center gap-1 rounded-full border border-emerald-200/25 bg-emerald-200/[0.07] px-2.5 py-1 text-[9.5px] tracking-[0.16em] text-emerald-50 transition hover:bg-emerald-200/15">
            <Sheet className="h-3 w-3" />GOOGLE SHEET
          </a>
        )}
        {(!run || run.status === "needs_setup") && (
          <div className="mt-2.5 flex gap-1.5">
            {run?.status === "needs_setup"
              ? <Btn onClick={() => setSettings(true)} icon={<Settings2 className="h-3 w-3" />}>SET UP</Btn>
              : <Btn onClick={async () => setMsg(await daily.act({ action: "start" }))} icon={busy === "start" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}>START NOW</Btn>}
          </div>
        )}
        {msg && <p className="mt-1.5 text-[10px] text-rose-200/80">{msg}</p>}
      </div>
      {settings && <DailySettings daily={daily} onClose={() => setSettings(false)} />}
      {report && view.report && <DailyReportModal view={view} onClose={() => setReport(false)} onViewLeads={() => { setReport(false); onViewLeads(run!.leadIds); }} />}
    </>
  );
}

/** Automatic outreach at a glance: sent in the last 24 h, waiting, or what's blocking it. */
function EmailLine({ e }: { e: DarwinDailyView["email"] }) {
  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2 py-1 text-[10px]" data-darwin-auto-email>
      <Mail className="h-3 w-3 shrink-0 text-cyan-200/70" />
      {e.connected
        ? <span className="text-white/70"><span className="tabular-nums text-white/90">{e.sentLast24h}</span> emailed today{e.waiting > 0 && <> · <span className="tabular-nums">{e.waiting}</span> waiting</>}{e.sentLast24h >= e.cap && " · daily limit reached"}</span>
        : <span className="text-amber-200/80">Connect Gmail to email leads automatically{e.waiting > 0 ? ` (${e.waiting} waiting)` : ""}</span>}
    </div>
  );
}

function Stat({ k, v, hot }: { k: string; v: number; hot?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="truncate text-white/45">{k}</span>
      <span className={cn("tabular-nums", hot ? "text-cyan-200" : "text-white/85")}>{v}</span>
    </div>
  );
}
function Btn({ children, onClick, icon }: { children: React.ReactNode; onClick: () => void; icon?: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 rounded-full border border-cyan-200/25 bg-cyan-200/[0.07] px-2.5 py-1 text-[9.5px] tracking-[0.16em] text-cyan-50 transition hover:bg-cyan-200/15">
      {icon}{children}
    </button>
  );
}

/** Where and what DARWIN searches every day. */
function DailySettings({ daily, onClose }: { daily: ReturnType<typeof useDarwinDaily>; onClose: () => void }) {
  const v = daily.view!;
  const [allBangalore, setAllBangalore] = useState(!!v.config.allBangalore);
  const [keepGoing, setKeepGoing] = useState(v.config.keepGoing !== false);
  const [locations, setLocations] = useState((v.config.allBangalore ? v.config.ownLocations ?? [] : v.config.locations).join("\n"));
  const [categories, setCategories] = useState(v.config.categories.join(", "));
  const allowed = v.allowedCategories;
  const picked = categories.split(/,|\n/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const toggle = (c: string) => setCategories((picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c]).join(", "));
  const [target, setTarget] = useState(v.config.target);
  const [radiusKm, setRadiusKm] = useState(v.config.radiusKm);
  const [requirePhone, setRequirePhone] = useState(v.config.requirePhone);
  const [strict, setStrict] = useState(v.config.strict);
  const [autoEmail, setAutoEmail] = useState(v.config.autoEmail);
  const [emailTarget, setEmailTarget] = useState(v.config.emailTarget ?? 25);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const e = await daily.act({
      action: "settings", target, radiusKm, requirePhone, strict, autoEmail, emailTarget, allBangalore, keepGoing,
      locations: locations.split(/\n|;/).map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 12),
      categories: categories.split(/,|\n/).map((x) => x.trim()).filter((x) => x.length >= 2),
    });
    if (e) setErr(e); else onClose();
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3 backdrop-blur-[2px]" onClick={onClose}>
      <div className="dw-glass w-full max-w-md rounded-2xl p-4" onClick={(e) => e.stopPropagation()} style={{ animation: "ultron-emerge .35s ease both" }} data-darwin-daily-settings>
        <div className="flex items-center justify-between">
          <span className="text-[10px] tracking-[0.34em] text-white/65">DAILY SEARCH</span>
          <button onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <label className="mt-3 flex items-start gap-2 text-[12px] text-white/80" data-darwin-all-bangalore>
          <input type="checkbox" checked={allBangalore} onChange={(e) => { setAllBangalore(e.target.checked); setRadiusKm(e.target.checked ? 3 : 6); }} className="mt-0.5 accent-cyan-300" />
          <span>Search every area of Bangalore <span className="text-white/40">— {v.bangaloreAreas} areas, from the centre out to Yelahanka, Whitefield, Electronic City and Kengeri. Each day carries on from where the last one stopped, so every area gets its turn.</span></span>
        </label>
        {!allBangalore && (
          <>
            <label className="mt-3 block text-[10px] tracking-[0.2em] text-white/50">TARGET LOCATIONS <span className="normal-case tracking-normal text-white/30">(one per line)</span></label>
            <textarea value={locations} onChange={(e) => setLocations(e.target.value)} rows={3} placeholder={"Indiranagar, Bengaluru\nKoramangala, Bengaluru"}
              className="dw-bare mt-1 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white outline-none focus:border-cyan-200/40" />
            {v.config.source === "recent searches" && <p className="mt-1 text-[10px] text-white/40">Using the places you searched recently — save to make them yours.</p>}
          </>
        )}
        <label className="mt-3 block text-[10px] tracking-[0.2em] text-white/50">BUSINESS CATEGORIES</label>
        {allowed ? (
          <>
            <div className="mt-1 flex flex-wrap gap-1.5" data-darwin-categories>
              {allowed.map((c) => (
                <button key={c} type="button" onClick={() => toggle(c)} aria-pressed={picked.includes(c)}
                  className={cn("rounded-full border px-3 py-1 text-[11px] capitalize transition", picked.includes(c) ? "border-cyan-200/50 bg-cyan-300/15 text-white" : "border-white/10 bg-black/30 text-white/45 hover:text-white/75")}>
                  {c}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-white/40">DARWIN only looks for {allowed.join(", ")}. Leave none picked to search them all.</p>
          </>
        ) : (
          <textarea value={categories} onChange={(e) => setCategories(e.target.value)} rows={3}
            className="dw-bare mt-1 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white outline-none focus:border-cyan-200/40" />
        )}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-[10px] tracking-[0.2em] text-white/50">DAILY TARGET
            <input type="number" min={1} max={200} value={target} onChange={(e) => setTarget(Math.min(Math.max(+e.target.value || 1, 1), 200))}
              className="dw-bare mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white outline-none" />
          </label>
          <label className="text-[10px] tracking-[0.2em] text-white/50">RADIUS (KM)
            <input type="number" min={1} max={25} value={radiusKm} onChange={(e) => setRadiusKm(Math.min(Math.max(+e.target.value || 1, 1), 25))}
              className="dw-bare mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white outline-none" />
          </label>
        </div>
        <label className="mt-3 block text-[10px] tracking-[0.2em] text-white/50" data-darwin-email-target>EMAIL GOAL PER DAY <span className="normal-case tracking-normal text-white/30">(no-website businesses with an email, all emailed by {v.emailDeadlineLabel} · 0 = off)</span>
          <input type="number" min={0} max={40} value={emailTarget} onChange={(e) => setEmailTarget(Math.min(Math.max(Math.round(+e.target.value || 0), 0), 40))}
            className="dw-bare mt-1 w-28 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white outline-none" />
        </label>
        <label className="mt-3 flex items-start gap-2 text-[12px] text-white/80" data-darwin-keep-going>
          <input type="checkbox" checked={keepGoing} onChange={(e) => setKeepGoing(e.target.checked)} className="mt-0.5 accent-cyan-300" />
          <span>Keep going until the target is reached <span className="text-white/40">— if the leads aren&apos;t all found by {v.deadlineLabel}, DARWIN keeps searching for the rest of the day</span></span>
        </label>
        <label className="mt-1.5 flex items-center gap-2 text-[12px] text-white/80"><input type="checkbox" checked={requirePhone} onChange={(e) => setRequirePhone(e.target.checked)} className="accent-cyan-300" /> Only count businesses with a public phone number</label>
        <label className="mt-1.5 flex items-center gap-2 text-[12px] text-white/80"><input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} className="accent-cyan-300" /> Strict: confirm “no website” with Google or web search</label>
        <label className="mt-1.5 flex items-start gap-2 text-[12px] text-white/80" data-darwin-auto-email-setting>
          <input type="checkbox" checked={autoEmail} onChange={(e) => setAutoEmail(e.target.checked)} className="mt-0.5 accent-cyan-300" />
          <span>Email every new lead automatically <span className="text-white/40">— one email each, from your Gmail, to leads with a public email address (max {v.email.cap} a day)</span>
            {autoEmail && !v.email.connected && <span className="block text-amber-200/80">Gmail isn&apos;t connected — connect Google in Settings first.</span>}</span>
        </label>
        <div className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2 text-[10.5px] leading-relaxed text-white/60">
          <div className="text-[9px] tracking-[0.26em] text-white/40">VERIFICATION SOURCES</div>
          <div>Business listings (Geoapify): <Ok on={v.sources.geoapify} /></div>
          <div>Google business profile: <Ok on={v.sources.google} hint="GOOGLE_PLACES_API_KEY" /></div>
          <div>Web search: <Ok on={v.sources.search} hint="SEARCH_API_KEY" /></div>
          <div>Website reachability + name/domain matching: <Ok on /></div>
        </div>
        {err && <p className="mt-2 text-[11px] text-rose-200">{err}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-3 py-1.5 text-[11px] text-white/60 hover:text-white">Cancel</button>
          <button onClick={save} disabled={daily.busy === "settings"} className="flex items-center gap-1.5 rounded-full border border-cyan-200/30 bg-cyan-200/10 px-4 py-1.5 text-[11px] text-cyan-50 hover:bg-cyan-200/20 disabled:opacity-50">
            {daily.busy === "settings" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
function Ok({ on, hint }: { on: boolean; hint?: string }) {
  return on ? <span className="text-emerald-200">on</span> : <span className="text-amber-200/80">off{hint ? ` — set ${hint}` : ""}</span>;
}

/** DARWIN DAILY REPORT — computed from the run. */
export function DailyReportModal({ view, onClose, onViewLeads }: { view: DarwinDailyView; onClose: () => void; onViewLeads?: () => void }) {
  const r = view.report!;
  const max = Math.max(1, ...r.breakdown.map((b) => b.count));
  const date = new Date(`${r.date}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-3 backdrop-blur-[3px]" onClick={onClose}>
      <div className="dw-glass max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl p-5" onClick={(e) => e.stopPropagation()} style={{ animation: "ultron-emerge .4s ease both" }} data-darwin-report>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] tracking-[0.4em] text-cyan-100/70">DARWIN DAILY REPORT</div>
            <div className="mt-0.5 text-[13px] text-white/70">{date}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-4xl font-extralight tabular-nums text-white">{r.verified}</span>
          <span className="text-white/45">/ {r.target} verified new leads</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-1.5 text-[12px]">
          <Row k="Target" v={r.target} /><Row k="Verified new leads" v={r.verified} />
          <Row k="Duplicates removed" v={r.duplicates} /><Row k="Businesses with websites rejected" v={r.websiteRejected} />
          <Row k="Unclear website status" v={r.unclear} /><Row k="Website temporarily down" v={r.tempUnavailable} />
          <Row k="Contactable leads" v={r.contactable} /><Row k="High-potential leads" v={r.highPotential} />
          {r.alreadyChecked > 0 && <Row k="Checked on earlier days" v={r.alreadyChecked} />}
          {r.closed > 0 && <Row k="Permanently closed" v={r.closed} />}
        </div>
        {r.breakdown.length > 0 && (
          <div className="mt-5">
            <div className="text-[9px] tracking-[0.34em] text-white/45">LEAD BREAKDOWN</div>
            <div className="mt-2 space-y-1.5">
              {r.breakdown.map((b) => (
                <div key={b.bucket} className="flex items-center gap-2 text-[11.5px]">
                  <span className="w-32 shrink-0 text-white/70">{b.bucket}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full bg-gradient-to-r from-sky-300/80 to-cyan-200" style={{ width: `${(b.count / max) * 100}%` }} /></span>
                  <span className="w-6 text-right tabular-nums text-white/85">{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className={cn("mt-5 text-[12px] leading-relaxed", r.status === "completed" ? "text-emerald-100/85" : "text-amber-100/85")}>
          {r.status === "completed" ? "Search completed successfully." : `Search finished short of the target — ${r.target - r.verified} more couldn't be safely verified, so they weren't added.`}
        </p>
        {r.reasons.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-white/55">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
        <p className="mt-3 text-[10px] text-white/35">
          Verified with: business listing · website reachability · name/domain matching{r.sources.google ? " · Google business profile" : ""}{r.sources.search ? " · web search" : ""}.
        </p>
        {r.top.length > 0 && (
          <div className="mt-4">
            <div className="text-[9px] tracking-[0.34em] text-white/45">TOP LEADS</div>
            <ul className="mt-1.5 divide-y divide-white/5">
              {r.top.map((l) => (
                <li key={l.id} className="flex items-center gap-2 py-1.5 text-[11.5px]">
                  <span className="min-w-0 flex-1 truncate text-white/85">{l.name}<span className="text-white/35"> · {l.category ?? "Business"}</span></span>
                  <span className="shrink-0 text-white/50">{l.phone ?? "no phone"}</span>
                  {l.score != null && <span className="w-7 shrink-0 text-right tabular-nums text-cyan-200">{l.score}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {onViewLeads && r.verified > 0 && (
          <button onClick={onViewLeads} className="mt-4 flex items-center gap-1.5 rounded-full border border-cyan-200/25 bg-cyan-200/10 px-4 py-1.5 text-[11px] text-cyan-50 hover:bg-cyan-200/20"><Eye className="h-3.5 w-3.5" /> View these leads</button>
        )}
      </div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: number }) {
  return <div className="flex items-baseline justify-between gap-2 border-b border-white/5 pb-1"><span className="text-white/55">{k}</span><span className="tabular-nums text-white/90">{v}</span></div>;
}
