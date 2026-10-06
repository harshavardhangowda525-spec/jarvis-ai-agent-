"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ultronHealth } from "@/lib/local-ultron";
import { AGENT_NODES, STAGE_LABEL, type CheckStatus, type NodeId, type ScanEvent, type StageId } from "@/lib/system/types";
import { ScanEngine, scanLayout } from "./scan-engine";

/**
 * "Analyze the system": JARVIS's holographic self-diagnostic. The analysis
 * runs on the server and streams each real step; this view plays those steps
 * back — the stage, the agent being checked, every check's actual result —
 * at a pace the eye can follow. Nothing here is invented: the counter is
 * checks completed out of checks planned, and every warning is a real one.
 */

interface Line { node: NodeId; label: string; status: CheckStatus; detail: string }
type Summary = { ok: number; warn: number; fail: number; info: number };

const NODE_NAME: Record<NodeId, string> = { core: "JARVIS CORE", ...Object.fromEntries(AGENT_NODES.map((n) => [n.id, n.label])) } as Record<NodeId, string>;
const GLYPH: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✕", info: "·" };
const TONE: Record<CheckStatus, string> = { ok: "text-emerald-300", warn: "text-amber-300", fail: "text-rose-300", info: "text-cyan-100/60" };
/** How long each kind of step stays on screen (ms) — real steps, readable pace. */
const DWELL: Record<ScanEvent["type"], number> = { start: 900, stage: 900, focus: 650, check: 360, node: 260, done: 0, error: 0 };

export function spokenResult(s: Summary): string {
  const total = s.ok + s.warn + s.fail + s.info;
  if (s.fail) return `System analysis complete. ${total} checks: ${s.fail} failed and ${s.warn} need attention. The details are on screen.`;
  if (s.warn) return `System analysis complete. ${total} checks — no failures, ${s.warn} need attention. The details are on screen.`;
  return `System analysis complete. All ${total} checks passed.`;
}

export function SystemAnalysis({ onClose, onFinish }: { onClose: () => void; onFinish?: (s: Summary, issues: Line[]) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ScanEngine | null>(null);
  const [stage, setStage] = useState<StageId | null>(null);
  const [focus, setFocus] = useState<NodeId | null>(null);
  const [current, setCurrent] = useState<Line | null>(null);
  const [log, setLog] = useState<Line[]>([]);
  const [all, setAll] = useState<Line[]>([]);
  const [count, setCount] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const onFinishRef = useRef(onFinish); onFinishRef.current = onFinish;
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;

  // the canvas
  useEffect(() => {
    const c = canvasRef.current!;
    const e = new ScanEngine(c, AGENT_NODES);
    engine.current = e;
    const fit = () => { e.resize(); setSize({ w: c.clientWidth, h: c.clientHeight }); };
    fit(); e.start();
    window.addEventListener("resize", fit);
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", key);
    return () => { e.destroy(); window.removeEventListener("resize", fit); window.removeEventListener("keydown", key); };
  }, []);

  // the analysis: stream the real events, play each one
  useEffect(() => {
    const ac = new AbortController();
    const queue: ScanEvent[] = [];
    let ended = false, playing = false, stopped = false;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lines: Line[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, reduce ? ms * 0.5 : ms));

    const play = async () => {
      if (playing) return;
      playing = true;
      while (!stopped) {
        const ev = queue.shift();
        if (!ev) { if (ended) break; await sleep(60); continue; }
        const e = engine.current;
        switch (ev.type) {
          case "start": setCount({ done: 0, total: ev.total }); e?.begin(); break;
          case "stage": setStage(ev.stage); setCurrent(null); e?.setStage(ev.stage); break;
          case "focus": setFocus(ev.node); setCurrent(null); e?.focus(ev.node); break;
          case "check": {
            const line: Line = { node: ev.node, label: ev.label, status: ev.status, detail: ev.detail };
            lines.push(line);
            setCurrent(line); setAll([...lines]); setLog((l) => [...l.slice(-4), line]);
            setCount((c) => ({ ...c, done: c.done + 1 }));
            e?.check(ev.node, ev.status);
            break;
          }
          case "node": e?.setNode(ev.node, ev.state); break;
          case "done": {
            setFocus(null); setCurrent(null);
            e?.finish(ev.summary.fail ? "error" : ev.summary.warn ? "warning" : "healthy");
            setSummary(ev.summary);
            onFinishRef.current?.(ev.summary, lines.filter((l) => l.status === "warn" || l.status === "fail"));
            break;
          }
          case "error": setFailed(ev.message); break;
        }
        await sleep(DWELL[ev.type]);
      }
      playing = false;
    };

    (async () => {
      try {
        const ultron = await ultronHealth().catch(() => null);
        const res = await fetch("/api/system/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
          body: JSON.stringify({ ultron: ultron ? { known: ultron.known, reachable: ultron.reachable, brain: ultron.brain, ms: ultron.ms } : null }),
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => null);
          setFailed(j?.error || `The analysis couldn't start (HTTP ${res.status}).`);
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        void play();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (line) { try { queue.push(JSON.parse(line) as ScanEvent); } catch { /* skip a broken line */ } }
          }
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") setFailed("Couldn't reach the server for the analysis.");
      } finally {
        ended = true;
      }
    })();
    return () => { stopped = true; ac.abort(); };
  }, []);

  const L = scanLayout(size.w, size.h);
  const done = !!summary;
  const issues = all.filter((l) => l.status === "fail" || l.status === "warn");
  const pct = count.total ? count.done / count.total : 0;

  return (
    <div className="fixed inset-0 z-[180] overflow-hidden bg-[#02060e]/95 text-white backdrop-blur-sm" role="dialog" aria-label="System analysis" data-system-analysis={done ? "done" : failed ? "failed" : "running"}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(40,140,200,0.14),transparent_62%)]" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

      {/* HUD corner brackets */}
      {["left-3 top-3 border-l border-t", "right-3 top-3 border-r border-t", "left-3 bottom-3 border-l border-b", "right-3 bottom-3 border-r border-b"].map((c) => (
        <div key={c} className={cn("pointer-events-none absolute h-6 w-6 border-cyan-300/40 sm:h-9 sm:w-9", c)} />
      ))}

      {/* title */}
      <div className="absolute inset-x-0 top-5 flex justify-center px-14 sm:top-7">
        <div className="sys-in rounded-md border border-cyan-300/30 bg-cyan-400/[0.06] px-3 py-1.5 font-mono text-[10px] tracking-[0.28em] text-cyan-100 shadow-[0_0_24px_-8px_rgba(70,205,255,0.8)] backdrop-blur-md sm:text-[12px]">
          {done ? "SYSTEM ANALYSIS COMPLETE" : failed ? "SYSTEM ANALYSIS INTERRUPTED" : <>SYSTEM ANALYSIS MODE ACTIVE <span className="text-cyan-300/60">—</span> RUNNING DIAGNOSTIC</>}
        </div>
      </div>
      <button onClick={onClose} aria-label="Close system analysis" className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/5 p-2 text-cyan-100/70 backdrop-blur hover:text-white sm:right-6 sm:top-6">
        <X className="h-4 w-4" />
      </button>

      {/* current operation, under the constellation */}
      {!done && !failed && (
        <div className="absolute inset-x-0 flex flex-col items-center px-4 text-center" style={{ top: Math.min(size.h - 150, L.cy + L.ry + L.R * (L.narrow ? 1.85 : 0.9)) }} aria-live="polite">
          <div className="rounded-md border border-cyan-300/20 bg-[#04121f]/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-cyan-100/90 backdrop-blur-md sm:text-[11px]">
            CURRENT OPERATION: {stage ? STAGE_LABEL[stage] : "INITIALIZING"}{focus ? <span className="text-cyan-300/70"> · {NODE_NAME[focus]}</span> : null}
            <span className="ml-2 text-cyan-300/60">({count.done}/{count.total || "…"})</span>
          </div>
          <div className="mt-2 h-px w-56 overflow-hidden bg-cyan-300/15 sm:w-72"><div className="h-full bg-cyan-300/80 transition-[width] duration-300" style={{ width: `${pct * 100}%` }} /></div>
          {current && (
            <div key={`${current.node}-${current.label}`} className="sys-in mt-2 max-w-xl text-[12px] text-cyan-50/80">
              <span className={cn("mr-1.5 font-mono", TONE[current.status])}>{GLYPH[current.status]}</span>
              <span className="text-cyan-100">{current.label}</span><span className="text-cyan-100/50"> — {current.detail}</span>
            </div>
          )}
        </div>
      )}

      {/* live log (desktop) */}
      {!done && log.length > 0 && (
        <div className="pointer-events-none absolute bottom-6 left-6 hidden w-80 space-y-0.5 font-mono text-[10px] leading-tight md:block">
          {log.map((l, i) => (
            <div key={`${l.label}-${i}`} className="truncate text-cyan-100/50" style={{ opacity: 0.35 + (i / log.length) * 0.65 }}>
              <span className={TONE[l.status]}>{GLYPH[l.status]}</span> {NODE_NAME[l.node]} · {l.label}
            </div>
          ))}
        </div>
      )}

      {/* result */}
      {(done || failed) && (
        <div className="sys-in absolute inset-x-0 bottom-0 flex justify-center px-3 pb-4 sm:pb-8">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#061423]/70 p-4 shadow-[0_0_60px_-20px_rgba(70,205,255,0.6)] backdrop-blur-xl sm:p-5">
            {failed && !done ? (
              <div className="text-sm text-rose-200">{failed}</div>
            ) : summary && (
              <>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[12px]">
                  <span className="text-cyan-100">{count.done} CHECKS</span>
                  <span className="text-emerald-300">{summary.ok} PASSED</span>
                  <span className="text-amber-300">{summary.warn} ATTENTION</span>
                  <span className="text-rose-300">{summary.fail} FAILED</span>
                  <span className="text-cyan-100/50">{summary.info} NOTES</span>
                </div>
                {issues.length ? (
                  <div className="mt-3 max-h-[34vh] space-y-1 overflow-y-auto pr-1">
                    {issues.map((l, i) => (
                      <div key={i} className="text-[12px] leading-snug">
                        <span className={cn("mr-1.5 font-mono", TONE[l.status])}>{GLYPH[l.status]}</span>
                        <span className="text-cyan-100/90">{NODE_NAME[l.node]} · {l.label}</span>
                        <span className="text-cyan-50/55"> — {l.detail}</span>
                      </div>
                    ))}
                  </div>
                ) : <div className="mt-2 text-sm text-emerald-200">Every check passed.</div>}
                <div className="mt-3 text-[10px] text-cyan-100/40">Read-only analysis — nothing was changed.</div>
              </>
            )}
            <div className="mt-3 flex justify-end">
              <button onClick={onClose} className="rounded-md border border-cyan-300/30 px-3 py-1 font-mono text-[11px] tracking-wider text-cyan-100 hover:bg-cyan-300/10">CLOSE</button>
            </div>
          </div>
        </div>
      )}
      <style jsx>{`
        .sys-in { animation: sysIn 0.5s cubic-bezier(.2,.7,.2,1) both; }
        @keyframes sysIn { from { opacity: 0; transform: translateY(6px); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
        @media (prefers-reduced-motion: reduce) { .sys-in { animation: none; } }
      `}</style>
    </div>
  );
}
