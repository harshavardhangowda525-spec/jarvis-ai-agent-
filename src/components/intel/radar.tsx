"use client";

import { useMemo } from "react";
import type { ItemView, Radar } from "./types";

/**
 * GLOBAL TECH RADAR — one sector per category; each blip is a real item:
 * nearer the centre = more recent, larger = more important. A sector glows
 * only when its last-24h count is clearly above its usual daily rate.
 */
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; };

export function TechRadar({ radar, items, selected, onSelect, category, onCategory, now }: {
  radar: Radar; items: ItemView[]; selected: string | null; onSelect: (id: string) => void; category: string; onCategory: (id: string) => void; now: number;
}) {
  const S = 300, C = S / 2, R = 128;
  const n = radar.length;
  const blips = useMemo(() => items.slice(0, 70).flatMap((it) => {
    const k = radar.findIndex((r) => r.id === it.category);
    if (k < 0) return [];
    const ageH = Math.max(0, (now - Date.parse(it.publishedAt ?? it.fetchedAt)) / 3600_000);
    const r = 18 + Math.sqrt(Math.min(1, ageH / 168)) * (R - 26);
    const a = ((k + 0.15 + hash(it.id) * 0.7) / n) * Math.PI * 2 - Math.PI / 2;
    return [{ it, x: C + r * Math.cos(a), y: C + r * Math.sin(a), size: 2 + (it.importance ?? 2) * 0.9 }];
  }), [items, radar, n, now, C, R]);

  return (
    <svg viewBox={`-52 -6 ${S + 104} ${S + 12}`} className="cc-radar" role="img" aria-label="Global tech radar: items by category and recency">
      <defs>
        <radialGradient id="ccr-bg"><stop offset="0" stopColor="#0d3a5c" stopOpacity=".55" /><stop offset="1" stopColor="#05121f" stopOpacity=".1" /></radialGradient>
        <linearGradient id="ccr-sweep" x1="0" x2="1"><stop offset="0" stopColor="#38d6ff" stopOpacity="0" /><stop offset="1" stopColor="#38d6ff" stopOpacity=".35" /></linearGradient>
      </defs>
      <circle cx={C} cy={C} r={R} fill="url(#ccr-bg)" stroke="rgba(80,200,255,.45)" />
      {[0.25, 0.5, 0.75].map((f) => <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="rgba(80,200,255,.18)" />)}
      {radar.map((r, k) => {
        const a0 = (k / n) * Math.PI * 2 - Math.PI / 2, a1 = ((k + 1) / n) * Math.PI * 2 - Math.PI / 2, am = (a0 + a1) / 2;
        const on = category === r.id;
        const path = `M${C},${C} L${C + R * Math.cos(a0)},${C + R * Math.sin(a0)} A${R},${R} 0 0 1 ${C + R * Math.cos(a1)},${C + R * Math.sin(a1)} Z`;
        return (
          <g key={r.id} className="cc-sector" onClick={() => onCategory(on ? "all" : r.id)}>
            <path d={path} fill={on ? "rgba(56,214,255,.16)" : r.emerging ? "rgba(255,190,80,.10)" : "transparent"} stroke="rgba(80,200,255,.16)" />
            <text x={C + (R + 12) * Math.cos(am)} y={C + (R + 12) * Math.sin(am)} textAnchor={Math.cos(am) > 0.2 ? "start" : Math.cos(am) < -0.2 ? "end" : "middle"} dominantBaseline="middle" className={`cc-rlabel${on ? " on" : ""}${r.emerging ? " em" : ""}`}>{r.label}</text>
            <title>{`${r.label}: ${r.total} items this week, ${r.last24} in the last 24h (usually ${r.perDayBefore}/day)${r.emerging ? " — emerging" : ""}`}</title>
          </g>
        );
      })}
      <g className="cc-sweep"><path d={`M${C},${C} L${C + R},${C} A${R},${R} 0 0 0 ${C + R * Math.cos(-0.6)},${C + R * Math.sin(-0.6)} Z`} fill="url(#ccr-sweep)" /></g>
      {blips.map((b) => (
        <circle key={b.it.id} cx={b.x} cy={b.y} r={selected === b.it.id ? b.size + 2.5 : b.size} className={`cc-blip${selected === b.it.id ? " on" : ""}${b.it.analysis ? "" : " raw"}`} onClick={() => onSelect(b.it.id)}>
          <title>{`${b.it.title} — ${b.it.publisher ?? ""}`}</title>
        </circle>
      ))}
      <circle cx={C} cy={C} r={3} fill="#9ff0ff" />
    </svg>
  );
}
