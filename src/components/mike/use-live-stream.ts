"use client";

import { useEffect, useRef, useState } from "react";
import type { Candle, Timeframe } from "@/lib/mike/types";

/**
 * Tick-by-tick candles for crypto straight from Binance's public market-data
 * WebSocket (no key, read-only). Other markets have no free streaming feed, so
 * they're polled instead — the caller keeps doing that when this is "off" or
 * "down". If the stream can't connect (blocked region, offline), it says so and
 * the chart falls back to polling; it never fills gaps with made-up ticks.
 */
export type StreamState = "off" | "connecting" | "live" | "down";
const HOSTS = ["wss://data-stream.binance.vision/ws", "wss://stream.binance.com:9443/ws"];

export function useBinanceStream(symbol: string | null, timeframe: Timeframe, onCandle: (c: Candle, closed: boolean) => void): StreamState {
  const [state, setState] = useState<StreamState>("off");
  const cb = useRef(onCandle); cb.current = onCandle;
  useEffect(() => {
    if (!symbol || typeof WebSocket === "undefined") { setState("off"); return; }
    let ws: WebSocket | null = null, host = 0, stopped = false, opened = false, retry: ReturnType<typeof setTimeout> | null = null, fails = 0;
    const connect = () => {
      if (stopped) return;
      setState("connecting");
      opened = false;
      try { ws = new WebSocket(`${HOSTS[host]}/${symbol.toLowerCase()}@kline_${timeframe}`); } catch { next(); return; }
      ws.onopen = () => { opened = true; fails = 0; setState("live"); };
      ws.onmessage = (ev) => {
        try {
          const k = JSON.parse(String(ev.data))?.k;
          if (!k) return;
          const c: Candle = { t: Number(k.t), o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c), v: Number(k.v) };
          if ([c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)) cb.current(c, !!k.x);
        } catch { /* ignore a malformed frame */ }
      };
      ws.onerror = () => { /* onclose follows */ };
      ws.onclose = () => { if (!stopped) (opened ? later() : next()); };
    };
    const next = () => {
      // this host refused → the other one; both refused → give up (polling carries on)
      if (++host < HOSTS.length) { connect(); return; }
      host = 0;
      if (++fails >= 2) { setState("down"); retry = setTimeout(connect, 60_000); return; }
      later();
    };
    const later = () => { setState("connecting"); retry = setTimeout(connect, 3000); };
    connect();
    return () => { stopped = true; if (retry) clearTimeout(retry); try { ws?.close(); } catch { /* already closed */ } };
  }, [symbol, timeframe]);
  return state;
}
