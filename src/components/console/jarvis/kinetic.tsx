"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Kinetic typography: words whose letters move into place.
 *   slide    — letters appear one by one and slide into alignment (ANALYZING)
 *   rush     — letters race in horizontally and lock (EXECUTING)
 *   emerge   — letters condense out of a blur of light (COMPLETE, ULTRON ACTIVE)
 *   distort  — letters glitch briefly, then stabilise (ANOMALY / ERROR)
 *   sweep    — letters fade in under a travelling light (READY)
 *   wave     — letters breathe in a wave (LISTENING)
 *   converge — widely spaced letters collapse together (PROCESSING)
 *   type     — typed one character at a time with a caret (SYSTEM ONLINE)
 */
export type KineticStyle = "slide" | "rush" | "emerge" | "distort" | "sweep" | "wave" | "converge" | "type";

export function KineticWord({ word, style, className, stagger = 45 }: { word: string; style: KineticStyle; className?: string; stagger?: number }) {
  if (style === "type") return <TypedWord word={word} className={className} />;
  const letters = word.split("");
  return (
    <span className={cn("jv-kinetic relative inline-flex whitespace-pre", style === "sweep" && "jv-sweep", className)} aria-label={word}>
      {letters.map((l, i) => (
        <span key={i} aria-hidden className={`jv-k-${style}`}
          style={{ animationDelay: `${style === "wave" ? i * 90 : i * stagger}ms`, ["--i" as string]: i, ["--n" as string]: letters.length }}>
          {l === " " ? " " : l}
        </span>
      ))}
    </span>
  );
}

function TypedWord({ word, className }: { word: string; className?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const id = setInterval(() => setN((v) => (v >= word.length ? v : v + 1)), 55);
    return () => clearInterval(id);
  }, [word]);
  return (
    <span className={cn("inline-flex items-center whitespace-pre", className)} aria-label={word}>
      <span aria-hidden>{word.slice(0, n)}</span>
      <span aria-hidden className="ml-1 inline-block h-[0.95em] w-px bg-current" style={{ animation: "caret-blink .8s steps(1) infinite" }} />
    </span>
  );
}

/**
 * Shows the current kinetic word; when it changes or disappears, the old one
 * dissolves (never a hard cut).
 */
export function KineticStage({ word, style, className }: { word: string | null; style: KineticStyle; className?: string }) {
  const [shown, setShown] = useState<{ word: string; style: KineticStyle; key: number } | null>(word ? { word, style, key: 0 } : null);
  const [leaving, setLeaving] = useState<{ word: string; style: KineticStyle; key: number } | null>(null);
  const seq = useRef(1);
  useEffect(() => {
    setShown((cur) => {
      if (cur?.word === word && cur?.style === style) return cur;
      if (cur) setLeaving(cur);
      return word ? { word, style, key: seq.current++ } : null;
    });
  }, [word, style]);
  useEffect(() => { if (!leaving) return; const t = setTimeout(() => setLeaving(null), 650); return () => clearTimeout(t); }, [leaving]);
  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {leaving && <span key={`l${leaving.key}`} className="jv-dissolve absolute"><KineticWord word={leaving.word} style={leaving.style} /></span>}
      {shown && <span key={`s${shown.key}`} className="relative"><KineticWord word={shown.word} style={shown.style} /></span>}
    </div>
  );
}
