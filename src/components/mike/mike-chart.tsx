"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartData, TradeSetup, Timeframe } from "@/lib/mike/types";
import { fmtPrice } from "@/lib/mike/format";

export interface ChartToggles { ema: boolean; bb: boolean; vwap: boolean; levels: boolean; structure: boolean; volume: boolean; rsi: boolean }
export const DEFAULT_TOGGLES: ChartToggles = { ema: true, bb: false, vwap: false, levels: true, structure: true, volume: true, rsi: false };

export type LevelKey = "entry" | "stop" | "t1" | "t2" | "t3";
export interface LevelPos { key: LevelKey; x: number; y: number }

/**
 * The live chart. Candles are real (the newest one may still be forming and
 * is drawn with a dashed outline); overlays are computed server-side from the
 * same bars. Transitions are eased so updates flow instead of jumping.
 */
export function MikeChart({ chart, setup, toggles, timeframe, onLevels, replayKey }: {
  chart: ChartData | null; setup: TradeSetup | null; toggles: ChartToggles; timeframe: Timeframe;
  onLevels?: (l: LevelPos[]) => void; replayKey: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const st = useRef({
    reveal: 0, lo: 0, hi: 0, ready: false, visible: 120, hover: -1, hoverY: -1,
    lv: {} as Partial<Record<LevelKey, number>>, lastReport: "", replay: "",
  });
  const props = useRef({ chart, setup, toggles, onLevels, timeframe });
  props.current = { chart, setup, toggles, onLevels, timeframe };
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);
  const hoverInfoRef = useRef<string | null>(null);

  useEffect(() => {
    if (st.current.replay !== replayKey) { st.current.reveal = 0; st.current.replay = replayKey; st.current.ready = false; }
  }, [replayKey]);

  useEffect(() => {
    const canvas = cvs.current!, box = wrap.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0, last = performance.now(), w = 0, h = 0, dpr = 1, t = 0;
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = box.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(box);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = st.current;
      s.visible = Math.max(30, Math.min(props.current.chart?.candles.length ?? 180, Math.round(s.visible * (e.deltaY > 0 ? 1.12 : 0.89))));
    };
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      st.current.hover = e.clientX - r.left; st.current.hoverY = e.clientY - r.top;
    };
    const onLeave = () => { st.current.hover = -1; setHoverInfo(null); };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      const { chart: c, setup: su, toggles: tg, onLevels: report } = props.current;
      const s = st.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!c || !c.candles.length) { raf = requestAnimationFrame(draw); return; }
      const n = c.candles.length;
      const vis = Math.min(s.visible, n);
      const start = n - vis;
      s.reveal = Math.min(vis, s.reveal + dt * (s.ready ? 400 : 110));
      if (s.reveal >= vis) s.ready = true;
      const shown = Math.floor(s.reveal);
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      const axisW = Math.max(56, Math.ceil(ctx.measureText(`T3 ${fmtPrice(c.candles[n - 1].h * 1.2)}`).width) + 10), padT = 10;
      const rsiH = tg.rsi ? Math.max(50, h * 0.2) : 0;
      const priceH = h - 22 - rsiH;
      const plotW = w - axisW;
      const bw = plotW / vis;
      // target price range (candles + setup levels), eased
      let lo = Infinity, hi = -Infinity;
      for (let i = start; i < n; i++) { lo = Math.min(lo, c.candles[i].l); hi = Math.max(hi, c.candles[i].h); }
      if (su && tg.levels) for (const p of [su.stop, su.entryLow, su.entryHigh, ...su.targets.map((x) => x.price)]) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
      const pad = (hi - lo) * 0.06 || hi * 0.01;
      lo -= pad; hi += pad;
      if (!s.lo || !Number.isFinite(s.lo)) { s.lo = lo; s.hi = hi; }
      s.lo += (lo - s.lo) * Math.min(1, dt * 5); s.hi += (hi - s.hi) * Math.min(1, dt * 5);
      const Y = (p: number) => padT + (1 - (p - s.lo) / (s.hi - s.lo || 1)) * (priceH - padT);
      const X = (i: number) => (i - start) * bw + bw / 2;

      // grid + price axis
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "left";
      for (let k = 0; k <= 5; k++) {
        const p = s.lo + ((s.hi - s.lo) * k) / 5;
        const y = Y(p);
        ctx.strokeStyle = "rgba(125,211,252,0.06)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        ctx.fillStyle = "rgba(186,230,253,0.45)"; ctx.fillText(fmtPrice(p), plotW + 6, y + 3);
      }
      // time labels
      ctx.fillStyle = "rgba(186,230,253,0.35)";
      const nLabels = w < 520 ? 3 : 5;
      for (let k = 0; k < nLabels; k++) {
        const i = start + Math.floor((vis * (k + 0.5)) / nLabels);
        if (i >= n) continue;
        const d = new Date(c.candles[i].t);
        const label = props.current.timeframe === "1d" || props.current.timeframe === "1w"
          ? d.toISOString().slice(5, 10) : `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}`;
        ctx.fillText(label, X(i) - 28, h - 6 - rsiH + (rsiH ? 0 : 0));
      }

      // Bollinger band
      if (tg.bb) {
        ctx.fillStyle = "rgba(59,130,246,0.07)";
        ctx.beginPath();
        let started = false;
        for (let i = start; i < start + shown; i++) { const v = c.bbUpper[i]; if (v == null) continue; const x = X(i), y = Y(v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
        for (let i = start + shown - 1; i >= start; i--) { const v = c.bbLower[i]; if (v == null) continue; ctx.lineTo(X(i), Y(v)); }
        ctx.closePath(); ctx.fill();
      }
      // volume
      let vmax = 0;
      if (tg.volume) for (let i = start; i < n; i++) vmax = Math.max(vmax, c.candles[i].v);
      if (tg.volume && vmax > 0) {
        const vh = priceH * 0.16;
        for (let i = start; i < start + shown; i++) {
          const k = c.candles[i];
          const hgt = (k.v / vmax) * vh;
          ctx.fillStyle = k.c >= k.o ? "rgba(45,212,191,0.18)" : "rgba(244,63,94,0.16)";
          ctx.fillRect(X(i) - bw * 0.35, priceH - hgt, bw * 0.7, hgt);
        }
      }
      // support / resistance
      if (tg.levels) {
        ctx.setLineDash([3, 5]);
        for (const l of [...c.support, ...c.resistance]) {
          const y = Y(l.price);
          ctx.strokeStyle = l.kind === "support" ? "rgba(45,212,191,0.28)" : "rgba(251,146,60,0.28)";
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      // candles
      for (let i = start; i < start + shown; i++) {
        const k = c.candles[i];
        const up = k.c >= k.o;
        const x = X(i);
        const col = up ? "rgba(45,212,191,0.95)" : "rgba(244,63,94,0.92)";
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, Y(k.h)); ctx.lineTo(x, Y(k.l)); ctx.stroke();
        const top = Y(Math.max(k.o, k.c)), bot = Y(Math.min(k.o, k.c));
        const forming = i === n - 1 && k.t + tfMs(props.current.timeframe) > Date.now();
        if (forming) { ctx.setLineDash([2, 2]); ctx.strokeRect(x - bw * 0.32, top, bw * 0.64, Math.max(1, bot - top)); ctx.setLineDash([]); }
        else ctx.fillRect(x - bw * 0.32, top, bw * 0.64, Math.max(1, bot - top));
      }
      // moving averages / VWAP
      const line = (arr: (number | null)[], color: string, width = 1.2) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
        let started = false;
        for (let i = start; i < start + shown; i++) { const v = arr[i]; if (v == null) { started = false; continue; } const x = X(i), y = Y(v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
        ctx.stroke();
      };
      if (tg.ema) { line(c.ema20, "rgba(103,232,249,0.85)"); line(c.ema50, "rgba(165,180,252,0.8)"); line(c.ema200, "rgba(250,204,21,0.6)"); }
      if (tg.vwap) line(c.vwap, "rgba(244,114,182,0.7)");
      // structure markers
      if (tg.structure && s.ready) {
        ctx.font = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace"; ctx.textAlign = "center";
        for (const sw of c.swings) {
          if (sw.i < start || !sw.label) continue;
          const y = sw.type === "high" ? Y(sw.price) - 6 : Y(sw.price) + 13;
          ctx.fillStyle = sw.label === "HH" || sw.label === "HL" ? "rgba(94,234,212,0.85)" : "rgba(251,113,133,0.85)";
          ctx.fillText(sw.label, X(sw.i), y);
        }
        for (const e of c.events) {
          if (e.i < start) continue;
          const y = Y(e.price);
          ctx.strokeStyle = e.dir === "bullish" ? "rgba(94,234,212,0.6)" : "rgba(251,113,133,0.6)";
          ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(Math.max(0, X(e.i) - bw * 12), y); ctx.lineTo(X(e.i), y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = ctx.strokeStyle; ctx.fillText(e.kind, X(e.i) - bw * 6, y - 4);
        }
      }
      // trade levels (eased toward their new values)
      const reports: LevelPos[] = [];
      const tags: { key: LevelKey | "last"; y: number; color: string; text: string }[] = [];
      if (su && tg.levels && s.ready) {
        const tgt: Record<LevelKey, number> = { entry: (su.entryLow + su.entryHigh) / 2, stop: su.stop, t1: su.targets[0]?.price, t2: su.targets[1]?.price, t3: su.targets[2]?.price };
        for (const key of Object.keys(tgt) as LevelKey[]) {
          const cur = s.lv[key];
          s.lv[key] = cur == null ? tgt[key] : cur + (tgt[key] - cur) * Math.min(1, dt * 6);
        }
        const glow = 0.5 + Math.sin(t * 3) * 0.2;
        // entry zone band
        const yA = Y(su.entryHigh), yB = Y(su.entryLow);
        ctx.fillStyle = `rgba(34,211,238,${0.1 + glow * 0.08})`;
        ctx.fillRect(0, Math.min(yA, yB), plotW, Math.abs(yB - yA) || 1);
        const draw1 = (key: LevelKey, color: string, label: string) => {
          const v = s.lv[key]; if (v == null) return;
          const y = Y(v);
          ctx.strokeStyle = color; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
          tags.push({ key, y, color, text: `${label} ${fmtPrice(v)}` });
        };
        draw1("entry", "rgba(34,211,238,0.95)", "ENT");
        draw1("stop", "rgba(244,63,94,0.95)", "SL");
        draw1("t1", "rgba(45,212,191,0.9)", "T1");
        draw1("t2", "rgba(52,211,153,0.9)", "T2");
        draw1("t3", "rgba(134,239,172,0.9)", "T3");
      }
      // last price line
      const lastC = c.candles[n - 1];
      if (s.ready) {
        const y = Y(lastC.c);
        ctx.strokeStyle = `rgba(255,255,255,${0.35 + Math.sin(t * 4) * 0.15})`; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke(); ctx.setLineDash([]);
        tags.push({ key: "last", y, color: "rgba(226,232,240,0.95)", text: fmtPrice(lastC.c) });
      }
      // axis tags never overlap: sorted, then nudged apart (a leader tick shows the true level)
      tags.sort((a, b) => a.y - b.y);
      let prevY = -Infinity;
      const rect = canvas.getBoundingClientRect();
      for (const tg2 of tags) {
        const ty = Math.max(tg2.y, prevY + 17);
        prevY = ty;
        if (ty !== tg2.y) { ctx.strokeStyle = tg2.color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(plotW - 6, tg2.y); ctx.lineTo(plotW, ty); ctx.stroke(); }
        ctx.fillStyle = tg2.color; ctx.fillRect(plotW, ty - 8, axisW, 16);
        ctx.fillStyle = "#020617"; ctx.textAlign = "left"; ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(tg2.text, plotW + 3, ty + 3.5);
        if (tg2.key !== "last") reports.push({ key: tg2.key, x: rect.left + w, y: rect.top + ty });
      }
      // RSI sub-pane
      if (tg.rsi) {
        const top = h - rsiH, bot = h - 4;
        const RY = (v: number) => top + (1 - v / 100) * (bot - top);
        ctx.strokeStyle = "rgba(125,211,252,0.12)"; ctx.strokeRect(0, top, plotW, bot - top);
        ctx.setLineDash([2, 4]);
        for (const lvl of [30, 70]) { ctx.beginPath(); ctx.moveTo(0, RY(lvl)); ctx.lineTo(plotW, RY(lvl)); ctx.stroke(); }
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(196,181,253,0.85)"; ctx.lineWidth = 1.2; ctx.beginPath();
        let started = false;
        for (let i = start; i < start + shown; i++) { const v = c.rsi[i]; if (v == null) continue; if (!started) { ctx.moveTo(X(i), RY(v)); started = true; } else ctx.lineTo(X(i), RY(v)); }
        ctx.stroke();
        ctx.fillStyle = "rgba(196,181,253,0.6)"; ctx.fillText("RSI 14", 4, top + 11);
      }
      // crosshair
      if (s.hover >= 0 && s.hover < plotW && s.ready) {
        const i = Math.min(n - 1, start + Math.floor(s.hover / bw));
        const k = c.candles[i];
        ctx.strokeStyle = "rgba(186,230,253,0.25)";
        ctx.beginPath(); ctx.moveTo(X(i), 0); ctx.lineTo(X(i), h); ctx.moveTo(0, s.hoverY); ctx.lineTo(plotW, s.hoverY); ctx.stroke();
        const info = `${new Date(k.t).toISOString().slice(0, 16).replace("T", " ")} UTC · O ${fmtPrice(k.o)} H ${fmtPrice(k.h)} L ${fmtPrice(k.l)} C ${fmtPrice(k.c)}${k.v ? ` · V ${Math.round(k.v).toLocaleString("en-US")}` : ""}`;
        if (info !== hoverInfoRef.current) { hoverInfoRef.current = info; setHoverInfo(info); }
      }
      // report level positions for the chart → trade-sheet connectors (only when they move)
      const sig = reports.map((r) => `${r.key}${Math.round(r.y)}`).join("|");
      if (sig !== s.lastReport) { s.lastReport = sig; report?.(reports); }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener("wheel", onWheel); canvas.removeEventListener("mousemove", onMove); canvas.removeEventListener("mouseleave", onLeave); };
  }, []);

  return (
    <div ref={wrap} className="relative h-full w-full">
      <canvas ref={cvs} className="absolute inset-0 cursor-crosshair" aria-label="Price chart" />
      {hoverInfo && <div className="pointer-events-none absolute left-2 top-1 rounded bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] text-cyan-100/80">{hoverInfo}</div>}
    </div>
  );
}

function tfMs(tf: Timeframe) {
  return ({ "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000, "1w": 604_800_000 } as const)[tf];
}
