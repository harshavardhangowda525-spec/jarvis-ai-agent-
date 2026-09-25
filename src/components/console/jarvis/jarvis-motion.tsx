"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { JarvisMotionEngine, type AgentName, type JState, type MotionCallbacks, type Pt } from "./motion-engine";

export type { AgentName, JState, Pt };

export interface JarvisMotionHandle {
  taskComplete: () => void;
  anomaly: () => void;
  activateAgent: (a: AgentName) => void;
  agentReturn: (a: AgentName) => void;
  buildWebsite: () => void;
  keystroke: (x: number, y: number) => void;
  commandToParticles: (text: string, rect: DOMRect) => void;
  skipIntro: () => void;
}

interface Props extends MotionCallbacks {
  state: JState;
  micLevel: number;
  voiceLevel: () => number;
  paused?: boolean;
  /** Element that receives the --jv-level CSS variable (voice-driven typography). */
  cssTarget?: React.RefObject<HTMLElement>;
  className?: string;
}

/** Full-stage canvas running the JARVIS motion engine. */
export const JarvisMotion = forwardRef<JarvisMotionHandle, Props>(function JarvisMotion(
  { state, micLevel, voiceLevel, paused, cssTarget, className, ...callbacks }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<JarvisMotionEngine | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const voiceRef = useRef(voiceLevel);
  voiceRef.current = voiceLevel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: JarvisMotionEngine;
    try {
      engine = new JarvisMotionEngine(canvas, {
        onIntro: (p) => cbRef.current.onIntro?.(p),
        onAnomaly: (p) => cbRef.current.onAnomaly?.(p),
        onProcessing: () => cbRef.current.onProcessing?.(),
        onBuildReady: () => cbRef.current.onBuildReady?.(),
        onLayout: (l) => cbRef.current.onLayout?.(l),
      }, cssTarget?.current ?? null);
    } catch {
      cbRef.current.onIntro?.("logo"); cbRef.current.onIntro?.("online"); cbRef.current.onIntro?.("done");
      return;
    }
    engineRef.current = engine;
    engine.setVoiceLevelGetter(() => voiceRef.current());
    engine.start();
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);
    document.fonts?.ready.then(() => engine.resize()).catch(() => {});
    const move = (ev: PointerEvent) => { const r = canvas.getBoundingClientRect(); engine.setPointer(ev.clientX - r.left, ev.clientY - r.top); };
    const leave = () => engine.clearPointer();
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      engine.destroy(); engineRef.current = null; ro.disconnect();
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { engineRef.current?.setState(state); }, [state]);
  useEffect(() => { engineRef.current?.setMicLevel(micLevel); }, [micLevel]);
  // Fully covered by another mode (EV / Humanoid) → stop drawing to save the CPU.
  useEffect(() => { const e = engineRef.current; if (!e) return; if (paused) e.destroy(); else e.start(); }, [paused]);

  useImperativeHandle(ref, () => {
    const local = (x: number, y: number) => { const r = canvasRef.current?.getBoundingClientRect(); return r ? { x: x - r.left, y: y - r.top } : { x, y }; };
    return {
      taskComplete: () => engineRef.current?.taskComplete(),
      anomaly: () => engineRef.current?.anomalyDetected(),
      activateAgent: (a) => engineRef.current?.activateAgent(a),
      agentReturn: (a) => engineRef.current?.agentReturn(a),
      buildWebsite: () => engineRef.current?.buildWebsite(),
      keystroke: (x, y) => { const p = local(x, y); engineRef.current?.keystroke(p.x, p.y); },
      commandToParticles: (text, rect) => { const p = local(rect.left, rect.top); engineRef.current?.commandToParticles(text, { x: p.x, y: p.y, w: rect.width, h: rect.height }); },
      skipIntro: () => engineRef.current?.skipIntro(),
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={className} style={{ display: "block", width: "100%", height: "100%" }} />;
});
