"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { CreativeFormat } from "@/lib/ev/studio";
import { EvStudioEngine, type BrandDnaInput, type PublishPhase, type StudioMode, type StudioState } from "./studio-engine";

export interface StudioCanvasHandle {
  /** DOM elements the engine keeps glued to the creative canvas (media) and beside it (approval). */
  setAnchors: (media: HTMLElement | null, side: HTMLElement | null) => void;
  celebrate: () => void;
}

interface Props {
  state: StudioState;
  mode: StudioMode;
  format: CreativeFormat | null;
  mediaAspect: number | null;
  focus: boolean;
  publish: PublishPhase;
  level: number;
  headline: string;
  brand: BrandDnaInput[];
  className?: string;
}

/** Full-screen canvas running EV's creative-studio engine. */
export const StudioCanvas = forwardRef<StudioCanvasHandle, Props>(function StudioCanvas(
  { state, mode, format, mediaAspect, focus, publish, level, headline, brand, className }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EvStudioEngine | null>(null);
  const anchors = useRef<[HTMLElement | null, HTMLElement | null]>([null, null]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: EvStudioEngine;
    try { engine = new EvStudioEngine(canvas); } catch { return; }
    engineRef.current = engine;
    engine.setAnchors(...anchors.current);
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
  }, []);

  useEffect(() => { engineRef.current?.setState(state); }, [state]);
  useEffect(() => { engineRef.current?.setMode(mode); }, [mode]);
  useEffect(() => { engineRef.current?.setFormat(format); }, [format]);
  useEffect(() => { engineRef.current?.setMedia(mediaAspect); }, [mediaAspect]);
  useEffect(() => { engineRef.current?.setFocus(focus); }, [focus]);
  useEffect(() => { engineRef.current?.setPublish(publish); }, [publish]);
  useEffect(() => { engineRef.current?.setLevel(level); }, [level]);
  useEffect(() => { engineRef.current?.setHeadline(headline); }, [headline]);
  useEffect(() => { engineRef.current?.setBrand(brand); }, [brand]);

  useImperativeHandle(ref, () => ({
    setAnchors: (media, side) => { anchors.current = [media, side]; engineRef.current?.setAnchors(media, side); },
    celebrate: () => engineRef.current?.celebrate(),
  }), []);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
});
