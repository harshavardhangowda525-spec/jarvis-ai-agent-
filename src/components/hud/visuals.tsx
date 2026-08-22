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

/** Geometric robot/helmet face with glowing eyes for the sidebar header. */
export function RobotFace({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={cn("drop-glow", className)} aria-hidden>
      {/* wireframe facets */}
      <g fill="none" stroke={A} strokeWidth="1.2" strokeLinejoin="round" opacity="0.9">
        <path d="M35 16 L85 16 L98 34 L98 74 L78 98 L42 98 L22 74 L22 34 Z" opacity="0.4" />
        <path d="M40 28 L80 28 L90 42 L90 70 L72 90 L48 90 L30 70 L30 42 Z" />
        <path d="M40 28 L60 40 L80 28 M30 42 L60 40 L90 42 M48 90 L60 74 L72 90 M60 40 L60 74" opacity="0.35" />
        {/* antenna */}
        <line x1="60" y1="6" x2="60" y2="16" opacity="0.6" />
      </g>
      <circle cx="60" cy="4" r="2.5" fill={AB} stroke="none" className="animate-hud-pulse" />
      {/* glowing eyes */}
      <g style={{ filter: `drop-shadow(0 0 6px ${AB})` }} className="animate-glow-pulse">
        <path d="M38 56 L54 54 L50 66 L36 66 Z" fill={AB} />
        <path d="M82 56 L66 54 L70 66 L84 66 Z" fill={AB} />
      </g>
      {/* mouth grille */}
      <g stroke={A} strokeWidth="1.2" opacity="0.7">
        <line x1="50" y1="78" x2="70" y2="78" />
        <line x1="53" y1="82" x2="67" y2="82" opacity="0.6" />
        <line x1="56" y1="86" x2="64" y2="86" opacity="0.4" />
      </g>
    </svg>
  );
}

/**
 * Holographic humanoid bust — the glowing "assistant presence" from the JARVIS
 * mockup. Front-facing head + shoulders + torso, translucent cyan body fill,
 * contour + horizontal scan lines, glowing eyes, and a projector base.
 */
export function HumanFigure({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 180" className={cn("h-full w-full drop-glow animate-hud-float", className)}
      preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        <radialGradient id="humanBody" cx="50%" cy="30%" r="80%">
          <stop offset="0%" stopColor={`rgba(120,190,255,0.34)`} />
          <stop offset="55%" stopColor={`rgba(120,190,255,0.14)`} />
          <stop offset="100%" stopColor={`rgba(120,190,255,0.03)`} />
        </radialGradient>
        <linearGradient id="humanBeam" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="hsl(var(--accent) / 0.28)" />
          <stop offset="100%" stopColor="hsl(var(--accent) / 0)" />
        </linearGradient>
        <clipPath id="humanClip">
          {/* head + neck + shoulders bust (union of shapes) */}
          <ellipse cx="70" cy="42" rx="20" ry="23" />
          <rect x="60" y="58" width="20" height="22" rx="6" />
          <path d="M20 150 C20 106 42 82 70 82 C98 82 120 106 120 150 Z" />
        </clipPath>
      </defs>

      {/* upward hologram beam */}
      <polygon points="44,150 96,150 110,178 30,178" fill="url(#humanBeam)" opacity="0.55" />

      {/* translucent body fill + holographic scan lines */}
      <g clipPath="url(#humanClip)">
        <rect x="0" y="0" width="140" height="152" fill="url(#humanBody)" />
        {Array.from({ length: 14 }).map((_, i) => (
          <line key={i} x1="0" x2="140" y1={22 + i * 9} y2={22 + i * 9}
            stroke={A} strokeWidth="0.6" opacity="0.18" />
        ))}
      </g>

      {/* glowing outlines: head, neck, shoulders */}
      <g fill="none" stroke={A} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 3px ${A})` }}>
        <ellipse cx="70" cy="42" rx="20" ry="23" />
        <path d="M62 62 L61 80 M78 62 L79 80" opacity="0.75" />
        {/* shoulders (fade at the bottom, no baseline) */}
        <path d="M20 150 C20 106 42 82 70 82 C98 82 120 106 120 150" />
      </g>

      {/* contour detail (thin) */}
      <g fill="none" stroke={AB} strokeWidth="0.9" strokeLinecap="round" opacity="0.5">
        <path d="M50 94 Q70 102 90 94" />                 {/* collar */}
        <path d="M50 94 Q56 110 58 126 M90 94 Q84 110 82 126" /> {/* chest */}
        <line x1="70" y1="84" x2="70" y2="150" opacity="0.4" /> {/* center */}
        <path d="M60 118 Q70 122 80 118 M61 132 Q70 136 79 132" opacity="0.5" /> {/* torso */}
        <path d="M30 100 Q25 126 34 148 M110 100 Q115 126 106 148" opacity="0.5" /> {/* arms */}
      </g>

      {/* face */}
      <g fill="none" stroke={A} strokeWidth="1" opacity="0.6">
        <path d="M58 38 Q62 35 67 37 M73 37 Q78 35 82 38" /> {/* brows */}
        <path d="M70 43 L70 49 M65 52 Q70 55 75 52" />        {/* nose + mouth */}
      </g>
      {/* glowing eyes */}
      <g style={{ filter: `drop-shadow(0 0 6px ${AB})` }} className="animate-glow-pulse">
        <ellipse cx="62" cy="42" rx="3.4" ry="2.4" fill={AB} />
        <ellipse cx="78" cy="42" rx="3.4" ry="2.4" fill={AB} />
      </g>

      {/* projector base */}
      <ellipse cx="70" cy="152" rx="54" ry="11" fill="none" stroke={AB} strokeWidth="1.6" opacity="0.75" className="animate-glow-pulse" />
      <ellipse cx="70" cy="157" rx="40" ry="8" fill="none" stroke={A} strokeWidth="1" opacity="0.45" />
      <ellipse cx="70" cy="161" rx="26" ry="5" fill="none" stroke={A} strokeWidth="1" opacity="0.3" />

      {/* floating particles */}
      <g fill={AB}>
        <circle cx="30" cy="74" r="1.4" opacity="0.7" className="animate-hud-pulse" />
        <circle cx="112" cy="90" r="1.4" opacity="0.6" className="animate-glow-pulse" />
        <circle cx="26" cy="118" r="1.2" opacity="0.5" className="animate-hud-pulse" />
        <circle cx="116" cy="126" r="1.2" opacity="0.6" className="animate-glow-pulse" />
      </g>
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
