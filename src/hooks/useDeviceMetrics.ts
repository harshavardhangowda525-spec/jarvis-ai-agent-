"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Real client-side telemetry for the HUD. Everything here is measured from the
 * browser — no invented numbers:
 *   - memory : JS heap used / limit           (performance.memory, Chromium)
 *   - storage: origin storage used / quota    (navigator.storage.estimate)
 *   - network: downlink Mbps + rtt ms + type  (navigator.connection)
 *   - render : live frames-per-second          (requestAnimationFrame)
 * Values that a given browser can't provide come back null and the UI shows "—".
 */
export interface Metric {
  pct: number; // 0..100 for the bar
  label: string; // human value, e.g. "42%", "128 MB", "60 fps"
  available: boolean;
}
export interface DeviceMetrics {
  memory: Metric;
  storage: Metric;
  network: Metric;
  render: Metric;
  cores: number | null;
  downlinkMbps: number | null;
  rttMs: number | null;
  connectionType: string | null;
  secure: boolean;
  history: { mem: number; net: number; fps: number }[];
}

const NA: Metric = { pct: 0, label: "—", available: false };
const MAX_HISTORY = 40;

export function useDeviceMetrics(): DeviceMetrics {
  const [m, setM] = useState<DeviceMetrics>({
    memory: NA, storage: NA, network: NA, render: NA,
    cores: null, downlinkMbps: null, rttMs: null, connectionType: null,
    secure: typeof window !== "undefined" ? window.location.protocol === "https:" : true,
    history: [],
  });
  const fpsRef = useRef(0);
  const historyRef = useRef<DeviceMetrics["history"]>([]);

  // Live FPS via rAF.
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      frames++;
      if (t - last >= 1000) {
        fpsRef.current = Math.round((frames * 1000) / (t - last));
        frames = 0;
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let stopped = false;
    const nav = navigator as any;

    async function sample() {
      if (stopped) return;

      // Memory (Chromium only)
      let memory: Metric = NA;
      const perfMem = (performance as any).memory;
      if (perfMem?.usedJSHeapSize && perfMem?.jsHeapSizeLimit) {
        const pct = (perfMem.usedJSHeapSize / perfMem.jsHeapSizeLimit) * 100;
        const usedMb = Math.round(perfMem.usedJSHeapSize / 1048576);
        memory = { pct: Math.min(100, pct), label: `${usedMb} MB`, available: true };
      } else if (nav.deviceMemory) {
        memory = { pct: 0, label: `${nav.deviceMemory} GB`, available: true };
      }

      // Storage
      let storage: Metric = NA;
      try {
        if (nav.storage?.estimate) {
          const est = await nav.storage.estimate();
          if (est.quota) {
            const pct = (est.usage / est.quota) * 100;
            storage = { pct: Math.min(100, pct), label: `${pct.toFixed(1)}%`, available: true };
          }
        }
      } catch { /* ignore */ }

      // Network
      const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
      let network: Metric = NA;
      let downlinkMbps: number | null = null;
      let rttMs: number | null = null;
      let connectionType: string | null = null;
      if (conn) {
        downlinkMbps = typeof conn.downlink === "number" ? conn.downlink : null;
        rttMs = typeof conn.rtt === "number" ? conn.rtt : null;
        connectionType = conn.effectiveType ?? null;
        if (downlinkMbps != null) {
          network = { pct: Math.min(100, (downlinkMbps / 10) * 100), label: `${downlinkMbps} Mbps`, available: true };
        } else if (connectionType) {
          network = { pct: 60, label: connectionType, available: true };
        }
      }

      // Render (FPS)
      const fps = fpsRef.current || 0;
      const render: Metric = fps > 0
        ? { pct: Math.min(100, (fps / 60) * 100), label: `${fps} fps`, available: true }
        : NA;

      const hist = [
        ...historyRef.current,
        { mem: memory.pct, net: network.pct, fps: render.pct },
      ].slice(-MAX_HISTORY);
      historyRef.current = hist;

      if (!stopped) {
        setM({
          memory, storage, network, render,
          cores: nav.hardwareConcurrency ?? null,
          downlinkMbps, rttMs, connectionType,
          secure: window.location.protocol === "https:",
          history: hist,
        });
      }
    }

    sample();
    const id = setInterval(sample, 1500);
    return () => { stopped = true; clearInterval(id); };
  }, []);

  return m;
}

/** Live wall clock, updated every second. */
export function useClock(): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
