"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Loader2, Search, ChevronLeft, ChevronRight, Radar } from "lucide-react";
import { useVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import { cn, timeAgo } from "@/lib/utils";

type DarwinState = "IDLE" | "LISTENING" | "THINKING" | "SEARCHING" | "PROCESSING" | "WAITING_FOR_APPROVAL" | "COMPLETED" | "ERROR";

const PROGRESS: Record<DarwinState, string> = {
  IDLE: "18%", LISTENING: "40%", THINKING: "55%", SEARCHING: "72%",
  PROCESSING: "72%", WAITING_FOR_APPROVAL: "60%", COMPLETED: "100%", ERROR: "30%",
};

interface Overview {
  hasData: boolean; hasConnectedDiscovery: boolean; emailReady: boolean;
  totals: { leads: number; dueFollowUps: number; pendingApprovals: number };
  intelligence: { businessesFound: number; verifiedLeads: number; noWebsite: number; weakWebsite: number; highPotential: number; contactable: number };
  byStage: Record<string, number>; bySource: Record<string, number>;
  sources: { id: string; label: string; connected: boolean; kind: string }[];
  recentActivity: { id: string; type: string; detail: string; createdAt: string }[];
}

export function DarwinConsole() {
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState("");
  const sendRef = useRef<(t: string) => void>(() => {});

  const voice = useVoice({ onTranscript: (t) => sendRef.current(t), autoListen: true });
  const agent = useAgent({ onAssistantComplete: (text) => { if (voiceStarted && !voice.muted && voice.enabled) voice.speak(text); loadOverview(); } });

  const loadOverview = useCallback(() => {
    fetch("/api/darwin/overview").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setOverview(j.data)).catch(() => {});
  }, []);
  useEffect(() => { loadOverview(); const t = setInterval(loadOverview, 20000); return () => clearInterval(t); }, [loadOverview]);
  useEffect(() => { sendRef.current = (t: string) => { if (t.trim()) agent.send(t, { agent: "darwin" }); }; }, [agent]);

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

  const runSearch = useCallback(async (form: SearchForm) => {
    setSearching(true); setSearchMsg("");
    try {
      const res = await fetch("/api/darwin/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) { setSearchMsg(j.error || "Search failed."); }
      else { setSearchMsg(`Found ${j.data.found} real business${j.data.found === 1 ? "" : "es"} — added ${j.data.created} new, ${j.data.duplicates} duplicate(s).`); }
      loadOverview();
    } catch { setSearchMsg("Network error."); }
    finally { setSearching(false); }
  }, [loadOverview]);

  const intel = overview?.intelligence;

  return (
    <div className="darwin-bg relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[#04060d] px-3 pb-6 pt-4 md:px-6">
      {/* ambient */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-1/3 h-[60vmin] w-[60vmin] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.12),transparent_62%)] blur-3xl" />
        <Dust />
      </div>

      {/* header */}
      <header className="relative z-10 mx-auto flex max-w-6xl flex-col items-center pt-1">
        <h1 className="bg-gradient-to-r from-accent via-accent-bright to-accent bg-clip-text text-2xl font-light tracking-[0.35em] text-transparent md:text-3xl">DARWIN DASHBOARD</h1>
        <div className="mt-1 flex items-center gap-3">
          <span className="hud-label text-[10px] tracking-[0.3em] text-muted-foreground">STATUS: <span className="text-accent">{state.replace(/_/g, " ")}</span></span>
          <div className="h-px w-40 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-accent" style={{ width: PROGRESS[state], transition: "width .5s ease" }} />
          </div>
          {/* voice mic */}
          <button onClick={() => (voiceStarted ? voice.toggleMute() : enableVoice())} title="Voice"
            className={cn("flex h-7 w-7 items-center justify-center rounded-full border transition", voiceStarted && !voice.muted ? "border-accent bg-accent/15 text-accent animate-hud-pulse" : "border-border text-muted-foreground hover:border-accent/50")}>
            {voiceStarted && voice.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
        </div>
      </header>

      {/* main grid */}
      <div className="relative z-10 mx-auto mt-4 grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-[300px_1fr_300px]">
        <LeadDiscovery onSearch={runSearch} searching={searching} msg={searchMsg} connected={overview?.hasConnectedDiscovery ?? false} />
        <div className="relative flex min-h-[320px] items-center justify-center lg:min-h-[420px]">
          <GlassCylinder state={state} level={voice.level} />
        </div>
        <Intelligence intel={intel} hasData={overview?.hasData ?? false} />
      </div>

      {/* command echo / subtitle */}
      {(agent.streaming || [...agent.messages].reverse().find((m) => m.role === "assistant")) && (
        <div className="relative z-10 mx-auto mt-3 max-w-3xl px-4 text-center text-xs text-foreground/80">
          {agent.streaming ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {agent.activity[0]?.label ?? "working…"}</span>
            : [...agent.messages].reverse().find((m) => m.role === "assistant")?.content}
        </div>
      )}

      {/* live activity stream */}
      <ActivityStream items={overview?.recentActivity ?? []} connected={overview?.hasConnectedDiscovery ?? false} />
    </div>
  );
}

/* ================= LEAD DISCOVERY ================= */
interface SearchForm { category?: string; location: string; radiusKm?: number; limit?: number; hasWebsite?: boolean; noWebsite?: boolean; needsPhone?: boolean; needsEmail?: boolean }

function LeadDiscovery({ onSearch, searching, msg, connected }: { onSearch: (f: SearchForm) => void; searching: boolean; msg: string; connected: boolean }) {
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [radius, setRadius] = useState(5);
  const [limit, setLimit] = useState(50);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [noWebsite, setNoWebsite] = useState(false);
  const [quality, setQuality] = useState("Any");
  const [needsPhone, setNeedsPhone] = useState(false);
  const [needsEmail, setNeedsEmail] = useState(false);

  const submit = () => {
    if (!location.trim() || searching) return;
    onSearch({ category: category.trim() || undefined, location: location.trim(), radiusKm: radius, limit, hasWebsite: hasWebsite || quality === "High", noWebsite, needsPhone, needsEmail });
  };

  return (
    <GlassPanel title="LEAD DISCOVERY">
      <div className="space-y-2.5">
        <Row label="Business category">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Cafe | Tech | Retail" className="dw-input" />
        </Row>
        <div className="flex gap-1">
          {["Cafe", "Tech", "Retail", "Salon", "Gym"].map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={cn("rounded-full border px-2 py-0.5 text-[9px] transition", category === c ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:border-accent/50")}>{c}</button>
          ))}
        </div>
        <Row label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="London, UK" className="dw-input" /></Row>
        <Row label="Radius"><div className="flex items-center gap-1"><input type="number" min={1} max={50} value={radius} onChange={(e) => setRadius(+e.target.value)} className="dw-input w-16 text-right" /><span className="text-[10px] text-muted-foreground">km</span></div></Row>
        <Row label="Number of leads"><input type="number" min={1} max={60} value={limit} onChange={(e) => setLimit(+e.target.value)} className="dw-input w-20 text-right" /></Row>

        <div className="flex gap-2">
          <Toggle active={hasWebsite} onClick={() => { setHasWebsite((v) => !v); setNoWebsite(false); }} label="Has website" />
          <Toggle active={noWebsite} onClick={() => { setNoWebsite((v) => !v); setHasWebsite(false); }} label="No website" />
        </div>
        <Row label="Website quality">
          <select value={quality} onChange={(e) => setQuality(e.target.value)} className="dw-input"><option>Any</option><option>High</option><option>Weak</option></select>
        </Row>
        <div className="flex flex-wrap gap-2">
          <Toggle active={needsPhone} onClick={() => setNeedsPhone((v) => !v)} label="Phone available" />
          <Toggle active={needsEmail} onClick={() => setNeedsEmail((v) => !v)} label="Email available" />
        </div>

        <button onClick={submit} disabled={searching || !location.trim()} className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/12 px-3 py-2 text-sm text-accent-bright transition hover:bg-accent/20 disabled:opacity-40">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {searching ? "Discovering…" : "Discover Leads"}
        </button>
        {!connected && <p className="text-[10px] leading-snug text-warning">Google Places not connected — set GOOGLE_PLACES_API_KEY. DARWIN won't invent leads.</p>}
        {msg && <p className="text-[10px] leading-snug text-muted-foreground">{msg}</p>}
      </div>
    </GlassPanel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2"><span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>{children}</div>;
}
function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button onClick={onClick} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition", active ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:border-accent/50")}>{active ? "✓" : ""} {label}</button>;
}

/* ================= INTELLIGENCE ================= */
function Intelligence({ intel, hasData }: { intel?: Overview["intelligence"]; hasData: boolean }) {
  const rows: { label: string; value: number; tone?: string }[] = [
    { label: "Businesses Found", value: intel?.businessesFound ?? 0 },
    { label: "Verified Leads", value: intel?.verifiedLeads ?? 0, tone: "text-success" },
    { label: "No Website", value: intel?.noWebsite ?? 0 },
    { label: "Weak Website", value: intel?.weakWebsite ?? 0, tone: "text-warning" },
    { label: "High Potential", value: intel?.highPotential ?? 0, tone: "text-accent-bright" },
    { label: "Contactable Leads", value: intel?.contactable ?? 0 },
  ];
  return (
    <GlassPanel title="INTELLIGENCE">
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between border-b border-white/5 pb-2 last:border-0">
            <div>
              <div className="text-[10px] text-muted-foreground">{r.label}</div>
              <div className={cn("text-2xl font-light leading-none", r.tone ?? "text-foreground/90")}>{r.value}</div>
            </div>
            <Spark value={r.value} tone={r.tone} />
          </div>
        ))}
        {!hasData && <p className="text-[10px] leading-snug text-muted-foreground">All zero — no real leads yet. Run a discovery.</p>}
      </div>
    </GlassPanel>
  );
}

/** Small decorative trend line (not a data claim — the number is the data). */
function Spark({ value, tone }: { value: number; tone?: string }) {
  const pts = useMemo(() => {
    // Stable pseudo-shape seeded by the value; flat when value is 0.
    let seed = (value * 2654435761) % 100 || 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const n = 10, base = value === 0 ? 0.5 : 0.35;
    return Array.from({ length: n }, (_, i) => {
      const y = value === 0 ? 0.5 : Math.max(0.1, Math.min(0.9, base + rnd() * 0.5 + i * 0.02));
      return `${(i / (n - 1)) * 56},${16 - y * 14}`;
    }).join(" ");
  }, [value]);
  const stroke = tone === "text-warning" ? "hsl(var(--warning))" : tone === "text-success" ? "hsl(var(--success))" : "hsl(var(--accent-bright))";
  return (
    <svg width="60" height="18" viewBox="0 0 56 18" className="shrink-0 opacity-70">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
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
      return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.92, r: 0.8 + (i % 4) * 0.5 };
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
          <p className="py-2 text-center text-[11px] text-muted-foreground">{connected ? "Awaiting activity — run a discovery to see the live stream." : "No source connected — DARWIN shows only real activity, never sample data."}</p>
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

/* ================= shared ================= */
function GlassPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative rounded-2xl border border-accent/15 bg-white/[0.03] px-4 py-3 backdrop-blur-xl" style={{ boxShadow: "0 10px 50px -24px hsl(var(--accent)/0.5), inset 0 1px 0 hsl(0 0% 100% / 0.06)" }}>
      <div className="mb-2 flex items-center gap-1.5">
        <Radar className="h-3 w-3 text-accent/70" />
        <span className="hud-label text-[10px] tracking-[0.28em] text-accent/80">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Dust() {
  const dots = useMemo(() => Array.from({ length: 22 }, () => ({ x: Math.random() * 100, y: Math.random() * 100, d: 6 + Math.random() * 10, delay: Math.random() * 6, s: 1 + Math.random() * 2 })), []);
  return <div className="absolute inset-0">{dots.map((p, i) => <span key={i} className="absolute rounded-full bg-accent/40" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, animation: `drift ${p.d}s ease-in-out ${p.delay}s infinite` }} />)}</div>;
}
