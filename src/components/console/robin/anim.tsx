"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/robin/types";

/** A number that morphs to its new value instead of jumping (real values only). */
export function useCountUp(value: number, ms = 900): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const cur = useRef(value);
  useEffect(() => {
    from.current = cur.current;
    if (from.current === value) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { cur.current = value; setShown(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      cur.current = from.current + (value - from.current) * e;
      setShown(cur.current);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

export function Count({ value, ms, className }: { value: number; ms?: number; className?: string }) {
  const v = useCountUp(value, ms);
  return <span className={className}>{Math.round(v).toLocaleString("en-IN")}</span>;
}

export function Money({ value, currency, compact = true, className }: { value: number; currency: string; compact?: boolean; className?: string }) {
  const v = useCountUp(value, 1100);
  return <span className={className}>{value ? money(v, currency, compact) : money(0, currency, compact)}</span>;
}

export const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
