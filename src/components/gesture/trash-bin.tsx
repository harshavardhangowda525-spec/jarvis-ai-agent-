"use client";

import { forwardRef } from "react";
import type { BinState } from "@/lib/gesture/grab-throw";

/**
 * A small holographic trash bin that floats in a corner of the JARVIS browser.
 * Purely visual (pointer-events: none) — its state comes from the grab-and-throw
 * controller: idle → approaching (glows) → ready (lid opens, grows) →
 * receiving (swallows the object) → success (dust burst) → idle.
 * Position it with `className`/`style`; the controller reads its box for the hitbox.
 */
export const TrashBin = forwardRef<HTMLDivElement, { state: BinState; className?: string; style?: React.CSSProperties; title?: string }>(
  function TrashBin({ state, className = "", style, title }, ref) {
    return (
      <div ref={ref} data-state={state} data-testid="trash-bin" data-gesture-ui aria-hidden title={title}
        className={`jv-bin pointer-events-none select-none ${className}`} style={style}>
        <div className="jv-bin-float">
          <svg viewBox="0 0 64 76" className="jv-bin-svg" fill="none">
            <defs>
              <linearGradient id="jvBinBody" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="rgba(165,243,252,0.34)" />
                <stop offset="1" stopColor="rgba(56,189,248,0.06)" />
              </linearGradient>
              <radialGradient id="jvBinBase" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="rgba(103,232,249,0.75)" />
                <stop offset="1" stopColor="rgba(103,232,249,0)" />
              </radialGradient>
              <clipPath id="jvBinClip"><path d="M15 27 H49 L45.2 63 Q44.8 66 41.8 66 H22.2 Q19.2 66 18.8 63 Z" /></clipPath>
            </defs>
            {/* projector glow under the hologram */}
            <ellipse className="jv-bin-base" cx="32" cy="71" rx="21" ry="4" fill="url(#jvBinBase)" />
            {/* body */}
            <path className="jv-bin-body" d="M15 27 H49 L45.2 63 Q44.8 66 41.8 66 H22.2 Q19.2 66 18.8 63 Z" fill="url(#jvBinBody)" stroke="rgba(165,243,252,0.9)" strokeWidth="1.3" />
            <g clipPath="url(#jvBinClip)">
              <g className="jv-bin-scan">
                {Array.from({ length: 14 }, (_, i) => <line key={i} x1="10" x2="54" y1={20 + i * 4} y2={20 + i * 4} stroke="rgba(186,245,255,0.16)" strokeWidth="0.8" />)}
              </g>
              <path className="jv-bin-mouth" d="M15 27 H49" stroke="rgba(236,254,255,0.9)" strokeWidth="2" />
            </g>
            <g stroke="rgba(186,245,255,0.55)" strokeWidth="1.1" strokeLinecap="round">
              <line x1="25" y1="33" x2="26.2" y2="59" />
              <line x1="32" y1="33" x2="32" y2="59" />
              <line x1="39" y1="33" x2="37.8" y2="59" />
            </g>
            {/* lid (hinged on the right) */}
            <g className="jv-bin-lid">
              <rect x="11.5" y="20" width="41" height="5.2" rx="2.4" fill="rgba(165,243,252,0.22)" stroke="rgba(207,250,254,0.95)" strokeWidth="1.2" />
              <path d="M26 20 V16.6 Q26 15 27.6 15 H36.4 Q38 15 38 16.6 V20" stroke="rgba(207,250,254,0.9)" strokeWidth="1.2" />
            </g>
            {/* success ring */}
            <circle className="jv-bin-ring" cx="32" cy="44" r="22" stroke="rgba(165,243,252,0.9)" strokeWidth="1.2" />
          </svg>
        </div>
      </div>
    );
  },
);
