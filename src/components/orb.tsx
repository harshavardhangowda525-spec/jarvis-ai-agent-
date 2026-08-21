"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

export type OrbState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "executing"
  | "error"
  | "offline";

const STATE_COLORS: Record<OrbState, { core: string; glow: string; label: string }> = {
  idle: { core: "#38e8ff", glow: "56,232,255", label: "Idle" },
  listening: { core: "#3dd68c", glow: "61,214,140", label: "Listening" },
  thinking: { core: "#a78bfa", glow: "167,139,250", label: "Thinking" },
  speaking: { core: "#38bdf8", glow: "56,189,248", label: "Speaking" },
  executing: { core: "#fbbf24", glow: "251,191,36", label: "Executing" },
  error: { core: "#f87171", glow: "248,113,113", label: "Error" },
  offline: { core: "#64748b", glow: "100,116,139", label: "Offline" },
};

interface OrbProps {
  state: OrbState;
  /** Live audio amplitude 0..1 (mic when listening, output when speaking). */
  level?: number;
  size?: number;
  className?: string;
}

export function Orb({ state, level = 0, size = 220, className }: OrbProps) {
  const c = STATE_COLORS[state];
  const active = state === "listening" || state === "speaking";
  const amp = active ? Math.min(1, Math.max(0, level)) : 0;

  // Visualizer bars arranged radially; heights react to amplitude + a per-bar
  // phase so the ring feels alive rather than uniform.
  const bars = useMemo(() => Array.from({ length: 40 }, (_, i) => i), []);
  const coreScale = 1 + amp * 0.18;

  return (
    <div
      className={cn("relative select-none", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`JARVIS is ${c.label.toLowerCase()}`}
    >
      {/* Outer pulsing rings */}
      {state !== "offline" && (
        <>
          <span
            className="absolute inset-0 rounded-full animate-pulse-ring"
            style={{ background: `radial-gradient(circle, rgba(${c.glow},0.35), transparent 70%)` }}
          />
          <span
            className="absolute inset-0 rounded-full animate-pulse-ring [animation-delay:1.2s]"
            style={{ background: `radial-gradient(circle, rgba(${c.glow},0.25), transparent 70%)` }}
          />
        </>
      )}

      {/* Rotating gradient halo */}
      <div
        className={cn(
          "absolute inset-[8%] rounded-full",
          state !== "offline" && "animate-spin-slow",
        )}
        style={{
          background: `conic-gradient(from 0deg, transparent, rgba(${c.glow},0.55), transparent 55%)`,
          filter: "blur(6px)",
          opacity: state === "thinking" || state === "executing" ? 0.9 : 0.55,
        }}
      />

      {/* Radial audio visualizer */}
      <svg
        viewBox="-110 -110 220 220"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        {bars.map((i) => {
          const angle = (i / bars.length) * Math.PI * 2;
          const wobble = active
            ? 0.5 + 0.5 * Math.sin(i * 1.7 + amp * 12) * amp + amp * 0.6
            : 0.12 + 0.05 * Math.sin(i * 1.3);
          const inner = 74;
          const len = 6 + wobble * 26;
          const x1 = Math.cos(angle) * inner;
          const y1 = Math.sin(angle) * inner;
          const x2 = Math.cos(angle) * (inner + len);
          const y2 = Math.sin(angle) * (inner + len);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={c.core}
              strokeWidth={2.4}
              strokeLinecap="round"
              opacity={active ? 0.85 : 0.35}
              style={{ transition: "all 90ms linear" }}
            />
          );
        })}
      </svg>

      {/* Core sphere */}
      <div
        className={cn(
          "absolute left-1/2 top-1/2 rounded-full glow-ring animate-orb-float",
          "flex items-center justify-center",
        )}
        style={{
          width: size * 0.5,
          height: size * 0.5,
          transform: `translate(-50%, -50%) scale(${coreScale})`,
          transition: "transform 90ms ease-out",
          background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.85), ${c.core} 42%, rgba(${c.glow},0.25) 75%, transparent)`,
          boxShadow: `0 0 60px -6px rgba(${c.glow},0.75), inset 0 0 40px -10px rgba(255,255,255,0.6)`,
        }}
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full bg-white/90",
            state === "thinking" && "animate-ping",
          )}
        />
      </div>
    </div>
  );
}

export function orbStateLabel(state: OrbState): string {
  return STATE_COLORS[state].label;
}
