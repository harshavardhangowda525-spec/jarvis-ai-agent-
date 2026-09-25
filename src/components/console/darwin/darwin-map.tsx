"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { DarwinMapEngine, type MapCallbacks, type MapNodeInput } from "./map-engine";

export type { MapNodeInput };

export interface DarwinMapHandle {
  setPlace: (p: { label: string; radiusM: number; hasCenter?: boolean }) => void;
  setLeads: (list: MapNodeInput[], fresh?: Set<string>) => void;
  setVisible: (ids: Set<string> | null) => void;
  setScanning: (on: boolean) => void;
  searchComplete: () => void;
  sourceError: () => void;
  select: (id: string | null) => void;
  crmStream: (id: string) => void;
  skipIntro: () => void;
  setAnchor: (el: HTMLElement | null) => void;
}

interface Props extends MapCallbacks {
  /** Element the engine moves to follow the selected business (the info layer). */
  anchorRef?: React.RefObject<HTMLElement>;
  paused?: boolean;
  className?: string;
}

/** The DARWIN intelligence map: canvas + drag to pan, scroll to zoom, click to select. */
export const DarwinMap = forwardRef<DarwinMapHandle, Props>(function DarwinMap({ anchorRef, paused, className, ...callbacks }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<DarwinMapEngine | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: DarwinMapEngine;
    try {
      engine = new DarwinMapEngine(canvas, {
        onIntro: (p) => cbRef.current.onIntro?.(p),
        onSelect: (id) => cbRef.current.onSelect?.(id),
        onHover: (id) => cbRef.current.onHover?.(id),
        onEvent: (t, tone) => cbRef.current.onEvent?.(t, tone),
      });
    } catch {
      cbRef.current.onIntro?.("online"); cbRef.current.onIntro?.("done");
      return;
    }
    engineRef.current = engine;
    engine.setAnchor(anchorRef?.current ?? null);
    engine.start();
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);
    const local = (e: PointerEvent | WheelEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const move = (e: PointerEvent) => { const p = local(e); engine.pointerMove(p.x, p.y); };
    const down = (e: PointerEvent) => { if (e.button !== 0) return; const p = local(e); engine.pointerDown(p.x, p.y); canvas.setPointerCapture?.(e.pointerId); };
    const up = (e: PointerEvent) => { const p = local(e); engine.pointerUp(p.x, p.y); };
    const leave = () => engine.pointerLeave();
    const wheel = (e: WheelEvent) => { e.preventDefault(); engine.wheel(e.deltaY); };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      engine.destroy(); engineRef.current = null; ro.disconnect();
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const e = engineRef.current; if (!e) return; if (paused) e.destroy(); else e.start(); }, [paused]);

  useImperativeHandle(ref, () => ({
    setPlace: (p) => engineRef.current?.setPlace(p),
    setLeads: (l, f) => engineRef.current?.setLeads(l, f),
    setVisible: (ids) => engineRef.current?.setVisible(ids),
    setScanning: (on) => engineRef.current?.setScanning(on),
    searchComplete: () => engineRef.current?.searchComplete(),
    sourceError: () => engineRef.current?.sourceError(),
    select: (id) => engineRef.current?.select(id),
    crmStream: (id) => engineRef.current?.crmStream(id),
    skipIntro: () => engineRef.current?.skipIntro(),
    setAnchor: (el) => engineRef.current?.setAnchor(el),
  }), []);

  return <canvas ref={canvasRef} aria-label="DARWIN intelligence map" className={className} style={{ display: "block", width: "100%", height: "100%", touchAction: "none" }} />;
});
