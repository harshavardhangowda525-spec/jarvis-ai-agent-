"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadCard, NodeView } from "@/lib/robin/overview";
import { NODES, money, type NodeId } from "@/lib/robin/types";
import { contactStatus, initials, leadStatus } from "./orbit-pipeline";

/**
 * A stage, expanded: EVERY lead in it (most in need of you first) with search,
 * quick filters and the follow-up / move actions. Rows can be dragged onto any
 * stage on the arc as well.
 */

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "high", label: "High priority", test: (l: LeadCard) => l.priority === "high" },
  { id: "due", label: "Follow-up due", test: (l: LeadCard) => !!l.flag },
  { id: "reach", label: "Reachable", test: (l: LeadCard) => l.phone || l.whatsapp || l.email },
  { id: "none", label: "No follow-up set", test: (l: LeadCard) => !l.nextFollowUpAt },
] as const;

export function StagePanel({ node, currency, tz, style, className, onClose, onOpenLead, onFollowUp, onMove, beginDrag }: {
  node: NodeView; currency: string; tz: string; style?: React.CSSProperties; className?: string;
  onClose: () => void;
  onOpenLead: (id: string) => void;
  onFollowUp: (id: string) => void;
  onMove: (lead: LeadCard, to: NodeId) => void;
  beginDrag: (e: React.PointerEvent, lead: LeadCard, from: NodeId) => void;
}) {
  const [all, setAll] = useState<LeadCard[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [shown, setShown] = useState(60);
  useEffect(() => {
    let live = true;
    void fetch(`/api/robin/leads?cards=${node.id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (live && Array.isArray(j?.data?.cards)) setAll(j.data.cards); }).catch(() => {});
    return () => { live = false; };
  }, [node.id, node.count]);
  useEffect(() => { setShown(60); }, [q, filter, node.id]);
  const source = all ?? node.leads;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = FILTERS.find((x) => x.id === filter)!;
    return source.filter((l) => f.test(l) && (!needle || `${l.name} ${l.category ?? ""}`.toLowerCase().includes(needle)));
  }, [source, q, filter]);

  return (
    <div className={cn("robin-glass robin-expand flex flex-col rounded-2xl", className)} style={style} role="dialog" aria-label={`${node.label} leads`}>
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
        <p className="text-[10px] tracking-[0.26em] text-cyan-100">{node.label} <span className="text-slate-400">· {node.count} LEAD{node.count === 1 ? "" : "S"}{node.value ? ` · ${money(node.value, currency, true)}` : ""}</span></p>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label={`Search ${node.label.toLowerCase()} leads`}
          className="w-28 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/50" />
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
            className={cn("rounded-full border px-2 py-0.5 text-[10px] transition-colors", filter === f.id ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-50" : "border-white/10 text-slate-400 hover:text-slate-200")}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="robin-scroll mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.length === 0 ? (
          <p className="px-2 py-3 text-xs text-slate-400">{all === null ? "Loading every lead in this stage…" : q || filter !== "all" ? "No leads match." : "No leads in this stage right now."}</p>
        ) : list.slice(0, shown).map((l, i) => (
          <div key={l.id} className="robin-lead-row group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5" style={{ animationDelay: i < 14 ? `${i * 28}ms` : undefined }}>
            <span
              onPointerDown={(e) => beginDrag(e, l, node.id)}
              className={cn("robin-bubble flex h-7 w-7 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-full text-[9px] font-semibold active:cursor-grabbing", l.priority === "high" && "robin-bubble-high")}
              title="Drag onto a stage to move it" aria-hidden
            >{initials(l.name)}</span>
            <button type="button" onClick={() => onOpenLead(l.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[11.5px] font-medium text-slate-100 group-hover:text-white">{l.name}</span>
              <span className={cn("block truncate text-[10px]", l.flag === "overdue" ? "text-amber-300/90" : "text-slate-400")}>{leadStatus(l, tz)} · {contactStatus(l).replace("Reachable by ", "")}</span>
            </button>
            {l.value != null && <span className="hidden shrink-0 text-[10.5px] text-emerald-300/90 sm:block">{money(l.value, currency, true)}</span>}
            <div className="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
              <button type="button" onClick={() => onFollowUp(l.id)} title="Schedule a follow-up" aria-label={`Schedule a follow-up with ${l.name}`} className="rounded-full p-1.5 text-slate-300 hover:bg-cyan-300/10 hover:text-cyan-100"><CalendarClock className="h-3.5 w-3.5" /></button>
              <select
                value="" onChange={(e) => { const to = e.target.value as NodeId; if (to) onMove(l, to); }}
                aria-label={`Move ${l.name} to another stage`} title="Move to…"
                className="w-[22px] cursor-pointer appearance-none rounded-full bg-transparent p-1 text-center text-[11px] text-slate-300 outline-none hover:bg-cyan-300/10 hover:text-cyan-100"
              >
                <option value="">⇄</option>
                {NODES.filter((n) => n.id !== node.id).map((n) => <option key={n.id} value={n.id} className="bg-slate-900">{n.label}</option>)}
              </select>
              <button type="button" onClick={() => onOpenLead(l.id)} title="Open" aria-label={`Open ${l.name}`} className="rounded-full p-1.5 text-slate-300 hover:bg-cyan-300/10 hover:text-cyan-100"><ExternalLink className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
        {list.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + 200)} className="robin-btn mt-1 w-full rounded-full border border-white/10 py-1 text-[10px] tracking-[0.18em] text-slate-300">SHOW {Math.min(200, list.length - shown)} MORE OF {list.length}</button>
        )}
      </div>
    </div>
  );
}
