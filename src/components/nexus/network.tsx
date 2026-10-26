"use client";

import { useEffect, useMemo, useState } from "react";
import { AgentGlyph } from "@/components/omega/glyphs";
import { STATE_COLOR } from "@/components/omega/tokens";
import { STATE_LABEL, type AgentState } from "@/lib/nexus/agents";
import type { Signal } from "@/lib/nexus/events";

/**
 * The agents around JARVIS's core and the pathways between them. A pathway
 * lights only for a real task signal: dispatch (core → agent), return
 * (agent → core), failure (a red flash), approval (amber, steady while it
 * waits) and dependency hand-offs (agent → agent).
 */

export interface NodeAgent { id: string; name: string; title: string; color: string; motif: string; state: AgentState; reason: string; updatedAt: string | null; counts: { queued: number; approval: number; running: number } }
export interface Pulse { id: string; from: string; to: string; color: string; reverse?: boolean }

const W = 1000, H = 640, CX = 500, CY = 320;

export function useLayout(ids: string[], narrow: boolean) {
  return useMemo(() => {
    const rx = narrow ? 300 : 400, ry = narrow ? 260 : 235;
    const pos: Record<string, { x: number; y: number }> = { jarvis: { x: CX, y: CY } };
    ids.forEach((id, i) => {
      const a = -Math.PI / 2 + (i / ids.length) * Math.PI * 2;
      pos[id] = { x: CX + Math.cos(a) * rx, y: CY + Math.sin(a) * ry };
    });
    return pos;
  }, [ids, narrow]);
}

const curve = (a: { x: number; y: number }, b: { x: number; y: number }, bend = 0.18) => {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
  return `M${a.x},${a.y} Q${mx - dy * bend},${my + dx * bend} ${b.x},${b.y}`;
};

export function Network({ agents, selected, onSelect, pulses, reduced, narrow, flashes }: {
  agents: NodeAgent[]; selected: string | null; onSelect: (id: string | null) => void; pulses: Pulse[]; reduced: boolean; narrow: boolean; flashes: Record<string, { kind: "fail" | "return" | "dispatch"; at: number }>;
}) {
  const pos = useLayout(agents.map((a) => a.id), narrow);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const ago = (iso: string | null) => {
    if (!iso) return "no activity yet";
    const s = (now - Date.parse(iso)) / 1000;
    return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="nx-net" role="group" aria-label="Agent network">
      <defs>
        <filter id="nx-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {/* pathways */}
      {agents.map((a) => {
        const p = pos[a.id];
        const d = curve(pos.jarvis, p);
        const flash = flashes[a.id] && now - flashes[a.id].at < 4000 ? flashes[a.id] : null;
        const col = a.state === "offline" ? "rgba(90,110,130,.35)" : a.state === "waiting_approval" ? "#f4c35a" : a.state === "error" || flash?.kind === "fail" ? "#ff6b7a" : a.state === "working" ? a.color : "rgba(120,200,255,.22)";
        const active = a.state === "working";
        return (
          <g key={a.id}>
            <path d={d} fill="none" stroke={col} strokeWidth={active ? 1.6 : 1} strokeDasharray={a.state === "offline" ? "3 6" : undefined} opacity={selected && selected !== a.id ? 0.35 : 1} />
            {active && !reduced && <path d={d} fill="none" stroke={a.color} strokeWidth={2.2} strokeDasharray="2 14" className="nx-flow" filter="url(#nx-glow)" />}
          </g>
        );
      })}
      {/* real signals travelling */}
      {pulses.map((p) => {
        const a = pos[p.from], b = pos[p.to];
        if (!a || !b) return null;
        const d = curve(a, b, p.from === "jarvis" || p.to === "jarvis" ? 0.18 : 0.08);
        return (
          <g key={p.id}>
            <path d={d} fill="none" stroke={p.color} strokeWidth={1.4} opacity={0.5} className="nx-trace" />
            {!reduced && <circle r={4.5} fill={p.color} filter="url(#nx-glow)"><animateMotion dur="1.3s" path={d} keyPoints={p.reverse ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" fill="freeze" /></circle>}
          </g>
        );
      })}
      {/* JARVIS label at the core (the canvas draws the core itself) */}
      <text x={CX} y={CY + 64} textAnchor="middle" className="nx-core-label">JARVIS</text>
      {/* agent nodes */}
      {agents.map((a) => {
        const p = pos[a.id];
        const sc = STATE_COLOR[a.state] ?? "#5d7590";
        const on = selected === a.id;
        const flash = flashes[a.id] && now - flashes[a.id].at < 2500 ? flashes[a.id].kind : null;
        return (
          <g key={a.id} transform={`translate(${p.x},${p.y})`} className={`nx-node m-${a.motif}${on ? " on" : ""}${a.state === "offline" ? " off" : ""}${flash ? ` f-${flash}` : ""}`}
            onClick={() => onSelect(on ? null : a.id)} role="button" tabIndex={0} aria-pressed={on}
            aria-label={`${a.name}, ${a.title}: ${STATE_LABEL[a.state]}. ${a.reason}`}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(on ? null : a.id); } }}>
            <circle r={44} className="nx-halo" style={{ stroke: a.color }} />
            <polygon points="0,-34 29.4,-17 29.4,17 0,34 -29.4,17 -29.4,-17" className="nx-hex" style={{ stroke: a.color }} />
            {a.state === "working" && !reduced && <circle r={40} className="nx-orbit" style={{ stroke: a.color }} />}
            <g transform="translate(-13,-20)" style={{ color: a.color }}><AgentGlyph motif={a.motif} size={26} color={a.color} /></g>
            <text y={20} textAnchor="middle" className="nx-name">{a.name}</text>
            <g transform="translate(0,56)">
              <rect x={-62} y={-11} width={124} height={22} rx={11} className="nx-state-bg" style={{ stroke: sc }} />
              <circle cx={-48} cy={0} r={3.5} fill={sc} />
              <text x={-40} y={4} className="nx-state">{STATE_LABEL[a.state]}</text>
            </g>
            <text y={84} textAnchor="middle" className="nx-sub">{a.title}</text>
            <text y={100} textAnchor="middle" className="nx-when">{a.state === "unknown" ? "status not reported" : ago(a.updatedAt)}{a.counts.queued ? ` · ${a.counts.queued} queued` : ""}</text>
          </g>
        );
      })}
    </svg>
  );
}
