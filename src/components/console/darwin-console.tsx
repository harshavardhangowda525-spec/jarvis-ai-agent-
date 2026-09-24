"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Loader2, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { useVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import { cn, timeAgo } from "@/lib/utils";
import { GENERATE_LEADS_RE, parseLeadCommand } from "@/lib/darwin/command";
import type { FindLeadsResult, LeadDTO } from "@/lib/darwin/types";
import { GlassPanel } from "./darwin/ui";
import {
  LeadSearchPanel, NewLeadsPanel, CrmPanel, FollowUpsPanel, ResultBanner,
  type SearchForm, type SessionStats, type CrmMetrics, type BannerState,
} from "./darwin/panels";
import { LeadTable, type TableRequest } from "./darwin/lead-table";

// Phrases that close DARWIN and return to JARVIS.
const DEACTIVATE_RE = /\b(deactivate|de-activate|shut ?down|power down|close|exit|leave|stand ?down|log ?off)\b.*\bdarwin\b|\bdarwin[,\s]+(deactivate|shut ?down|stand ?down|close|exit|off)\b|^(deactivate|shut ?down|power down|exit|close|stand ?down|back to jarvis|go to jarvis|open jarvis|return to jarvis)[\s!.,]*$/i;

type DarwinState = "IDLE" | "LISTENING" | "THINKING" | "SEARCHING" | "PROCESSING" | "WAITING_FOR_APPROVAL" | "COMPLETED" | "ERROR";

const PROGRESS: Record<DarwinState, string> = {
  IDLE: "18%", LISTENING: "40%", THINKING: "55%", SEARCHING: "72%",
  PROCESSING: "72%", WAITING_FOR_APPROVAL: "60%", COMPLETED: "100%", ERROR: "30%",
};

interface Overview {
  crm: CrmMetrics;
  geoapifyReady: boolean;
  totals: { leads: number; dueFollowUps: number; pendingApprovals: number };
  recentActivity: { id: string; type: string; detail: string; createdAt: string }[];
}

const DEFAULT_FORM: SearchForm = { category: "", location: "", limit: 20, filter: "all", radiusKm: 5 };
const FORM_KEY = "darwin.searchForm";
const SESSION_KEY = "darwin.session";

// Per-viewer conveniences only — the lead history itself lives in the database.
function readStore<T>(store: "local" | "session", key: string, fallback: T): T {
  try {
    const raw = (store === "local" ? window.localStorage : window.sessionStorage).getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch { return fallback; }
}
function writeStore(store: "local" | "session", key: string, v: unknown) {
  try { (store === "local" ? window.localStorage : window.sessionStorage).setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ }
}

export function DarwinConsole() {
  const router = useRouter();
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [followUps, setFollowUps] = useState<LeadDTO[]>([]);
  const [searching, setSearching] = useState(false);
  const [boot, setBoot] = useState<"run" | "fade" | "done">("run");
  const [leaving, setLeaving] = useState(false);

  const [form, setForm] = useState<SearchForm>(DEFAULT_FORM);
  const [lastForm, setLastForm] = useState<SearchForm | null>(null);
  const [session, setSession] = useState<SessionStats>({ newFound: 0, skipped: 0, searches: 0 });
  const [banner, setBanner] = useState<BannerState>(null);
  const [searchLeads, setSearchLeads] = useState<LeadDTO[]>([]);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [tableRequest, setTableRequest] = useState<TableRequest | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const tableRef = useRef<HTMLDivElement>(null);

  const sendRef = useRef<(t: string) => void>(() => {});
  const deactivateRef = useRef<() => void>(() => {});
  const runSearchRef = useRef<(f: SearchForm) => void>(() => {});

  useEffect(() => {
    const t1 = setTimeout(() => setBoot("fade"), 1900);
    const t2 = setTimeout(() => setBoot("done"), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Restore the last form (this browser) and this tab's session counters.
  useEffect(() => {
    const f = readStore<SearchForm>("local", FORM_KEY, DEFAULT_FORM);
    setForm(f);
    if (f.category && f.location) setLastForm(f);
    setSession(readStore<SessionStats>("session", SESSION_KEY, { newFound: 0, skipped: 0, searches: 0 }));
  }, []);

  const loadOverview = useCallback(() => {
    fetch("/api/darwin/overview").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setOverview(j.data)).catch(() => {});
    fetch("/api/darwin/leads?followups=1&limit=6").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setFollowUps(j.data.leads)).catch(() => {});
  }, []);
  useEffect(() => { loadOverview(); const t = setInterval(loadOverview, 30000); return () => clearInterval(t); }, [loadOverview]);

  const voice = useVoice({ onTranscript: (t) => sendRef.current(t), autoListen: true, voiceProfile: "darwin" });
  const speak = useCallback((text: string) => {
    if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak(text); } catch { /* ignore */ } }
  }, [voice, voiceStarted]);

  const agent = useAgent({
    onAssistantComplete: (text) => { speak(text); loadOverview(); },
    // The agent ran a discovery itself → refresh and show the full history.
    onTool: (t) => {
      if (t.name === "darwin_search" && t.status === "ok") {
        loadOverview(); setRefreshKey((k) => k + 1);
        setTableRequest({ tab: "all", nonce: Date.now() });
      }
    },
  });

  // ---- FIND NEW LEADS --------------------------------------------------------
  const runSearch = useCallback(async (f: SearchForm) => {
    if (searching) return;
    const clean = { ...f, category: f.category.trim(), location: f.location.trim() };
    setForm(clean); setLastForm(clean); writeStore("local", FORM_KEY, clean);
    setSearching(true); setBanner(null);
    try {
      const res = await fetch("/api/darwin/find-new-leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: clean.category, location: clean.location, limit: clean.limit, filter: clean.filter, radiusKm: clean.radiusKm }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = j.error === "Invalid request." ? "Enter a category and a location (at least 2 characters each)." : j.error || `Search failed (HTTP ${res.status}).`;
        setBanner({ kind: "error", message });
        speak(message);
        return;
      }
      const r = j.data as FindLeadsResult;
      setBanner({ kind: "ok", result: r });
      setSearchLeads(r.leads);
      setFreshIds(new Set(r.leads.map((l) => l.id)));
      setSession((s) => {
        const n = { newFound: s.newFound + r.newCount, skipped: s.skipped + r.skippedDuplicates, searches: s.searches + 1 };
        writeStore("session", SESSION_KEY, n);
        return n;
      });
      loadOverview(); setRefreshKey((k) => k + 1);
      if (r.newCount) setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
      const withPhone = r.leads.filter((l) => l.phone).length;
      speak(r.newCount
        ? `${r.message.replace(/ · /g, ", ")} ${withPhone} of them ${withPhone === 1 ? "has" : "have"} a phone number.`
        : r.message);
    } catch {
      setBanner({ kind: "error", message: "Network error — couldn't reach the server." });
    } finally { setSearching(false); }
  }, [searching, loadOverview, speak]);
  useEffect(() => { runSearchRef.current = runSearch; }, [runSearch]);

  // ---- deactivate → JARVIS ---------------------------------------------------
  const deactivate = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    const spoke = voiceStarted && !voice.muted && voice.enabled;
    // Speak the goodbye (don't stop() first — that would cut it off). Navigating
    // unmounts the console, whose cleanup releases the mic so JARVIS can take it.
    if (spoke) { try { voice.speak("Deactivating. Handing you back to JARVIS."); } catch { /* ignore */ } }
    setTimeout(() => router.push("/dashboard"), spoke ? 1100 : 300);
  }, [leaving, router, voice, voiceStarted]);
  useEffect(() => { deactivateRef.current = deactivate; }, [deactivate]);

  // ---- voice / typed commands -------------------------------------------------
  useEffect(() => {
    sendRef.current = (t: string) => {
      const s = t.trim();
      if (!s) return;
      if (DEACTIVATE_RE.test(s)) { deactivateRef.current(); return; }

      // "find 20 gyms in Bangalore without a website" / "generate new leads"
      // → run the real discovery directly (deterministic, no agent round-trip).
      if (GENERATE_LEADS_RE.test(s)) {
        const p = parseLeadCommand(s);
        const base = lastForm ?? form;
        const next: SearchForm = {
          category: p.category ?? base.category,
          location: p.location ?? base.location,
          limit: p.limit ?? base.limit ?? 20,
          filter: p.filter ?? (p.category || p.location ? "all" : base.filter),
          radiusKm: base.radiusKm || 5,
        };
        if (!next.category || !next.location) {
          setForm(next);
          const ask = !next.category && !next.location ? "Sure — what kind of businesses, and where? For example: find 20 gyms in Bangalore."
            : !next.location ? `Got it, ${next.category}. Which city or area should I search?` : "What kind of businesses should I look for?";
          setBanner({ kind: "error", message: ask });
          speak(ask);
          return;
        }
        speak(`On it — scanning for new ${next.category} in ${next.location}.`);
        runSearchRef.current(next);
        return;
      }
      agent.send(s, { agent: "darwin" });
    };
  }, [agent, form, lastForm, speak]);

  async function enableVoice() { const ok = await voice.init(); if (ok) setVoiceStarted(true); return ok; }

  const state: DarwinState = (() => {
    if (voice.status === "denied" || voice.status === "error") return "ERROR";
    if (searching) return "SEARCHING";
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

  const onLeadUpdated = useCallback((l: LeadDTO) => {
    setSearchLeads((prev) => prev.map((x) => (x.id === l.id ? l : x)));
    loadOverview();
  }, [loadOverview]);

  const showSlice = useCallback((p: { stage?: string; filter?: TableRequest["filter"]; q?: string }) => {
    setTableRequest({ tab: "all", ...p, nonce: Date.now() });
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, []);

  const lastAssistant = useMemo(() => [...agent.messages].reverse().find((m) => m.role === "assistant"), [agent.messages]);

  return (
    <div className="darwin-bg relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[#04060d] px-3 pb-6 pt-4 md:px-6">
      {boot !== "done" && <DarwinBoot fading={boot === "fade"} />}

      {leaving && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-[#04060d]/95 backdrop-blur-sm" style={{ animation: "dw-reveal .4s ease both" }}>
          <span className="hud-label text-[11px] tracking-[0.4em] text-accent/80">DEACTIVATING DARWIN</span>
          <span className="mt-2 text-xs text-muted-foreground">Returning to JARVIS…</span>
        </div>
      )}

      <div style={boot === "done" ? { animation: "dw-reveal .7s ease both" } : { opacity: 0 }}>
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-1/3 h-[60vmin] w-[60vmin] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.12),transparent_62%)] blur-3xl" />
        <Dust />
      </div>

      {/* header */}
      <header className="relative z-10 mx-auto flex max-w-6xl flex-col items-center pt-1">
        <h1 className="bg-gradient-to-r from-accent via-accent-bright to-accent bg-clip-text text-2xl font-light tracking-[0.35em] text-transparent md:text-3xl">DARWIN DASHBOARD</h1>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
          <span className="hud-label text-[10px] tracking-[0.3em] text-muted-foreground">STATUS: <span className="text-accent">{state.replace(/_/g, " ")}</span></span>
          <div className="h-px w-40 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-accent" style={{ width: PROGRESS[state], transition: "width .5s ease" }} />
          </div>
          <button onClick={() => (voiceStarted ? voice.toggleMute() : enableVoice())} title="Voice"
            className={cn("flex h-7 w-7 items-center justify-center rounded-full border transition", voiceStarted && !voice.muted ? "border-accent bg-accent/15 text-accent animate-hud-pulse" : "border-border text-muted-foreground hover:border-accent/50")}>
            {voiceStarted && voice.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
          <button onClick={deactivate} disabled={leaving} title="Deactivate DARWIN — back to JARVIS"
            className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground transition hover:border-destructive/60 hover:text-destructive disabled:opacity-50">
            <LogOut className="h-3 w-3" /> Deactivate
          </button>
        </div>
      </header>

      {/* main grid: search · AI core · metrics */}
      <div className="relative z-10 mx-auto mt-4 grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-[300px_1fr_310px]">
        <LeadSearchPanel form={form} setForm={setForm} onSearch={() => runSearch(form)} searching={searching} geoapifyReady={overview ? overview.geoapifyReady : null} />
        <div className="relative flex min-h-[320px] items-center justify-center lg:min-h-[420px]">
          <GlassCylinder state={state} level={voice.level} />
        </div>
        <div className="space-y-3">
          <NewLeadsPanel session={session} last={lastForm} onMore={() => lastForm && runSearch(lastForm)} searching={searching} />
          <CrmPanel crm={overview?.crm ?? null} onPick={showSlice} />
          <FollowUpsPanel items={followUps} dueCount={overview?.crm.followUpsDue ?? 0} onOpen={(l) => showSlice({ q: l.businessName })} />
        </div>
      </div>

      {/* agent reply / subtitle */}
      {(agent.streaming || lastAssistant) && (
        <div className="relative z-10 mx-auto mt-3 max-w-3xl px-4 text-center text-xs text-foreground/80">
          {agent.streaming ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {agent.activity[0]?.label ?? "working…"}</span>
            : lastAssistant?.content}
        </div>
      )}

      {/* live voice caption */}
      {voiceStarted && !voice.muted && (voice.status === "listening" || voice.status === "recording" || voice.status === "processing" || voice.transcript) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-6">
          <div className="flex max-w-xl items-center gap-2 rounded-full border border-accent/25 bg-black/50 px-4 py-1.5 backdrop-blur-md">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", voice.status === "recording" ? "bg-accent animate-hud-pulse" : voice.status === "processing" ? "bg-warning animate-hud-pulse" : "bg-accent/60 animate-hud-pulse")} />
            <span className="truncate text-sm text-foreground/90">
              {voice.transcript
                ? <>“{voice.transcript}”</>
                : voice.error && voice.status !== "recording" ? <span className="text-warning">{voice.error}</span>
                : voice.status === "processing" ? "Thinking…"
                : voice.status === "recording" ? "Listening…"
                : "Listening… say “find 20 gyms in Bangalore without a website”"}
            </span>
          </div>
        </div>
      )}

      {/* result + leads */}
      <div ref={tableRef} className="relative z-10 mx-auto mt-4 max-w-6xl scroll-mt-4 space-y-3">
        <ResultBanner state={banner} onClose={() => setBanner(null)} />
        <LeadTable searchLeads={searchLeads} freshIds={freshIds} request={tableRequest} onLeadUpdated={onLeadUpdated} refreshKey={refreshKey} />
      </div>

      <ActivityStream items={overview?.recentActivity ?? []} connected={overview?.geoapifyReady ?? false} />
      </div>
    </div>
  );
}

/* ================= BOOT SEQUENCE ================= */
function DarwinBoot({ fading }: { fading: boolean }) {
  const lines = ["INITIALIZING NEURAL CORE", "LINKING DATA SOURCES", "CALIBRATING LEAD INTELLIGENCE", "DARWIN ONLINE"];
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#04060d]"
      style={{ animation: fading ? "dw-boot-out .7s ease forwards" : undefined }}
    >
      {/* scanline sweep */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 h-24 bg-[linear-gradient(to_bottom,transparent,hsl(var(--accent)/0.18),transparent)]" style={{ animation: "dw-scan 1.9s ease-in-out" }} />
        <div className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.14),transparent_60%)] blur-2xl" />
      </div>

      {/* assembling rings + hex */}
      <div className="relative mb-6 h-40 w-40">
        <span className="absolute inset-0 rounded-full border border-accent/30" style={{ animation: "dw-ring-in .8s ease both" }} />
        <span className="absolute inset-3 rounded-full border border-dashed border-accent/40" style={{ animation: "edith-spin 4s linear infinite, dw-ring-in .9s ease both" }} />
        <span className="absolute inset-8 rounded-full border border-accent-bright/50" style={{ animation: "dw-ring-in 1s ease both" }} />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center text-lg font-semibold text-white"
            style={{ clipPath: "polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)", background: "linear-gradient(160deg, hsl(var(--accent)/0.5), hsl(280 70% 55% / 0.5))", boxShadow: "0 0 30px hsl(var(--accent-bright))", animation: "dw-hex-pop .6s .3s ease both" }}>
            AI
          </span>
        </span>
      </div>

      <h1 className="bg-gradient-to-r from-accent via-accent-bright to-accent bg-clip-text text-3xl font-light tracking-[0.5em] text-transparent" style={{ animation: "dw-hex-pop .7s .2s ease both" }}>
        DARWIN
      </h1>
      <div className="relative mt-4 h-4 w-72 text-center">
        {lines.map((l, i) => (
          <div key={l} className="hud-label absolute inset-x-0 text-[10px] tracking-[0.3em] text-accent/80" style={{ opacity: 0, animation: `dw-line 1.9s ${i * 0.45}s ease both` }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= GLASS CYLINDER + NEURAL CORE ================= */
function GlassCylinder({ state, level }: { state: DarwinState; level: number }) {
  const searching = state === "SEARCHING" || state === "PROCESSING";
  return (
    <div className="relative flex flex-col items-center" style={{ animation: "ev-breathe 6s ease-in-out infinite" }}>
      {/* capsule */}
      <div className="relative h-[340px] w-[260px] overflow-hidden rounded-[42px] border border-white/15 md:h-[380px] md:w-[300px]"
        style={{ background: "linear-gradient(160deg, hsl(0 0% 100% / 0.10), hsl(210 60% 12% / 0.30))", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", boxShadow: "0 30px 90px -30px hsl(var(--accent)/0.6), inset 0 1px 0 hsl(0 0% 100% / 0.25), inset 0 0 60px -30px hsl(var(--accent)/0.6)" }}>
        {/* glass sheen */}
        <div className="pointer-events-none absolute -left-1/3 top-0 h-full w-1/3 -skew-x-12 bg-white/10 blur-md" />
        <NeuralSphere active={searching} level={level} />
      </div>
      {/* base */}
      <div className="mt-1 h-3 w-[180px] rounded-[50%] bg-[radial-gradient(ellipse,hsl(var(--accent)/0.45),transparent_70%)] blur-[2px] md:w-[210px]" />
      <div className="-mt-1 h-2 w-[150px] rounded-[50%] bg-black/50 blur-md" />
    </div>
  );
}

function NeuralSphere({ active, level }: { active: boolean; level: number }) {
  const { nodes, edges } = useMemo(() => {
    const N = 40, R = 96, cx = 130, cy = 150;
    const nodes = Array.from({ length: N }, (_, i) => {
      const a = (i * 137.5) * (Math.PI / 180);
      const rr = R * Math.sqrt((i + 0.5) / N);
      // Rounded so server and client serialize identical SVG attributes.
      return { x: Math.round((cx + Math.cos(a) * rr) * 100) / 100, y: Math.round((cy + Math.sin(a) * rr * 0.92) * 100) / 100, r: 0.8 + (i % 4) * 0.5 };
    });
    const edges: [number, number][] = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
      if (Math.hypot(dx, dy) < 34) edges.push([i, j]);
    }
    return { nodes, edges };
  }, []);
  const A = "hsl(var(--accent))"; const AB = "hsl(var(--accent-bright))"; const P = "hsl(280 80% 70%)";
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <svg viewBox="0 0 260 300" className="h-full w-full">
        {/* soft sphere glow */}
        <circle cx="130" cy="150" r="104" fill="url(#dw-glow)" />
        <defs>
          <radialGradient id="dw-glow" cx="50%" cy="45%" r="55%"><stop offset="0%" stopColor={AB} stopOpacity="0.22" /><stop offset="55%" stopColor={P} stopOpacity="0.10" /><stop offset="100%" stopColor={A} stopOpacity="0" /></radialGradient>
        </defs>
        <g style={{ transformOrigin: "130px 150px", animation: `edith-spin ${active ? 26 : 60}s linear infinite` }}>
          <g stroke={A} strokeOpacity={active ? 0.28 : 0.16} strokeWidth="0.5">
            {edges.map(([a, b], i) => <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} />)}
          </g>
          {nodes.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={n.r} fill={i % 5 === 0 ? P : i % 2 ? AB : A}
              style={{ filter: `drop-shadow(0 0 3px ${i % 2 ? AB : A})` }} className={active && i % 3 === 0 ? "animate-hud-pulse" : ""} />
          ))}
        </g>
        {/* scanning ring */}
        <ellipse cx="130" cy="150" rx="100" ry="94" fill="none" stroke={AB} strokeOpacity={active ? 0.5 : 0.25} strokeWidth="1" strokeDasharray="4 10" style={{ transformOrigin: "130px 150px", animation: `edith-spin ${active ? 7 : 20}s linear infinite` }} />
      </svg>
      {/* DARWIN AI hex badge */}
      <div className="absolute flex flex-col items-center">
        <div className="relative flex h-16 w-16 items-center justify-center" style={{ clipPath: "polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)", background: "linear-gradient(160deg, hsl(var(--accent)/0.35), hsl(280 70% 55% / 0.35))", boxShadow: `0 0 24px ${AB}` }}>
          <div className="text-center">
            <div className="text-[8px] tracking-[0.3em] text-foreground/80">DARWIN</div>
            <div className="text-lg font-semibold leading-none text-white">AI</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= LIVE ACTIVITY STREAM ================= */
function ActivityStream({ items, connected }: { items: Overview["recentActivity"]; connected: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  return (
    <div className="relative z-10 mx-auto mt-4 max-w-6xl">
      <GlassPanel title="LIVE ACTIVITY STREAM">
        {items.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground">{connected ? "Awaiting activity — run a discovery to see the live stream." : "Geoapify isn’t configured yet — DARWIN shows only real activity, never sample data."}</p>
        ) : (
          <div className="flex items-center gap-1">
            <button onClick={() => scroll(-1)} className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-accent md:flex"><ChevronLeft className="h-4 w-4" /></button>
            <div ref={ref} className="grid flex-1 auto-cols-[minmax(240px,1fr)] grid-flow-col gap-x-8 gap-y-1 overflow-x-auto pb-1 md:grid-flow-row md:grid-cols-3 md:overflow-visible" style={{ scrollbarWidth: "none" }}>
              {items.slice(0, 9).map((a) => (
                <div key={a.id} className="flex items-start gap-2 py-0.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: streamColor(a.type), boxShadow: `0 0 6px ${streamColor(a.type)}` }} />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-foreground/85">{a.detail}</div>
                    <div className="text-[8px] text-muted-foreground">{timeAgo(a.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => scroll(1)} className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-accent md:flex"><ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
function streamColor(type: string): string {
  if (/sent|won|verified|discovered/.test(type)) return "hsl(var(--success))";
  if (/failed|lost/.test(type)) return "hsl(var(--warning))";
  return "hsl(var(--accent-bright))";
}

function Dust() {
  // Seeded (not Math.random) so server and client render the same particles.
  const dots = useMemo(() => {
    let seed = 42;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    return Array.from({ length: 22 }, () => ({ x: +(rnd() * 100).toFixed(2), y: +(rnd() * 100).toFixed(2), d: +(6 + rnd() * 10).toFixed(2), delay: +(rnd() * 6).toFixed(2), s: +(1 + rnd() * 2).toFixed(2) }));
  }, []);
  return <div className="absolute inset-0">{dots.map((p, i) => <span key={i} className="absolute rounded-full bg-accent/40" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, animation: `drift ${p.d}s ease-in-out ${p.delay}s infinite` }} />)}</div>;
}
