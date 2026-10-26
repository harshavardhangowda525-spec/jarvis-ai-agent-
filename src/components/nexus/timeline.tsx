"use client";

import { useMemo, useState } from "react";
import { STATE_COLOR } from "@/components/omega/tokens";
import type { JobView } from "@/lib/jobs/engine";

/**
 * The orchestration timeline: one lane per agent, one bar per real task —
 * thin while it waited in the queue, solid while it ran, ending when it
 * finished (or now). Approval checkpoints are marked where they happened;
 * dependencies are drawn between the tasks.
 */
const STATUS_COLOR: Record<string, string> = { planning: "#9b7bff", assigned: "#5d7590", running: "#5fe1ff", waiting_approval: "#f4c35a", completed: "#4ce0a6", failed: "#ff6b7a", cancelled: "#5d7590" };

export function Timeline({ jobs, agents, onPick, picked }: { jobs: JobView[]; agents: { id: string; name: string; color: string }[]; onPick: (id: string) => void; picked: string | null }) {
  const [hover, setHover] = useState<string | null>(null);
  const lanes = agents.filter((a) => jobs.some((j) => j.agent === a.id));
  const now = Date.now();
  const { t0, t1 } = useMemo(() => {
    const starts = jobs.map((j) => Date.parse(j.createdAt));
    const lo = starts.length ? Math.min(...starts) : now - 3600_000;
    return { t0: lo - (now - lo) * 0.03, t1: now + (now - lo) * 0.03 + 60_000 };
  }, [jobs, now]);
  if (!jobs.length) return <div className="nx-empty">No tasks in this period. Ask JARVIS for something above — every task it delegates appears here as it happens.</div>;
  const W = 1000, laneH = 40, top = 26, H = top + lanes.length * laneH + 10, left = 90;
  const x = (t: number) => left + ((t - t0) / (t1 - t0)) * (W - left - 10);
  const ticks = Array.from({ length: 6 }, (_, i) => t0 + ((t1 - t0) * i) / 5);
  const fmt = (t: number) => new Date(t).toLocaleString("en-IN", (t1 - t0) > 36 * 3600_000 ? { day: "numeric", month: "short", hour: "numeric" } : { hour: "numeric", minute: "2-digit" });
  const laneY = (agent: string) => top + lanes.findIndex((l) => l.id === agent) * laneH + laneH / 2;
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const end = (j: JobView) => Date.parse(j.finishedAt ?? new Date(now).toISOString());
  const h = hover ? byId.get(hover) : null;
  return (
    <div className="nx-tl">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Task timeline">
        {ticks.map((t, i) => <g key={i}><line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 6} className="nx-tl-grid" /><text x={x(t)} y={14} textAnchor="middle" className="nx-tl-axis">{fmt(t)}</text></g>)}
        <line x1={x(now)} x2={x(now)} y1={top - 8} y2={H - 4} className="nx-tl-now" />
        {lanes.map((l) => <text key={l.id} x={8} y={laneY(l.id) + 4} className="nx-tl-lane" style={{ fill: l.color }}>{l.name}</text>)}
        {jobs.flatMap((j) => j.dependsOn.map((d) => { const p = byId.get(d); if (!p) return null; return <path key={`${d}-${j.id}`} d={`M${x(end(p))},${laneY(p.agent)} C${x(end(p)) + 20},${laneY(p.agent)} ${x(Date.parse(j.createdAt)) - 20},${laneY(j.agent)} ${x(Date.parse(j.createdAt))},${laneY(j.agent)}`} className="nx-tl-dep" />; }))}
        {jobs.map((j) => {
          const y = laneY(j.agent), c = STATUS_COLOR[j.status] ?? "#5d7590";
          const created = Date.parse(j.createdAt), started = j.startedAt ? Date.parse(j.startedAt) : null, fin = end(j);
          const approvals = (j.progress ?? []).filter((s) => s.kind === "approval");
          return (
            <g key={j.id} className={`nx-tl-bar${picked === j.id ? " on" : ""}`} onClick={() => onPick(j.id)} onMouseEnter={() => setHover(j.id)} onMouseLeave={() => setHover(null)}>
              <line x1={x(created)} x2={x(started ?? fin)} y1={y} y2={y} stroke={c} strokeWidth={2} strokeDasharray="2 3" opacity={0.7} />
              {started && <rect x={x(started)} y={y - 7} width={Math.max(4, x(fin) - x(started))} height={14} rx={4} fill={c} opacity={0.85} />}
              {!started && <circle cx={x(created)} cy={y} r={4} fill={c} />}
              {approvals.map((s, i) => <path key={i} d={`M${x(Date.parse(s.at))},${y - 12} l5,5 -5,5 -5,-5z`} fill="#f4c35a" />)}
              <rect x={x(created) - 4} y={y - 14} width={Math.max(12, x(fin) - x(created) + 8)} height={28} fill="transparent" />
            </g>
          );
        })}
      </svg>
      {h && <div className="nx-tl-tip"><b>{h.title}</b><br />{h.agentName} · {h.status.replace("_", " ")}<br /><span className="om-dim">created {new Date(h.createdAt).toLocaleString("en-IN")}{h.finishedAt ? ` · finished ${new Date(h.finishedAt).toLocaleString("en-IN")}` : ""}</span></div>}
      <div className="nx-tl-legend">{Object.entries(STATUS_COLOR).filter(([k]) => k !== "cancelled").map(([k, c]) => <span key={k}><i style={{ background: c }} />{k.replace("_", " ")}</span>)}<span><i className="dia" />approval checkpoint</span></div>
    </div>
  );
}
export { STATE_COLOR };
