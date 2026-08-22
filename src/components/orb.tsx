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

const STATE: Record<OrbState, { color: string; label: string }> = {
  idle: { color: "148,188,227", label: "Idle" },
  listening: { color: "61,214,140", label: "Listening" },
  thinking: { color: "167,139,250", label: "Thinking" },
  speaking: { color: "120,190,255", label: "Speaking" },
  executing: { color: "251,191,36", label: "Executing" },
  error: { color: "248,113,113", label: "Error" },
  offline: { color: "120,132,150", label: "Offline" },
};

interface OrbProps {
  state: OrbState;
  level?: number;
  size?: number;
  /** Show the JARVIS wordmark in the center (the mission-control core). */
  showLabel?: boolean;
  className?: string;
}

/**
 * The JARVIS Core — a concentric-ring HUD reticle. Rotating arcs, a radial tick
 * dial that reacts to live audio level, and cardinal crosshairs. Pure SVG/CSS,
 * GPU-friendly.
 */
export function Orb({ state, level = 0, size = 320, showLabel = false, className }: OrbProps) {
  const c = STATE[state].color;
  const active = state === "listening" || state === "speaking";
  const amp = active ? Math.min(1, Math.max(0, level)) : 0;
  const spinning = state !== "offline";

  const ticks = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);
  const markers = useMemo(() => [45, 135, 225, 315], []);

  return (
    <div
      className={cn("relative select-none", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`JARVIS core — ${STATE[state].label.toLowerCase()}`}
    >
      <svg viewBox="-160 -160 320 320" className="absolute inset-0 h-full w-full">
        {/* cardinal crosshairs */}
        {[0, 90, 180, 270].map((deg) => (
          <g key={deg} transform={`rotate(${deg})`} opacity={0.7}>
            <line x1="0" y1="-158" x2="0" y2="-146" stroke={`rgb(${c})`} strokeWidth="1.5" />
          </g>
        ))}

        {/* outer ring + rotating bright arc */}
        <circle cx="0" cy="0" r="150" fill="none" stroke={`rgba(${c},0.18)`} strokeWidth="1" />
        <g className={spinning ? "animate-hud-spin" : undefined} style={{ transformOrigin: "center" }}>
          <circle
            cx="0" cy="0" r="150" fill="none" stroke={`rgb(${c})`} strokeWidth="2"
            strokeDasharray="140 802" strokeLinecap="round" opacity={0.9}
          />
          <circle cx="0" cy="-150" r="2.5" fill={`rgb(${c})`} />
        </g>

        {/* radial tick dial (reacts to audio level) */}
        <g>
          {ticks.map((i) => {
            const a = (i / ticks.length) * Math.PI * 2;
            const major = i % 5 === 0;
            const react = active ? amp * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.3 + amp * 10))) : 0;
            const inner = 108;
            const len = (major ? 10 : 5) + react * 16;
            return (
              <line
                key={i}
                x1={Math.cos(a) * inner}
                y1={Math.sin(a) * inner}
                x2={Math.cos(a) * (inner + len)}
                y2={Math.sin(a) * (inner + len)}
                stroke={`rgb(${c})`}
                strokeWidth={major ? 1.6 : 1}
                opacity={active ? 0.5 + react * 0.5 : major ? 0.5 : 0.25}
                style={{ transition: "all 90ms linear" }}
              />
            );
          })}
        </g>

        {/* middle ring + reverse arc */}
        <circle cx="0" cy="0" r="95" fill="none" stroke={`rgba(${c},0.16)`} strokeWidth="1" />
        <g className={spinning ? "animate-hud-spin-rev" : undefined} style={{ transformOrigin: "center" }}>
          <circle
            cx="0" cy="0" r="95" fill="none" stroke={`rgb(${c})`} strokeWidth="2"
            strokeDasharray="60 537" strokeLinecap="round" opacity={0.85}
          />
        </g>

        {/* inner ring + diagonal square markers */}
        <circle cx="0" cy="0" r="66" fill="none" stroke={`rgba(${c},0.3)`} strokeWidth="1" />
        {markers.map((deg) => {
          const a = (deg * Math.PI) / 180;
          return (
            <rect
              key={deg}
              x={Math.cos(a) * 66 - 2.5}
              y={Math.sin(a) * 66 - 2.5}
              width="5" height="5"
              fill={`rgb(${c})`}
              opacity={0.8}
            />
          );
        })}

        {/* core glow */}
        <circle
          cx="0" cy="0" r={54}
          fill={`rgba(${c},${0.06 + amp * 0.12})`}
          stroke={`rgba(${c},0.35)`}
          strokeWidth="1"
          style={{ transition: "all 120ms ease-out" }}
        />
        <circle
          cx="0" cy="0" r={18 + amp * 10}
          fill={`rgba(${c},0.22)`}
          className={state === "thinking" ? "animate-hud-pulse" : undefined}
          style={{ transition: "r 120ms ease-out" }}
        />
      </svg>

      {/* center label */}
      {showLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="hud-display text-2xl"
            style={{ color: `rgb(${c})`, textShadow: `0 0 18px rgba(${c},0.6)` }}
          >
            JARVIS
          </span>
          <div className="mt-2 flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1 w-1 rounded-full animate-hud-pulse"
                style={{ background: `rgb(${c})`, animationDelay: `${i * 0.25}s` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function orbStateLabel(state: OrbState): string {
  return STATE[state].label;
}
