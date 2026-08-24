"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Mic, MicOff, Send, Paperclip, Volume2, VolumeX, Loader2,
  Terminal, ScanLine, BarChart3, Search, FileText, Lock,
  ExternalLink, Power, Check, AlertTriangle,
} from "lucide-react";
import { Orb, type OrbState, orbStateLabel } from "@/components/orb";
import { HudPanel } from "@/components/hud/panel";
import { Waveform } from "@/components/hud/visuals";
import { useVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import { useDeviceMetrics } from "@/hooks/useDeviceMetrics";
import { useWakeWord } from "@/hooks/useWakeWord";
import { cn, timeAgo } from "@/lib/utils";

interface Services { [k: string]: boolean }
interface Stats {
  tasks: { all: number; completed: number; pending: number; high: number };
  totals: { notes: number; memories: number; conversations: number };
  recentActivity: { tool: string; status: string; at: string }[];
  upcoming: { id: string; title: string; dueAt: string; priority: string }[];
  activeTasks: { id: string; title: string; priority: string }[];
}

export function JarvisConsole({ userName }: { assistantName: string; userName: string }) {
  const router = useRouter();
  const [voiceConfigured, setVoiceConfigured] = useState<boolean | null>(null);
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [services, setServices] = useState<Services | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
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

  const sleep = useCallback(() => { voice.stop(); setVoiceStarted(false); }, [voice]);
  useEffect(() => {
    sendRef.current = (t: string) => {
      const low = t.toLowerCase().trim();
      if (/\b(go to sleep|jarvis[,\s]*sleep|sleep now|power down|good ?night|stand ?by)\b/.test(low)) { sleep(); return; }
      agent.send(t);
    };
  }, [agent, sleep]);

  const wake = useWakeWord({
    enabled: !voiceStarted,
    onWake: async () => { const ok = await enableVoice(); if (ok && voiceConfigured) setTimeout(() => voice.speak("Yes?"), 350); },
  });

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
  const statusLabel = agent.streaming ? (orbState === "executing" ? "Executing" : "Thinking") : orbStateLabel(orbState);

  async function enableVoice() { const ok = await voice.init(); if (ok) setVoiceStarted(true); return ok; }
  const focusCommand = useCallback((prefill?: string) => {
    if (prefill != null) setInput(prefill);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); });
  }, []);

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const t = input.trim(); if (!t) return;
    setInput(""); agent.send(t);
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
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

  const dock = useMemo(() => [
    { icon: Terminal, label: "Command", run: () => focusCommand("") },
    { icon: ScanLine, label: "Scan", run: () => { loadPanels(); agent.send("Run a status check: summarize which systems and tools are online."); } },
    { icon: Mic, label: "Voice", center: true, run: () => (voiceStarted ? voice.toggleMute() : enableVoice()) },
    { icon: BarChart3, label: "Analyze", run: () => agent.send("Analyze my data — summarize my tasks, notes and recent activity.") },
    { icon: FileText, label: "Note", run: () => focusCommand("Create a note: ") },
  ], [agent, focusCommand, loadPanels, voice, voiceStarted]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastAssistant = [...agent.messages].reverse().find((m) => m.role === "assistant");
  const lastUserMsg = [...agent.messages].reverse().find((m) => m.role === "user");
  const subtitle = lastAssistant?.content ?? "";
  const subtitleLinks = lastAssistant?.links ?? [];
  const hasMessages = agent.messages.length > 0;

  const servicesPct = services ? Math.round((Object.values(services).filter(Boolean).length / Object.values(services).length) * 100) : 0;
  const t = stats?.tasks;
  const completionPct = t && t.all > 0 ? Math.round((t.completed / t.all) * 100) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

  return (
    <div className="grid min-h-[calc(100vh-4rem)] grid-rows-[1fr_auto] gap-3 p-3">
      {/* ===== MAIN 3-COLUMN HUD ===== */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,0.9fr)]">
        {/* LEFT */}
        <div className="flex min-w-0 flex-col gap-3">
          <HudPanel label="Overview" bodyClassName="p-3">
            <div className="hud-label text-[10px] text-accent">{greeting},</div>
            <div className="hud-display text-lg text-foreground text-glow">{userName.toUpperCase()}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <MiniStat value={t ? t.pending : "—"} label="Pending" />
              <MiniStat value={t ? t.completed : "—"} label="Done" tone="success" />
              <MiniStat value={t ? t.high : "—"} label="Priority" tone="warning" />
            </div>
          </HudPanel>

          <HudPanel label="Diagnostics" bodyClassName="p-3">
            <div className="flex items-center justify-around">
              <Gauge value={completionPct} label="Tasks" />
              <Gauge value={servicesPct} label="Systems" />
              <Gauge value={metrics.storage.available ? metrics.storage.pct : 0} label="Storage" />
            </div>
          </HudPanel>

          <HudPanel label="Performance" className="flex-1" bodyClassName="flex h-full flex-col p-3">
            <AreaChart history={metrics.history} />
          </HudPanel>

          <HudPanel label="Activity" bodyClassName="p-3">
            <BarChart stats={stats} />
          </HudPanel>
        </div>

        {/* CENTER — reactor core */}
        <HudPanel label="JARVIS Core" className="flex flex-col" bodyClassName="flex flex-1 flex-col items-center justify-center p-4">
          <Orb state={orbState} level={voice.level} size={300} beam />
          <div className="mt-6 hud-label text-[11px] text-accent-bright text-glow">{statusLabel}</div>
          {voice.error && <div className="mt-1 text-xs text-destructive">{voice.error}</div>}

          {!voiceStarted && (
            <div className="mt-3 text-center">
              {voiceConfigured === null ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Initializing voice…</p>
              ) : voiceConfigured ? (
                <button onClick={enableVoice} className="flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm text-accent-bright transition hover:bg-accent/20 box-glow-soft">
                  <Mic className="h-4 w-4" /> Enable JARVIS Voice
                </button>
              ) : (
                <p className="max-w-xs text-[11px] text-muted-foreground">Voice is not configured — you can still chat by text.</p>
              )}
              <div className="mt-2 hud-label text-[10px] text-muted-foreground">
                {wake.armed ? <>Wake ready — clap twice{wake.speechSupported ? " or say “Jarvis wake up”" : ""}</> : wake.micGranted ? "Arming wake…" : <button onClick={wake.requestPermission} className="text-accent hover:underline">Enable clap / “Jarvis wake up”</button>}
              </div>
            </div>
          )}

          {/* subtitle caption */}
          <div className="mt-5 w-full max-w-xl text-center">
            {hasMessages && lastUserMsg?.content && <p className="mb-1.5 truncate text-[11px] text-accent/70">“{lastUserMsg.content}”</p>}
            <div className="max-h-28 overflow-y-auto">
              {subtitle ? (
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/95 [text-shadow:0_0_12px_hsl(var(--accent)/0.35)]">{subtitle}</p>
              ) : agent.streaming ? (
                <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…</p>
              ) : !hasMessages ? (
                <p className="text-sm text-muted-foreground">How can I help you today, {userName}?</p>
              ) : null}
            </div>
            {subtitleLinks.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {subtitleLinks.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-accent transition hover:bg-accent/20">
                    <ExternalLink className="h-3.5 w-3.5" /> Open {l.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </HudPanel>

        {/* RIGHT */}
        <div className="flex min-w-0 flex-col gap-3">
          <HudPanel label="Systems" bodyClassName="p-3">
            <StatusList services={services} />
          </HudPanel>
          <HudPanel label="Network" bodyClassName="p-3">
            <div className="flex items-center justify-around">
              <Gauge value={metrics.memory.available ? metrics.memory.pct : 0} label="Memory" small />
              <Gauge value={metrics.network.available ? metrics.network.pct : 0} label="Network" small />
              <Gauge value={metrics.render.available ? metrics.render.pct : 0} label="Render" small />
            </div>
          </HudPanel>
          <HudPanel label="Live Feed" className="flex-1" bodyClassName="flex h-full flex-col p-3">
            <ActivityFeed items={agent.activity} recent={stats?.recentActivity ?? []} streaming={agent.streaming} />
          </HudPanel>
        </div>
      </div>

      {/* ===== BOTTOM DOCK + COMMAND ===== */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-end gap-4">
          {dock.map((d) => (
            <button key={d.label} onClick={d.run} title={d.label}
              className={cn(
                "group flex flex-col items-center gap-1 transition",
                d.center ? "" : "opacity-90 hover:opacity-100",
              )}>
              <span className={cn(
                "flex items-center justify-center rounded-full border transition box-glow-soft",
                d.center
                  ? "h-14 w-14 border-accent bg-accent/20 text-accent-bright animate-glow-pulse"
                  : "h-11 w-11 border-accent/30 bg-accent/8 text-accent hover:border-accent/60 hover:bg-accent/15",
              )}>
                <d.icon className={d.center ? "h-6 w-6" : "h-5 w-5"} />
              </span>
              <span className="hud-label text-[8px] text-muted-foreground">{d.label}</span>
            </button>
          ))}
        </div>

        <form onSubmit={handleSend} className="hud-panel box-glow-soft relative w-full max-w-3xl">
          <span className="hud-corners" aria-hidden />
          <div className="flex items-center gap-2 p-2">
            <input ref={fileRef} type="file" hidden onChange={onFile} accept="image/*,.pdf,.txt,.md,.json,.csv" />
            <IconBtn onClick={() => fileRef.current?.click()} label="Upload file" disabled={uploading} type="button">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </IconBtn>
            <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              rows={1} placeholder={`How can I help you today, ${userName}?`}
              className="max-h-24 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground" />
            {voiceStarted && (
              <>
                <IconBtn onClick={voice.toggleMute} label={voice.muted ? "Unmute" : "Mute"}>
                  {voice.muted ? <MicOff className="h-4 w-4 text-destructive" /> : <Mic className="h-4 w-4 text-accent" />}
                </IconBtn>
                <IconBtn onClick={() => voice.setEnabled(!voice.enabled)} label={voice.enabled ? "Voice on" : "Voice off"}>
                  {voice.enabled ? <Volume2 className="h-4 w-4 text-accent" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
                </IconBtn>
                <IconBtn onClick={sleep} label="Sleep"><Power className="h-4 w-4 text-muted-foreground" /></IconBtn>
              </>
            )}
            <button type="submit" disabled={!input.trim() || agent.streaming}
              className="flex h-9 w-9 items-center justify-center rounded bg-accent/15 text-accent transition hover:bg-accent/25 disabled:opacity-40" aria-label="Send">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- pieces ----

function MiniStat({ value, label, tone }: { value: number | string; label: string; tone?: "success" | "warning" }) {
  return (
    <div className="hud-row rounded p-2">
      <div className={cn("hud-display text-xl", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground")}>{value}</div>
      <div className="hud-label text-[7px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Gauge({ value, label, small }: { value: number; label: string; small?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const r = 30, circ = 2 * Math.PI * r, dash = (v / 100) * circ;
  const size = small ? "h-16 w-16" : "h-20 w-20";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn("relative", size)}>
        <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
          <circle cx="36" cy="36" r={r} fill="none" stroke="hsl(var(--accent) / 0.12)" strokeWidth="5" />
          <circle cx="36" cy="36" r={r} fill="none" stroke="hsl(var(--accent))" strokeWidth="5" strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round" style={{ transition: "stroke-dasharray 600ms ease-out", filter: "drop-shadow(0 0 4px hsl(var(--accent)))" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center hud-display text-sm text-foreground">{v}%</div>
      </div>
      <span className="hud-label text-[8px] text-muted-foreground">{label}</span>
    </div>
  );
}

function AreaChart({ history }: { history: { mem: number; net: number; fps: number }[] }) {
  const W = 300, H = 110, pad = 4;
  const n = Math.max(history.length, 2);
  const x = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - pad * 2);
  const line = history.length < 2 ? "" : history.map((h, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(h.fps).toFixed(1)}`).join(" ");
  const area = history.length < 2 ? "" : `${line} L${x(history.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return (
    <div className="flex h-full flex-col">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--warning) / 0.5)" />
            <stop offset="100%" stopColor="hsl(var(--warning) / 0)" />
          </linearGradient>
        </defs>
        {[0, 33, 66, 100].map((g) => <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="hsl(var(--accent) / 0.07)" />)}
        {history.length < 2 ? (
          <text x={W / 2} y={H / 2} textAnchor="middle" style={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}>Sampling live telemetry…</text>
        ) : (
          <>
            <path d={area} fill="url(#areaFill)" />
            <path d={line} fill="none" stroke="hsl(var(--warning))" strokeWidth="1.8" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 3px hsl(var(--warning)))" }} />
          </>
        )}
      </svg>
      <div className="mt-auto flex justify-between text-[8px] text-muted-foreground"><span>live render rate</span><span>{Math.max(0, history.length)} samples</span></div>
    </div>
  );
}

function BarChart({ stats }: { stats: Stats | null }) {
  const bars = [
    { label: "Tasks", value: stats?.tasks.all ?? 0 },
    { label: "Done", value: stats?.tasks.completed ?? 0 },
    { label: "Notes", value: stats?.totals.notes ?? 0 },
    { label: "Memory", value: stats?.totals.memories ?? 0 },
    { label: "Convos", value: stats?.totals.conversations ?? 0 },
  ];
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex h-24 items-end justify-around gap-2">
      {bars.map((b) => (
        <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-16 w-full items-end justify-center">
            <div className="w-5 rounded-t bg-gradient-to-t from-accent-deep to-accent-bright box-glow-soft"
              style={{ height: `${(b.value / max) * 100}%`, minHeight: b.value > 0 ? 4 : 1, transition: "height 500ms ease-out" }} />
          </div>
          <span className="hud-display text-xs text-foreground">{b.value}</span>
          <span className="hud-label text-[7px] text-muted-foreground">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusList({ services }: { services: Services | null }) {
  const rows: { key: string; label: string }[] = [
    { key: "ai", label: "AI Core" },
    { key: "voice", label: "Voice" },
    { key: "database", label: "Database" },
    { key: "tools", label: "Tools" },
    { key: "search", label: "Web Search" },
    { key: "weather", label: "Weather" },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const on = services?.[r.key];
        return (
          <div key={r.key} className="flex items-center gap-2 text-xs">
            <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-success shadow-[0_0_8px_hsl(var(--success))] animate-hud-pulse" : "bg-muted-foreground/40")} />
            <span className="text-foreground/85">{r.label}</span>
            <span className={cn("hud-label ml-auto text-[8px]", on ? "text-success" : "text-muted-foreground")}>{services == null ? "…" : on ? "online" : "standby"}</span>
          </div>
        );
      })}
    </div>
  );
}

function ActivityFeed({ items, recent, streaming }: {
  items: { id: string; label: string; kind: string; status?: string }[];
  recent: { tool: string; status: string; at: string }[];
  streaming: boolean;
}) {
  const live = items.slice(0, 6);
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {live.length === 0 && recent.length === 0 && (
          <p className="text-xs text-muted-foreground">System idle. Awaiting command.</p>
        )}
        {live.map((it) => (
          <div key={it.id} className="flex items-start gap-2 text-xs animate-fade-in">
            {it.kind === "error" || it.status === "error"
              ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              : it.kind === "tool" ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              : <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
            <span className={cn(it.kind === "error" ? "text-destructive" : "text-foreground/85")}>{it.label}</span>
          </div>
        ))}
        {live.length === 0 && recent.map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {a.status === "error" ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> : <Check className="h-3.5 w-3.5 text-success" />}
            <span className="text-foreground/85">{a.tool}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{timeAgo(a.at)}</span>
          </div>
        ))}
      </div>
      {streaming && <div className="mt-2 flex items-center gap-2 text-[10px] text-accent"><Loader2 className="h-3 w-3 animate-spin" /> processing…</div>}
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
