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
  const eyeGlow = listening || speaking ? 9 : 5;
  return (
    <svg viewBox="0 0 300 440" className="h-full w-auto" preserveAspectRatio="xMidYMax meet" aria-hidden>
      <defs>
        {/* face volume shading */}
        <radialGradient id="hv-face" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="rgba(190,232,255,0.42)" />
          <stop offset="55%" stopColor="rgba(120,190,255,0.20)" />
          <stop offset="100%" stopColor="rgba(80,150,230,0.06)" />
        </radialGradient>
        <linearGradient id="hv-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(200,238,255,0.30)" />
          <stop offset="100%" stopColor="rgba(90,160,230,0.10)" />
        </linearGradient>
        <radialGradient id="hv-body" cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="rgba(130,205,255,0.24)" />
          <stop offset="60%" stopColor="rgba(120,190,255,0.10)" />
          <stop offset="100%" stopColor="rgba(120,190,255,0.02)" />
        </radialGradient>
        <radialGradient id="hv-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={AB} stopOpacity="0.9" />
          <stop offset="60%" stopColor={A} stopOpacity="0.15" />
          <stop offset="100%" stopColor={A} stopOpacity="0" />
        </radialGradient>
        <clipPath id="hv-faceclip">
          <path d="M150 40 C182 40 202 66 202 104 C202 140 184 176 150 186 C116 176 98 140 98 104 C98 66 118 40 150 40 Z" />
        </clipPath>
        <clipPath id="hv-torsoclip">
          <path d="M150 176 C176 176 190 188 196 206 C236 214 262 250 262 400 L38 400 C38 250 64 214 104 206 C110 188 124 176 150 176 Z" />
        </clipPath>
      </defs>

      {/* head orbital rings (neural halo) */}
      <g>
        {[0, 60, 120].map((deg, i) => (
          <ellipse key={deg} cx="150" cy="108" rx="86" ry="34" fill="none" stroke={A} strokeOpacity={thinking ? 0.45 : 0.2} strokeWidth="1"
            transform={`rotate(${deg} 150 108)`}
            style={{ transformOrigin: "150px 108px", animation: `edith-spin ${20 + i * 6}s linear infinite ${i % 2 ? "reverse" : ""}` }} />
        ))}
        {listening && [70, 80].map((r) => (
          <circle key={r} cx="150" cy="108" r={r} fill="none" stroke={AB} strokeOpacity="0.3" strokeWidth="1" className="animate-hud-pulse" />
        ))}
      </g>

      {/* hair silhouette (translucent, flowing) */}
      <path d="M150 30 C196 30 226 66 226 116 C226 150 218 176 208 196 C214 150 206 96 176 76 C168 71 158 69 150 69 C142 69 132 71 124 76 C94 96 86 150 92 196 C82 176 74 150 74 116 C74 66 104 30 150 30 Z"
        fill="url(#hv-body)" stroke={A} strokeOpacity="0.35" strokeWidth="1" />
      <g stroke={AB} strokeWidth="0.6" strokeOpacity="0.3" fill="none">
        <path d="M96 70 C86 120 88 168 100 200" /><path d="M204 70 C214 120 212 168 200 200" />
        <path d="M110 58 C102 110 104 160 112 196" /><path d="M190 58 C198 110 196 160 188 196" />
      </g>

      {/* neck + shoulders (shaded translucent) */}
      <path d="M132 176 L132 200 Q150 210 168 200 L168 176" fill="url(#hv-skin)" stroke={A} strokeOpacity="0.4" strokeWidth="1.1" />
      <g clipPath="url(#hv-torsoclip)">
        <rect x="0" y="170" width="300" height="240" fill="url(#hv-body)" />
        {Array.from({ length: 16 }).map((_, i) => (
          <line key={i} x1="0" x2="300" y1={210 + i * 12} y2={210 + i * 12} stroke={A} strokeWidth="0.5" opacity={thinking ? 0.2 : 0.12} />
        ))}
      </g>
      <path d="M150 176 C176 176 190 188 196 206 C236 214 262 250 262 400 M150 176 C124 176 110 188 104 206 C64 214 38 250 38 400"
        fill="none" stroke={A} strokeWidth="1.4" strokeOpacity="0.7" style={{ filter: `drop-shadow(0 0 3px ${A})` }} />
      {/* collarbones */}
      <path d="M110 214 Q150 226 190 214" fill="none" stroke={AB} strokeWidth="0.9" opacity="0.5" />

      {/* face — volume fill + shaded gradient */}
      <path d="M150 40 C182 40 202 66 202 104 C202 140 184 176 150 186 C116 176 98 140 98 104 C98 66 118 40 150 40 Z"
        fill="url(#hv-face)" stroke={A} strokeOpacity="0.55" strokeWidth="1.3" style={{ filter: `drop-shadow(0 0 3px ${A})` }} />
      <g clipPath="url(#hv-faceclip)">
        {/* soft cheek/temple shading */}
        <ellipse cx="118" cy="118" rx="26" ry="40" fill="rgba(60,120,200,0.18)" />
        <ellipse cx="182" cy="118" rx="26" ry="40" fill="rgba(60,120,200,0.18)" />
        {/* forehead highlight */}
        <ellipse cx="150" cy="74" rx="30" ry="18" fill="rgba(210,240,255,0.18)" />
        {/* thin holographic contour lines */}
        <g stroke={A} strokeWidth="0.5" opacity="0.16" fill="none">
          <path d="M100 100 Q150 116 200 100" /><path d="M104 130 Q150 150 196 130" /><path d="M112 156 Q150 172 188 156" />
        </g>
      </g>

      {/* eyebrows */}
      <g fill="none" stroke={A} strokeWidth="1.4" strokeLinecap="round" opacity="0.7">
        <path d="M120 92 Q133 85 146 90" /><path d="M154 90 Q167 85 180 92" />
      </g>
      {/* eyes — almond with iris glow */}
      <g>
        <path d="M120 102 Q133 94 146 102 Q133 110 120 102 Z" fill="rgba(10,26,48,0.5)" stroke={A} strokeWidth="0.9" opacity="0.8" />
        <path d="M154 102 Q167 94 180 102 Q167 110 154 102 Z" fill="rgba(10,26,48,0.5)" stroke={A} strokeWidth="0.9" opacity="0.8" />
        <g style={{ filter: `drop-shadow(0 0 ${eyeGlow}px rgb(${eyeColor}))` }} className={listening || speaking ? "" : "animate-glow-pulse"}>
          <circle cx="133" cy="102" r={listening || speaking ? 3.6 : 3.1} fill={`rgb(${eyeColor})`} />
          <circle cx="167" cy="102" r={listening || speaking ? 3.6 : 3.1} fill={`rgb(${eyeColor})`} />
          <circle cx="133" cy="102" r="1.1" fill="#ffffff" /><circle cx="167" cy="102" r="1.1" fill="#ffffff" />
        </g>
      </g>
      {/* nose */}
      <path d="M150 106 L147 130 Q150 134 153 130 L150 106" fill="none" stroke={A} strokeWidth="0.9" opacity="0.55" />
      {/* lips (open subtly while speaking) */}
      <g>
        <path d="M136 146 Q150 141 164 146" fill="none" stroke={AB} strokeWidth="1" opacity="0.6" />
        <path d={`M136 146 Q150 ${150 + (speaking ? level * 18 : 4)} 164 146 Q150 ${148 + (speaking ? level * 10 : 2)} 136 146`}
          fill={AB} opacity={speaking ? 0.4 : 0.22} style={{ transition: "all 90ms linear" }} />
      </g>

      {/* chest neural core */}
      <g>
        <circle cx="150" cy="270" r="46" fill="url(#hv-core)" />
        {[34, 26, 18].map((r, i) => (
          <circle key={r} cx="150" cy="270" r={r} fill="none" stroke={AB} strokeOpacity="0.5" strokeWidth="1"
            style={{ transformOrigin: "150px 270px", animation: `edith-spin ${8 + i * 4}s linear infinite ${i % 2 ? "reverse" : ""}` }} />
        ))}
        <circle cx="150" cy="270" r={8 + (speaking ? level * 18 : 0)} fill={AB} style={{ filter: `drop-shadow(0 0 8px ${AB})`, transition: "r 90ms linear" }} className={thinking ? "animate-hud-pulse" : ""} />
      </g>

      {/* floating particles */}
      <g fill={AB}>
        {[[64,196],[236,214],[54,310],[248,330],[86,150],[214,160]].map(([x, y], i) => (
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
