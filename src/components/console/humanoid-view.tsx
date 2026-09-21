"use client";

import { useMemo } from "react";
import { Mic, MicOff, Send, Power, Loader2 } from "lucide-react";
import type { OrbState } from "@/components/orb";
import { cn } from "@/lib/utils";

/**
 * Humanoid View — a cinematic presentation LAYER over the existing JARVIS. It
 * renders nothing of its own intelligence: it receives the SAME voice/agent
 * state and command handlers from JarvisConsole, so every capability keeps
 * working. Pure SVG/CSS (GPU-friendly transforms/opacity) — no heavy 3D deps.
 */
export interface HumanoidViewProps {
  userName: string;
  state: OrbState;           // idle | listening | thinking | speaking | executing | error | offline
  level: number;             // live mic level 0..1
  streaming: boolean;
  task?: string | null;      // current activity label (real)
  subtitle: string;
  phase: "in" | "active" | "out";
  // shared command bar (same handlers as normal mode)
  input: string;
  onInput: (s: string) => void;
  onSubmit: () => void;
  voiceStarted: boolean;
  muted: boolean;
  onMic: () => void;
  onSleep: () => void;
}

const STATE_LABEL: Record<string, string> = {
  idle: "READY", listening: "LISTENING", thinking: "THINKING",
  speaking: "SPEAKING", executing: "PROCESSING", error: "ERROR", offline: "OFFLINE",
};

export function HumanoidView(props: HumanoidViewProps) {
  const { state, level, streaming } = props;
  const active = state !== "idle" && state !== "offline";
  const listening = state === "listening";
  const thinking = state === "thinking" || state === "executing" || streaming;
  const speaking = state === "speaking";
  const eyeColor = state === "error" ? "248,113,113" : state === "executing" ? "251,191,36" : "150,225,255";

  const wrapAnim = props.phase === "in" ? "materialize 1.4s ease-out both"
    : props.phase === "out" ? "dematerialize 0.9s ease-in both" : undefined;

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-[#03070f]" style={{ animation: props.phase !== "active" ? (props.phase === "in" ? "fade-in .4s ease" : undefined) : undefined }}>
      {/* ambient depth */}
      <AmbientParticles />
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-[46%] h-[80vmin] w-[80vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.14),transparent_62%)] blur-3xl" />
        <PlexusSide side="right" />
        <PlexusSide side="left" />
      </div>

      {/* minimal HUD — top */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 pt-4">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", active ? "bg-accent animate-hud-pulse" : "bg-accent/50")} />
          <span className="hud-display text-sm tracking-[0.35em] text-foreground/90">JARVIS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hud-label text-[10px] tracking-[0.3em] text-accent/80">SYSTEM ONLINE</span>
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-hud-pulse" />
        </div>
      </div>

      {/* left — current task (only when something is happening) */}
      {(streaming || props.task) && (
        <div className="absolute left-6 top-1/2 z-10 hidden -translate-y-1/2 md:block">
          <div className="hud-label text-[10px] tracking-[0.25em] text-accent/70">CURRENT TASK</div>
          <div className="mt-1 max-w-[200px] text-sm text-foreground/85">{props.task || "Processing…"}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">(only relevant data shown)</div>
        </div>
      )}
      {/* right — system state */}
      <div className="absolute right-6 top-1/2 z-10 hidden -translate-y-1/2 text-right md:block">
        <div className="hud-label text-[10px] tracking-[0.25em] text-accent/70">SYSTEM</div>
        <div className="mt-1 text-sm text-foreground/85">{STATE_LABEL[state] ?? "READY"}</div>
      </div>

      {/* ===== the humanoid ===== */}
      <div className="absolute inset-0 z-0 flex items-end justify-center" style={{ animation: wrapAnim }}>
        <div className="relative flex h-[92%] items-end" style={{ animation: "breathe 6s ease-in-out infinite" }}>
          <Humanoid eyeColor={eyeColor} listening={listening} thinking={thinking} speaking={speaking} level={level} />
        </div>
      </div>

      {/* ===== bottom voice bar (liquid glass) ===== */}
      <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
        <form onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}
          className="flex w-full max-w-xl items-center gap-3 rounded-2xl border border-accent/20 bg-white/[0.03] px-4 py-2.5 backdrop-blur-xl"
          style={{ boxShadow: "0 8px 40px -12px hsl(var(--accent)/0.5), inset 0 1px 0 hsl(0 0% 100% / 0.05)" }}>
          <CircularWave listening={listening} speaking={speaking} thinking={thinking} level={level} />
          <input value={props.input} onChange={(e) => props.onInput(e.target.value)}
            placeholder={listening ? "Listening…" : streaming ? "Processing…" : `Speak to JARVIS, ${props.userName}…`}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground/90 outline-none placeholder:text-muted-foreground" />
          <button type="button" onClick={props.onMic} title={props.voiceStarted ? (props.muted ? "Unmute" : "Mute") : "Enable voice"}
            className={cn("flex h-9 w-9 items-center justify-center rounded-full border transition",
              props.voiceStarted && !props.muted ? "border-accent bg-accent/15 text-accent animate-hud-pulse" : "border-border text-muted-foreground hover:border-accent/50")}>
            {props.voiceStarted && props.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          {props.voiceStarted && (
            <button type="button" onClick={props.onSleep} title="Sleep" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-accent"><Power className="h-4 w-4" /></button>
          )}
          <button type="submit" disabled={!props.input.trim() || streaming}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent transition hover:bg-accent/25 disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </form>
      </div>

      {/* subtitle caption above the bar */}
      {(props.subtitle || streaming) && (
        <div className="absolute inset-x-0 bottom-24 z-20 flex justify-center px-6">
          <p className="max-w-2xl text-center text-[15px] leading-relaxed text-foreground/90 [text-shadow:0_0_16px_hsl(var(--accent)/0.4)]">
            {props.subtitle || (streaming ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…</span> : "")}
          </p>
        </div>
      )}

      {/* exit hint */}
      <div className="absolute bottom-1 left-1/2 z-20 -translate-x-1/2 text-[10px] text-muted-foreground/70">
        say “get me back to the normal interface”
      </div>
    </div>
  );
}

/* ---------------- the humanoid figure ---------------- */

function Humanoid({ eyeColor, listening, thinking, speaking, level }: {
  eyeColor: string; listening: boolean; thinking: boolean; speaking: boolean; level: number;
}) {
  const A = "hsl(var(--accent))";
  const AB = "hsl(var(--accent-bright))";
  const eyeGlow = listening || speaking ? 10 : 6;
  const eyeR = 3.4 + (speaking ? Math.min(1.2, level * 8) : 0);
  return (
    <svg viewBox="0 0 300 420" className="h-full w-auto" preserveAspectRatio="xMidYMax meet" aria-hidden>
      <defs>
        <radialGradient id="hv-body" cx="50%" cy="26%" r="75%">
          <stop offset="0%" stopColor="rgba(130,205,255,0.30)" />
          <stop offset="55%" stopColor="rgba(120,190,255,0.12)" />
          <stop offset="100%" stopColor="rgba(120,190,255,0.02)" />
        </radialGradient>
        <clipPath id="hv-clip">
          <ellipse cx="150" cy="92" rx="46" ry="54" />
          <rect x="127" y="130" width="46" height="46" rx="14" />
          <path d="M40 400 C40 250 92 188 150 188 C208 188 260 250 260 400 Z" />
        </clipPath>
        <radialGradient id="hv-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={AB} stopOpacity="0.9" />
          <stop offset="60%" stopColor={A} stopOpacity="0.15" />
          <stop offset="100%" stopColor={A} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* head orbital rings (neural halo) */}
      <g style={{ transformOrigin: "150px 92px" }}>
        {[0, 60, 120].map((deg, i) => (
          <ellipse key={deg} cx="150" cy="92" rx="78" ry="30" fill="none" stroke={A} strokeOpacity={thinking ? 0.5 : 0.22} strokeWidth="1"
            transform={`rotate(${deg} 150 92)`}
            style={{ transformOrigin: "150px 92px", animation: `edith-spin ${18 + i * 6}s linear infinite ${i % 2 ? "reverse" : ""}` }} />
        ))}
        {listening && [58, 66].map((r) => (
          <circle key={r} cx="150" cy="92" r={r} fill="none" stroke={AB} strokeOpacity="0.35" strokeWidth="1" className="animate-hud-pulse" />
        ))}
      </g>

      {/* translucent body + scan lines */}
      <g clipPath="url(#hv-clip)">
        <rect x="0" y="0" width="300" height="404" fill="url(#hv-body)" />
        {Array.from({ length: 26 }).map((_, i) => (
          <line key={i} x1="0" x2="300" y1={40 + i * 14} y2={40 + i * 14} stroke={A} strokeWidth="0.6" opacity={thinking ? 0.22 : 0.13} />
        ))}
      </g>

      {/* glowing outlines */}
      <g fill="none" stroke={A} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${A})` }}>
        <ellipse cx="150" cy="92" rx="46" ry="54" />
        <path d="M133 138 L131 186 M167 138 L169 186" opacity="0.7" />
        <path d="M40 400 C40 250 92 188 150 188 C208 188 260 250 260 400" />
      </g>

      {/* face */}
      <g fill="none" stroke={A} strokeWidth="1.1" opacity="0.6">
        <path d="M126 84 Q134 78 145 82 M155 82 Q166 78 174 84" /> {/* brows */}
        <path d="M150 90 L150 106 M140 112 Q150 118 160 112" />     {/* nose + mouth */}
      </g>
      {/* mouth (opens subtly while speaking) */}
      <ellipse cx="150" cy="114" rx={speaking ? 6 + level * 20 : 5} ry={speaking ? 2 + level * 8 : 1.2}
        fill={AB} opacity={speaking ? 0.55 : 0.18} style={{ transition: "all 90ms linear" }} />

      {/* glowing eyes */}
      <g style={{ filter: `drop-shadow(0 0 ${eyeGlow}px rgb(${eyeColor}))` }} className={listening || speaking ? "" : "animate-glow-pulse"}>
        <ellipse cx="134" cy="92" rx={eyeR} ry={eyeR * 0.7} fill={`rgb(${eyeColor})`} />
        <ellipse cx="166" cy="92" rx={eyeR} ry={eyeR * 0.7} fill={`rgb(${eyeColor})`} />
      </g>

      {/* contour + neural lines on torso */}
      <g fill="none" stroke={AB} strokeWidth="0.9" strokeLinecap="round" opacity={thinking ? 0.6 : 0.4}>
        <path d="M108 206 Q150 220 192 206" />
        <path d="M108 206 Q120 244 124 286 M192 206 Q180 244 176 286" />
        <path d="M64 224 Q52 286 70 350 M236 224 Q248 286 230 350" />
        <line x1="150" y1="188" x2="150" y2="360" opacity="0.35" />
      </g>

      {/* chest neural core */}
      <g>
        <circle cx="150" cy="250" r="46" fill="url(#hv-core)" />
        {[34, 26, 18].map((r, i) => (
          <circle key={r} cx="150" cy="250" r={r} fill="none" stroke={AB} strokeOpacity="0.5" strokeWidth="1"
            style={{ transformOrigin: "150px 250px", animation: `edith-spin ${8 + i * 4}s linear infinite ${i % 2 ? "reverse" : ""}` }} />
        ))}
        <circle cx="150" cy="250" r={8 + (speaking ? level * 20 : 0)} fill={AB} style={{ filter: `drop-shadow(0 0 8px ${AB})`, transition: "r 90ms linear" }} className={thinking ? "animate-hud-pulse" : ""} />
      </g>

      {/* floating particles around the body */}
      <g fill={AB}>
        {[[60,180],[240,210],[52,300],[250,320],[80,140],[220,150]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={1.4} opacity="0.6" style={{ animation: `drift ${4 + i}s ease-in-out ${i * 0.5}s infinite` }} />
        ))}
      </g>
    </svg>
  );
}

/* ---------------- ambient + waveform pieces ---------------- */

function AmbientParticles() {
  const dots = useMemo(() => Array.from({ length: 40 }, () => ({
    x: Math.random() * 100, y: Math.random() * 100, s: Math.random() * 1.6 + 0.4, d: Math.random() * 6 + 3, delay: Math.random() * 4,
  })), []);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {dots.map((p, i) => (
        <span key={i} className="absolute rounded-full bg-accent-bright"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, opacity: 0.4, animation: `drift ${p.d}s ease-in-out ${p.delay}s infinite` }} />
      ))}
    </div>
  );
}

function PlexusSide({ side }: { side: "left" | "right" }) {
  const pts = useMemo(() => Array.from({ length: 10 }, () => ({ x: Math.random() * 240, y: Math.random() * 420 })), []);
  return (
    <svg viewBox="0 0 240 420" className={cn("absolute top-1/2 h-[70%] w-56 -translate-y-1/2 opacity-40", side === "left" ? "left-0" : "right-0")} aria-hidden>
      <g stroke="hsl(var(--accent))" strokeOpacity="0.35" strokeWidth="0.5" fill="none">
        {pts.map((p, i) => pts.slice(i + 1).map((q, j) => {
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          return d < 120 ? <line key={`${i}-${j}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} /> : null;
        }))}
      </g>
      <g fill="hsl(var(--accent-bright))">
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="1.4" opacity="0.6" className="animate-hud-pulse" />)}
      </g>
    </svg>
  );
}

/** Circular neural waveform for the voice bar. */
function CircularWave({ listening, speaking, thinking, level }: { listening: boolean; speaking: boolean; thinking: boolean; level: number }) {
  const active = listening || speaking;
  const bars = 5;
  const base = useMemo(() => [45, 80, 100, 70, 50], []);
  return (
    <div className="flex h-7 w-9 shrink-0 items-center justify-center gap-[2px]" aria-hidden>
      {base.map((h, i) => (
        <span key={i} className="w-[3px] rounded-full bg-accent-bright"
          style={{
            height: active ? `${Math.min(100, h + level * 130)}%` : thinking ? "35%" : "18%",
            opacity: active ? 0.95 : 0.45,
            transition: "height 110ms ease",
            animation: active ? `edith-bar 640ms ease-in-out ${i * 80}ms infinite alternate` : thinking ? `edith-bar 1.4s ease-in-out ${i * 120}ms infinite alternate` : undefined,
          }} />
      ))}
    </div>
  );
}
