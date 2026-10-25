"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HandTracker, cameraErrorMessage } from "@/lib/gesture/tracker";
import { Gesture3D, FrameStats, type Output3D } from "@/lib/friday/gesture3d";

/**
 * Hand control for Friday's viewer. The camera is asked for ONLY when you turn
 * gestures on, frames are processed in this browser (never uploaded), and the
 * camera is released the moment gestures are turned off or the workspace closes.
 *
 * FPS = hand-tracking frames actually processed per second. Latency = from the
 * camera's capture timestamp (requestVideoFrameCallback metadata) to the end of
 * hand detection; when the browser doesn't expose capture time it's the
 * detection time alone, and labelled that way.
 */
export interface HandState {
  on: boolean;
  starting: boolean;
  error: string | null;
  out: Output3D | null;
  fps: number | null;
  latency: number | null;
  latencyKind: "capture" | "processing" | null;
  delegate: "GPU" | "CPU" | null;
  calibrated: boolean;
}

export function useHandControl(onFrame: (o: Output3D) => void) {
  const [st, setSt] = useState<HandState>({ on: false, starting: false, error: null, out: null, fps: null, latency: null, latencyKind: null, delegate: null, calibrated: false });
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const tracker = useRef<HandTracker | null>(null);
  const g = useRef(new Gesture3D());
  const stats = useRef(new FrameStats());
  const live = useRef(false);
  const frameCb = useRef(onFrame); frameCb.current = onFrame;
  const lastUi = useRef(0);

  const stop = useCallback(() => {
    live.current = false;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    tracker.current?.close();
    tracker.current = null;
    if (video.current) { video.current.srcObject = null; }
    stats.current.reset();
    setSt((s) => ({ ...s, on: false, starting: false, out: null, fps: null, latency: null, latencyKind: null }));
  }, []);

  const start = useCallback(async () => {
    if (live.current) return;
    setSt((s) => ({ ...s, starting: true, error: null }));
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("This browser can't use the camera here (it needs https or localhost)."), { name: "NotSupported" });
      const ms = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, min: 24 }, facingMode: "user" }, audio: false });
      stream.current = ms;
      const v = video.current ?? document.createElement("video");
      video.current = v;
      v.muted = true; v.playsInline = true; v.srcObject = ms;
      await v.play();
      tracker.current = await HandTracker.create({ numHands: 2 });
      live.current = true;
      setSt((s) => ({ ...s, on: true, starting: false, delegate: tracker.current?.delegate ?? null }));
      const vfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { captureTime?: number; mediaTime: number }) => void) => number }).requestVideoFrameCallback?.bind(v);
      const tick = (_now: number, meta?: { captureTime?: number }) => {
        if (!live.current || !tracker.current || !video.current) return;
        const t = performance.now();
        let hands: ReturnType<HandTracker["detectAll"]> = [];
        try { hands = tracker.current.detectAll(video.current, t); } catch { /* a frame the tracker couldn't read */ }
        const done = performance.now();
        const cap = meta?.captureTime;
        const lat = cap && cap > 0 && cap <= done ? done - cap : done - t;
        stats.current.frame(t, lat);
        const out = g.current.update(hands, t);
        frameCb.current(out);
        if (t - lastUi.current > 120) {
          lastUi.current = t;
          setSt((s) => ({ ...s, out, fps: stats.current.fps, latency: stats.current.latency, latencyKind: cap ? "capture" : "processing" }));
        }
        if (vfc) vfc(tick); else requestAnimationFrame((n) => tick(n));
      };
      if (vfc) vfc(tick); else requestAnimationFrame((n) => tick(n));
    } catch (e) {
      stop();
      const msg = (e as { name?: string }).name === "NotSupported" ? (e as Error).message : (e as Error)?.message?.startsWith("Hand tracking") ? (e as Error).message : cameraErrorMessage(e).message;
      setSt((s) => ({ ...s, starting: false, error: msg }));
    }
  }, [stop]);

  const calibrate = useCallback(() => {
    g.current.onCalibrated = () => setSt((s) => ({ ...s, calibrated: true }));
    g.current.startCalibration(performance.now());
  }, []);
  const setSensitivity = useCallback((k: number) => {
    g.current.s.rotateGain = 1.6 * k; g.current.s.panGain = 0.9 * k; g.current.s.zoomGain = 1.4 * k;
  }, []);
  const setPaused = useCallback((p: boolean) => g.current.setPaused(p), []);

  // camera off when the page/workspace goes away
  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    const off = () => { if (document.hidden && live.current) stop(); };
    document.addEventListener("visibilitychange", off);
    return () => document.removeEventListener("visibilitychange", off);
  }, [stop]);

  return { state: st, start, stop, calibrate, setSensitivity, setPaused, video };
}
