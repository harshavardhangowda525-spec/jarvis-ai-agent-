"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { BadgeCheck, CalendarClock, Check, ChevronUp, MessageCircle, Send, Sparkles, UserPlus, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadCard, NodeView } from "@/lib/robin/overview";
import { STAGE_LABEL, money, type NodeId, type Stage } from "@/lib/robin/types";
import { Count, reducedMotion } from "./anim";

/**
 * ROBIN's CRM as an orbit beneath the core: the eight stages sit on one arc,
 * joined by flowing light. Every orb, count and lead bubble is a real CRM
 * record. Hover a lead for its stage and contact status, drag it onto another
 * stage to move it, click a stage to expand it. When a lead changes stage it
 * travels along the arc and a surge of light runs into the stage.
 */

export const ARC: NodeId[] = ["new", "contacted", "qualified", "interested", "follow_up", "proposal", "won"];
export const ICON: Record<NodeId, LucideIcon> = {
  new: UserPlus, contacted: MessageCircle, qualified: BadgeCheck, interested: Sparkles, follow_up: CalendarClock, proposal: Send, won: Check, lost: X,
};

export interface ArcGeo {
  /** The box the arc is drawn in (px). */
  w: number; h: number;
  /** The ellipse the stages sit on — centred on the core. */
  cx: number; cy: number; rx: number; ry: number;
  /** First and last stage angle (radians, screen space: 0 = right, π/2 = down). */
  a0: number; a1: number;
  /** Stage orb radius. */
  r: number;
}
type P = { x: number; y: number };

export interface OrbitHandle {
  nodeCenter: (id: NodeId) => P | null;
  /** Where DARWIN's leads enter the arc (screen coords). */
  intakePoint: () => P | null;
  travel: (name: string, from: NodeId, to: NodeId) => void;
  /** Start dragging a lead from anywhere (a bubble, or a row in the stage panel). A press without movement opens it. */
  beginDrag: (e: React.PointerEvent, lead: LeadCard, from: NodeId) => void;
}

interface Props {
  geo: ArcGeo;
  nodes: NodeView[];
  currency: string;
  highlight: Partial<Record<NodeId, number>>;
  expanded: NodeId | null;
  focus: NodeId | null;
  selectedLeadId: string | null;
  onExpand: (id: NodeId | null) => void;
  onOpenLead: (id: string) => void;
  onMove: (lead: LeadCard, to: NodeId) => void;
  className?: string;
}

const angleOf = (g: ArcGeo, i: number) => g.a0 + ((g.a1 - g.a0) * i) / (ARC.length - 1);
const at = (g: ArcGeo, a: number): P => ({ x: g.cx + g.rx * Math.cos(a), y: g.cy + g.ry * Math.sin(a) });
const TAIL = 0.15;

export function arcLayout(g: ArcGeo) {
  const pos = {} as Record<NodeId, P>;
  ARC.forEach((id, i) => { pos[id] = at(g, angleOf(g, i)); });
  const won = pos.won;
  pos.lost = { x: Math.min(g.w - g.r - 8, won.x + Math.max(34, g.rx * 0.11)), y: won.y + Math.max(70, g.ry * 0.27) };
  const step = (g.a1 - g.a0) / (ARC.length - 1);
  // the branch to REJECTED leaves the arc between PROPOSAL SENT and WON
  const fork = at(g, angleOf(g, 5) + step * 0.45);
  const branchCtl = { x: fork.x + 6, y: pos.lost.y };
  return { pos, step, fork, branchCtl };
}

/** Points along the ellipse between two angles. */
function sample(g: ArcGeo, from: number, to: number, n = 24): P[] {
  return Array.from({ length: n + 1 }, (_, k) => at(g, from + ((to - from) * k) / n));
}
const poly = (pts: P[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const bez = (a: P, c: P, b: P, t: number): P => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });

export function initials(name: string) {
  const w = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "?") + (w[1]?.[0] ?? "")).toUpperCase();
}
export function contactStatus(l: LeadCard): string {
  const ch = [l.phone && "phone", l.whatsapp && "WhatsApp", l.email && "email"].filter(Boolean) as string[];
  return ch.length ? `Reachable by ${ch.join(" · ")}` : "No contact details yet";
}
export function leadStatus(l: LeadCard, tz?: string): string {
  const stage = STAGE_LABEL[l.stage as Stage] ?? l.stage;
  if (l.flag === "overdue") return `${stage} · follow-up overdue`;
  if (l.flag === "today") return `${stage} · follow-up today`;
  if (l.demoAt) return `${stage} · demo ${new Date(l.demoAt).toLocaleString("en-IN", { timeZone: tz, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`;
  if (l.quote) return `${stage} · quotation ${l.quote.status}`;
  return stage;
}

export const OrbitPipeline = forwardRef<OrbitHandle, Props>(function OrbitPipeline(p, ref) {
  const { geo: g } = p;
  const box = useRef<HTMLDivElement>(null);
  const L = useMemo(() => arcLayout(g), [g]);
  const byId = useMemo(() => Object.fromEntries(p.nodes.map((n) => [n.id, n])) as Record<NodeId, NodeView>, [p.nodes]);
  const [hover, setHover] = useState<{ lead: LeadCard; at: P } | null>(null);
  const [drag, setDrag] = useState<{ lead: LeadCard; from: NodeId; x: number; y: number; over: NodeId | null } | null>(null);
  const [travellers, setTravellers] = useState<{ id: number; name: string; from: NodeId; to: NodeId }[]>([]);
  const [surges, setSurges] = useState<{ id: number; node: NodeId }[]>([]);
  const seq = useRef(0);

  // ---- paths
  const tailA = g.a0 - L.step * TAIL * 4;
  const mainPath = useMemo(() => poly(sample(g, tailA, g.a1, 90)), [g, tailA]);
  const segPath = useCallback((id: NodeId) => {
    if (id === "lost") return `M${L.fork.x},${L.fork.y} Q${L.branchCtl.x},${L.branchCtl.y} ${L.pos.lost.x - g.r},${L.pos.lost.y}`;
    const i = ARC.indexOf(id);
    const from = i === 0 ? tailA : angleOf(g, i - 1);
    return poly(sample(g, from, angleOf(g, i), 18));
  }, [L, g, tailA]);
  /** Where a stage's lead bubble sits: halfway along the line into the stage. */
  const bubbleAt = useCallback((id: NodeId): P => {
    if (id === "lost") return bez(L.fork, L.branchCtl, { x: L.pos.lost.x - g.r, y: L.pos.lost.y }, 0.55);
    const i = ARC.indexOf(id);
    const from = i === 0 ? tailA : angleOf(g, i - 1);
    return at(g, from + (angleOf(g, i) - from) * 0.5);
  }, [L, g, tailA]);

  const toScreen = useCallback((pt: P): P | null => {
    const r = box.current?.getBoundingClientRect();
    return r ? { x: r.left + pt.x, y: r.top + pt.y } : null;
  }, []);
  const nodeAt = useCallback((clientX: number, clientY: number): NodeId | null => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    const x = clientX - r.left, y = clientY - r.top;
    let best: NodeId | null = null, bd = Infinity;
    for (const [id, c] of Object.entries(L.pos) as [NodeId, P][]) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < g.r + 30 && d < bd) { bd = d; best = id; }
    }
    return best;
  }, [L, g.r]);

  // ---- drag (window-level, so rows in the stage panel can be dragged onto the arc too)
  const onOpen = useRef(p.onOpenLead); onOpen.current = p.onOpenLead;
  const onMove = useRef(p.onMove); onMove.current = p.onMove;
  const beginDrag = useCallback((e: React.PointerEvent, lead: LeadCard, from: NodeId) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      started = true;
      setHover(null);
      setDrag({ lead, from, x: ev.clientX, y: ev.clientY, over: nodeAt(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel);
      setDrag(null);
      if (!started) { onOpen.current(lead.id); return; }
      const to = nodeAt(ev.clientX, ev.clientY);
      if (to && to !== from) onMove.current(lead, to);
    };
    const cancel = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); setDrag(null); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
  }, [nodeAt]);

  useImperativeHandle(ref, () => ({
    nodeCenter: (id) => (L.pos[id] ? toScreen(L.pos[id]) : null),
    intakePoint: () => toScreen(at(g, tailA)),
    travel: (name, from, to) => {
      if (from === to) return;
      const id = ++seq.current;
      setSurges((s) => [...s.slice(-6), { id, node: to }]);
      setTimeout(() => setSurges((s) => s.filter((x) => x.id !== id)), 1600);
      if (reducedMotion()) return;
      setTravellers((t) => [...t.slice(-5), { id, name, from, to }]);
      setTimeout(() => setTravellers((t) => t.filter((x) => x.id !== id)), 1900);
    },
    beginDrag,
  }), [L, g, tailA, toScreen, beginDrag]);

  const now = Date.now();
  const lit = (id: NodeId) => (p.highlight[id] ?? 0) > now - 1800;
  const reduced = reducedMotion();

  return (
    <div ref={box} className={cn("pointer-events-none absolute left-0 top-0", p.className)} style={{ width: g.w, height: g.h }}>
      <svg className="absolute inset-0 overflow-visible" width={g.w} height={g.h} aria-hidden>
        <defs>
          <linearGradient id="ro-line" x1="0" x2="1">
            <stop offset="0" stopColor="rgba(103,232,249,0)" />
            <stop offset="0.12" stopColor="rgba(103,232,249,0.45)" />
            <stop offset="0.55" stopColor="rgba(125,211,252,0.7)" />
            <stop offset="1" stopColor="rgba(167,139,250,0.5)" />
          </linearGradient>
          <filter id="ro-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        {/* the arc: a soft glow, the line, and data flowing along it */}
        <path d={mainPath} stroke="rgba(56,189,248,0.35)" strokeWidth={5} fill="none" filter="url(#ro-glow)" opacity={0.5} />
        <path d={mainPath} stroke="url(#ro-line)" strokeWidth={1.3} fill="none" className="robin-draw-long" />
        {!reduced && <path d={mainPath} stroke="rgba(165,243,252,0.55)" strokeWidth={1.3} fill="none" strokeDasharray="2 22" className="robin-dataflow" />}
        {/* REJECTED branch */}
        <path d={segPath("lost")} stroke="rgba(251,113,133,0.28)" strokeWidth={1.1} strokeDasharray="3 5" fill="none" />
        {/* particles: one per lead now waiting in the next stage (up to 3) */}
        {!reduced && ARC.map((id) => Array.from({ length: Math.min(3, byId[id]?.count ?? 0) }, (_, k) => (
          <circle key={`${id}${k}`} r={1.9} fill="#a5f3fc" opacity={0.9}>
            <animateMotion dur={`${2.8 + k * 0.6}s`} begin={`${k * 0.9}s`} repeatCount="indefinite" path={segPath(id)} />
          </circle>
        )))}
        {/* a surge of light into the stage a lead just moved to */}
        {surges.map((s) => (
          <path key={s.id} d={segPath(s.node)} stroke={s.node === "lost" ? "rgba(253,164,175,0.9)" : s.node === "won" ? "rgba(110,231,183,0.95)" : "rgba(165,243,252,0.95)"} strokeWidth={2.4} fill="none" pathLength={1} className="robin-surge" filter="url(#ro-glow)" />
        ))}
        {/* DARWIN → ROBIN: where new leads enter */}
        <circle cx={at(g, tailA).x} cy={at(g, tailA).y} r={2.5} fill="rgba(165,243,252,0.7)" />
      </svg>
      <span className="absolute whitespace-nowrap text-[8.5px] tracking-[0.3em] text-slate-500" style={{ left: at(g, tailA).x + 8, top: at(g, tailA).y - 14 }}>DARWIN</span>

      {/* stages */}
      {([...ARC, "lost"] as NodeId[]).map((id, i) => {
        const n = byId[id];
        const c = L.pos[id];
        const over = drag?.over === id && drag.from !== id;
        return (
          <StageOrb
            key={id} id={id} node={n} at={c} r={id === "lost" ? g.r * 0.82 : g.r} delay={180 + i * 70}
            lit={lit(id) || over} open={p.expanded === id} focus={p.focus === id && p.expanded !== id} currency={p.currency}
            onClick={() => p.onExpand(p.expanded === id ? null : id)}
          />
        );
      })}

      {/* the lead most in need of you in each stage, on the line into it */}
      {([...ARC, "lost"] as NodeId[]).map((id) => {
        const lead = byId[id]?.leads[0];
        if (!lead) return null;
        const b = bubbleAt(id);
        return (
          <button
            key={lead.id} type="button"
            className={cn("robin-bubble pointer-events-auto absolute flex touch-none select-none items-center justify-center rounded-full text-[9px] font-semibold tracking-[0.04em]",
              lead.priority === "high" && "robin-bubble-high", p.selectedLeadId === lead.id && "robin-bubble-sel", drag?.lead.id === lead.id && "opacity-30", id === "won" && "robin-bubble-won", id === "lost" && "opacity-70")}
            style={{ left: b.x - 13, top: b.y - 13, width: 26, height: 26 }}
            onPointerDown={(e) => beginDrag(e, lead, id)}
            onPointerEnter={() => setHover({ lead, at: b })}
            onPointerLeave={() => setHover((h) => (h?.lead.id === lead.id ? null : h))}
            onFocus={() => setHover({ lead, at: b })} onBlur={() => setHover(null)}
            onKeyDown={(e) => { if (e.key === "Enter") p.onOpenLead(lead.id); }}
            aria-label={`${lead.name} — ${STAGE_LABEL[lead.stage as Stage] ?? lead.stage}. ${contactStatus(lead)}. Drag onto a stage to move it.`}
          >
            {initials(lead.name)}
          </button>
        );
      })}

      {/* hover: business, stage, contact status */}
      {hover && !drag && (
        <div className="robin-tip pointer-events-none absolute z-40 w-max max-w-[240px] rounded-lg border border-cyan-300/20 bg-slate-950/85 px-2.5 py-1.5 text-[10.5px] leading-snug shadow-[0_10px_30px_-10px_rgba(8,145,178,0.6)] backdrop-blur-xl"
          style={{ left: Math.max(6, Math.min(g.w - 246, hover.at.x - 40)), top: hover.at.y - 86 }}>
          <p><span className="text-slate-500">Lead:</span> <span className="font-semibold text-slate-50">{hover.lead.name}</span></p>
          <p className="text-slate-300"><span className="text-slate-500">Contact:</span> {contactStatus(hover.lead)}</p>
          <p className="text-cyan-100"><span className="text-slate-500">Status:</span> {leadStatus(hover.lead)}</p>
          {hover.lead.value != null && <p className="text-emerald-300/90"><span className="text-slate-500">Opportunity:</span> {money(hover.lead.value, p.currency)}</p>}
        </div>
      )}

      {/* leads travelling between stages */}
      {travellers.map((t) => <Traveller key={t.id} name={t.name} frames={travelPath(g, L, t.from, t.to)} />)}

      {/* the lead being dragged follows the pointer */}
      {drag && (
        <div className="pointer-events-none fixed z-[80] flex items-center gap-2" style={{ left: drag.x - 15, top: drag.y - 15 }}>
          <span className="robin-bubble robin-bubble-sel flex h-[30px] w-[30px] items-center justify-center rounded-full text-[10px] font-semibold">{initials(drag.lead.name)}</span>
          <span className="rounded-full border border-cyan-300/30 bg-slate-950/85 px-2 py-0.5 text-[10px] text-cyan-50 backdrop-blur">
            {drag.over && drag.over !== drag.from ? `→ ${byId[drag.over]?.label ?? drag.over}` : drag.lead.name}
          </span>
        </div>
      )}
    </div>
  );
});

function travelPath(g: ArcGeo, L: ReturnType<typeof arcLayout>, from: NodeId, to: NodeId): P[] {
  const fi = ARC.indexOf(from), ti = ARC.indexOf(to);
  if (fi >= 0 && ti >= 0) return sample(g, angleOf(g, fi), angleOf(g, ti), 28);
  const a = L.pos[from], b = L.pos[to];
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 50 };
  return Array.from({ length: 29 }, (_, k) => bez(a, c, b, k / 28));
}

function StageOrb({ id, node, at: c, r, delay, lit, open, focus, currency, onClick }: {
  id: NodeId; node?: NodeView; at: P; r: number; delay: number; lit: boolean; open: boolean; focus: boolean; currency: string; onClick: () => void;
}) {
  const Icon = ICON[id];
  const inner = useRef<HTMLSpanElement>(null);
  // magnetic hover: the orb leans toward the pointer
  const lean = (e: React.PointerEvent) => {
    const el = inner.current;
    if (!el || reducedMotion()) return;
    const b = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - (b.left + b.width / 2)) * 0.18, dy = (e.clientY - (b.top + b.height / 2)) * 0.18;
    el.style.transform = `translate(${Math.max(-6, Math.min(6, dx))}px, ${Math.max(-6, Math.min(6, dy))}px)`;
  };
  const rest = () => { if (inner.current) inner.current.style.transform = ""; };
  const count = node?.count ?? 0;
  return (
    <div className="pointer-events-none absolute" style={{ left: c.x, top: c.y }}>
      <button
        type="button" onClick={onClick} onPointerMove={lean} onPointerLeave={rest}
        className="robin-orb-hit pointer-events-auto absolute flex items-center justify-center rounded-full"
        style={{ left: -r - 10, top: -r - 10, width: (r + 10) * 2, height: (r + 10) * 2, animationDelay: `${delay}ms` }}
        aria-label={`${node?.label ?? id}: ${count} lead${count === 1 ? "" : "s"}${node?.value ? `, ${money(node.value, currency)}` : ""}. ${open ? "Collapse" : "Expand"}.`}
        aria-expanded={open}
        title={node?.value ? `${count} lead${count === 1 ? "" : "s"} · ${money(node.value, currency)}` : undefined}
      >
        <span ref={inner} className={cn("robin-orb relative flex items-center justify-center rounded-full", id === "won" && "robin-orb-won", id === "lost" && "robin-orb-lost", lit && "robin-orb-lit", open && "robin-orb-open")} style={{ width: r * 2, height: r * 2 }}>
          {lit && <span className="robin-ping pointer-events-none absolute inset-0 rounded-full border border-cyan-300/70" />}
          {(open || focus) && <span className={cn("robin-orbit pointer-events-none absolute rounded-[50%] border", open ? "border-cyan-200/70" : "border-cyan-200/30")} style={{ left: -r * 0.55, right: -r * 0.55, top: r * 0.28, bottom: r * 0.28 }} />}
          <Icon className={cn("relative", id === "won" ? "text-emerald-200" : id === "lost" ? "text-rose-200/80" : "text-cyan-50")} style={{ width: r * 0.72, height: r * 0.72 }} strokeWidth={1.6} />
        </span>
      </button>
      <div className="pointer-events-none absolute flex -translate-x-1/2 flex-col items-center" style={{ top: r + 6 }}>
        <span className="whitespace-nowrap text-[10.5px] tracking-[0.06em] text-slate-200">{titleCase(node?.label ?? id)}</span>
        <span className={cn("mt-1 flex items-center gap-0.5 rounded-md border px-1.5 text-[10px] leading-[16px]", open ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-50" : "border-white/10 bg-white/[0.05] text-slate-200")}>
          <Count value={count} />
          <ChevronUp className={cn("h-2.5 w-2.5 transition-transform", open ? "rotate-0" : "rotate-180")} />
        </span>
      </div>
    </div>
  );
}
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

function Traveller({ name, frames }: { name: string; frames: P[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    const n = frames.length - 1;
    const kf: Keyframe[] = frames.map((p, i) => {
      const t = i / n;
      return { transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${0.85 + Math.sin(t * Math.PI) * 0.25})`, opacity: t > 0.93 ? (1 - t) * 14 : Math.min(1, t * 8) };
    });
    const a = e.animate(kf, { duration: 1600, easing: "cubic-bezier(.45,.05,.25,1)", fill: "forwards" });
    return () => a.cancel();
  }, [frames]);
  return (
    <div ref={el} className="pointer-events-none absolute left-0 top-0 z-40 flex items-center gap-1.5 rounded-full border border-cyan-200/50 bg-slate-950/80 py-0.5 pl-0.5 pr-2.5 shadow-[0_0_22px_rgba(103,232,249,0.6)]">
      <span className="robin-bubble flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-semibold">{initials(name)}</span>
      <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-50">{name}</span>
    </div>
  );
}
