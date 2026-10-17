"use client";

import { Eye, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DarwinDailyView } from "@/lib/darwin/daily/run";

/** DARWIN DAILY REPORT — computed from the run. */
export function DailyReportModal({ view, onClose, onViewLeads }: { view: DarwinDailyView; onClose: () => void; onViewLeads?: () => void }) {
  const r = view.report!;
  const max = Math.max(1, ...r.breakdown.map((b) => b.count));
  const date = new Date(`${r.date}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-3 backdrop-blur-[3px]" onClick={onClose}>
      <div className="dw-glass max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl p-5" onClick={(e) => e.stopPropagation()} style={{ animation: "ultron-emerge .4s ease both" }} data-darwin-report>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] tracking-[0.4em] text-cyan-100/70">DARWIN DAILY REPORT</div>
            <div className="mt-0.5 text-[13px] text-white/70">{date}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-4xl font-extralight tabular-nums text-white">{r.verified}</span>
          <span className="text-white/45">/ {r.target} verified new leads</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-1.5 text-[12px]">
          <Row k="Target" v={r.target} /><Row k="Verified new leads" v={r.verified} />
          <Row k="Duplicates removed" v={r.duplicates} /><Row k="Businesses with websites rejected" v={r.websiteRejected} />
          <Row k="Unclear website status" v={r.unclear} /><Row k="Website temporarily down" v={r.tempUnavailable} />
          <Row k="Contactable leads" v={r.contactable} /><Row k="High-potential leads" v={r.highPotential} />
          {r.alreadyChecked > 0 && <Row k="Checked on earlier days" v={r.alreadyChecked} />}
          {r.closed > 0 && <Row k="Permanently closed" v={r.closed} />}
        </div>
        {r.breakdown.length > 0 && (
          <div className="mt-5">
            <div className="text-[9px] tracking-[0.34em] text-white/45">LEAD BREAKDOWN</div>
            <div className="mt-2 space-y-1.5">
              {r.breakdown.map((b) => (
                <div key={b.bucket} className="flex items-center gap-2 text-[11.5px]">
                  <span className="w-32 shrink-0 text-white/70">{b.bucket}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full bg-gradient-to-r from-sky-300/80 to-cyan-200" style={{ width: `${(b.count / max) * 100}%` }} /></span>
                  <span className="w-6 text-right tabular-nums text-white/85">{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className={cn("mt-5 text-[12px] leading-relaxed", r.status === "completed" ? "text-emerald-100/85" : "text-amber-100/85")}>
          {r.status === "completed" ? "Search completed successfully." : `Search finished short of the target — ${r.target - r.verified} more couldn't be safely verified, so they weren't added.`}
        </p>
        {r.reasons.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-white/55">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
        <p className="mt-3 text-[10px] text-white/35">
          Verified with: business listing · website reachability · name/domain matching{r.sources.google ? " · Google business profile" : ""}{r.sources.search ? " · web search" : ""}.
        </p>
        {r.top.length > 0 && (
          <div className="mt-4">
            <div className="text-[9px] tracking-[0.34em] text-white/45">TOP LEADS</div>
            <ul className="mt-1.5 divide-y divide-white/5">
              {r.top.map((l) => (
                <li key={l.id} className="flex items-center gap-2 py-1.5 text-[11.5px]">
                  <span className="min-w-0 flex-1 truncate text-white/85">{l.name}<span className="text-white/35"> · {l.category ?? "Business"}</span></span>
                  <span className="shrink-0 text-white/50">{l.phone ?? "no phone"}</span>
                  {l.score != null && <span className="w-7 shrink-0 text-right tabular-nums text-cyan-200">{l.score}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {onViewLeads && r.verified > 0 && (
          <button onClick={onViewLeads} className="mt-4 flex items-center gap-1.5 rounded-full border border-cyan-200/25 bg-cyan-200/10 px-4 py-1.5 text-[11px] text-cyan-50 hover:bg-cyan-200/20"><Eye className="h-3.5 w-3.5" /> View these leads</button>
        )}
      </div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: number }) {
  return <div className="flex items-baseline justify-between gap-2 border-b border-white/5 pb-1"><span className="text-white/55">{k}</span><span className="tabular-nums text-white/90">{v}</span></div>;
}
