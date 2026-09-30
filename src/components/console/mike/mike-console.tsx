"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Loader2, LogOut, Radar, FlaskConical, BookOpen, Bell, ShieldCheck, Send, SlidersHorizontal, Maximize2, CandlestickChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/activity/client";
import { useVoice, useResumeVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import type { ChartData, MarketKind, MikeAnalysis, MikeSettings, Timeframe } from "@/lib/mike/types";
import { DEFAULT_SETTINGS, MARKETS, TIMEFRAMES, TF_LABEL, CHECK_LABEL, SCAN_EVENT_LABEL, TF_MS, RISK_WARNING } from "@/lib/mike/types";
import { catalog, catalogMatch } from "@/lib/mike/assets";
import { parseMikeCommand } from "@/lib/mike/command";
import { isMikeDeactivation } from "@/lib/mike/wake";
import { spokenSummary } from "@/lib/mike/summary";
import { fmtPct, fmtPrice } from "@/lib/mike/format";
import { MikeCoreEngine, type CoreState, type RingSpec } from "./core-engine";
import { MikeChart, DEFAULT_TOGGLES, type ChartToggles, type LevelKey, type LevelPos } from "./mike-chart";
import { LiveChartView, type ChartMeta } from "./live-chart";
import { useBinanceStream } from "./use-live-stream";
import { TradeSheet, type SheetPhase } from "./trade-sheet";
import { IntelStream, RegimeOrb, Ticker, MarketPanel, AlignmentTable, Connectors, type StreamItem, type TickerItem, type MarketSummary } from "./widgets";
import { BacktestPanel, JournalPanel, AlertsPanel, RiskPanel } from "./panels";
import { BootOverlay, type FeedStatus } from "./boot-overlay";

/**
 * MIKE Intelligence Center. Everything on screen comes from real market data
 * (or says LIVE DATA UNAVAILABLE); the motion is driven by what MIKE is
 * actually doing — scanning, analysing, validating, rejecting.
 */

const CORE_TEXT: Record<CoreState, string> = {
  idle: "IDLE · MONITORING", scanning: "SCANNING GLOBAL MARKETS", analyzing: "ANALYZING MARKET STRUCTURE",
  validating: "VALIDATING SIGNAL", alert: "NEW VALIDATED SETUP", no_trade: "NO TRADE", complete: "ANALYSIS COMPLETE",
};
const RING_ORDER = ["trend", "momentum", "volume", "structure", "volatility", "mtf"] as const;
const RING_NAME: Record<(typeof RING_ORDER)[number], string> = { trend: "TREND", momentum: "MOMENTUM", volume: "VOLUME", structure: "STRUCTURE", volatility: "VOLATILITY", mtf: "MULTI-TIMEFRAME" };
const LAYERS = ["MARKET STRUCTURE", "TREND", "MOMENTUM", "VOLUME", "VOLATILITY", "MULTI-TIMEFRAME"];

const short = (d: string) => d.replace("/USDT", "");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BOOT_MS = 3200;
const prefersReduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
/** Panel entrance after the boot titles: slides in from its side, then clears the transform. */
function fly(booted: boolean, from: "left" | "right" | "up" | "down", delayMs: number): React.CSSProperties {
  const off = { left: "translateX(-56px)", right: "translateX(56px)", up: "translateY(-28px)", down: "translateY(36px)" }[from];
  return {
    opacity: booted ? 1 : 0,
    transform: booted ? "none" : `${off} scale(0.98)`,
    filter: booted ? "none" : "blur(6px)",
    transition: "opacity .7s ease, transform .9s cubic-bezier(.2,.8,.2,1), filter .7s ease",
    transitionDelay: booted ? `${delayMs}ms` : "0ms",
  };
}

interface ScanRowDTO { asset: { display: string; symbol: string }; price: number | null; change24hPct: number | null; bias: "bullish" | "bearish" | "neutral" | null; regimeLabel: string | null; events: string[]; eventLabels: string[]; freshness: string; interest: number; spark: number[]; volumeRatio: number | null }
interface ActiveSetup { id: string; asset: string; direction: string | null; confidence: number; status: string }

export function MikeConsole() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const engine = useRef<MikeCoreEngine | null>(null);
  const rows = useRef<Partial<Record<LevelKey, HTMLElement | null>>>({});

  const [settings, setSettings] = useState<MikeSettings>(DEFAULT_SETTINGS);
  const [market, setMarket] = useState<MarketKind | "all">("all");
  const [assetQ, setAssetQ] = useState("BTC");
  const [tf, setTf] = useState<Timeframe>("1h");
  const [mode, setMode] = useState<"mtf" | "single">("mtf");
  const [coreState, setCoreState] = useState<CoreState>("idle");
  const [analysis, setAnalysis] = useState<MikeAnalysis | null>(null);
  const [phase, setPhase] = useState<SheetPhase>("empty");
  const [alertKey, setAlertKey] = useState(0);
  const [chart, setChartState] = useState<ChartData | null>(null);
  // The chart object is shared with the canvas; live ticks update its last candle in place
  // (no re-render per tick), so this ref always points at the one being drawn.
  const chartRef = useRef<ChartData | null>(null);
  const setChart = useCallback((c: ChartData | null) => { chartRef.current = c; setChartState(c); }, []);
  const [liveMeta, setLiveMeta] = useState<ChartMeta | null>(null);
  const [streamSym, setStreamSym] = useState<string | null>(null);
  const [liveView, setLiveView] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [livePrice, setLivePrice] = useState<{ price: number; at: number } | null>(null);
  const [assetHits, setAssetHits] = useState<{ symbol: string; display: string; name?: string; exchange: string }[]>([]);
  const openChartRef = useRef<(q: string | null, tf: Timeframe | null) => Promise<void>>(async () => {});
  const [chartMeta, setChartMeta] = useState<{ asset: string; tf: Timeframe; freshness: string; note: string; price: number | null; regime?: { id: any; volatility: any; label: string } } | null>(null);
  const [toggles, setToggles] = useState<ChartToggles>(DEFAULT_TOGGLES);
  const [levels, setLevels] = useState<LevelPos[]>([]);
  const [stream, setStream] = useState<StreamItem[]>([]);
  const [summary, setSummary] = useState<MarketSummary | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [ticker, setTicker] = useState<TickerItem[]>([]);
  const [active, setActive] = useState<ActiveSetup[]>([]);
  const [busy, setBusy] = useState<null | "analyze" | "scan">(null);
  const [modal, setModal] = useState<null | { kind: "backtest"; auto?: boolean; asset?: string; tf?: Timeframe } | { kind: "journal" } | { kind: "alerts" } | { kind: "risk" }>(null);
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [input, setInput] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [showChartOpts, setShowChartOpts] = useState(false);
  // power-up sequence: the core boots, titles run, then the panels fly in
  const [booted, setBooted] = useState(false);
  const [showBoot, setShowBoot] = useState(true);
  const [feeds, setFeeds] = useState<FeedStatus>({ state: "pending" });
  const [bootTop, setBootTop] = useState<number | null>(null);
  useEffect(() => { if (prefersReduced()) { setBooted(true); setShowBoot(false); } }, []);
  const seq = useRef(0);
  const runId = useRef(0);

  const push = useCallback((text: string, tone: StreamItem["tone"] = "info", at = Date.now()) => {
    setStream((s) => [...s.slice(-13), { id: ++seq.current, text, tone, at }]);
  }, []);

  // ---- core canvas ----------------------------------------------------------------
  useEffect(() => {
    const c = canvasRef.current!;
    let e: MikeCoreEngine;
    try { e = new MikeCoreEngine(c); } catch { return; }
    engine.current = e;
    const place = () => {
      e.resize();
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) e.setAnchor(r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width, r.height) * 0.2);
    };
    place();
    const ro = new ResizeObserver(place);
    if (anchorRef.current) ro.observe(anchorRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const move = (ev: PointerEvent) => e.pointer(ev.clientX, ev.clientY);
    window.addEventListener("pointermove", move);
    e.start();
    e.boot(BOOT_MS);
    // boot titles sit just below the core's rings, never on top of it
    const a = anchorRef.current?.getBoundingClientRect();
    if (a) {
      const R = Math.min(a.width, a.height) * 0.2;
      setBootTop(Math.max(0, Math.min(a.top + a.height / 2 + R * 1.75, window.innerHeight - 330)));
    }
    return () => { e.destroy(); ro.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); window.removeEventListener("pointermove", move); };
  }, []);
  useEffect(() => { engine.current?.setState(coreState); }, [coreState]);

  // ---- voice + agent ----------------------------------------------------------------
  const handleRef = useRef<(t: string) => void>(() => {});
  const voice = useVoice({ onTranscript: (t) => handleRef.current(t), autoListen: true, voiceProfile: "mike" });
  const voiceRef = useRef(voice); voiceRef.current = voice;
  const speak = useCallback((text: string) => {
    setReply(text);
    const v = voiceRef.current;
    if (voiceStarted && !v.muted && v.enabled) { try { v.speak(text); } catch { /* ignore */ } }
  }, [voiceStarted]);
  async function enableVoice() { const ok = await voice.init(); if (ok) setVoiceStarted(true); return ok; }
  useResumeVoice(enableVoice);
  // boot finished → MIKE announces itself once
  const announced = useRef(false);
  useEffect(() => {
    if (!booted || announced.current) return;
    announced.current = true;
    push("MIKE ONLINE", "ok");
    const t = setTimeout(() => speak("MIKE online. Market intelligence ready."), 350);
    return () => clearTimeout(t);
  }, [booted, push, speak]);

  const showAnalysisRef = useRef<(a: MikeAnalysis, animate: boolean) => Promise<void>>(async () => {});
  const agent = useAgent({
    onAssistantComplete: (text) => speak(text.replace(/\*\*/g, "")),
    onNavigate: (p) => {
      // "show me the X chart" from MIKE's brain → open it right here
      const m = p.match(/^\/dashboard\/mike\?(.*)$/);
      const sp = m ? new URLSearchParams(m[1]) : null;
      if (sp?.get("chart")) { void openChartRef.current(sp.get("chart"), (sp.get("tf") as Timeframe) || null); return; }
      router.push(p);
    },
    onTool: (t) => {
      if (t.status !== "ok") return;
      if (t.name === "mike_analyze") {
        // show the analysis MIKE's brain just ran (same cached data, not journalled twice)
        void fetch("/api/mike/journal?limit=1&insights=0").then((r) => r.json()).then(async (j) => {
          const s = j?.data?.signals?.[0];
          if (!s) return;
          const res = await fetch("/api/mike/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset: s.symbol, timeframe: s.timeframe, mode: s.mode, journal: false }) });
          const a = (await res.json())?.data as MikeAnalysis | undefined;
          if (a) { setAssetQ(short(a.asset.display)); setTf(a.timeframe); await showAnalysisRef.current(a, true); }
        }).catch(() => {});
      }
      if (t.name === "mike_scan") void refreshMarket(false);
      if (t.name === "mike_alert") push("ALERT UPDATED", "info");
    },
  });
  // core reacts to voice: listening / processing / speaking
  useEffect(() => {
    const iv = setInterval(() => {
      const v = voiceRef.current, e = engine.current;
      if (!e) return;
      if (v.status === "speaking") e.setVoice("speaking", v.getOutputLevel?.() ?? 0.4);
      else if (agent.streaming || busy) e.setVoice("processing", 0);
      else if (v.status === "recording" || v.status === "listening") e.setVoice("listening", v.level);
      else e.setVoice("none", 0);
    }, 50);
    return () => clearInterval(iv);
  }, [agent.streaming, busy]);

  // ---- data loads -------------------------------------------------------------------
  const liveKey = useRef("");
  const loadChart = useCallback(async (asset: string, timeframe: Timeframe): Promise<{ error: string } | { data: any }> => {
    try {
      const r = await fetch(`/api/mike/chart?asset=${encodeURIComponent(asset)}&tf=${timeframe}&bars=240`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) return { error: j.error || "Couldn't load that chart." };
      const d = j.data;
      setChart(d.chart);
      setChartMeta({ asset: d.asset.display, tf: timeframe, freshness: d.freshness, note: d.note, price: d.price, regime: d.regime });
      setLiveMeta({ symbol: d.asset.symbol, display: d.asset.display, name: d.asset.name ?? null, exchange: d.asset.exchange, tf: timeframe, freshness: d.freshness, note: d.note, source: d.source, fetchedAt: d.fetchedAt });
      setStreamSym(d.stream?.symbol ?? null);
      const key = `${d.asset.symbol}:${timeframe}`;
      if (key !== liveKey.current) { liveKey.current = key; setLivePrice(null); }
      if (d.chart) engine.current?.setCandles(d.chart.candles.map((c: any) => ({ o: c.o, h: c.h, l: c.l, c: c.c })));
      return { data: d };
    } catch { return { error: "Network error — couldn't reach the chart feed." }; }
  }, [setChart]);

  // crypto: every trade updates the last candle live (Binance public stream)
  const lastTickUi = useRef(0);
  const streamState = useBinanceStream(streamSym, liveMeta?.tf ?? tf, (k) => {
    const c = chartRef.current;
    if (!c?.candles.length) return;
    const arr = c.candles, last = arr[arr.length - 1];
    if (k.t === last.t) arr[arr.length - 1] = k;
    else if (k.t > last.t) {
      arr.push(k);
      for (const key of ["ema20", "ema50", "ema200", "bbUpper", "bbLower", "vwap", "rsi"] as const) c[key].push(null);
    } else return;
    const now = Date.now();
    if (now - lastTickUi.current > 350) { lastTickUi.current = now; setLivePrice({ price: k.c, at: now }); }
  });

  const refreshMarket = useCallback(async (announce: boolean) => {
    try {
      const r = await fetch(`/api/mike/scan?tf=1h`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { if (announce) push(j.error || "SCAN FAILED", "warn"); return null; }
      const d = j.data as { rows: ScanRowDTO[]; summary: MarketSummary; scannedAt: string; activeSetups: ActiveSetup[] };
      setSummary(d.summary); setScannedAt(d.scannedAt); setActive(d.activeSetups);
      setTicker(d.rows.map((x) => ({ label: short(x.asset.display), price: x.price, change: x.change24hPct, bias: x.bias, freshness: x.freshness, spark: x.spark })));
      engine.current?.setLabels(d.rows.filter((x) => x.price != null).map((x) => ({ label: short(x.asset.display), value: fmtPct(x.change24hPct), up: x.change24hPct == null ? null : x.change24hPct >= 0 })));
      return d;
    } catch { if (announce) push("SCAN FAILED — NETWORK", "warn"); return null; }
  }, [push]);

  // first load: settings, market, chart, the journal's recent real history
  useEffect(() => {
    logActivity({ category: "agent", agent: "MIKE", action: "Opened MIKE", importance: 1 });
    (async () => {
      const s = await fetch("/api/mike/settings").then((r) => r.json()).then((j) => j.data?.settings as MikeSettings).catch(() => DEFAULT_SETTINGS);
      const set = s ?? DEFAULT_SETTINGS;
      setSettings(set); setTf(set.defaultTimeframe);
      const first = set.watchlist[0] ?? "BTC";
      setAssetQ(first);
      void loadChart(first, set.defaultTimeframe);
      // the boot log reports how the market feeds really came up
      const m = await refreshMarket(false);
      setFeeds(m && m.summary.withData > 0 ? { state: "ok", withData: m.summary.withData, total: m.summary.assets } : { state: "down" });
      const j = await fetch("/api/mike/journal?limit=5&insights=0").then((r) => r.json()).catch(() => null);
      for (const x of [...(j?.data?.signals ?? [])].reverse()) {
        push(`${x.asset} ${TF_LABEL[x.timeframe as Timeframe] ?? x.timeframe} · ${x.decision === "setup" ? `${String(x.direction).toUpperCase()} SETUP ${x.confidence}` : "NO TRADE"} · ${x.status.replace("_", " ")}`, x.decision === "setup" ? "ok" : "warn", new Date(x.createdAt).getTime());
      }
    })();
    const iv = setInterval(() => { if (!document.hidden) void refreshMarket(false); }, 90_000);
    return () => clearInterval(iv);
  }, [loadChart, refreshMarket, push]);

  // keep the chart current: streamed markets refresh their indicators every minute; everything
  // else is polled — every 10 s while the live chart is open, otherwise every 15–30 s
  const chartKey = useRef({ asset: "BTC", tf: "1h" as Timeframe });
  const chartTf = liveMeta?.tf ?? tf;
  useEffect(() => {
    chartKey.current = { asset: liveMeta?.symbol ?? assetQ, tf: chartTf };
    const every = streamState === "live" ? 60_000 : liveView ? 10_000 : TF_MS[chartTf] <= 900_000 ? 15_000 : 30_000;
    const iv = setInterval(() => { if (!document.hidden) void loadChart(chartKey.current.asset, chartKey.current.tf); }, every);
    return () => clearInterval(iv);
  }, [liveMeta?.symbol, assetQ, chartTf, liveView, streamState, loadChart]);

  // asset box: suggestions for ANY market as you type
  useEffect(() => {
    const q = assetQ.trim();
    if (q.length < 2 || catalogMatch(q)) { setAssetHits([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/mike/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((j) => setAssetHits(j?.data?.results ?? [])).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [assetQ]);

  // alerts + journal outcomes: checked every 2 minutes while MIKE is open
  useEffect(() => {
    const check = async () => {
      if (document.hidden) return;
      const j = await fetch("/api/mike/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }) }).then((r) => r.json()).catch(() => null);
      for (const f of j?.data?.fired ?? []) { push(`ALERT · ${f.message}`, "hot"); speak(f.message); }
      for (const r of j?.data?.resolved ?? []) push(`${r.asset} SETUP ${r.status.toUpperCase()}${r.r != null ? ` ${r.r}R` : ""}`, r.status === "won" ? "ok" : "warn");
    };
    const t = setTimeout(check, 20_000);
    const iv = setInterval(check, 120_000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [push, speak]);

  // ---- ANALYZE: layers → validation rings → trade sheet (or deliberate rejection) ----
  const showAnalysis = useCallback(async (a: MikeAnalysis, animate: boolean) => {
    const my = ++runId.current;
    const e = engine.current;
    setAnalysis(a);
    if (a.chart) { setChart(a.chart); e?.setCandles(a.chart.candles.map((c) => ({ o: c.o, h: c.h, l: c.l, c: c.c })), true); }
    void loadChart(a.asset.symbol, a.timeframe); // same bars, plus the live stream when there is one
    setChartMeta({ asset: a.asset.display, tf: a.timeframe, freshness: a.data.freshness, note: a.data.note, price: a.primary?.snapshot.price ?? null, regime: a.regime });
    if (a.data.freshness === "unavailable" || !a.primary) {
      push(`${a.asset.display} · LIVE DATA UNAVAILABLE`, "warn");
      setPhase("no_trade"); setCoreState("no_trade");
      speak(spokenSummary(a));
      return;
    }
    push(`${a.asset.display} ANALYZED · ${a.regime.label.split(" · ")[0]}`, "info");
    for (const ev of a.primary.events.slice(-2)) push(`${ev.kind} ${ev.dir.toUpperCase()} · ${fmtPrice(ev.price)}`, "info");
    for (const s of a.primary.scanEvents.slice(0, 3)) push(`${short(a.asset.display)} · ${SCAN_EVENT_LABEL[s].toUpperCase()}`, s === "volume_spike" || s === "breakout" || s === "breakdown" ? "hot" : "info");
    const aligned = a.alignment.filter((r) => r.bias === (a.direction === "short" ? "bearish" : "bullish")).length;
    if (a.alignment.length > 1) push(`TIMEFRAME ALIGNMENT ${aligned}/${a.alignment.length}`, aligned >= a.alignment.length - 1 ? "ok" : "warn");
    if (animate && a.checks.length) {
      const rings: RingSpec[] = RING_ORDER.map((id) => ({ label: RING_NAME[id], state: a.checks.find((c) => c.id === id)?.state ?? "unavailable" }));
      e?.validate(rings, 420);
      setCoreState("validating");
      await wait(250 + rings.length * 420 + 650);
      if (my !== runId.current) return;
    }
    if (a.decision === "setup" && a.setup) {
      const r = sheetRef.current?.getBoundingClientRect();
      if (r && e) { e.pulse(); e.emitTo(r.left + r.width * 0.3, r.top + r.height * 0.3, 90); }
      await wait(animate ? 700 : 0);
      if (my !== runId.current) return;
      setPhase("ready"); setAlertKey((k) => k + 1); setCoreState("alert");
      push(`SETUP VALIDATED · ${short(a.asset.display)} ${a.setup.direction.toUpperCase()} · ${a.confidence.score}/100`, "hot");
      speak(spokenSummary(a));
      await wait(3500);
      if (my === runId.current) setCoreState("complete");
    } else {
      setPhase("no_trade"); setCoreState("no_trade");
      push(`NO TRADE · ${(a.noTradeReasons[0] ?? "INSUFFICIENT EVIDENCE").split(" — ")[0]}`, "warn");
      speak(spokenSummary(a));
      await wait(9000);
      if (my === runId.current) setCoreState("idle");
    }
  }, [push, speak, loadChart, setChart]);
  showAnalysisRef.current = showAnalysis;

  const runAnalysis = useCallback(async (assetText: string, timeframe: Timeframe, opts: { quiet?: boolean } = {}) => {
    // catalogue names resolve here; anything else (Reliance, Tesla, PEPE…) is looked up by the server
    const known = catalogMatch(assetText);
    const ref = known ?? { display: assetText.trim().toUpperCase(), symbol: assetText.trim(), kind: market === "all" ? undefined : market };
    if (!ref.symbol) return null;
    setBusy("analyze");
    runId.current++;
    setPhase("building"); setCoreState("analyzing");
    engine.current?.layers(LAYERS, 480);
    push(`ANALYZING ${ref.display} · ${TF_LABEL[timeframe]}${mode === "mtf" ? " + MTF" : ""}`, "info");
    if (!opts.quiet) void loadChart(ref.symbol, timeframe);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/mike/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset: ref.symbol, timeframe, mode, market: ref.kind }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Analysis failed.");
      await wait(Math.max(0, 3300 - (Date.now() - t0))); // let the analysis layers finish travelling into the core
      await showAnalysis(j.data as MikeAnalysis, true);
      return j.data as MikeAnalysis;
    } catch (err) {
      push(`ANALYSIS FAILED · ${(err as Error).message}`.slice(0, 90), "warn");
      speak((err as Error).message);
      setPhase(analysis ? "no_trade" : "empty"); setCoreState("idle");
      return null;
    } finally { setBusy(null); }
  }, [market, mode, push, speak, loadChart, showAnalysis, analysis]);

  // ---- SCAN → FILTER → ANALYZE → VALIDATE --------------------------------------------
  const runScan = useCallback(async (findSetups: boolean) => {
    setBusy("scan");
    const e = engine.current;
    e?.scanStart(settings.watchlist.map((s) => s.toUpperCase()), 30_000);
    setCoreState("scanning");
    push("MARKET SCAN STARTED", "info");
    speak(findSetups ? "Scanning for high-confidence setups." : "Scanning the market.");
    const d = await refreshMarket(true);
    if (!d) { setBusy(null); setCoreState("idle"); return; }
    const withData = d.rows.filter((r) => r.freshness !== "unavailable");
    const keep = withData.filter((r) => r.interest >= 30).sort((a, b) => b.interest - a.interest);
    const drop = d.rows.filter((r) => !keep.includes(r));
    e?.scanResult(keep.map((r) => short(r.asset.display).toUpperCase()), drop.map((r) => short(r.asset.display).toUpperCase()));
    for (const r of d.rows) {
      if (r.freshness === "unavailable") { push(`${short(r.asset.display)} · DATA UNAVAILABLE`, "warn"); continue; }
      if (r.eventLabels.length) push(`${short(r.asset.display)} · ${r.eventLabels.slice(0, 2).join(", ").toUpperCase()}`, r.events.some((x) => ["breakout", "breakdown", "volume_spike", "unusual_activity"].includes(x)) ? "hot" : "info");
    }
    await wait(1800);
    setBusy(null);
    if (!findSetups) {
      const line = `Scanned ${d.summary.withData} of ${d.summary.assets} markets. Trend ${d.summary.trend}, volatility ${d.summary.volatility}.${keep.length ? ` Most active: ${keep.slice(0, 3).map((r) => short(r.asset.display)).join(", ")}.` : " Nothing stands out right now."}`;
      speak(line); setCoreState("idle");
      return;
    }
    // analyse the strongest candidates (real multi-timeframe analysis for each)
    const found: string[] = [];
    for (const r of keep.slice(0, 3)) {
      const a = await runAnalysis(r.asset.symbol, tf, { quiet: false });
      if (a?.decision === "setup" && a.setup) found.push(`${short(a.asset.display)} ${a.setup.direction} at ${a.confidence.score}`);
      await wait(1200);
    }
    speak(found.length ? `Validated setups: ${found.join("; ")}. ${RISK_WARNING}` : "No high-conviction setups right now. Insufficient evidence — no trade.");
  }, [settings.watchlist, push, speak, refreshMarket, runAnalysis, tf]);

  // ---- commands (voice + text) ----------------------------------------------------------
  // ---- LIVE CHART of any market ---------------------------------------------------------
  const openChart = useCallback(async (query: string | null, timeframe: Timeframe | null) => {
    const q = (query ?? liveMeta?.symbol ?? assetQ).trim();
    const t = timeframe ?? liveMeta?.tf ?? tf;
    if (!q) return;
    setLiveView(true); setChartLoading(true);
    push(`PULLING UP ${q.toUpperCase()} · ${TF_LABEL[t]}`, "info");
    engine.current?.pulse();
    const r = await loadChart(q, t);
    setChartLoading(false);
    if ("error" in r) { push(`CHART · ${r.error}`.slice(0, 90), "warn"); speak(r.error); return; }
    const d = r.data;
    setTf(t); setAssetQ(short(d.asset.display));
    const label = d.freshness === "unavailable" ? "DATA UNAVAILABLE" : d.stream ? "LIVE STREAM" : String(d.freshness).toUpperCase();
    push(`CHART · ${short(d.asset.display)} · ${TF_LABEL[t]} · ${label}`, d.freshness === "unavailable" ? "warn" : "ok");
    const who = d.asset.name ?? short(d.asset.display).replace("/", " ");
    speak(d.freshness === "unavailable" ? `Live data for ${who} is unavailable right now.`
      : `Here's the live ${who} chart.${d.freshness === "delayed" ? " This feed can lag the exchange by up to fifteen minutes." : d.freshness === "closed" ? " The market is closed, so this is the last session." : ""}`);
  }, [liveMeta, assetQ, tf, loadChart, push, speak]);
  openChartRef.current = openChart;

  // opened from JARVIS with ?chart=… → pull it up once MIKE has booted
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!booted || deepLinked.current) return;
    deepLinked.current = true;
    const sp = new URLSearchParams(window.location.search);
    const sym = sp.get("chart");
    if (!sym) return;
    const tfp = sp.get("tf");
    window.history.replaceState(null, "", window.location.pathname);
    void openChart(sym, (TIMEFRAMES as readonly string[]).includes(tfp ?? "") ? (tfp as Timeframe) : null);
  }, [booted, openChart]);

  const deactivate = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    speak("MIKE standing down. Back to JARVIS.");
    setTimeout(() => router.push("/dashboard"), 1100);
  }, [leaving, router, speak]);

  const handle = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;
    if (isMikeDeactivation(text)) { deactivate(); return; }
    const cmd = parseMikeCommand(text);
    switch (cmd.kind) {
      case "exit": deactivate(); return;
      case "chart": void openChart(cmd.query, cmd.timeframe); return;
      case "close_chart": setLiveView(false); speak("Chart closed."); return;
      case "scan": void runScan(cmd.setups); return;
      case "analyze": {
        const name = cmd.asset ? short(cmd.asset.display) : assetQ;
        const t = cmd.timeframe ?? tf;
        setAssetQ(name); setTf(t);
        void runAnalysis(cmd.asset?.symbol ?? name, t);
        return;
      }
      case "backtest": setModal({ kind: "backtest", auto: true, asset: cmd.asset ? short(cmd.asset.display) : (analysis ? short(analysis.asset.display) : assetQ), tf: cmd.timeframe ?? tf }); speak("Running the backtest. These are historical results, not a promise."); return;
      case "journal": setModal({ kind: "journal" }); return;
      case "alerts": setModal({ kind: "alerts" }); return;
      case "risk": setModal({ kind: "risk" }); return;
      default: {
        // the brain gets what's on screen, so "why no trade?" / "explain this chart" are about THIS analysis
        const ctx = analysis ? `\n\n[On screen: MIKE analysis of ${analysis.asset.display} ${TF_LABEL[analysis.timeframe]} at ${analysis.generatedAt} (${analysis.data.freshness} data, ${analysis.data.source}). Decision: ${analysis.decision === "setup" ? `${analysis.setup?.direction} setup, entry ${fmtPrice(analysis.setup?.entryLow)}–${fmtPrice(analysis.setup?.entryHigh)}, stop ${fmtPrice(analysis.setup?.stop)}, targets ${analysis.setup?.targets.map((t) => fmtPrice(t.price)).join("/")}` : "NO TRADE"}. Reasons: ${analysis.noTradeReasons.join("; ") || "none"}. Checks: ${analysis.checks.map((c) => `${CHECK_LABEL[c.id]} ${c.state} (${c.detail})`).join("; ")}. Confidence ${analysis.confidence.score}/100. Regime: ${analysis.regime.label}.]` : "";
        void agent.send((text + ctx).slice(0, 7800), { agent: "mike" });
      }
    }
  }, [deactivate, runScan, runAnalysis, openChart, assetQ, tf, analysis, agent, speak]);
  handleRef.current = handle;

  const explain = useCallback(() => handle(phase === "no_trade" ? "Mike, why is this a no-trade?" : "Mike, explain this chart and the setup."), [handle, phase]);

  const setRow = useCallback((key: LevelKey, el: HTMLElement | null) => { rows.current[key] = el; }, []);
  const suggestions = useMemo(() => catalog(market === "all" ? undefined : market), [market]);
  const regime = analysis?.regime ?? (chartMeta?.regime as MikeAnalysis["regime"] | undefined) ?? null;
  const vState = voice.status === "speaking" ? "MIKE SPEAKING" : agent.streaming || busy ? "PROCESSING" : voice.status === "recording" ? "LISTENING" : null;
  const showSetup = phase === "ready" && analysis?.decision === "setup";

  return (
    <div className={cn("mike-bg relative min-h-[calc(100vh-4rem)] overflow-hidden text-slate-100 transition-opacity duration-700", leaving && "opacity-0")}>
      <div className="mike-grid pointer-events-none absolute inset-0" />
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" aria-hidden />
      <Connectors levels={levels} rows={rows} visible={showSetup} />

      <div className="relative z-10 flex min-h-[calc(100vh-4rem)] flex-col xl:h-[calc(100vh-4rem)]">
        {/* ---- command bar ---- */}
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-4" style={fly(booted, "up", 0)}>
          <div className="mr-2 leading-none">
            <div className="text-2xl font-bold tracking-[0.35em] text-white" style={{ textShadow: "0 0 18px rgba(34,211,238,.6)" }}>MIKE</div>
            <div className="hud-label text-[8px] tracking-[0.25em] text-cyan-300/70">MARKET INTELLIGENCE &amp; KNOWLEDGE ENGINE</div>
          </div>
          <select value={market} onChange={(e) => setMarket(e.target.value as MarketKind | "all")} aria-label="Market" className="mike-glass rounded-lg px-2 py-1.5 text-xs text-slate-100">
            <option value="all">All markets</option>
            {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <input list="mike-assets" value={assetQ} onChange={(e) => setAssetQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runAnalysis(assetQ, tf); }} aria-label="Asset" placeholder="Asset or ticker" className="mike-glass w-32 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-slate-500" />
          <datalist id="mike-assets">
            {assetHits.map((s) => <option key={`h-${s.symbol}`} value={s.symbol}>{`${s.name ?? s.display} · ${s.exchange}`}</option>)}
            {suggestions.map((s) => <option key={s.symbol} value={short(s.display)}>{s.exchange}</option>)}
          </datalist>
          <div className="mike-glass flex overflow-hidden rounded-lg">
            {TIMEFRAMES.map((t) => (
              <button key={t} onClick={() => { setTf(t); void loadChart(liveMeta?.symbol ?? assetQ, t); }} className={cn("px-2 py-1.5 font-mono text-[10.5px] transition", t === tf ? "bg-cyan-400/20 text-cyan-100" : "text-slate-400 hover:text-slate-100")}>{TF_LABEL[t]}</button>
            ))}
          </div>
          <button onClick={() => setMode(mode === "mtf" ? "single" : "mtf")} className="mike-btn mike-glass rounded-lg px-2 py-1.5 text-[10.5px] text-slate-200" title="Analysis mode">{mode === "mtf" ? "MULTI-TIMEFRAME" : "SINGLE TIMEFRAME"}</button>
          <button onClick={() => void runAnalysis(assetQ, tf)} disabled={!!busy} className="mike-btn rounded-lg border border-cyan-300/50 bg-cyan-400/15 px-3 py-1.5 text-xs font-semibold tracking-wider text-cyan-50 disabled:opacity-50">
            {busy === "analyze" ? <Loader2 className="h-4 w-4 animate-spin" /> : "ANALYZE"}
          </button>
          <button onClick={() => void openChart(assetQ, tf)} className="mike-btn mike-glass flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wider text-slate-100" title="Open the live chart of this market"><CandlestickChart className="h-3.5 w-3.5" /> LIVE CHART</button>
          <button onClick={() => void runScan(false)} disabled={!!busy} className="mike-btn mike-glass flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wider text-slate-100 disabled:opacity-50"><Radar className="h-3.5 w-3.5" /> SCAN</button>
          <div className="ml-auto flex items-center gap-1.5">
            <IconBtn label="Backtest" onClick={() => setModal({ kind: "backtest" })}><FlaskConical className="h-4 w-4" /></IconBtn>
            <IconBtn label="Signal journal" onClick={() => setModal({ kind: "journal" })}><BookOpen className="h-4 w-4" /></IconBtn>
            <IconBtn label="Alerts" onClick={() => setModal({ kind: "alerts" })}><Bell className="h-4 w-4" /></IconBtn>
            <IconBtn label="Risk settings" onClick={() => setModal({ kind: "risk" })}><ShieldCheck className="h-4 w-4" /></IconBtn>
            <IconBtn label={voiceStarted ? (voice.muted ? "Unmute voice" : "Mute voice") : "Start voice"} onClick={() => (voiceStarted ? voice.toggleMute() : void enableVoice())} active={voiceStarted && !voice.muted}>{voiceStarted && !voice.muted ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}</IconBtn>
            <IconBtn label="Back to JARVIS" onClick={deactivate}><LogOut className="h-4 w-4" /></IconBtn>
          </div>
        </div>

        {/* ---- main three-part composition ---- */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 sm:px-4 xl:grid-cols-[290px_minmax(0,1fr)_400px]">
          {/* LEFT — market intelligence */}
          <div className="mike-scroll order-3 flex min-h-0 flex-col gap-3 xl:order-1 xl:overflow-y-auto" style={fly(booted, "left", 120)}>
            <div className="mike-glass rounded-xl p-3">
              <div className="hud-label mb-2 text-[9px] tracking-[0.25em] text-cyan-300/80">MARKET INTELLIGENCE</div>
              <RegimeOrb regime={regime?.id ?? null} volatility={regime?.volatility ?? null} label={regime?.label ?? null} />
              <div className="mt-3"><MarketPanel s={summary} regime={regime?.label ?? null} active={active} scannedAt={scannedAt} /></div>
            </div>
            <div className="mike-glass flex min-h-[220px] flex-1 flex-col rounded-xl p-3 xl:min-h-0">
              <div className="hud-label mb-2 text-[9px] tracking-[0.25em] text-cyan-300/80">INTELLIGENCE STREAM</div>
              <IntelStream items={stream} />
            </div>
          </div>

          {/* CENTER — MIKE core + chart */}
          <div className="order-1 flex min-h-0 flex-col gap-3 xl:order-2">
            <div ref={anchorRef} className="relative flex h-[40vh] min-h-[260px] items-end justify-center xl:h-auto xl:flex-1">
              <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 text-center" style={fly(booted, "up", 300)}>
                <div className="hud-label text-[9px] tracking-[0.4em] text-cyan-300/60">MIKE AI CORE</div>
              </div>
              <div className="pointer-events-none mb-2 text-center" style={fly(booted, "down", 380)}>
                <div key={vState ?? coreState} className={cn("mike-in font-mono text-xs font-bold tracking-[0.3em]", coreState === "no_trade" ? "text-amber-200" : coreState === "alert" ? "text-white" : "text-cyan-200")} style={{ textShadow: "0 0 12px rgba(34,211,238,.6)" }}>{vState ?? CORE_TEXT[coreState]}</div>
                {chartMeta && <div className="mt-0.5 font-mono text-[10px] text-slate-400">{chartMeta.asset} · {TF_LABEL[chartMeta.tf]} · {livePrice ? fmtPrice(livePrice.price) : chartMeta.price != null ? fmtPrice(chartMeta.price) : "—"}</div>}
              </div>
            </div>
            <div className="mike-glass relative h-[330px] shrink-0 rounded-xl p-2" style={fly(booted, "down", 240)}>
              <div className="flex items-center justify-between px-1 pb-1">
                <div className="flex items-center gap-2">
                  <span className="hud-label text-[9px] tracking-[0.2em] text-cyan-300/80">CHART</span>
                  {chartMeta && <FreshBadge f={chartMeta.freshness} note={chartMeta.note} />}
                </div>
                <div className="relative">
                  <button onClick={() => setShowChartOpts((v) => !v)} className="mike-btn flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300"><SlidersHorizontal className="h-3 w-3" /> INDICATORS</button>
                  <button onClick={() => setLiveView(true)} aria-label="Full-screen live chart" title="Full-screen live chart" className="mike-btn ml-1 inline-flex items-center rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300"><Maximize2 className="h-3 w-3" /></button>
                  {showChartOpts && (
                    <div className="mike-glass-strong absolute right-0 top-6 z-20 w-44 rounded-lg p-2">
                      {(Object.keys(toggles) as (keyof ChartToggles)[]).map((k) => (
                        <label key={k} className="flex items-center gap-2 py-0.5 text-[11px] text-slate-200">
                          <input type="checkbox" checked={toggles[k]} onChange={() => setToggles({ ...toggles, [k]: !toggles[k] })} />
                          {({ ema: "EMA 20 / 50 / 200", bb: "Bollinger Bands", vwap: "VWAP", levels: "Levels & S/R", structure: "Structure (HH/HL, BOS)", volume: "Volume", rsi: "RSI pane" } as const)[k]}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="h-[calc(100%-22px)]">
                {chart ? (
                  <MikeChart chart={chart} setup={showSetup ? analysis!.setup : null} toggles={toggles} timeframe={chartMeta?.tf ?? tf} onLevels={setLevels} replayKey={`${chartMeta?.asset}-${chartMeta?.tf}-${analysis?.generatedAt ?? ""}`} />
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-xs text-slate-400">
                    {chartMeta?.freshness === "unavailable" ? <span className="font-mono font-bold tracking-widest text-rose-300">LIVE DATA UNAVAILABLE<span className="mt-1 block font-sans text-[11px] font-normal tracking-normal text-slate-400">{chartMeta.note}</span></span> : <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT — the large trade sheet */}
          <div className="mike-scroll order-2 flex min-h-0 flex-col gap-3 xl:order-3 xl:overflow-y-auto xl:pr-1" style={fly(booted, "right", 180)}>
            <div ref={sheetRef}><TradeSheet analysis={analysis} phase={phase} alertKey={alertKey} rowRef={setRow} onExplain={analysis ? explain : undefined} /></div>
            <AlignmentTable a={analysis} />
            {analysis?.external && (
              <div className="mike-glass rounded-xl p-3 text-[11px]">
                <div className="hud-label text-[9px] tracking-[0.2em] text-cyan-300/80">EXTERNAL INFORMATION · NEWS</div>
                {analysis.external.available ? (
                  <>
                    <div className="mt-1 text-slate-400">{analysis.external.note}</div>
                    {analysis.external.eventRisk.length > 0 && <div className="mt-1 text-amber-200">Event risk: {analysis.external.eventRisk.join(", ")}</div>}
                    {analysis.external.headlines.slice(0, 4).map((h) => (
                      <a key={h.url} href={h.url} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-slate-200 hover:text-cyan-200">
                        <span className={h.tone > 0 ? "text-emerald-300" : h.tone < 0 ? "text-rose-300" : "text-slate-500"}>{h.tone > 0 ? "▲" : h.tone < 0 ? "▼" : "•"}</span> {h.title} <span className="text-slate-500">· {h.source}</span>
                      </a>
                    ))}
                  </>
                ) : <div className="mt-1 text-slate-400">{analysis.external.note}</div>}
              </div>
            )}
          </div>
        </div>

        {/* ---- MIKE line + text command ---- */}
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2 sm:px-4" style={fly(booted, "down", 420)}>
          <form onSubmit={(e) => { e.preventDefault(); handle(input); setInput(""); }} className="mike-glass flex min-w-[260px] flex-1 items-center gap-2 rounded-lg px-2 py-1">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="“Mike, analyze NIFTY on the 4 hour” · “find high-confidence setups” · “why is this a no-trade?”" className="flex-1 bg-transparent py-1 text-xs text-white outline-none placeholder:text-slate-500" aria-label="Command MIKE" />
            <button type="submit" aria-label="Send" className="text-cyan-200 hover:text-white">{agent.streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
          </form>
          {(reply || voice.transcript) && (
            <div className="mike-glass max-w-full flex-[2] truncate rounded-lg px-3 py-1.5 text-[11px] text-slate-200" title={reply ?? ""}>
              {voice.transcript ? <span className="text-cyan-200">“{voice.transcript}”</span> : <><span className="font-semibold text-cyan-300">MIKE:</span> {reply}</>}
            </div>
          )}
        </div>

        {/* ---- global market ticker ---- */}
        <div className="border-t border-cyan-400/10 bg-slate-950/40" style={fly(booted, "down", 500)}><Ticker items={ticker} /></div>
      </div>

      {liveView && (
        <LiveChartView
          meta={liveMeta} chart={chart} livePrice={livePrice} stream={streamState} loading={chartLoading}
          toggles={toggles} setToggles={setToggles}
          setup={showSetup && analysis && liveMeta && analysis.asset.symbol === liveMeta.symbol && analysis.timeframe === liveMeta.tf ? analysis.setup : null}
          onTimeframe={(t) => void openChart(liveMeta?.symbol ?? assetQ, t)}
          onPick={(q) => void openChart(q, null)}
          onClose={() => setLiveView(false)}
          onAnalyze={() => { setLiveView(false); void runAnalysis(liveMeta?.symbol ?? assetQ, liveMeta?.tf ?? tf); }}
        />
      )}
      {showBoot && <BootOverlay durationMs={BOOT_MS} feeds={feeds} top={bootTop} onExit={() => setBooted(true)} onGone={() => setShowBoot(false)} />}

      {modal?.kind === "backtest" && <BacktestPanel asset={modal.asset ?? (analysis ? short(analysis.asset.display) : assetQ)} timeframe={modal.tf ?? tf} autoRun={modal.auto} onClose={() => setModal(null)} onResult={(r) => { push(`BACKTEST · ${short(r.asset.display)} · ${r.totalTrades} TRADES · ${r.winRate}%`, "info"); speak(`Backtest done: ${r.totalTrades} trades, win rate ${r.winRate} percent, expectancy ${r.expectancyR} R. These are backtest results, not live performance.`); }} />}
      {modal?.kind === "journal" && <JournalPanel onClose={() => setModal(null)} />}
      {modal?.kind === "alerts" && <AlertsPanel asset={analysis ? short(analysis.asset.display) : assetQ} timeframe={tf} onClose={() => setModal(null)} />}
      {modal?.kind === "risk" && <RiskPanel onClose={() => setModal(null)} onSaved={(s) => { setSettings(s); push("RISK SETTINGS UPDATED", "ok"); }} />}
    </div>
  );
}

function IconBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={cn("mike-btn mike-glass flex h-8 w-8 items-center justify-center rounded-lg", active ? "text-cyan-200" : "text-slate-300")}>{children}</button>
  );
}

function FreshBadge({ f, note }: { f: string; note: string }) {
  const m: Record<string, [string, string]> = {
    live: ["LIVE", "text-emerald-300 border-emerald-400/40"], delayed: ["DELAYED", "text-amber-300 border-amber-400/40"],
    closed: ["MARKET CLOSED", "text-slate-300 border-slate-400/40"], stale: ["STALE", "text-rose-300 border-rose-400/40"],
    unavailable: ["LIVE DATA UNAVAILABLE", "text-rose-300 border-rose-400/40"],
  };
  const [t, c] = m[f] ?? m.delayed;
  return <span title={note} className={cn("rounded border px-1.5 py-px font-mono text-[9px] tracking-wider", c)}>{f === "live" && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}{t}</span>;
}
