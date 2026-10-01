"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { LeadCard, NodeView } from "@/lib/robin/overview";
import { money, type NodeId } from "@/lib/robin/types";
import { Count, Money, reducedMotion } from "./anim";

/**
 * ROBIN's operational map: the live CRM as a connected, holographic pipeline.
 * Every node, count, value and card is a real CRM record. Drag a lead onto
 * another stage to move it (the database is updated, the card travels there);
 * click a stage to expand it, a card to open the lead. Three modes morph into
 * each other: PIPELINE (movement), FUNNEL (how far leads got), REVENUE
 * (potential value by stage, actual revenue at WON).
 */

export type ChartMode = "pipeline" | "funnel" | "revenue";
export interface PipelineHandle {
  /** Screen position of a stage (for the core's data arcs). */
  nodeCenter: (id: NodeId) => { x: number; y: number } | null;
  /** Animate a lead travelling from one stage to another. */
  travel: (name: string, from: NodeId, to: NodeId) => void;
}

interface Props {
  nodes: NodeView[];
  funnel: { id: NodeId; label: string; count: number }[];
  revenueWon: number;
  currency: string;
  mode: ChartMode;
  highlight: Partial<Record<NodeId, number>>;
  selectedLeadId: string | null;
  expanded: NodeId | null;
  topIds: Set<string>;
  onExpand: (id: NodeId | null) => void;
  onOpenLead: (id: string) => void;
  onMove: (lead: LeadCard, to: NodeId) => void;
  empty: boolean;
  onImport?: () => void;
}

const MAIN: NodeId[] = ["new", "qualified", "contacted", "interested", "follow_up", "demo", "quotation", "negotiation", "won"];
const MIN_W = 1180;
const CARD_H = 90;

function geometry(W: number) {
  const width = Math.max(W, MIN_W);
  // cards are centred on their stage, so the outer stages sit far enough in for a whole card
  const cw = Math.min((width - 180) / (MAIN.length - 1) - 12, 150);
  const padX = cw / 2 + 10;
  const spacing = (width - padX * 2) / (MAIN.length - 1);
  const r = Math.max(32, Math.min(50, spacing * 0.33));
  const cy = 18 + CARD_H + 16 + r;
  const pos = Object.fromEntries(MAIN.map((id, i) => [id, { x: padX + i * spacing, y: cy }])) as Record<NodeId, { x: number; y: number }>;
  const lostR = Math.max(24, r * 0.62);
  pos.lost = { x: pos.won.x, y: cy + r + 40 + lostR };
  const height = Math.max(cy + r + 16 + CARD_H + 14, pos.lost.y + lostR + 14);
  return { width, height, spacing, r, cw, cy, pos, lostR };
}

export const PipelineChart = forwardRef<PipelineHandle, Props>(function PipelineChart(p, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(1200);
  const [drag, setDrag] = useState<{ lead: LeadCard; from: NodeId; x: number; y: number; over: NodeId | null } | null>(null);
  const dragRef = useRef<{ lead: LeadCard; from: NodeId; sx: number; sy: number; started: boolean } | null>(null);
  const [travellers, setTravellers] = useState<{ id: number; name: string; from: NodeId; to: NodeId }[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const g = useMemo(() => geometry(W), [W]);
  const byId = useMemo(() => Object.fromEntries(p.nodes.map((n) => [n.id, n])) as Record<NodeId, NodeView>, [p.nodes]);

  const nodeCenter = useCallback((id: NodeId) => {
    const el = inner.current;
    if (!el || !g.pos[id]) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + g.pos[id].x, y: r.top + g.pos[id].y };
  }, [g]);
  useImperativeHandle(ref, () => ({
    nodeCenter,
    travel: (name, from, to) => {
      if (reducedMotion() || from === to) return;
      const id = ++seq.current;
      setTravellers((t) => [...t.slice(-5), { id, name, from, to }]);
      setTimeout(() => setTravellers((t) => t.filter((x) => x.id !== id)), 1700);
    },
  }), [nodeCenter]);

  // ---- drag & drop (pointer events: mouse, pen and touch alike)
  const nodeAt = useCallback((clientX: number, clientY: number): NodeId | null => {
    const el = inner.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    let best: NodeId | null = null, bd = Infinity;
    for (const [id, c] of Object.entries(g.pos) as [NodeId, { x: number; y: number }][]) {
      const d = Math.hypot(c.x - x, c.y - y);
      const lim = (id === "lost" ? g.lostR : g.r) + 34;
      if (d < lim && d < bd) { bd = d; best = id; }
    }
    return best;
  }, [g]);
  const onCardDown = (e: React.PointerEvent, lead: LeadCard, from: NodeId) => {
    if (e.button !== 0) return;
    dragRef.current = { lead, from, sx: e.clientX, sy: e.clientY, started: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onCardMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.started && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
    d.started = true;
    setDrag({ lead: d.lead, from: d.from, x: e.clientX, y: e.clientY, over: nodeAt(e.clientX, e.clientY) });
  };
  const onCardUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.started) { p.onOpenLead(d.lead.id); setDrag(null); return; }
    const to = nodeAt(e.clientX, e.clientY);
    setDrag(null);
    if (to && to !== d.from) p.onMove(d.lead, to);
  };

  const cardProps = (lead: LeadCard, from: NodeId) => ({
    onPointerDown: (e: React.PointerEvent) => onCardDown(e, lead, from),
    onPointerMove: onCardMove,
    onPointerUp: onCardUp,
    onPointerCancel: () => { dragRef.current = null; setDrag(null); },
  });

  const now = Date.now();
  const lit = (id: NodeId) => (p.highlight[id] ?? 0) > now - 1800;

  return (
    <div ref={wrap} className="robin-scroll relative h-full w-full overflow-x-auto overflow-y-hidden">
      <div ref={inner} className="relative mx-auto" style={{ width: g.width, height: g.height }}>
        {/* ---------- PIPELINE ---------- */}
        <div key="pipeline" className={cn("absolute inset-0 transition-all duration-500", p.mode === "pipeline" ? "opacity-100" : "pointer-events-none scale-[0.97] opacity-0 blur-[3px]")}>
          <svg className="absolute inset-0" width={g.width} height={g.height} aria-hidden>
            <defs>
              <linearGradient id="rb-line" x1="0" x2="1">
                <stop offset="0" stopColor="rgba(103,232,249,0.15)" />
                <stop offset="0.5" stopColor="rgba(103,232,249,0.55)" />
                <stop offset="1" stopColor="rgba(129,140,248,0.35)" />
              </linearGradient>
              <filter id="rb-glow"><feGaussianBlur stdDeviation="2.2" /></filter>
            </defs>
            {MAIN.slice(0, -1).map((id, i) => {
              const a = g.pos[id], b = g.pos[MAIN[i + 1]];
              const x0 = a.x + g.r + 6, x1 = b.x - g.r - 6;
              const path = `M${x0},${a.y} L${x1},${b.y}`;
              const downstream = byId[MAIN[i + 1]]?.count ?? 0;
              return (
                <g key={id}>
                  <path d={path} stroke="url(#rb-line)" strokeWidth={1.2} fill="none" className="robin-draw" style={{ animationDelay: `${i * 70}ms` }} />
                  <path d={path} stroke="rgba(103,232,249,0.35)" strokeWidth={3} fill="none" filter="url(#rb-glow)" opacity={lit(MAIN[i + 1]) ? 1 : 0.35} className="transition-opacity duration-700" />
                  <path d={`M${x1 - 7},${b.y - 4} L${x1},${b.y} L${x1 - 7},${b.y + 4}`} stroke="rgba(165,243,252,0.7)" strokeWidth={1.2} fill="none" />
                  {[0.3, 0.5, 0.7].map((u) => <circle key={u} cx={x0 + (x1 - x0) * u} cy={a.y} r={1.2} fill="rgba(165,243,252,0.5)" />)}
                  {/* one gliding particle per lead now in the next stage (up to 3) */}
                  {!reducedMotion() && Array.from({ length: Math.min(3, downstream) }, (_, k) => (
                    <circle key={k} r={2} fill="#a5f3fc" opacity={0.85}>
                      <animateMotion dur={`${3.2 + k * 0.7}s`} begin={`${k * 1.1}s`} repeatCount="indefinite" path={path} />
                    </circle>
                  ))}
                </g>
              );
            })}
            {/* the LOST branch */}
            {(() => {
              const n = g.pos.negotiation, w = g.pos.won, l = g.pos.lost;
              const sx = (n.x + w.x) / 2 + 4;
              const d = `M${sx},${n.y + 2} C${sx},${l.y - 6} ${sx + 10},${l.y} ${l.x - g.lostR - 6},${l.y}`;
              return (
                <g>
                  <path d={d} stroke="rgba(148,163,184,0.35)" strokeDasharray="3 5" strokeWidth={1.2} fill="none" />
                  <path d={`M${l.x - g.lostR - 13},${l.y - 4} L${l.x - g.lostR - 6},${l.y} L${l.x - g.lostR - 13},${l.y + 4}`} stroke="rgba(148,163,184,0.6)" strokeWidth={1.2} fill="none" />
                </g>
              );
            })()}
            {/* card ↔ node connectors */}
            {MAIN.map((id) => (byId[id]?.leads ?? []).slice(0, id === "won" ? 1 : 2).map((lead, k) => {
              const c = g.pos[id];
              const y0 = k === 0 ? c.y - g.r : c.y + g.r, y1 = k === 0 ? c.y - g.r - 14 : c.y + g.r + 14;
              return <line key={lead.id} x1={c.x} x2={c.x} y1={y0} y2={y1} stroke={p.selectedLeadId === lead.id ? "rgba(165,243,252,0.9)" : "rgba(103,232,249,0.25)"} strokeWidth={1} />;
            }))}
          </svg>

          {/* stage nodes */}
          {[...MAIN, "lost" as NodeId].map((id, i) => {
            const n = byId[id];
            const c = g.pos[id];
            const r = id === "lost" ? g.lostR : g.r;
            const over = drag?.over === id && drag.from !== id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => p.onExpand(p.expanded === id ? null : id)}
                className={cn(
                  "robin-node group absolute flex flex-col items-center justify-center rounded-full text-center",
                  id === "won" && "robin-node-won", id === "lost" && "robin-node-lost",
                  (lit(id) || over) && "robin-node-lit", p.expanded === id && "robin-node-open",
                )}
                style={{ left: c.x - r, top: c.y - r, width: r * 2, height: r * 2, animationDelay: `${120 + i * 60}ms` }}
                aria-label={`${n?.label ?? id}: ${n?.count ?? 0} leads`}
              >
                {lit(id) && <span className="robin-ping pointer-events-none absolute inset-0 rounded-full border border-cyan-300/70" />}
                {id !== "lost" && <span className="text-[7.5px] tracking-[0.25em] text-slate-400">STAGE</span>}
                <span className={cn("font-semibold tracking-[0.12em] text-slate-100", id === "lost" ? "text-[10px]" : "text-[10.5px]")}>{n?.label ?? id.toUpperCase()}</span>
                {id !== "lost" ? (
                  <>
                    <span className="mt-0.5 text-[9px] tracking-[0.12em] text-cyan-200/80"><Count value={n?.count ?? 0} /> LEAD{(n?.count ?? 0) === 1 ? "" : "S"}</span>
                    <Money value={id === "won" ? Math.max(n?.value ?? 0, p.revenueWon) : n?.value ?? 0} currency={p.currency} className="text-[10px] font-medium text-slate-200" />
                  </>
                ) : <span className="text-[9px] text-slate-400"><Count value={n?.count ?? 0} /></span>}
              </button>
            );
          })}

          {/* lead cards: the most relevant first, one above and one below each stage */}
          {MAIN.map((id) => (byId[id]?.leads ?? []).slice(0, id === "won" ? 1 : 2).map((lead, k) => {
            const c = g.pos[id];
            const top = k === 0 ? c.y - g.r - 14 - CARD_H : c.y + g.r + 14;
            return (
              <div
                key={lead.id}
                {...cardProps(lead, id)}
                className={cn("robin-card absolute cursor-grab touch-none select-none active:cursor-grabbing", lead.priority === "high" && "robin-card-high", p.topIds.has(lead.id) && "robin-card-hot", p.selectedLeadId === lead.id && "robin-card-sel", drag?.lead.id === lead.id && "opacity-30")}
                style={{ left: c.x - g.cw / 2, top, width: g.cw, height: CARD_H }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") p.onOpenLead(lead.id); }}
                aria-label={`${lead.name}, ${lead.category ?? ""}, score ${lead.score}`}
              >
                <LeadCardBody lead={lead} currency={p.currency} />
              </div>
            );
          }))}

          {/* expanded stage: all its (top) leads fan out above the chart */}
          {p.expanded && byId[p.expanded] && (
            <StageFan node={byId[p.expanded]} at={g.pos[p.expanded]} width={g.width} currency={p.currency} cardProps={cardProps} onClose={() => p.onExpand(null)} selectedLeadId={p.selectedLeadId} />
          )}

          {/* leads travelling between stages */}
          {travellers.map((t) => <Traveller key={t.id} name={t.name} from={g.pos[t.from]} to={g.pos[t.to]} />)}

          {p.empty && (
            <div className="absolute inset-x-0 top-1/2 mx-auto w-[min(92%,440px)] -translate-y-1/2 rounded-2xl border border-cyan-300/15 bg-slate-950/70 p-5 text-center backdrop-blur-xl robin-in">
              <p className="text-sm font-medium text-slate-100">No leads in the pipeline yet</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">When DARWIN finds a business, it arrives here automatically and Robin qualifies it.</p>
              {p.onImport && <button type="button" onClick={p.onImport} className="robin-btn mt-3 rounded-full border border-cyan-300/30 px-4 py-1.5 text-[11px] tracking-[0.18em] text-cyan-100">CHECK DARWIN FOR LEADS</button>}
            </div>
          )}
        </div>

        {/* ---------- FUNNEL ---------- */}
        {p.mode === "funnel" && <FunnelView funnel={p.funnel} height={g.height} />}
        {/* ---------- REVENUE ---------- */}
        {p.mode === "revenue" && <RevenueView nodes={p.nodes} revenueWon={p.revenueWon} currency={p.currency} width={g.width} height={g.height} />}
      </div>

      {/* the card being dragged follows the pointer */}
      {drag && (
        <div className="robin-card robin-card-drag pointer-events-none fixed z-[80]" style={{ left: drag.x - g.cw / 2, top: drag.y - 30, width: g.cw, height: CARD_H }}>
          <LeadCardBody lead={drag.lead} currency={p.currency} />
          {drag.over && drag.over !== drag.from && <div className="absolute -bottom-6 left-0 right-0 text-center text-[10px] tracking-[0.2em] text-cyan-200">→ {byId[drag.over]?.label}</div>}
        </div>
      )}
    </div>
  );
});

export function LeadCardBody({ lead, currency }: { lead: LeadCard; currency: string }) {
  const flag = lead.stage === "won" ? { t: "CLIENT", c: "text-emerald-300" }
    : lead.flag === "overdue" ? { t: "FOLLOW-UP OVERDUE", c: "text-amber-300" }
    : lead.flag === "today" ? { t: "FOLLOW-UP TODAY", c: "text-emerald-300" }
      : lead.demoAt ? { t: `DEMO ${new Date(lead.demoAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).toUpperCase()}`, c: "text-sky-300" }
        : lead.quote ? { t: `QUOTE ${lead.quote.status.toUpperCase()}`, c: "text-violet-300" }
          : lead.priority === "high" ? { t: "HIGH PRIORITY", c: "text-cyan-300" }
            : lead.priority === "needs_review" ? { t: "NEEDS REVIEW", c: "text-slate-400" } : null;
  return (
    <div className="flex h-full flex-col justify-between px-2.5 py-2">
      <div className="min-w-0">
        <p className="robin-type truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-50">{lead.name}</p>
        <p className="truncate text-[9.5px] text-slate-400">{lead.category ?? "—"}</p>
      </div>
      <div className="flex items-end justify-between gap-1">
        <div className="leading-tight"><Count value={lead.score} className="text-[13px] font-semibold text-cyan-200" /><p className="whitespace-nowrap text-[8px] text-slate-500">Lead score</p></div>
        <div className="text-right leading-tight">
          <p className="text-[10.5px] font-medium text-emerald-300">{lead.value != null ? money(lead.value, currency) : "—"}</p>
          <p className="whitespace-nowrap text-[8px] text-slate-500">Opportunity</p>
        </div>
      </div>
      {flag && <p className={cn("truncate text-[8.5px] font-semibold tracking-[0.14em]", flag.c)}>{flag.t}</p>}
    </div>
  );
}

function StageFan({ node, at, width, currency, cardProps, onClose, selectedLeadId }: {
  node: NodeView; at: { x: number; y: number }; width: number; currency: string; selectedLeadId: string | null;
  cardProps: (lead: LeadCard, from: NodeId) => Record<string, unknown>; onClose: () => void;
}) {
  // every lead in the stage, not just the ones on the chart (most-needing-you first)
  const [all, setAll] = useState<LeadCard[] | null>(null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(120);
  useEffect(() => {
    let live = true;
    void fetch(`/api/robin/leads?cards=${node.id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (live && Array.isArray(j?.data?.cards)) setAll(j.data.cards); }).catch(() => {});
    return () => { live = false; };
  }, [node.id, node.count]);
  const source = all ?? node.leads;
  const needle = q.trim().toLowerCase();
  const list = needle ? source.filter((l) => `${l.name} ${l.category ?? ""}`.toLowerCase().includes(needle)) : source;
  const cw = 150, gap = 8;
  const perRow = Math.max(1, Math.floor((Math.min(width, 1180) - 40) / (cw + gap)));
  const panelW = Math.min(perRow, Math.max(list.length, 3)) * (cw + gap) + 24;
  const left = Math.max(8, Math.min(width - panelW - 8, at.x - panelW / 2));
  return (
    <div className="robin-fan absolute z-30 rounded-2xl border border-cyan-300/20 bg-slate-950/95 p-3 backdrop-blur-xl" style={{ left, top: 6, width: panelW, transformOrigin: `${at.x - left}px ${at.y}px` }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[10px] tracking-[0.25em] text-cyan-200">ALL {node.label} · {node.count} LEAD{node.count === 1 ? "" : "S"}{node.value ? ` · ${money(node.value, currency)}` : ""}</p>
        <div className="flex items-center gap-2">
          {node.count > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label={`Search ${node.label.toLowerCase()} leads`} className="w-36 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-slate-100 outline-none focus:border-cyan-300/50" />}
          <button type="button" onClick={onClose} className="text-[10px] tracking-[0.2em] text-slate-400 hover:text-white">CLOSE</button>
        </div>
      </div>
      {list.length === 0 ? <p className="px-1 pb-1 text-xs text-slate-400">{needle ? "No leads match." : "No leads in this stage."}</p> : (
        <div className="robin-scroll grid gap-2 overflow-y-auto pr-1" style={{ gridTemplateColumns: `repeat(${Math.min(perRow, list.length)}, ${cw}px)`, maxHeight: 2 * (CARD_H + gap) + 30 }}>
          {list.slice(0, shown).map((l, i) => (
            <div key={l.id} {...cardProps(l, node.id)} className={cn("robin-card relative cursor-grab touch-none select-none", i < 24 && "robin-card-fan", l.priority === "high" && "robin-card-high", selectedLeadId === l.id && "robin-card-sel")} style={{ height: CARD_H, animationDelay: i < 24 ? `${i * 30}ms` : undefined }}>
              <LeadCardBody lead={l} currency={currency} />
            </div>
          ))}
          {list.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + 300)} className="robin-btn col-span-full rounded-full border border-white/10 py-1 text-[10px] tracking-[0.18em] text-slate-300">SHOW {Math.min(300, list.length - shown)} MORE OF {list.length}</button>
          )}
        </div>
      )}
      <p className="mt-2 px-1 text-[10px] text-slate-500">{all ? `${needle ? `${list.length} of ` : "All "}${all.length} — most in need of you first. Drag one onto a stage to move it.` : "Loading every lead in this stage…"}</p>
    </div>
  );
}

function Traveller({ name, from, to }: { name: string; from: { x: number; y: number }; to: { x: number; y: number } }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    const lift = to.y > from.y + 20 ? 20 : -46; // arc above the line (or down into LOST)
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, u = 1 - t;
      const cx = (from.x + to.x) / 2, cy = Math.min(from.y, to.y) + lift;
      const x = u * u * from.x + 2 * u * t * cx + t * t * to.x;
      const y = u * u * from.y + 2 * u * t * cy + t * t * to.y;
      frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${0.85 + Math.sin(t * Math.PI) * 0.25})`, opacity: t > 0.92 ? (1 - t) * 12 : Math.min(1, t * 8) });
    }
    const a = e.animate(frames, { duration: 1400, easing: "cubic-bezier(.45,.05,.25,1)", fill: "forwards" });
    return () => a.cancel();
  }, [from, to]);
  return (
    <div ref={el} className="pointer-events-none absolute left-0 top-0 z-40 flex items-center gap-1.5 rounded-full border border-cyan-200/50 bg-slate-950/80 px-2.5 py-1 shadow-[0_0_18px_rgba(103,232,249,0.55)]">
      <span className="h-1.5 w-1.5 rounded-full bg-cyan-200 shadow-[0_0_8px_#a5f3fc]" />
      <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-50">{name}</span>
    </div>
  );
}

function FunnelView({ funnel, height }: { funnel: Props["funnel"]; height: number }) {
  const rows = funnel.filter((f) => f.id !== "lost");
  const lost = funnel.find((f) => f.id === "lost");
  const max = Math.max(1, ...rows.map((r) => r.count));
  const rowH = Math.min(30, (height - 40) / (rows.length + 1));
  const [built, setBuilt] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setBuilt(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <div className="absolute inset-0 flex flex-col justify-center px-10 robin-morph">
      {rows.map((r, i) => {
        const prev = i ? rows[i - 1].count : null;
        const pct = prev ? Math.round((r.count / prev) * 100) : null;
        const w = r.count ? Math.max(1.5, (r.count / max) * 100) : 0;
        return (
          <div key={r.id} className="grid items-center gap-3" style={{ gridTemplateColumns: "110px 1fr 150px", height: rowH }}>
            <span className="text-right text-[10px] tracking-[0.22em] text-slate-300">{i === 0 ? "ALL LEADS" : r.label}</span>
            <div className="flex h-[70%] justify-center">
              <div className="robin-bar h-full rounded-md" style={{ width: built ? `${w}%` : "0%", transitionDelay: `${i * 90}ms` }} />
            </div>
            <span className="text-[11px] text-slate-200"><Count value={r.count} /> <span className="text-[10px] text-slate-500">{pct != null ? `· ${pct}% of previous` : ""}</span></span>
          </div>
        );
      })}
      {lost && <p className="mt-2 text-center text-[10px] tracking-[0.18em] text-slate-500">LOST / NOT INTERESTED: {lost.count}</p>}
      {max <= 1 && rows.every((r) => !r.count) && <p className="mt-2 text-center text-xs text-slate-400">The funnel builds itself as leads move through the pipeline.</p>}
    </div>
  );
}

function RevenueView({ nodes, revenueWon, currency, width, height }: { nodes: NodeView[]; revenueWon: number; currency: string; width: number; height: number }) {
  const rows = nodes.filter((n) => n.id !== "lost" && n.id !== "new");
  const vals = rows.map((n) => (n.id === "won" ? revenueWon : n.value));
  const max = Math.max(1, ...vals);
  const padX = 70, top = 34, base = height - 46;
  const step = (width - padX * 2) / Math.max(1, rows.length - 1);
  const pts = rows.map((_, i) => ({ x: padX + i * step, y: base - (vals[i] / max) * (base - top) }));
  const curve = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : (() => { const q = pts[i - 1]; const mx = (q.x + p.x) / 2; return `C${mx},${q.y} ${mx},${p.y} ${p.x},${p.y}`; })())).join(" ");
  const [built, setBuilt] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setBuilt(true)); return () => cancelAnimationFrame(t); }, []);
  const anyValue = vals.some((v) => v > 0);
  return (
    <div className="absolute inset-0 robin-morph">
      <svg width={width} height={height} className="absolute inset-0" aria-hidden>
        <defs>
          <linearGradient id="rb-bar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="rgba(103,232,249,0.65)" /><stop offset="1" stopColor="rgba(59,130,246,0.08)" /></linearGradient>
          <linearGradient id="rb-won" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="rgba(52,211,153,0.8)" /><stop offset="1" stopColor="rgba(16,185,129,0.08)" /></linearGradient>
        </defs>
        <line x1={padX - 30} x2={width - padX + 30} y1={base} y2={base} stroke="rgba(148,163,184,0.25)" />
        {rows.map((n, i) => {
          const h = built ? (vals[i] / max) * (base - top) : 0;
          return (
            <g key={n.id}>
              <rect x={pts[i].x - 16} y={base - h} width={32} height={h} rx={4} fill={n.id === "won" ? "url(#rb-won)" : "url(#rb-bar)"} style={{ transition: `all .9s cubic-bezier(.2,.8,.2,1) ${i * 80}ms` }} />
              <text x={pts[i].x} y={base + 16} textAnchor="middle" fontSize="9.5" letterSpacing="2" fill="rgba(203,213,225,0.85)">{n.label}</text>
              <text x={pts[i].x} y={base + 29} textAnchor="middle" fontSize="8" letterSpacing="1.5" fill={n.id === "won" ? "rgba(110,231,183,0.8)" : "rgba(148,163,184,0.7)"}>{n.id === "won" ? "ACTUAL" : "POTENTIAL"}</text>
              {vals[i] > 0 && <text x={pts[i].x} y={base - h - 8} textAnchor="middle" fontSize="11" fontWeight="600" fill={n.id === "won" ? "#6ee7b7" : "#e2e8f0"} style={{ opacity: built ? 1 : 0, transition: `opacity .4s ${300 + i * 80}ms` }}>{money(vals[i], currency, true)}</text>}
            </g>
          );
        })}
        {anyValue && <path d={curve} fill="none" stroke="rgba(165,243,252,0.7)" strokeWidth={1.4} pathLength={1} className="robin-curve" />}
        {anyValue && pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.6} fill="#a5f3fc" className="robin-pop" style={{ animationDelay: `${600 + i * 90}ms` }} />)}
      </svg>
      {!anyValue && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-slate-400">No values yet — add a potential value to a lead or prepare a quotation, and the revenue pipeline fills in.</p>}
    </div>
  );
}
