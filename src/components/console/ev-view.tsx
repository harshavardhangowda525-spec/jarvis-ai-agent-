"use client";

import { useMemo } from "react";
import { Mic, MicOff, Send, Power } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * EV — the cinematic AI-presence dashboard. This is ONLY a presentation layer:
 * it reuses the existing JARVIS voice, agent stream and command router. There is
 * no backend, no fake data — the central hologram and the two glass panels react
 * to EV's real operating state and the real command being processed.
 *
 * Visual hierarchy (nothing else competes): 1) central hologram, 2) EV ACTIVITY,
 * 3) COMMAND.
 */

export type EvState =
  | "IDLE" | "LISTENING" | "THINKING" | "GENERATING"
  | "WAITING_FOR_APPROVAL" | "EXECUTING" | "SUCCESS" | "ERROR";

export interface EvViewProps {
  state: EvState;
  /** Current EV activity line (bottom-left panel). */
  activity: string;
  /** Current command being processed (bottom-right panel). */
  command: string;
  /** Voice input level 0..1 for reactive motion. */
  level: number;
  /** Transition phase driven by the console. */
  phase: "in" | "active" | "out";
  input: string;
  onInput: (v: string) => void;
  onSubmit: () => void;
  voiceStarted: boolean;
  muted: boolean;
  onMic: () => void;
  onSleep: () => void;
}

export function EvView(props: EvViewProps) {
  const { state, level, phase } = props;
  const listening = state === "LISTENING";
  const thinking = state === "THINKING";
  const generating = state === "GENERATING";
  const executing = state === "EXECUTING";
  const waiting = state === "WAITING_FOR_APPROVAL";
  const success = state === "SUCCESS";
  const error = state === "ERROR";

  const wrapAnim =
    phase === "in" ? "ev-materialize 1.4s cubic-bezier(0.22,1,0.36,1) both"
    : phase === "out" ? "ev-dissolve 0.9s ease-in both"
    : undefined;

  return (
    <div
      className="fixed inset-0 z-40 overflow-hidden bg-[#03070f]"
      style={{ animation: phase === "in" ? "fade-in .4s ease" : undefined }}
      aria-label="EV interface"
    >
      {/* ambient depth */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-1/2 h-[78vmin] w-[78vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.12),transparent_62%)] blur-3xl" />
        <ScanBeam />
        <AmbientDust />
      </div>

      {/* minimal top marker */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center pt-5">
        <div className="flex items-center gap-2 opacity-80">
          <span className={cn("h-1.5 w-1.5 rounded-full", error ? "bg-warning" : "bg-accent animate-hud-pulse")} />
          <span className="hud-display text-sm tracking-[0.55em] text-foreground/85">EV</span>
        </div>
      </div>

      {/* ===== CENTRAL HOLOGRAM ===== */}
      <div className="absolute inset-0 z-0 flex items-center justify-center" style={{ animation: wrapAnim }}>
        <div
          className={cn("relative", error && "animate-[ev-glitch_0.5s_steps(2)_infinite]")}
          style={{ animation: !error ? "ev-breathe 6s ease-in-out infinite" : undefined }}
        >
          <EvCore
            listening={listening} thinking={thinking} generating={generating}
            executing={executing} waiting={waiting} success={success} error={error}
            level={level}
          />
        </div>
      </div>

      {/* subtle light trails hologram → panels */}
      <TrailLines />

      {/* ===== SPEC 1 — EV ACTIVITY (bottom-left) ===== */}
      <div className="absolute bottom-6 left-4 z-20 md:bottom-10 md:left-10" style={{ animation: "ev-panel-in .6s ease .3s both" }}>
        <GlassPanel title="EV ACTIVITY">
          <div className="flex items-center gap-2">
            <StateDot state={state} />
            <span className="text-sm text-foreground/90">{props.activity || "Idle"}</span>
          </div>
        </GlassPanel>
      </div>

      {/* ===== SPEC 2 — COMMAND (bottom-right) ===== */}
      <div className="absolute bottom-6 right-4 z-20 text-right md:bottom-10 md:right-10" style={{ animation: "ev-panel-in .6s ease .45s both" }}>
        <GlassPanel title="COMMAND" align="right">
          <span className={cn("text-sm", props.command ? "text-foreground/90" : "text-muted-foreground")}>
            {props.command ? `“${props.command}”` : "Awaiting command…"}
          </span>
        </GlassPanel>
      </div>

      {/* minimal voice-first control (no chat box) */}
      <form
        onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}
        className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/15 bg-white/[0.03] px-2 py-1.5 backdrop-blur-xl"
        style={{ boxShadow: "0 8px 40px -14px hsl(var(--accent)/0.5)" }}
      >
        <button
          type="button" onClick={props.onMic}
          title={props.voiceStarted ? (props.muted ? "Unmute" : "Mute") : "Enable voice"}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full border transition",
            props.voiceStarted && !props.muted
              ? "border-accent bg-accent/15 text-accent animate-hud-pulse"
              : "border-border text-muted-foreground hover:border-accent/50",
          )}
        >
          {props.voiceStarted && props.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <input
          value={props.input}
          onChange={(e) => props.onInput(e.target.value)}
          placeholder={listening ? "Listening…" : "Speak to EV"}
          className="w-40 min-w-0 bg-transparent text-sm text-foreground/90 outline-none placeholder:text-muted-foreground/70 focus:w-56 md:w-48 md:focus:w-72"
          style={{ transition: "width 200ms ease" }}
        />
        {props.input.trim() && (
          <button type="submit" className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent transition hover:bg-accent/25">
            <Send className="h-4 w-4" />
          </button>
        )}
        {props.voiceStarted && (
          <button type="button" onClick={props.onSleep} title="Sleep" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-accent">
            <Power className="h-4 w-4" />
          </button>
        )}
      </form>
    </div>
  );
}

/* ---------------- central holographic neural core ---------------- */

function EvCore(props: {
  listening: boolean; thinking: boolean; generating: boolean; executing: boolean;
  waiting: boolean; success: boolean; error: boolean; level: number;
}) {
  const { listening, thinking, generating, executing, waiting, success, error, level } = props;
  const A = "hsl(var(--accent))";
  const AB = "hsl(var(--accent-bright))";
  const active = listening || thinking || generating || executing;

  // Outer ring expands slightly while listening; core brightens while generating.
  const outerScale = listening ? 1.06 + level * 0.12 : 1;
  const coreGlow = generating || success ? 1 : waiting ? 0.85 : 0.7;

  // Orbital particles (abstract AI presence — light + energy, never a face).
  const particles = useMemo(
    () => Array.from({ length: 22 }, (_, i) => ({
      a: (360 / 22) * i,
      r: 96 + (i % 5) * 26,
      d: 10 + (i % 6) * 3,
      s: 1.4 + (i % 4) * 0.7,
    })),
    [],
  );

  return (
    <div className="relative h-[62vmin] w-[62vmin] max-h-[560px] max-w-[560px]">
      {/* volumetric glow */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, hsl(var(--accent-bright)/${0.16 * coreGlow}), transparent 60%)`,
          filter: "blur(28px)",
        }}
      />

      {/* rotating concentric rings (different speeds while thinking) */}
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" style={{ transform: `scale(${outerScale})`, transition: "transform 200ms ease" }}>
        <defs>
          <radialGradient id="ev-core-g" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={AB} stopOpacity={0.95 * coreGlow} />
            <stop offset="55%" stopColor={A} stopOpacity="0.16" />
            <stop offset="100%" stopColor={A} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* thin concentric rings */}
        {[196, 168, 140, 112].map((r, i) => (
          <circle
            key={r} cx="200" cy="200" r={r} fill="none" stroke={A}
            strokeOpacity={0.14 + (i === 0 ? (listening ? 0.35 : 0.1) : 0.06)}
            strokeWidth={i === 0 ? 1.4 : 1}
            style={{
              transformOrigin: "200px 200px",
              animation: `edith-spin ${(thinking ? 14 : 30) + i * (thinking ? 5 : 8)}s linear infinite ${i % 2 ? "reverse" : ""}`,
            }}
          />
        ))}

        {/* dashed energy ring — flows while generating/executing */}
        <circle
          cx="200" cy="200" r="182" fill="none" stroke={AB} strokeOpacity={generating || executing ? 0.7 : 0.3}
          strokeWidth="1.2" strokeDasharray="6 12"
          style={{ transformOrigin: "200px 200px", animation: `edith-spin ${executing ? 6 : 18}s linear infinite` }}
        />

        {/* rotating segments (arc brackets) */}
        {[0, 90, 180, 270].map((deg) => (
          <path
            key={deg} d="M200 36 A164 164 0 0 1 316 84" fill="none" stroke={AB}
            strokeOpacity={active ? 0.5 : 0.22} strokeWidth="2" strokeLinecap="round"
            transform={`rotate(${deg} 200 200)`}
            style={{ transformOrigin: "200px 200px", animation: `edith-spin ${thinking ? 10 : 22}s linear infinite` }}
          />
        ))}

        {/* neural network web (static abstract geometry) */}
        <g stroke={A} strokeOpacity={thinking || generating ? 0.32 : 0.16} strokeWidth="0.6" fill="none">
          <path d="M120 150 L200 120 L286 156 L262 244 L176 276 L118 232 Z" />
          <path d="M200 120 L176 276 M120 150 L262 244 M286 156 L118 232" />
        </g>
        {/* neural nodes */}
        <g fill={AB} style={{ filter: `drop-shadow(0 0 4px ${AB})` }}>
          {[[120,150],[200,120],[286,156],[262,244],[176,276],[118,232]].map(([x,y],i)=>(
            <circle key={i} cx={x} cy={y} r={thinking ? 3 : 2}
              className={thinking || generating ? "animate-hud-pulse" : ""}
              style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </g>

        {/* inner core */}
        <circle cx="200" cy="200" r="72" fill="url(#ev-core-g)" style={{ animation: "ev-core-pulse 3.4s ease-in-out infinite" }} />
        <circle
          cx="200" cy="200" r={22 + level * 40 * (listening ? 1 : generating ? 0.6 : 0.2)}
          fill={AB} style={{ filter: `drop-shadow(0 0 14px ${AB})`, transition: "r 90ms linear", opacity: coreGlow }}
          className={waiting ? "animate-hud-pulse" : ""}
        />

        {/* success ripple */}
        {success && (
          <circle cx="200" cy="200" r="90" fill="none" stroke={AB} strokeOpacity="0.7" strokeWidth="2"
            style={{ transformOrigin: "200px 200px", animation: "hud-glow-pulse 1s ease-out" }} />
        )}
      </svg>

      {/* orbital particles — pulled inward while listening */}
      <div className="absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-1/2 h-0 w-0">
          {particles.map((p, i) => (
            <span
              key={i}
              className="absolute block rounded-full"
              style={{
                width: 3, height: 3,
                background: i % 3 === 0 ? AB : A,
                boxShadow: `0 0 6px ${i % 3 === 0 ? AB : A}`,
                // @ts-expect-error CSS custom props
                "--a": `${p.a}deg`,
                "--r": `${listening ? p.r * 0.7 : p.r}px`,
                animation: `ev-orbit ${p.d * (executing ? 0.5 : 1)}s linear infinite`,
                opacity: active ? 0.95 : 0.55,
                transition: "opacity 300ms ease",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- supporting UI ---------------- */

function GlassPanel({ title, children, align = "left" }: { title: string; children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <div
      className={cn(
        "min-w-[180px] max-w-[260px] rounded-xl border border-accent/15 bg-white/[0.03] px-4 py-3 backdrop-blur-xl",
        align === "right" && "text-right",
      )}
      style={{ boxShadow: "0 8px 40px -16px hsl(var(--accent)/0.5), inset 0 1px 0 hsl(0 0% 100% / 0.05)" }}
    >
      <div className="hud-label text-[10px] tracking-[0.28em] text-accent/70">{title}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

const STATE_COLOR: Record<EvState, string> = {
  IDLE: "hsl(var(--muted-foreground))",
  LISTENING: "hsl(var(--accent))",
  THINKING: "hsl(var(--accent-bright))",
  GENERATING: "hsl(var(--accent-bright))",
  WAITING_FOR_APPROVAL: "hsl(var(--warning))",
  EXECUTING: "hsl(var(--accent))",
  SUCCESS: "hsl(var(--success))",
  ERROR: "hsl(var(--warning))",
};

function StateDot({ state }: { state: EvState }) {
  const pulse = state !== "IDLE";
  return (
    <span
      className={cn("h-2 w-2 shrink-0 rounded-full", pulse && "animate-hud-pulse")}
      style={{ background: STATE_COLOR[state], boxShadow: `0 0 8px ${STATE_COLOR[state]}` }}
    />
  );
}

/** Subtle animated light trails linking the hologram to the two panels. */
function TrailLines() {
  return (
    <svg className="pointer-events-none absolute inset-0 z-10 hidden h-full w-full md:block" aria-hidden>
      <line x1="42%" y1="52%" x2="14%" y2="88%" stroke="hsl(var(--accent))" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="4 8" style={{ animation: "ev-trail 6s linear infinite" }} />
      <line x1="58%" y1="52%" x2="86%" y2="88%" stroke="hsl(var(--accent))" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="4 8" style={{ animation: "ev-trail 6s linear infinite reverse" }} />
    </svg>
  );
}

function ScanBeam() {
  return (
    <div
      className="absolute left-1/2 top-1/2 h-[90vmin] w-[90vmin] -translate-x-1/2 -translate-y-1/2"
      style={{
        background: "conic-gradient(from 0deg, transparent 0deg, hsl(var(--accent)/0.06) 30deg, transparent 60deg)",
        borderRadius: "50%",
        animation: "ev-scan 12s linear infinite",
      }}
    />
  );
}

function AmbientDust() {
  const dots = useMemo(
    () => Array.from({ length: 26 }, () => ({
      x: Math.random() * 100, y: Math.random() * 100,
      d: 6 + Math.random() * 10, delay: Math.random() * 6, s: 1 + Math.random() * 2,
    })),
    [],
  );
  return (
    <div className="absolute inset-0">
      {dots.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-accent/40"
          style={{
            left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s,
            animation: `drift ${p.d}s ease-in-out ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
