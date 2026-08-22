"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Mic, MicOff, Send, Paperclip, Volume2, VolumeX, Loader2,
  Terminal, ScanLine, BarChart3, Search, FileText, Lock,
  ArrowRight, Check, AlertTriangle, Calendar, ExternalLink,
  Wifi, ShieldCheck, ShieldAlert, ChevronRight, Radio, Plus,
} from "lucide-react";
import { Orb, type OrbState, orbStateLabel } from "@/components/orb";
import { HudPanel } from "@/components/hud/panel";
import {
  HumanFigure, CoreCube, NetGlobe, Waveform,
} from "@/components/hud/visuals";
import { useVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import { useDeviceMetrics, type Metric } from "@/hooks/useDeviceMetrics";
import { cn } from "@/lib/utils";

interface Services { [k: string]: boolean }
interface TaskLite { id: string; title: string; priority: string; dueAt?: string | null }
interface Stats {
  tasks: { all: number; completed: number; pending: number; high: number };
  totals: { notes: number; memories: number; conversations: number };
  recentActivity: { tool: string; status: string; at: string }[];
  upcoming: { id: string; title: string; dueAt: string; priority: string }[];
  activeTasks: TaskLite[];
}

const QUOTES = [
  "The future is not something we enter. The future is something we create.",
  "Sometimes you gotta run before you can walk.",
  "Intelligence is the ability to adapt to change.",
  "The best way to predict the future is to invent it.",
  "Progress is impossible without change.",
];

export function JarvisConsole({ assistantName, userName }: { assistantName: string; userName: string }) {
  const router = useRouter();
  const [voiceConfigured, setVoiceConfigured] = useState<boolean | null>(null);
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [services, setServices] = useState<Services | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<(t: string) => void>(() => {});
  const metrics = useDeviceMetrics();

  const onNavigate = useCallback((path: string) => {
    if (path.startsWith("/dashboard") && path !== "/dashboard") router.push(path);
  }, [router]);

  const voice = useVoice({ onTranscript: (t) => sendRef.current(t), autoListen: true });
  const agent = useAgent({
    onAssistantComplete: (text) => { if (voiceStarted && !voice.muted && voice.enabled) voice.speak(text); },
    onNavigate,
    onOpen: (url) => {
      let win: Window | null = null;
      try { win = window.open(url, "_blank", "noopener,noreferrer"); } catch { win = null; }
      if (!win || win.closed || typeof win.closed === "undefined") window.location.href = url;
    },
  });
  useEffect(() => { sendRef.current = agent.send; }, [agent.send]);

  const loadPanels = useCallback(() => {
    fetch("/api/status").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setServices(j.data.services)).catch(() => {});
    fetch("/api/stats").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setStats(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/voice/config").then((r) => (r.ok ? r.json() : null))
      .then((j) => setVoiceConfigured(j?.data?.configured ?? false))
      .catch(() => setVoiceConfigured(false));
    loadPanels();
  }, [loadPanels]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [agent.messages]);

  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !agent.streaming) loadPanels();
    wasStreaming.current = agent.streaming;
  }, [agent.streaming, loadPanels]);

  const orbState: OrbState = (() => {
    if (voice.status === "denied" || voice.status === "error") return "error";
    if (voice.status === "speaking") return "speaking";
    if (agent.streaming) return agent.activity[0]?.kind === "tool" ? "executing" : "thinking";
    if (voice.status === "recording") return "listening";
    if (voice.status === "processing") return "thinking";
    if (voice.status === "listening") return "listening";
    return "idle";
  })();
  const statusLabel = agent.streaming
    ? orbState === "executing" ? "Executing" : "Thinking"
    : orbStateLabel(orbState);

  async function enableVoice() { if (await voice.init()) setVoiceStarted(true); }
  const focusCommand = useCallback((prefill?: string) => {
    if (prefill != null) setInput(prefill);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const t = input.trim();
    if (!t) return;
    setInput("");
    agent.send(t);
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("prompt", input.trim() || "Analyze this file and summarize it.");
      setInput("");
      const res = await fetch("/api/files/analyze", { method: "POST", body: form });
      const j = await res.json();
      const answer = res.ok ? j.data.answer : j.error || "Could not analyze the file.";
      agent.appendLocalExchange(`📎 ${file.name}`, answer);
      if (voiceStarted && !voice.muted && res.ok) voice.speak(answer);
    } finally { setUploading(false); }
  }

  const commands = useMemo(() => [
    { icon: Terminal, label: "Open Terminal", run: () => focusCommand("") },
    { icon: ScanLine, label: "Scan System", run: () => { loadPanels(); agent.send("Run a status check: summarize which systems and tools are online."); } },
    { icon: BarChart3, label: "Analyze Data", run: () => agent.send("Analyze my data — summarize my tasks, notes and recent activity.") },
    { icon: Mic, label: "Voice Command", run: () => (voiceStarted ? voice.toggleMute() : enableVoice()) },
    { icon: Search, label: "Smart Search", run: () => focusCommand("Search the web for ") },
    { icon: FileText, label: "Create Note", run: () => focusCommand("Create a note: ") },
    { icon: Lock, label: "Lock System", run: async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); } },
  ], [agent, focusCommand, loadPanels, router, voice, voiceStarted]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasMessages = agent.messages.length > 0;
  const servicesOnlinePct = services
    ? Math.round((Object.values(services).filter(Boolean).length / Object.values(services).length) * 100)
    : null;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";
  const quote = QUOTES[new Date().getDate() % QUOTES.length];

  return (
    <div className="space-y-3 p-3">
      {/* ===== TOP REGION ===== */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.5fr)_minmax(0,0.95fr)]">
        {/* LEFT column */}
        <div className="flex flex-col gap-3">
          <GreetingPanel greeting={greeting} name={userName} quote={quote} />
          <TodaysOverview tasks={stats?.tasks ?? null} />
          <ActiveTasks tasks={stats?.activeTasks ?? null} />
        </div>

        {/* CENTER column */}
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <SystemOverviewPanel pct={servicesOnlinePct} metrics={metrics} services={services} />
            <AICorePanel online={!!services?.ai} />
          </div>

          {/* Reactor core + transcript */}
          <HudPanel label="JARVIS Core" className="flex min-h-[46vh] flex-1 flex-col" bodyClassName="flex flex-1 flex-col p-0">
            <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
              {!hasMessages ? (
                <div className="flex min-h-[40vh] flex-col items-center justify-center py-8">
                  <Orb state={orbState} level={voice.level} size={320} beam />
                  <div className="mt-8 hud-label text-[11px] text-accent-bright text-glow">{statusLabel}</div>
                  {voice.error && <div className="mt-1 text-xs text-destructive">{voice.error}</div>}
                  {!voiceStarted && (
                    <div className="mt-4">
                      {voiceConfigured === null ? (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Initializing voice…
                        </p>
                      ) : voiceConfigured ? (
                        <button onClick={enableVoice}
                          className="flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm text-accent-bright transition hover:bg-accent/20 box-glow-soft">
                          <Mic className="h-4 w-4" /> Enable JARVIS Voice
                        </button>
                      ) : (
                        <p className="max-w-xs text-center text-[11px] text-muted-foreground">
                          Voice is not configured — you can still chat by text.
                        </p>
                      )}
                      {voice.status === "denied" && (
                        <button onClick={enableVoice} className="mt-2 block w-full text-center text-[11px] text-accent hover:underline">
                          Microphone blocked — grant permission and retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3 p-4">
                  <div className="mb-2 flex items-center gap-3 border-b border-accent/10 pb-3">
                    <Orb state={orbState} level={voice.level} size={54} />
                    <div>
                      <div className="hud-label text-[10px] text-accent-bright">{statusLabel}</div>
                      <div className="text-xs text-muted-foreground">{assistantName} online</div>
                    </div>
                  </div>
                  {agent.messages.map((m) => (
                    <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[85%] rounded px-3.5 py-2 text-sm animate-fade-in",
                        m.role === "user" ? "border border-accent/25 bg-accent/10" : "border border-accent/12 bg-panel/60",
                      )}>
                        {m.content ? (
                          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        ) : (
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…
                          </span>
                        )}
                        {m.tools && m.tools.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {m.tools.map((t, i) => (
                              <span key={i} className={cn(
                                "hud-label rounded px-1.5 py-0.5 text-[9px]",
                                t.status === "error" ? "bg-destructive/15 text-destructive" : "bg-accent/10 text-accent",
                              )}>{t.name}</span>
                            ))}
                          </div>
                        )}
                        {m.links && m.links.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {m.links.map((l, i) => (
                              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-accent transition hover:bg-accent/20">
                                <ExternalLink className="h-3.5 w-3.5" /> Open {l.label}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </HudPanel>
        </div>

        {/* RIGHT column */}
        <div className="flex flex-col gap-3">
          <QuickCommands commands={commands} />
          <Reminders upcoming={stats?.upcoming ?? null} />
        </div>
      </div>

      {/* ===== BOTTOM REGION ===== */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,1fr)]">
        <VoiceRecognition
          level={voice.level}
          active={voice.status === "recording" || voice.status === "listening"}
          status={voiceStarted ? statusLabel : voiceConfigured ? "Standby" : "Not configured"}
          started={voiceStarted}
          muted={voice.muted}
          onMic={() => (voiceStarted ? voice.toggleMute() : enableVoice())}
        />
        <SystemPerformance history={metrics.history} />
        <NetworkStatus metrics={metrics} />
      </div>

      {/* ===== COMMAND BAR ===== */}
      <CommandBar
        input={input} setInput={setInput} onSubmit={handleSend} inputRef={inputRef}
        streaming={agent.streaming} uploading={uploading} onFileClick={() => fileRef.current?.click()}
        voiceStarted={voiceStarted} muted={voice.muted} enabled={voice.enabled} level={voice.level}
        active={voice.status === "recording" || voice.status === "listening"}
        onMute={voice.toggleMute} onToggleVoice={() => voice.setEnabled(!voice.enabled)}
        userName={userName}
      />
      <input ref={fileRef} type="file" hidden onChange={onFile} accept="image/*,.pdf,.txt,.md,.json,.csv" />
    </div>
  );
}

// ---- Panels ------------------------------------------------------------

/**
 * The greeting-panel hologram. Prefers a real image at /hologram-human.png
 * (drop your rendered figure there and it appears automatically, with a screen
 * blend so a dark background disappears against the panel). Falls back to the
 * built-in SVG hologram if the image isn't present.
 */
function HeroHuman() {
  const [failed, setFailed] = useState(false);
  if (failed) return <HumanFigure />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/hologram-human.png"
      alt=""
      aria-hidden
      onError={() => setFailed(true)}
      className="h-full w-full object-contain animate-hud-float"
      style={{ mixBlendMode: "screen" }}
    />
  );
}

function GreetingPanel({ greeting, name, quote }: { greeting: string; name: string; quote: string }) {
  return (
    <HudPanel bodyClassName="p-0">
      <div className="flex items-stretch">
        <div className="flex min-w-0 flex-1 flex-col justify-center p-4">
          <div className="hud-label text-[11px] text-accent">{greeting},</div>
          <div className="hud-display mt-1 text-2xl leading-tight text-foreground text-glow">{name.toUpperCase()}</div>
          <p className="mt-3 max-w-[22ch] text-xs italic leading-relaxed text-muted-foreground">“{quote}”</p>
        </div>
        <div className="w-28 shrink-0 self-stretch py-2 pr-2 sm:w-32">
          <HeroHuman />
        </div>
      </div>
    </HudPanel>
  );
}

function TodaysOverview({ tasks }: { tasks: Stats["tasks"] | null }) {
  const pct = tasks && tasks.all > 0 ? Math.round((tasks.completed / tasks.all) * 100) : 0;
  const tiles = [
    { icon: Calendar, value: tasks ? String(tasks.pending).padStart(2, "0") : "—", label: "Tasks Pending", tone: "accent" },
    { icon: Check, value: tasks ? String(tasks.completed).padStart(2, "0") : "—", label: "Completed", tone: "success" },
    { icon: AlertTriangle, value: tasks ? String(tasks.high) : "—", label: "High Priority", tone: "warning" },
    { icon: BarChart3, value: tasks ? `${pct}%` : "—", label: "Completion", tone: "accent" },
  ];
  return (
    <HudPanel label="Today's Overview">
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <div key={t.label} className="hud-row rounded p-2.5">
            <t.icon className={cn("h-4 w-4",
              t.tone === "success" ? "text-success" : t.tone === "warning" ? "text-warning" : "text-accent")} />
            <div className={cn("mt-1.5 hud-display text-2xl",
              t.tone === "success" ? "text-success" : t.tone === "warning" ? "text-warning" : "text-foreground")}>
              {t.value}
            </div>
            <div className="hud-label text-[8px] text-muted-foreground">{t.label}</div>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

const PRIORITY_PCT: Record<string, number> = { high: 100, medium: 60, low: 30 };
function ActiveTasks({ tasks }: { tasks: TaskLite[] | null }) {
  return (
    <HudPanel label="Active Tasks" action={<Link href="/dashboard/tasks" className="text-accent"><ArrowRight className="h-3.5 w-3.5" /></Link>}>
      {tasks == null ? <Skeleton /> : tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active tasks. Ask JARVIS to add one.</p>
      ) : (
        <div className="space-y-2.5">
          {tasks.map((t) => {
            const p = PRIORITY_PCT[t.priority] ?? 40;
            return (
              <div key={t.id} className="flex items-center gap-2.5 text-xs">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full",
                  t.priority === "high" ? "bg-warning" : t.priority === "low" ? "bg-muted-foreground/60" : "bg-accent")} />
                <span className="min-w-0 flex-1 truncate text-foreground/85">{t.title}</span>
                <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-accent/12">
                  <div className={cn("h-full rounded-full",
                    t.priority === "high" ? "bg-warning" : "bg-accent")} style={{ width: `${p}%` }} />
                </div>
                <span className="hud-label w-12 shrink-0 text-right text-[8px] text-muted-foreground">{t.priority}</span>
              </div>
            );
          })}
        </div>
      )}
    </HudPanel>
  );
}

function Bar({ metric, label }: { metric: Metric; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="hud-label w-14 shrink-0 text-[9px] text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent/12">
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-bright box-glow-soft"
          style={{ width: `${metric.available ? Math.max(3, metric.pct) : 0}%`, transition: "width 500ms ease-out" }} />
      </div>
      <span className="w-14 shrink-0 text-right tabular-nums text-foreground/80">{metric.label}</span>
    </div>
  );
}

function SystemOverviewPanel({ pct, metrics, services }: { pct: number | null; metrics: ReturnType<typeof useDeviceMetrics>; services: Services | null }) {
  const r = 40, circ = 2 * Math.PI * r, dash = ((pct ?? 0) / 100) * circ;
  const optimal = (pct ?? 0) >= 80;
  return (
    <HudPanel label="System Overview">
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90">
          <defs>
            <linearGradient id="donutGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(var(--accent-bright))" />
              <stop offset="100%" stopColor="hsl(var(--accent-deep))" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--accent) / 0.12)" strokeWidth="7" />
          <circle cx="50" cy="50" r={r} fill="none" stroke="url(#donutGrad)" strokeWidth="7"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray 700ms ease-out", filter: "drop-shadow(0 0 7px hsl(var(--accent)))" }} />
          <text x="50" y="46" transform="rotate(90 50 50)" textAnchor="middle" className="fill-foreground" style={{ fontSize: 17 }}>{pct == null ? "—" : `${pct}%`}</text>
          <text x="50" y="60" transform="rotate(90 50 50)" textAnchor="middle" style={{ fontSize: 7, fill: "hsl(var(--muted-foreground))", letterSpacing: "0.15em" }}>
            {optimal ? "OPTIMAL" : "STATUS"}
          </text>
        </svg>
        <div className="flex-1 space-y-1.5">
          <Bar metric={metrics.memory} label="Memory" />
          <Bar metric={metrics.storage} label="Storage" />
          <Bar metric={metrics.network} label="Network" />
          <Bar metric={metrics.render} label="Render" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-accent/10 pt-2.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", optimal ? "bg-success shadow-[0_0_8px_hsl(var(--success))]" : "bg-warning")} />
        <span className="text-[11px] text-muted-foreground">
          {services == null ? "Checking systems…" : optimal ? "All systems functional" : "Some systems in standby"}
        </span>
      </div>
    </HudPanel>
  );
}

function AICorePanel({ online }: { online: boolean }) {
  return (
    <HudPanel label="AI Core">
      <div className="hud-label -mt-1 mb-1 text-[8px] text-muted-foreground">Central Processing Unit</div>
      <div className="flex items-center justify-center">
        <CoreCube />
      </div>
      <div className="mt-1 flex flex-col items-center">
        <div className="hud-label text-[11px] text-accent-bright text-glow">JARVIS Core</div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-success shadow-[0_0_8px_hsl(var(--success))] animate-hud-pulse" : "bg-muted-foreground/50")} />
          <span className={cn("hud-label text-[9px]", online ? "text-success" : "text-muted-foreground")}>
            {online ? "Active" : "Offline"}
          </span>
        </div>
      </div>
    </HudPanel>
  );
}

function QuickCommands({ commands }: { commands: { icon: React.ComponentType<{ className?: string }>; label: string; run: () => void }[] }) {
  return (
    <HudPanel label="Quick Commands">
      <div className="space-y-1.5">
        {commands.map((c) => (
          <button key={c.label} onClick={c.run}
            className="hud-row group flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm text-foreground/85 transition hover:text-accent-bright">
            <c.icon className="h-4 w-4 text-accent" />
            <span>{c.label}</span>
            <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-accent" />
          </button>
        ))}
      </div>
    </HudPanel>
  );
}

function Reminders({ upcoming }: { upcoming: Stats["upcoming"] | null }) {
  return (
    <HudPanel label="Reminders" action={
      <Link href="/dashboard/tasks" aria-label="Add reminder"
        className="flex h-5 w-5 items-center justify-center rounded border border-accent/30 text-accent transition hover:bg-accent/15">
        <Plus className="h-3.5 w-3.5" />
      </Link>
    }>
      {upcoming == null ? <Skeleton /> : upcoming.length === 0 ? (
        <p className="text-xs text-muted-foreground">No upcoming reminders.</p>
      ) : (
        <div className="space-y-2.5">
          {upcoming.map((t) => {
            const d = new Date(t.dueAt);
            const today = new Date();
            const isToday = d.toDateString() === today.toDateString();
            const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
            const isTomorrow = d.toDateString() === tomorrow.toDateString();
            const day = isToday ? "Today" : isTomorrow ? "Tomorrow" : d.toLocaleDateString("en", { month: "short", day: "numeric" });
            return (
              <div key={t.id} className="flex items-center gap-3">
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                  t.priority === "high" ? "border-warning/50 text-warning" : "border-accent/30 text-accent")}>
                  <Radio className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground/90">{t.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {day}, {d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </HudPanel>
  );
}

function VoiceRecognition({ level, active, status, started, muted, onMic }: {
  level: number; active: boolean; status: string; started: boolean; muted: boolean; onMic: () => void;
}) {
  return (
    <HudPanel label="Voice Recognition">
      <div className="flex items-center gap-4">
        <div className="h-16 flex-1">
          <Waveform bars={44} level={level} active={active && !muted} />
        </div>
        <button onClick={onMic}
          className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition box-glow-soft",
            active && !muted ? "border-accent bg-accent/15 text-accent-bright animate-glow-pulse" : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20")}
          aria-label="Toggle voice">
          {started && muted ? <MicOff className="h-5 w-5 text-destructive" /> : <Mic className="h-5 w-5" />}
        </button>
      </div>
      <div className="mt-2 hud-label text-[10px] text-muted-foreground">
        {active && !muted ? "Listening…" : status}
      </div>
    </HudPanel>
  );
}

function SystemPerformance({ history }: { history: { mem: number; net: number; fps: number }[] }) {
  const W = 320, H = 120, pad = 6;
  const n = Math.max(history.length, 2);
  const x = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - pad * 2);
  const path = (key: "mem" | "net" | "fps") =>
    history.length < 2 ? "" : history.map((h, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(h[key]).toFixed(1)}`).join(" ");
  const series = [
    { key: "fps" as const, color: "hsl(var(--accent-bright))", label: "Render" },
    { key: "mem" as const, color: "hsl(var(--warning))", label: "Memory" },
    { key: "net" as const, color: "hsl(var(--success))", label: "Network" },
  ];
  return (
    <HudPanel label="System Performance" action={
      <div className="flex items-center gap-3">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <span className="h-0.5 w-3" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
    }>
      <div className="w-full overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" preserveAspectRatio="none">
          {[0, 25, 50, 75, 100].map((g) => (
            <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="hsl(var(--accent) / 0.08)" strokeWidth="1" />
          ))}
          {history.length < 2 ? (
            <text x={W / 2} y={H / 2} textAnchor="middle" style={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}>
              Sampling live metrics…
            </text>
          ) : series.map((s) => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="1.6"
              strokeLinejoin="round" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${s.color})` }} />
          ))}
        </svg>
      </div>
      <div className="mt-1 flex justify-between text-[8px] text-muted-foreground">
        <span>live</span><span>client telemetry · {Math.max(0, history.length)} samples</span>
      </div>
    </HudPanel>
  );
}

function NetworkStatus({ metrics }: { metrics: ReturnType<typeof useDeviceMetrics> }) {
  const rows = [
    { label: "Downlink", value: metrics.downlinkMbps != null ? `${metrics.downlinkMbps} Mbps` : "—" },
    { label: "Ping", value: metrics.rttMs != null ? `${metrics.rttMs} ms` : "—" },
    { label: "Type", value: metrics.connectionType ? metrics.connectionType.toUpperCase() : "—" },
  ];
  return (
    <HudPanel label="Network Status">
      <div className="flex items-center gap-3">
        <NetGlobe className="h-24 w-24 shrink-0" />
        <div className="flex-1 space-y-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between border-b border-accent/8 pb-1">
              <span className="hud-label text-[9px] text-muted-foreground">{r.label}</span>
              <span className="hud-display text-sm text-accent-bright text-glow tabular-nums">{r.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2 border-t border-accent/10 pt-2">
        <Wifi className="h-3.5 w-3.5 text-accent" />
        <span className="hud-label text-[8px] text-muted-foreground">Global Connectivity</span>
        {metrics.secure ? (
          <span className="ml-auto flex items-center gap-1 text-[9px] text-success">
            <ShieldCheck className="h-3.5 w-3.5" /> Secure
          </span>
        ) : (
          <span className="ml-auto flex items-center gap-1 text-[9px] text-warning">
            <ShieldAlert className="h-3.5 w-3.5" /> Insecure
          </span>
        )}
      </div>
    </HudPanel>
  );
}

function CommandBar({
  input, setInput, onSubmit, inputRef, streaming, uploading, onFileClick,
  voiceStarted, muted, enabled, level, active, onMute, onToggleVoice, userName,
}: {
  input: string; setInput: (v: string) => void; onSubmit: (e?: React.FormEvent) => void;
  inputRef: React.RefObject<HTMLTextAreaElement>; streaming: boolean; uploading: boolean; onFileClick: () => void;
  voiceStarted: boolean; muted: boolean; enabled: boolean; level: number; active: boolean;
  onMute: () => void; onToggleVoice: () => void; userName: string;
}) {
  return (
    <form onSubmit={onSubmit} className="hud-panel box-glow-soft relative">
      <span className="hud-corners" aria-hidden />
      <div className="flex flex-col gap-2 p-3 lg:flex-row lg:items-center">
        {/* input command */}
        <div className="flex items-center gap-2">
          <span className="chev hidden text-accent sm:inline-flex"><span>›</span><span>›</span><span>›</span></span>
          <span className="hud-label hidden shrink-0 text-[10px] text-accent sm:block">Input Command</span>
        </div>
        <div className="flex flex-1 items-end gap-2 rounded border border-accent/15 bg-background/40 p-1.5">
          <IconBtn onClick={onFileClick} label="Upload file" disabled={uploading} type="button">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </IconBtn>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
            rows={1}
            placeholder={`How can I help you today, ${userName}?`}
            className="max-h-24 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button type="submit" disabled={!input.trim() || streaming}
            className="flex h-9 w-9 items-center justify-center rounded bg-accent/15 text-accent transition hover:bg-accent/25 disabled:opacity-40"
            aria-label="Send">
            <Send className="h-4 w-4" />
          </button>
        </div>

        {/* voice mode */}
        <div className="flex items-center gap-2">
          <div className="hidden h-8 w-24 lg:block">
            <Waveform bars={18} level={level} active={active && !muted} />
          </div>
          <span className="hud-label hidden shrink-0 text-[10px] text-accent sm:block">Voice Mode</span>
          {voiceStarted && (
            <>
              <IconBtn onClick={onMute} label={muted ? "Unmute" : "Mute"}>
                {muted ? <MicOff className="h-4 w-4 text-destructive" /> : <Mic className="h-4 w-4 text-accent" />}
              </IconBtn>
              <IconBtn onClick={onToggleVoice} label={enabled ? "Voice on" : "Voice off"}>
                {enabled ? <Volume2 className="h-4 w-4 text-accent" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
              </IconBtn>
            </>
          )}
        </div>
      </div>
    </form>
  );
}

function IconBtn({ children, onClick, label, disabled, type = "button" }: {
  children: React.ReactNode; onClick?: () => void; label: string; disabled?: boolean; type?: "button" | "submit";
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition hover:bg-accent/10 hover:text-accent disabled:opacity-40">
      {children}
    </button>
  );
}

function Skeleton() {
  return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-4 w-full animate-hud-pulse rounded bg-accent/8" />)}</div>;
}
