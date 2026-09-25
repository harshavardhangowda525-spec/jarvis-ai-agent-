"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A spatial holographic panel. It never pops in: a horizontal light streak
 * travels across, expands vertically into a liquid-glass panel, then the
 * content appears. Closing plays it backwards (panel → streak → gone).
 */
export function HoloPanel({ open, children, className, depth = 1, onClosed }: {
  open: boolean; children: React.ReactNode; className?: string; depth?: number; onClosed?: () => void;
}) {
  const [phase, setPhase] = useState<"closed" | "streak" | "open" | "closing">(open ? "streak" : "closed");
  useEffect(() => {
    if (open) {
      setPhase((p) => (p === "open" ? p : "streak"));
      const t = setTimeout(() => setPhase("open"), 380);
      return () => clearTimeout(t);
    }
    setPhase((p) => (p === "closed" ? p : "closing"));
    const t = setTimeout(() => { setPhase("closed"); onClosed?.(); }, 700);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (phase === "closed") return null;
  return (
    <div className={cn("jv-holo pointer-events-auto relative", `jv-holo-${phase}`, className)}
      style={{ transform: `translate3d(calc(var(--px, 0) * ${-7 * depth}px), calc(var(--py, 0) * ${-5 * depth}px), 0)` }}>
      <span aria-hidden className="jv-holo-streak" />
      <div className="jv-holo-glass">
        <span aria-hidden className="jv-holo-sheen" />
        <div className="jv-holo-content relative">{children}</div>
      </div>
    </div>
  );
}
