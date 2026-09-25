"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { UltronCoreEngine, type CoreState, type SideNode } from "./core-engine";

export type { CoreState, SideNode };

/** Imperative hooks into the motion core for one-off moments. */
export interface UltronCoreHandle {
  launchCommand: (x: number, y: number) => void;
  keystroke: (x: number, y: number) => void;
  diagnostic: () => void;
  codeBurst: (n?: number) => void;
  deployComplete: () => void;
  activate: (node: SideNode) => void;
  skipBoot: () => void;
}

interface Props {
  state: CoreState;
  /** Microphone loudness 0..1. */
  level: number;
  onPhase?: (phase: "ui" | "idle") => void;
  onCommandArrive?: () => void;
  className?: string;
}

/**
 * Full-screen canvas running the ULTRON motion core. Mouse position, size
 * changes and state are fed to the engine; everything else happens inside it.
 */
export const UltronCore = forwardRef<UltronCoreHandle, Props>(function UltronCore({ state, level, onPhase, onCommandArrive, className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<UltronCoreEngine | null>(null);
  const cbRef = useRef({ onPhase, onCommandArrive });
  cbRef.current = { onPhase, onCommandArrive };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: UltronCoreEngine;
    try {
      engine = new UltronCoreEngine(canvas, {
        onPhase: (p) => cbRef.current.onPhase?.(p),
        onCommandArrive: () => cbRef.current.onCommandArrive?.(),
      });
    } catch {
      // No canvas support: skip straight to the interface.
      cbRef.current.onPhase?.("ui"); cbRef.current.onPhase?.("idle");
      return;
    }
    engineRef.current = engine;
    engine.start();

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);
    // The wordmark is sampled from the display font — redo it once the font is in.
    document.fonts?.ready.then(() => engine.resize()).catch(() => {});

    const move = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      engine.setPointer(ev.clientX - r.left, ev.clientY - r.top);
    };
    const leave = () => engine.clearPointer();
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      engine.destroy(); engineRef.current = null; ro.disconnect();
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);

  useEffect(() => { engineRef.current?.setState(state); }, [state]);
  useEffect(() => { engineRef.current?.setLevel(level); }, [level]);

  useImperativeHandle(ref, () => {
    // Page coordinates → canvas coordinates.
    const local = (x: number, y: number) => {
      const r = canvasRef.current?.getBoundingClientRect();
      return r ? { x: x - r.left, y: y - r.top } : { x, y };
    };
    return {
      launchCommand: (x, y) => { const p = local(x, y); engineRef.current?.launchCommand(p.x, p.y); },
      keystroke: (x, y) => { const p = local(x, y); engineRef.current?.keystroke(p.x, p.y); },
      diagnostic: () => engineRef.current?.diagnostic(),
      codeBurst: (n) => engineRef.current?.codeBurst(n),
      deployComplete: () => engineRef.current?.deployComplete(),
      activate: (node) => engineRef.current?.activate(node),
      skipBoot: () => engineRef.current?.skipBoot(),
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={className} style={{ display: "block", width: "100%", height: "100%" }} />;
});
