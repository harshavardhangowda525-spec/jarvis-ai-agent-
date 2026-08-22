"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Mic, MicOff, Send, Paperclip, Volume2, VolumeX, Loader2,
  ListChecks, StickyNote, Brain, Settings as SettingsIcon,
  ArrowRight, Check, AlertTriangle, Calendar, ExternalLink,
} from "lucide-react";
import { Orb, type OrbState, orbStateLabel } from "@/components/orb";
import { HudPanel, StatusDot } from "@/components/hud/panel";
import { useVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import { cn, timeAgo } from "@/lib/utils";

interface Services { [k: string]: boolean }
interface Stats {
  tasks: { all: number; completed: number; pending: number; high: number };
  totals: { notes: number; memories: number; conversations: number };
  recentActivity: { tool: string; status: string; at: string }[];
  upcoming: { id: string; title: string; dueAt: string; priority: string }[];
}

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
  const sendRef = useRef<(t: string) => void>(() => {});

  const onNavigate = useCallback((path: string) => {
    if (path.startsWith("/dashboard") && path !== "/dashboard") router.push(path);
  }, [router]);

  const voice = useVoice({ onTranscript: (t) => sendRef.current(t), autoListen: true });
  const agent = useAgent({
    onAssistantComplete: (text) => { if (voiceStarted && !voice.muted && voice.enabled) voice.speak(text); },
    onNavigate,
    onOpen: (url) => {
      // Open automatically. Try a new tab first; if the pop-up blocker stops it
      // (common when not triggered by a direct click), fall back to navigating
      // the current tab — that is never blocked, so the site always opens.
      let win: Window | null = null;
      try { win = window.open(url, "_blank", "noopener,noreferrer"); } catch { win = null; }
      if (!win || win.closed || typeof win.closed === "undefined") {
        window.location.href = url;
      }
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

  const hasMessages = agent.messages.length > 0;

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,300px)]">
      {/* LEFT column */}
      <div className="flex min-w-0 flex-col gap-3">
        <SystemOverview services={services} />
        <ActiveModules services={services} />
      </div>

      {/* CENTER column */}
      <div className="flex min-h-[70vh] min-w-0 flex-col">
        <HudPanel
          label="JARVIS Core"
          className="flex flex-1 flex-col"
          bodyClassName="flex flex-1 flex-col p-0"
        >
          {/* Core / conversation region */}
          <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
            {!hasMessages ? (
              <div className="flex min-h-[46vh] flex-col items-center justify-center py-6">
                <Orb state={orbState} level={voice.level} size={300} showLabel />
                <div className="mt-4 hud-label text-[11px] text-accent">{statusLabel}</div>
                {voice.error && <div className="mt-1 text-xs text-destructive">{voice.error}</div>}
                {!voiceStarted && (
                  <div className="mt-4">
                    {voiceConfigured === null ? (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Initializing voice…
                      </p>
                    ) : voiceConfigured ? (
                      <button onClick={enableVoice}
                        className="flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm text-accent transition hover:bg-accent/20">
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
                {/* compact core header while conversing */}
                <div className="mb-2 flex items-center gap-3 border-b border-accent/10 pb-3">
                  <Orb state={orbState} level={voice.level} size={54} />
                  <div>
                    <div className="hud-label text-[10px] text-accent">{statusLabel}</div>
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
                            <a
                              key={i}
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-accent transition hover:bg-accent/20"
                            >
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

          {/* Composer */}
          <form onSubmit={handleSend} className="border-t border-accent/12 p-3">
            <div className="mb-2 flex items-center gap-3 px-1">
              <span className="text-xs text-muted-foreground">
                How can I help you today, {userName}?
              </span>
              <div className="ml-auto flex items-center gap-1">
                {voiceStarted && (
                  <>
                    <IconBtn onClick={voice.toggleMute} label={voice.muted ? "Unmute" : "Mute"}>
                      {voice.muted ? <MicOff className="h-4 w-4 text-destructive" /> : <Mic className="h-4 w-4 text-accent" />}
                    </IconBtn>
                    <IconBtn onClick={() => voice.setEnabled(!voice.enabled)} label={voice.enabled ? "Voice on" : "Voice off"}>
                      {voice.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
                    </IconBtn>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-end gap-2 rounded border border-accent/15 bg-background/40 p-1.5">
              <input ref={fileRef} type="file" hidden onChange={onFile} accept="image/*,.pdf,.txt,.md,.json,.csv" />
              <IconBtn onClick={() => fileRef.current?.click()} label="Upload file" disabled={uploading} type="button">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </IconBtn>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                rows={1}
                placeholder={voiceStarted ? "Speak or type a command…" : "Type a command…"}
                className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button type="submit" disabled={!input.trim() || agent.streaming}
                className="flex h-9 w-9 items-center justify-center rounded bg-accent/15 text-accent transition hover:bg-accent/25 disabled:opacity-40"
                aria-label="Send">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        </HudPanel>
      </div>

      {/* RIGHT column */}
      <div className="flex min-w-0 flex-col gap-3">
        <UpcomingEvents upcoming={stats?.upcoming ?? null} />
        <Notifications items={agent.activity} streaming={agent.streaming} />
      </div>

      {/* BOTTOM strip */}
      <div className="lg:col-span-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <QuickActions tasks={stats?.tasks ?? null} />
        <RecentActivity items={stats?.recentActivity ?? null} />
        <Shortcuts totals={stats?.totals ?? null} />
      </div>
    </div>
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

// ---- Panels (all fed real data) ----------------------------------------

function Row({ label, state }: { label: string; state: "online" | "standby" | "offline" }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <StatusDot state={state} />
      <span className="text-foreground/85">{label}</span>
      <span className={cn("hud-label ml-auto text-[9px]",
        state === "online" ? "text-success" : state === "standby" ? "text-warning" : "text-muted-foreground")}>
        {state}
      </span>
    </div>
  );
}

function SystemOverview({ services }: { services: Services | null }) {
  const s = services;
  const st = (v: boolean | undefined): "online" | "offline" => (v ? "online" : "offline");
  return (
    <HudPanel label="System Overview">
      {s == null ? <Skeleton /> : (
        <div className="divide-y divide-accent/8">
          <Row label="AI Core" state={st(s.ai)} />
          <Row label="Voice" state={st(s.voice)} />
          <Row label="Database" state={st(s.database)} />
          <Row label="Web Search" state={s.search ? "online" : "standby"} />
          <Row label="Weather" state={s.weather ? "online" : "standby"} />
          <Row label="Tools" state={st(s.tools)} />
        </div>
      )}
    </HudPanel>
  );
}

function ActiveModules({ services }: { services: Services | null }) {
  const s = services;
  const mod = (on: boolean | undefined, standby = false): "online" | "standby" | "offline" =>
    on ? "online" : standby ? "standby" : "offline";
  return (
    <HudPanel label="Active Modules">
      {s == null ? <Skeleton /> : (
        <div className="divide-y divide-accent/8">
          <Row label="Voice Recognition" state={mod(s.voice)} />
          <Row label="Natural Language" state={mod(s.ai)} />
          <Row label="Data Analysis" state={mod(s.ai)} />
          <Row label="Web Search" state={mod(s.search, true)} />
          <Row label="Computer Vision" state={mod(s.ai, true)} />
        </div>
      )}
    </HudPanel>
  );
}

function UpcomingEvents({ upcoming }: { upcoming: Stats["upcoming"] | null }) {
  return (
    <HudPanel label="Upcoming" action={<Link href="/dashboard/tasks" className="text-accent"><ArrowRight className="h-3.5 w-3.5" /></Link>}>
      {upcoming == null ? <Skeleton /> : upcoming.length === 0 ? (
        <p className="text-xs text-muted-foreground">No scheduled tasks.</p>
      ) : (
        <div className="space-y-2">
          {upcoming.map((t) => {
            const d = new Date(t.dueAt);
            return (
              <div key={t.id} className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded border border-accent/20 text-center">
                  <span className="hud-label text-[8px] text-muted-foreground">{d.toLocaleString("en", { month: "short" })}</span>
                  <span className="text-sm leading-none text-foreground">{d.getDate()}</span>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground/90">{t.title}</div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                    {t.priority === "high" && <span className="ml-1 text-warning">· high</span>}
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

function Notifications({ items, streaming }: { items: { id: string; label: string; kind: string; status?: string }[]; streaming: boolean }) {
  return (
    <HudPanel label="Notifications" action={streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> : undefined}>
      <div className="max-h-56 space-y-1.5 overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-muted-foreground">System idle. Awaiting command.</p>}
        {items.map((it) => (
          <div key={it.id} className="flex items-start gap-2 text-xs animate-fade-in">
            {it.kind === "error" || it.status === "error" ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            ) : it.kind === "tool" ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-accent" />
            )}
            <span className={cn(it.kind === "error" ? "text-destructive" : "text-foreground/85")}>{it.label}</span>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function QuickActions({ tasks }: { tasks: Stats["tasks"] | null }) {
  const t = tasks;
  const pct = t && t.all > 0 ? Math.round((t.completed / t.all) * 100) : 0;
  const r = 34, circ = 2 * Math.PI * r, dash = (pct / 100) * circ;
  return (
    <HudPanel label="Quick Actions">
      {t == null ? <Skeleton /> : (
        <div className="flex items-center gap-5">
          <svg viewBox="0 0 88 88" className="h-24 w-24 shrink-0 -rotate-90">
            <circle cx="44" cy="44" r={r} fill="none" stroke="hsl(var(--accent) / 0.15)" strokeWidth="6" />
            <circle cx="44" cy="44" r={r} fill="none" stroke="hsl(var(--accent))" strokeWidth="6"
              strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
              style={{ transition: "stroke-dasharray 600ms ease-out" }} />
            <text x="44" y="40" transform="rotate(90 44 44)" textAnchor="middle" className="fill-foreground text-[13px]">{pct}%</text>
            <text x="44" y="54" transform="rotate(90 44 44)" textAnchor="middle" className="fill-current text-[7px] uppercase" style={{ fill: "hsl(var(--muted-foreground))", letterSpacing: "0.1em" }}>Done</text>
          </svg>
          <div className="flex-1 space-y-1.5 text-sm">
            <Stat label="All Tasks" value={t.all} />
            <Stat label="Completed" value={t.completed} />
            <Stat label="Pending" value={t.pending} />
            <Stat label="High Priority" value={t.high} accent />
          </div>
        </div>
      )}
    </HudPanel>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex items-center border-b border-accent/8 pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("ml-auto tabular-nums", accent ? "text-warning" : "text-foreground")}>{value}</span>
    </div>
  );
}

function RecentActivity({ items }: { items: Stats["recentActivity"] | null }) {
  return (
    <HudPanel label="Recent Activity">
      {items == null ? <Skeleton /> : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tool activity yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {a.status === "error"
                ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                : <Check className="h-3.5 w-3.5 text-success" />}
              <span className="text-foreground/85">{a.tool}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{timeAgo(a.at)}</span>
            </div>
          ))}
        </div>
      )}
    </HudPanel>
  );
}

function Shortcuts({ totals }: { totals: Stats["totals"] | null }) {
  const links = [
    { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks, count: undefined },
    { href: "/dashboard/notes", label: "Notes", icon: StickyNote, count: totals?.notes },
    { href: "/dashboard/memory", label: "Memory", icon: Brain, count: totals?.memories },
    { href: "/dashboard/settings", label: "Settings", icon: SettingsIcon, count: undefined },
  ];
  return (
    <HudPanel label="Shortcuts">
      <div className="space-y-1">
        {links.map(({ href, label, icon: Icon, count }) => (
          <Link key={href} href={href}
            className="flex items-center gap-3 rounded px-2 py-2 text-sm text-foreground/85 transition hover:bg-accent/10 hover:text-accent">
            <Icon className="h-4 w-4 text-accent" />
            <span>{label}</span>
            {typeof count === "number" && <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>}
            <ArrowRight className="ml-auto h-3.5 w-3.5 opacity-40" />
          </Link>
        ))}
      </div>
    </HudPanel>
  );
}

function Skeleton() {
  return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-4 w-full animate-hud-pulse rounded bg-accent/8" />)}</div>;
}
