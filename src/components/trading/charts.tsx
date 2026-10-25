"use client";

import { useState } from "react";

/**
 * Small SVG charts for the trading dashboard — thin marks, recessive axes, a
 * hover tooltip on every mark, and a legend whenever there's more than one
 * series. Missing values are gaps, never zeros.
 */

export const SERIES = {
  backtest: "#3987e5",
  paper: "#d95926",
  journal: "#199e70",
  lessons: "#c98500",
  drawdown: "#e66767",
} as const;

type Tip = { x: number; y: number; lines: string[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="ti-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.lines.map((l, i) => <div key={i} className={i === 0 ? "ti-tip-h" : ""}>{l}</div>)}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="ti-legend">
      {items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>)}
    </div>
  );
}

/** Stacked daily bars (counts). */
export function StackedBars({ days, series }: { days: { label: string; values: number[] }[]; series: { label: string; color: string }[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const W = 560, H = 190, P = { l: 30, r: 8, t: 10, b: 24 };
  const max = Math.max(1, ...days.map((d) => d.values.reduce((a, b) => a + b, 0)));
  const bw = (W - P.l - P.r) / days.length;
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / max);
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <div className="ti-chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily activity">
        {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="ti-grid" /><text x={P.l - 6} y={y(t) + 3} className="ti-axis" textAnchor="end">{t}</text></g>)}
        {days.map((d, i) => {
          let acc = 0;
          const x = P.l + i * bw + bw * 0.22, w = bw * 0.56;
          const total = d.values.reduce((a, b) => a + b, 0);
          return (
            <g key={d.label}>
              {d.values.map((v, k) => {
                if (!v) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                return <rect key={k} x={x} y={y1 + 1} width={w} height={Math.max(1, y0 - y1 - 2)} rx={k === d.values.length - 1 || !d.values.slice(k + 1).some(Boolean) ? 3 : 0} fill={series[k].color} />;
              })}
              <rect x={P.l + i * bw} y={P.t} width={bw} height={H - P.t - P.b} fill="transparent"
                onMouseMove={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ x: e.clientX - r.left + 12, y: e.clientY - r.top - 10, lines: [d.label, ...(total ? d.values.map((v, k) => `${series[k].label}: ${v}`) : ["No activity"])] }); }} />
              <text x={P.l + i * bw + bw / 2} y={H - 8} className="ti-axis" textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
      </svg>
      <Legend items={series} />
      <Tooltip tip={tip} />
    </div>
  );
}

/** Cumulative net equity (line) above its drawdown (area), each on its own axis panel — never a dual axis. */
export function EquityChart({ points, color, label, currency = "₹" }: { points: { i: number; label: string; net: number; cum: number; dd: number }[]; color: string; label: string; currency?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return <div className="ti-empty">No {label.toLowerCase()} trades in this period.</div>;
  const W = 560, H1 = 150, H2 = 70, P = { l: 52, r: 10, t: 10, b: 6 };
  const n = points.length;
  const x = (i: number) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (n - 1));
  const lo = Math.min(0, ...points.map((p) => p.cum)), hi = Math.max(0, ...points.map((p) => p.cum));
  const y1 = (v: number) => P.t + (H1 - P.t - P.b) * (1 - (v - lo) / (hi - lo || 1));
  const ddMin = Math.min(-1e-9, ...points.map((p) => p.dd));
  const y2 = (v: number) => H1 + 6 + (H2 - 12) * (v / ddMin);
  const fmt = (v: number) => `${v < 0 ? "−" : ""}${currency}${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y1(p.cum)}`).join("");
  const area = `M${x(0)},${y2(0)}` + points.map((p, i) => `L${x(i)},${y2(p.dd)}`).join("") + `L${x(n - 1)},${y2(0)}Z`;
  const h = hover != null ? points[hover] : null;
  return (
    <div className="ti-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H1 + H2}`} role="img" aria-label={`${label} cumulative net and drawdown`}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; let best = 0; points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; }); setHover(best); }}>
        {[lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i).map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y1(v)} y2={y1(v)} className={v === 0 ? "ti-zero" : "ti-grid"} /><text x={P.l - 6} y={y1(v) + 3} className="ti-axis" textAnchor="end">{fmt(v)}</text></g>)}
        <path d={line} fill="none" stroke={color} strokeWidth={2} />
        {n <= 40 && points.map((p, i) => <circle key={i} cx={x(i)} cy={y1(p.cum)} r={hover === i ? 4.5 : 3} fill={color} stroke="#0b1018" strokeWidth={2} />)}
        <text x={P.l} y={H1 + 4} className="ti-axis">Drawdown</text>
        <path d={area} fill={SERIES.drawdown} opacity={0.55} />
        <line x1={P.l} x2={W - P.r} y1={y2(0)} y2={y2(0)} className="ti-zero" />
        <text x={P.l - 6} y={y2(ddMin) + 3} className="ti-axis" textAnchor="end">{fmt(ddMin)}</text>
        {h && <line x1={x(hover!)} x2={x(hover!)} y1={P.t} y2={H1 + H2 - 4} className="ti-cross" />}
      </svg>
      {h && <div className="ti-tip" style={{ left: `${(x(hover!) / W) * 100}%`, top: 8 }}><div className="ti-tip-h">Trade {h.i} · {h.label}</div><div>Net {fmt(h.net)}</div><div>Cumulative {fmt(h.cum)}</div><div>Drawdown {fmt(h.dd)}</div></div>}
    </div>
  );
}

/** Week-over-week small multiple: one measure, one series, gaps where a week has no data. */
export function WeekLine({ title, weeks, values, color, format }: { title: string; weeks: string[]; values: (number | null)[]; color: string; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 260, H = 110, P = { l: 8, r: 8, t: 22, b: 18 };
  const vs = values.filter((v): v is number => v != null);
  const lo = Math.min(0, ...vs), hi = Math.max(1e-9, ...vs);
  const x = (i: number) => P.l + (weeks.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (weeks.length - 1));
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo || 1));
  let d = "";
  values.forEach((v, i) => { if (v == null) return; d += `${i && values[i - 1] != null ? "L" : "M"}${x(i)},${y(v)}`; });
  const last = [...values].reverse().find((v) => v != null);
  return (
    <div className="ti-mini" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <text x={P.l} y={12} className="ti-mini-t">{title}</text>
        <text x={W - P.r} y={12} className="ti-mini-v" textAnchor="end">{last == null ? "no data" : format(last)}</text>
        <line x1={P.l} x2={W - P.r} y1={y(lo)} y2={y(lo)} className="ti-grid" />
        <path d={d} fill="none" stroke={color} strokeWidth={2} />
        {values.map((v, i) => v == null
          ? <text key={i} x={x(i)} y={H - P.b - 2} className="ti-axis" textAnchor="middle">–</text>
          : <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 3} fill={color} stroke="#0b1018" strokeWidth={2} />)}
        {weeks.map((w, i) => <rect key={w} x={x(i) - 14} y={P.t} width={28} height={H - P.t} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        {weeks.map((w, i) => (i === 0 || i === weeks.length - 1) && <text key={w} x={x(i)} y={H - 4} className="ti-axis" textAnchor={i === 0 ? "start" : "end"}>{w.slice(5)}</text>)}
      </svg>
      {hover != null && <div className="ti-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 20 }}><div className="ti-tip-h">Week of {weeks[hover]}</div><div>{values[hover] == null ? "No data" : format(values[hover]!)}</div></div>}
    </div>
  );
}

/** A horizontal progress meter (one value against a goal). */
export function Meter({ value, max, marks, color }: { value: number; max: number; marks?: { at: number; label: string }[]; color: string }) {
  return (
    <div className="ti-meter">
      <div className="ti-meter-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      {marks?.map((m) => <span key={m.label} className="ti-meter-mark" style={{ left: `${(m.at / max) * 100}%` }} title={m.label} />)}
    </div>
  );
}
