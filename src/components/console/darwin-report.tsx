"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Radar, X } from "lucide-react";
import type { DarwinDailyView } from "@/lib/darwin/daily/run";
import { DailyReportModal } from "./darwin/daily-target";

/**
 * JARVIS side of DARWIN's daily search: keeps an unfinished run moving while
 * JARVIS is open, and when today's search finishes, reports it once — spoken,
 * plus a liquid-glass card — then marks it reported so it isn't repeated.
 */
export function useDarwinReport(opts: { speak: (t: string) => void }) {
  const [view, setView] = useState<DarwinDailyView | null>(null);
  const [card, setCard] = useState(false);
  const [modal, setModal] = useState(false);
  const speakRef = useRef(opts.speak); speakRef.current = opts.speak;
  const ticking = useRef(false);
  const announced = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/darwin/daily", { cache: "no-store" });
      if (!r.ok) return null;
      const v = (await r.json())?.data as DarwinDailyView | undefined;
      if (v) setView(v);
      return v ?? null;
    } catch { return null; }
  }, []);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const loop = async () => {
      const v = await load();
      if (v?.run?.status === "running" && !ticking.current) {
        ticking.current = true;
        fetch("/api/darwin/daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tick" }) })
          .then((r) => r.json()).then((j) => { if (j?.data) setView(j.data); }).catch(() => {}).finally(() => { ticking.current = false; });
      }
      const finished = v?.run && (v.run.status === "completed" || v.run.status === "partial");
      if (finished && !v!.run!.reportedAt && v!.report && announced.current !== v!.run!.id) {
        announced.current = v!.run!.id;
        setCard(true);
        if (v!.spoken) speakRef.current(v!.spoken);
        fetch("/api/darwin/daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ack" }) }).catch(() => {});
      }
      if (alive) t = setTimeout(loop, v?.run?.status === "running" ? 20_000 : 5 * 60_000);
    };
    t = setTimeout(loop, 6000);
    return () => { alive = false; clearTimeout(t); };
  }, [load]);

  return { view, card, modal, openReport: () => { setCard(false); setModal(true); }, closeCard: () => setCard(false), closeModal: () => setModal(false), reload: load };
}

export function DarwinReportCard({ w, onOpenDarwin }: { w: ReturnType<typeof useDarwinReport>; onOpenDarwin: () => void }) {
  const r = w.view?.report;
  return (
    <>
      {w.card && r && (
        <div className="fixed left-3 top-20 z-[80] w-[min(360px,calc(100vw-24px))]" style={{ animation: "dw-pop-in .5s cubic-bezier(.2,.9,.25,1.15) both" }} data-darwin-report-card>
          <div className="relative overflow-hidden rounded-2xl border border-white/15 p-3.5 pr-9"
            style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.10), rgba(20,40,70,0.4))", backdropFilter: "blur(20px) saturate(140%)", WebkitBackdropFilter: "blur(20px) saturate(140%)", boxShadow: "0 18px 50px -20px rgba(80,200,255,0.55), inset 0 1px 0 rgba(255,255,255,0.2)" }}>
            <button onClick={w.closeCard} aria-label="Dismiss" className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>
            <div className="flex items-center gap-2 text-[10px] tracking-[0.3em] text-cyan-100/80"><Radar className="h-3.5 w-3.5" /> DARWIN DAILY REPORT</div>
            <div className="mt-1.5 flex items-baseline gap-1.5 text-white">
              <span className="text-3xl font-extralight tabular-nums">{r.verified}</span><span className="text-white/45">/ {r.target} verified no-website leads</span>
            </div>
            <div className="mt-1 text-[11.5px] text-white/65">{r.contactable} contactable · {r.highPotential} high-potential · {r.duplicates} duplicates removed · {r.websiteRejected} with websites rejected</div>
            {r.status !== "completed" && r.reasons[0] && <div className="mt-1 text-[11px] text-amber-100/75">{r.reasons[0]}</div>}
            <div className="mt-2.5 flex gap-2">
              <button onClick={w.openReport} className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-white/85 hover:bg-white/10">Daily report</button>
              <button onClick={() => { w.closeCard(); onOpenDarwin(); }} className="rounded-full border border-cyan-200/30 bg-cyan-200/10 px-3 py-1 text-[11px] text-cyan-50 hover:bg-cyan-200/20">Open DARWIN</button>
            </div>
          </div>
        </div>
      )}
      {w.modal && w.view?.report && <DailyReportModal view={w.view} onClose={w.closeModal} onViewLeads={() => { w.closeModal(); onOpenDarwin(); }} />}
    </>
  );
}
