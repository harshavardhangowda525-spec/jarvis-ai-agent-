"use client";

import { cn } from "@/lib/utils";

/**
 * Decorative HUD holograms — pure SVG/CSS, GPU-friendly, theme-aware (they use
 * the --accent / --cyan tokens). These are ambient chrome only; every data
 * value on the dashboard comes from a real source.
 */

const A = "hsl(var(--accent))";
const AB = "hsl(var(--accent-bright))";

/** The JARVIS reactor mark — concentric rings around a downward triangle. */
export function ReactorLogo({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={cn("drop-glow", className)} aria-hidden>
      <circle cx="50" cy="50" r="46" fill="none" stroke={A} strokeWidth="1.5" opacity="0.35" />
      <g className="animate-hud-spin" style={{ transformOrigin: "center" }}>
        <circle cx="50" cy="50" r="46" fill="none" stroke={AB} strokeWidth="2"
          strokeDasharray="40 250" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="50" r="37" fill="none" stroke={A} strokeWidth="1" opacity="0.4" />
      <g className="animate-hud-spin-rev" style={{ transformOrigin: "center" }}>
        <circle cx="50" cy="50" r="30" fill="none" stroke={A} strokeWidth="1.5"
          strokeDasharray="12 30" opacity="0.7" />
      </g>
      <polygon points="50,30 68,62 32,62" fill="none" stroke={AB} strokeWidth="2.5"
        strokeLinejoin="round" className="animate-glow-pulse" />
      <polygon points="50,40 60,58 40,58" fill={A} opacity="0.85" />
    </svg>
  );
}

/** Geometric robot/helmet face for the sidebar header. */
export function RobotFace({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={cn("drop-glow", className)} aria-hidden>
      <g fill="none" stroke={A} strokeWidth="1.4" strokeLinejoin="round">
        <path d="M35 18 L85 18 L96 34 L96 74 L78 96 L42 96 L24 74 L24 34 Z" opacity="0.5" />
        <path d="M40 30 L80 30 L88 42 L88 70 L72 88 L48 88 L32 70 L32 42 Z" opacity="0.85" />
        <line x1="60" y1="8" x2="60" y2="18" opacity="0.6" />
        <circle cx="60" cy="6" r="2.5" fill={AB} stroke="none" className="animate-hud-pulse" />
        <path d="M40 58 L52 58 L48 66 L36 66 Z" fill={AB} stroke="none" className="animate-glow-pulse" />
        <path d="M80 58 L68 58 L72 66 L84 66 Z" fill={AB} stroke="none" className="animate-glow-pulse" />
        <line x1="50" y1="78" x2="70" y2="78" opacity="0.7" />
        <line x1="53" y1="82" x2="67" y2="82" opacity="0.5" />
      </g>
    </svg>
  );
}

/** Wireframe humanoid bust — the "assistant presence" in the greeting panel. */
export function HumanFigure({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 150" className={cn("h-full w-full drop-glow animate-hud-float", className)}
      preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g fill="none" stroke={A} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round">
        <ellipse cx="60" cy="34" rx="18" ry="21" opacity="0.9" />
        <path d="M46 30 Q60 24 74 30" opacity="0.5" />
        <circle cx="52" cy="34" r="2.5" fill={AB} stroke="none" className="animate-hud-pulse" />
        <circle cx="68" cy="34" r="2.5" fill={AB} stroke="none" className="animate-hud-pulse" />
        <line x1="60" y1="55" x2="60" y2="62" opacity="0.6" />
        <path d="M30 96 Q30 66 60 64 Q90 66 90 96" opacity="0.9" />
        <path d="M38 90 Q60 80 82 90" opacity="0.4" />
        <line x1="60" y1="66" x2="60" y2="92" opacity="0.4" />
        <path d="M30 96 L24 120 M90 96 L96 120" opacity="0.6" />
      </g>
      {/* base ring */}
      <ellipse cx="60" cy="132" rx="46" ry="9" fill="none" stroke={AB} strokeWidth="1.5" opacity="0.7" className="animate-glow-pulse" />
      <ellipse cx="60" cy="132" rx="30" ry="6" fill="none" stroke={A} strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

/** Isometric wireframe core cube (AI CORE panel). */
export function CoreCube({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      <svg viewBox="0 0 160 160" className="h-40 w-40" aria-hidden>
        {/* base platform rings */}
        <ellipse cx="80" cy="128" rx="58" ry="16" fill="none" stroke={A} strokeWidth="1" opacity="0.35" />
        <ellipse cx="80" cy="128" rx="40" ry="11" fill="none" stroke={AB} strokeWidth="1.2" opacity="0.6" className="animate-glow-pulse" />
        <g className="animate-hud-float" style={{ transformOrigin: "center" }}>
          {/* cube */}
          <g fill="none" stroke={A} strokeWidth="1.6" strokeLinejoin="round">
            <polygon points="80,34 116,54 116,96 80,116 44,96 44,54" opacity="0.35" />
            <polygon points="80,34 116,54 80,74 44,54" stroke={AB} opacity="0.9" />
            <polygon points="44,54 80,74 80,116 44,96" opacity="0.8" />
            <polygon points="116,54 80,74 80,116 116,96" opacity="0.8" />
          </g>
          {/* glowing core */}
          <circle cx="80" cy="75" r="9" fill={AB} className="animate-glow-pulse" />
          <circle cx="80" cy="75" r="16" fill="none" stroke={AB} strokeWidth="1" opacity="0.5" />
        </g>
        {/* data streams */}
        <g stroke={A} strokeWidth="1" opacity="0.4" className="animate-hud-pulse">
          <line x1="80" y1="116" x2="80" y2="146" />
          <line x1="44" y1="96" x2="30" y2="138" />
          <line x1="116" y1="96" x2="130" y2="138" />
        </g>
      </svg>
    </div>
  );
}

/** Wireframe globe with orbiting rings (NETWORK STATUS). */
export function NetGlobe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 140" className={cn("drop-glow", className)} aria-hidden>
      <defs>
        <clipPath id="globeClip"><circle cx="70" cy="70" r="42" /></clipPath>
      </defs>
      <circle cx="70" cy="70" r="42" fill="hsl(var(--accent) / 0.05)" stroke={A} strokeWidth="1.2" opacity="0.7" />
      <g clipPath="url(#globeClip)" stroke={A} strokeWidth="1" fill="none" opacity="0.55">
        <ellipse cx="70" cy="70" rx="42" ry="14" />
        <ellipse cx="70" cy="70" rx="42" ry="28" />
        <ellipse cx="70" cy="70" rx="14" ry="42" />
        <ellipse cx="70" cy="70" rx="28" ry="42" />
        <line x1="28" y1="70" x2="112" y2="70" />
        <line x1="70" y1="28" x2="70" y2="112" />
      </g>
      {/* pulsing nodes */}
      <circle cx="52" cy="54" r="2" fill={AB} className="animate-hud-pulse" />
      <circle cx="92" cy="82" r="2" fill={AB} className="animate-glow-pulse" />
      <circle cx="70" cy="44" r="1.6" fill={AB} className="animate-hud-pulse" />
      {/* orbit */}
      <g className="animate-hud-spin-slow" style={{ transformOrigin: "center" }}>
        <ellipse cx="70" cy="70" rx="58" ry="20" fill="none" stroke={AB} strokeWidth="1" opacity="0.5"
          transform="rotate(28 70 70)" />
        <circle cx="128" cy="70" r="2.5" fill={AB} transform="rotate(28 70 70)" />
      </g>
    </svg>
  );
}

/** Animated equalizer bars, optionally driven by a live 0..1 audio level. */
export function Waveform({
  bars = 40,
  level = 0,
  active = false,
  className,
}: { bars?: number; level?: number; active?: boolean; className?: string }) {
  return (
    <div className={cn("flex h-full items-center justify-center gap-[3px]", className)} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const base = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.7));
        const h = active ? Math.max(0.12, Math.min(1, base * (0.4 + level * 2.2))) : base * 0.5;
        return (
          <span
            key={i}
            className={cn("w-[3px] rounded-full", active ? "animate-hud-pulse" : "")}
            style={{
              height: `${h * 100}%`,
              background: `linear-gradient(to top, ${A}, ${AB})`,
              opacity: active ? 0.9 : 0.4,
              animationDelay: `${(i % 8) * 0.09}s`,
              transition: "height 90ms linear",
            }}
          />
        );
      })}
    </div>
  );
}

/** Flowing ">>" chevrons around a status label. */
export function Chevrons({ dir = "right", className }: { dir?: "left" | "right"; className?: string }) {
  return (
    <span className={cn("chev inline-flex", dir === "left" && "rotate-180", className)} aria-hidden>
      <span className="text-accent">›</span>
      <span className="text-accent">›</span>
      <span className="text-accent-bright">›</span>
    </span>
  );
}
