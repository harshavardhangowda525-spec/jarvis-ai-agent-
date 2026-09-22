"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Send, Power, Radar, Database, Users, BellRing, ShieldCheck, X, ExternalLink, Loader2, CircleCheck } from "lucide-react";
import { useVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import { cn } from "@/lib/utils";

type DarwinState = "IDLE" | "LISTENING" | "THINKING" | "SEARCHING" | "PROCESSING" | "WAITING_FOR_APPROVAL" | "COMPLETED" | "ERROR";

interface Overview {
  hasData: boolean;
  hasConnectedDiscovery: boolean;
  emailReady: boolean;
  totals: { leads: number; dueFollowUps: number; pendingApprovals: number };
  byStage: Record<string, number>;
  bySource: Record<string, number>;
  sources: { id: string; label: string; connected: boolean; kind: string }[];
  recentActivity: { id: string; type: string; detail: string; createdAt: string }[];
}
interface Lead {
  id: string; businessName: string; category?: string; location?: string; website?: string; phone?: string; email?: string;
  instagram?: string; source: string; sourceUrl?: string; stage: string; opportunityType?: string; leadScore?: number;
  verifiedFields: string[]; aiAnalysis?: string; nextFollowUpAt?: string; discoveredAt: string;
}

const STAGE_ORDER = ["new", "qualified", "contacted", "replied", "interested", "demo", "proposal", "negotiation", "won", "lost", "follow_up"];
const STAGE_LABEL: Record<string, string> = {
  new: "NEW", qualified: "QUALIFIED", contacted: "CONTACTED", replied: "REPLIED", interested: "INTERESTED",
  demo: "DEMO", proposal: "PROPOSAL", negotiation: "NEGOTIATION", won: "WON", lost: "LOST", follow_up: "FOLLOW-UP",
};

export function DarwinConsole() {
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [input, setInput] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [showExplorer, setShowExplorer] = useState(false);
  const sendRef = useRef<(t: string) => void>(() => {});

  const voice = useVoice({ onTranscript: (t) => sendRef.current(t), autoListen: true });
  const agent = useAgent({
    onAssistantComplete: (text) => { if (voiceStarted && !voice.muted && voice.enabled) voice.speak(text); loadOverview(); },
  });

  const loadOverview = useCallback(() => {
    fetch("/api/darwin/overview").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setOverview(j.data)).catch(() => {});
  }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  useEffect(() => { sendRef.current = (t: string) => { if (t.trim()) agent.send(t, { agent: "darwin" }); }; }, [agent]);

  async function enableVoice() { const ok = await voice.init(); if (ok) setVoiceStarted(true); return ok; }
  function handleSend() { const t = input.trim(); if (!t) return; setInput(""); sendRef.current(t); }

  const state: DarwinState = (() => {
    if (voice.status === "denied" || voice.status === "error") return "ERROR";
    if ((overview?.totals.pendingApprovals ?? 0) > 0 && !agent.streaming) return "WAITING_FOR_APPROVAL";
    if (agent.streaming) {
      const label = agent.activity[0]?.label ?? "";
      if (/search|find|source|discover/i.test(label)) return "SEARCHING";
      if (agent.activity[0]?.kind === "tool") return "PROCESSING";
      return "THINKING";
    }
    if (voice.status === "recording" || voice.status === "listening") return "LISTENING";
    if (voice.status === "processing") return "THINKING";
    return "IDLE";
  })();

  const operation = agent.streaming ? (agent.activity[0]?.label ?? "Working…") : voice.status === "recording" ? "Listening…" : "Standing by";
  const subtitle = [...agent.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const noSource = overview && !overview.hasData && !overview.hasConnectedDiscovery;

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[#03060e]">
      {/* ambient depth */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-[42%] h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.12),transparent_62%)] blur-3xl" />
        <DarwinDust />
      </div>

      {/* top marker */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 pt-4">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-accent" />
          <span className="hud-display text-sm tracking-[0.5em] text-foreground/90">DARWIN</span>
        </div>
        <button onClick={() => setShowExplorer(true)} className="hud-row flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-accent">
          <Users className="h-3.5 w-3.5" /> Leads {overview ? `(${overview.totals.leads})` : ""}
        </button>
      </div>

      {/* central hologram */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <DarwinCore state={state} level={voice.level} />
      </div>

      {/* left HUD — status + operation */}
      <div className="absolute left-4 top-1/2 z-10 hidden -translate-y-1/2 space-y-3 md:block">
        <HudCard title="DARWIN STATUS"><StateLine state={state} /></HudCard>
        <HudCard title="CURRENT OPERATION"><span className="text-sm text-foreground/85">{operation}</span></HudCard>
      </div>

      {/* right HUD — pipeline + alerts + sources */}
      <div className="absolute right-4 top-1/2 z-10 hidden -translate-y-1/2 space-y-3 text-right md:block">
        <HudCard title="PIPELINE" align="right">
          <div className="text-sm text-foreground/85">{overview?.totals.leads ?? 0} leads</div>
          {overview && <div className="mt-0.5 text-[10px] text-muted-foreground">{(overview.byStage.won ?? 0)} won · {(overview.byStage.contacted ?? 0)} contacted</div>}
        </HudCard>
        <HudCard title="FOLLOW-UPS" align="right">
          <span className={cn("text-sm", (overview?.totals.dueFollowUps ?? 0) > 0 ? "text-warning" : "text-foreground/85")}>{overview?.totals.dueFollowUps ?? 0} due</span>
        </HudCard>
        {(overview?.totals.pendingApprovals ?? 0) > 0 && (
          <HudCard title="APPROVALS" align="right"><span className="text-sm text-warning">{overview!.totals.pendingApprovals} awaiting</span></HudCard>
        )}
      </div>

      {/* connection status (bottom-left) */}
      <div className="absolute bottom-24 left-4 z-10 hidden md:block">
        <HudCard title="SOURCES">
          <div className="space-y-0.5">
            {overview?.sources.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 text-[11px]">
                <span className={cn("h-1.5 w-1.5 rounded-full", s.connected ? "bg-success" : "bg-muted-foreground/40")} />
                <span className="text-foreground/80">{s.label}</span>
              </div>
            ))}
          </div>
        </HudCard>
      </div>

      {/* no-source banner (real-data-only honesty) */}
      {noSource && (
        <div className="absolute inset-x-0 top-16 z-20 flex justify-center px-4">
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-center text-xs text-warning backdrop-blur-md">
            NO REAL DATA AVAILABLE — CONNECT A DATA SOURCE (set GOOGLE_PLACES_API_KEY) to let DARWIN find real businesses.
          </div>
        </div>
      )}

      {/* subtitle / last reply */}
      {(subtitle || agent.streaming) && (
        <div className="absolute inset-x-0 bottom-24 z-20 flex justify-center px-6">
          <p className="max-w-2xl text-center text-sm leading-relaxed text-foreground/85 [text-shadow:0_0_16px_hsl(var(--accent)/0.35)]">
            {subtitle || <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> working…</span>}
          </p>
        </div>
      )}

      {/* command bar */}
      <form onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        className="absolute inset-x-0 bottom-6 z-30 mx-auto flex w-full max-w-xl items-center gap-2 rounded-2xl border border-accent/20 bg-white/[0.03] px-3 py-2 backdrop-blur-xl"
        style={{ boxShadow: "0 8px 40px -14px hsl(var(--accent)/0.5)", left: "50%", transform: "translateX(-50%)", position: "fixed" }}>
        <button type="button" onClick={() => (voiceStarted ? voice.toggleMute() : enableVoice())}
          className={cn("flex h-9 w-9 items-center justify-center rounded-full border transition", voiceStarted && !voice.muted ? "border-accent bg-accent/15 text-accent animate-hud-pulse" : "border-border text-muted-foreground hover:border-accent/50")}>
          {voiceStarted && voice.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={state === "LISTENING" ? "Listening…" : "Darwin, find 20 cafes in Bengaluru with a website…"}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground/90 outline-none placeholder:text-muted-foreground" />
        {voiceStarted && <button type="button" onClick={() => { voice.stop(); setVoiceStarted(false); }} title="Sleep" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-accent"><Power className="h-4 w-4" /></button>}
        <button type="submit" disabled={!input.trim() || agent.streaming} className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent transition hover:bg-accent/25 disabled:opacity-40"><Send className="h-4 w-4" /></button>
      </form>

      {showExplorer && <LeadExplorer onClose={() => setShowExplorer(false)} />}
    </div>
  );
}

/* ---------------- central hologram ---------------- */
function DarwinCore({ state, level }: { state: DarwinState; level: number }) {
  const A = "hsl(var(--accent))"; const AB = "hsl(var(--accent-bright))";
  const active = state === "LISTENING" || state === "THINKING" || state === "SEARCHING" || state === "PROCESSING";
  const searching = state === "SEARCHING";
  const waiting = state === "WAITING_FOR_APPROVAL";
  const done = state === "COMPLETED";
  const error = state === "ERROR";
  const particles = useMemo(() => Array.from({ length: 20 }, (_, i) => ({ a: (360 / 20) * i, r: 92 + (i % 5) * 24, d: 12 + (i % 6) * 3 })), []);
  return (
    <div className={cn("relative h-[58vmin] w-[58vmin] max-h-[520px] max-w-[520px]", error && "animate-[ev-glitch_0.5s_steps(2)_infinite]")}
      style={{ animation: !error ? "ev-breathe 6s ease-in-out infinite" : undefined }}>
      <div className="absolute inset-0 rounded-full" style={{ background: `radial-gradient(circle, hsl(var(--accent-bright)/${done ? 0.22 : 0.14}), transparent 60%)`, filter: "blur(30px)" }} />
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
        <defs><radialGradient id="dw-core" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor={AB} stopOpacity="0.95" /><stop offset="60%" stopColor={A} stopOpacity="0.14" /><stop offset="100%" stopColor={A} stopOpacity="0" /></radialGradient></defs>
        {[196, 168, 140, 112].map((r, i) => (
          <circle key={r} cx="200" cy="200" r={r} fill="none" stroke={A} strokeOpacity={0.14 + (i === 0 ? 0.14 : 0.05)} strokeWidth={i === 0 ? 1.4 : 1}
            style={{ transformOrigin: "200px 200px", animation: `edith-spin ${(state === "THINKING" ? 14 : 30) + i * 8}s linear infinite ${i % 2 ? "reverse" : ""}` }} />
        ))}
        {/* radar sweep while searching */}
        {searching && <path d="M200 200 L200 20 A180 180 0 0 1 356 116 Z" fill={A} fillOpacity="0.08" style={{ transformOrigin: "200px 200px", animation: "edith-spin 2.2s linear infinite" }} />}
        <circle cx="200" cy="200" r="182" fill="none" stroke={AB} strokeOpacity={active ? 0.6 : 0.28} strokeWidth="1.2" strokeDasharray="6 12" style={{ transformOrigin: "200px 200px", animation: `edith-spin ${searching ? 6 : 18}s linear infinite` }} />
        <g stroke={A} strokeOpacity={active ? 0.3 : 0.16} strokeWidth="0.6" fill="none"><path d="M120 150 L200 120 L286 156 L262 244 L176 276 L118 232 Z" /><path d="M200 120 L176 276 M120 150 L262 244 M286 156 L118 232" /></g>
        <circle cx="200" cy="200" r="72" fill="url(#dw-core)" style={{ animation: "ev-core-pulse 3.4s ease-in-out infinite" }} />
        <circle cx="200" cy="200" r={20 + level * 44 * (state === "LISTENING" ? 1 : 0.3)} fill={AB} style={{ filter: `drop-shadow(0 0 14px ${AB})`, transition: "r 90ms linear" }} className={waiting ? "animate-hud-pulse" : ""} />
        {done && <circle cx="200" cy="200" r="90" fill="none" stroke="hsl(var(--success))" strokeOpacity="0.7" strokeWidth="2" style={{ transformOrigin: "200px 200px", animation: "hud-glow-pulse 1s ease-out" }} />}
      </svg>
      <div className="absolute inset-0" aria-hidden><div className="absolute left-1/2 top-1/2 h-0 w-0">
        {particles.map((p, i) => (
          <span key={i} className="absolute block rounded-full" style={{ width: 3, height: 3, background: i % 3 === 0 ? AB : A, boxShadow: `0 0 6px ${i % 3 === 0 ? AB : A}`,
            // @ts-expect-error css var
            "--a": `${p.a}deg`, "--r": `${state === "LISTENING" ? p.r * 0.72 : p.r}px`, animation: `ev-orbit ${p.d * (searching ? 0.5 : 1)}s linear infinite`, opacity: active ? 0.95 : 0.5, transition: "opacity 300ms" }} />
        ))}
      </div></div>
    </div>
  );
}

/* ---------------- HUD bits ---------------- */
function HudCard({ title, children, align = "left" }: { title: string; children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <div className={cn("min-w-[160px] max-w-[220px] rounded-xl border border-accent/15 bg-white/[0.03] px-3 py-2 backdrop-blur-xl", align === "right" && "text-right")}
      style={{ boxShadow: "0 8px 40px -18px hsl(var(--accent)/0.5)" }}>
      <div className="hud-label text-[9px] tracking-[0.28em] text-accent/70">{title}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const STATE_COLOR: Record<DarwinState, string> = {
  IDLE: "hsl(var(--muted-foreground))", LISTENING: "hsl(var(--accent))", THINKING: "hsl(var(--accent-bright))",
  SEARCHING: "hsl(var(--accent))", PROCESSING: "hsl(var(--accent-bright))", WAITING_FOR_APPROVAL: "hsl(var(--warning))",
  COMPLETED: "hsl(var(--success))", ERROR: "hsl(var(--warning))",
};
function StateLine({ state }: { state: DarwinState }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2 w-2 rounded-full", state !== "IDLE" && "animate-hud-pulse")} style={{ background: STATE_COLOR[state], boxShadow: `0 0 8px ${STATE_COLOR[state]}` }} />
      <span className="text-sm text-foreground/90">{state.replace(/_/g, " ")}</span>
    </div>
  );
}

function DarwinDust() {
  const dots = useMemo(() => Array.from({ length: 22 }, () => ({ x: Math.random() * 100, y: Math.random() * 100, d: 6 + Math.random() * 10, delay: Math.random() * 6, s: 1 + Math.random() * 2 })), []);
  return <div className="absolute inset-0">{dots.map((p, i) => <span key={i} className="absolute rounded-full bg-accent/40" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, animation: `drift ${p.d}s ease-in-out ${p.delay}s infinite` }} />)}</div>;
}

/* ---------------- lead explorer ---------------- */
function LeadExplorer({ onClose }: { onClose: () => void }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<string>("");

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q); if (stage) p.set("stage", stage);
    fetch(`/api/darwin/leads?${p.toString()}`).then((r) => (r.ok ? r.json() : null)).then((j) => setLeads(j?.data?.leads ?? [])).catch(() => setLeads([]));
  }, [q, stage]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-2xl flex-col border-l border-accent/20 bg-[#04070f]"
        style={{ animation: "ev-panel-in .35s ease both" }}>
        <div className="flex items-center justify-between border-b border-accent/15 px-5 py-3">
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-accent" /><span className="hud-label text-xs tracking-[0.28em] text-accent/80">LEAD EXPLORER</span></div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-2 border-b border-accent/10 px-5 py-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search real leads…" className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-accent/60" />
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded border border-border bg-[#04070f] px-2 py-1.5 text-xs outline-none">
            <option value="">All stages</option>
            {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="flex-1 overflow-auto px-5 py-3">
          {leads == null ? (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading real leads…</div>
          ) : leads.length === 0 ? (
            <div className="mt-10 text-center text-xs text-muted-foreground">
              NO REAL DATA AVAILABLE — CONNECT A DATA SOURCE.<br />Ask DARWIN to search once Google Places is connected. No placeholder leads are shown.
            </div>
          ) : (
            <div className="space-y-2">
              {leads.map((l) => <LeadCard key={l.id} lead={l} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const verified = new Set(lead.verifiedFields ?? []);
  const Field = ({ k, label, value, href }: { k: string; label: string; value?: string; href?: string }) =>
    value ? (
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground">{label}:</span>
        {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">{value}<ExternalLink className="h-3 w-3" /></a> : <span className="text-foreground/85">{value}</span>}
        {verified.has(k) ? <span className="rounded bg-success/15 px-1 text-[8px] text-success">VERIFIED</span> : null}
      </div>
    ) : null;
  return (
    <div className="rounded-xl border border-accent/12 bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-foreground/90">{lead.businessName}</div>
          <div className="text-[10px] text-muted-foreground">{lead.category}{lead.location ? ` · ${lead.location}` : ""}</div>
        </div>
        <span className="shrink-0 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[9px] text-accent">{STAGE_LABEL[lead.stage] ?? lead.stage}</span>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        <Field k="website" label="Website" value={lead.website} href={lead.website} />
        <Field k="phone" label="Phone" value={lead.phone} />
        <Field k="email" label="Email" value={lead.email} />
        <Field k="location" label="Location" value={lead.location} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent/80">SOURCE: {lead.source}</span>
        {lead.sourceUrl && <a href={lead.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">origin</a>}
        {lead.opportunityType && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">OPPORTUNITY (AI): {lead.opportunityType.replace(/_/g, " ")}</span>}
        {typeof lead.leadScore === "number" && <span className="rounded bg-accent-bright/10 px-1.5 py-0.5 text-accent-bright">SCORE (AI): {lead.leadScore}</span>}
      </div>
      {lead.aiAnalysis && <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground"><span className="text-warning">AI ANALYSIS:</span> {lead.aiAnalysis}</p>}
    </div>
  );
}
