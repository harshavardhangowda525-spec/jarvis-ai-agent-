"use client";

import { useState } from "react";
import { SERVICES, serviceOf } from "@/lib/intel/impact";
import { when, type Opportunity } from "./types";

/**
 * OPPORTUNITY RADAR. Each blip is a stored opportunity: its sector is the
 * service it points at (keyword match, labelled), its distance from the
 * centre is its score (closer = higher), its colour is the follow-up state.
 */
const STATUS_COLOR: Record<string, string> = { new: "#5fe1ff", investigating: "#9b7bff", pursuing: "#4ce0a6" };
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; };
const CONF: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

export function OpportunityRadar({ list, rule, onStatus, onPropose, proposing }: {
  list: Opportunity[]; rule: string; onStatus: (id: string, s: string) => void; onPropose: (id: string, agent: string) => void; proposing: string | null;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [agent, setAgent] = useState("darwin");
  const o = list.find((x) => x.id === sel) ?? list[0];
  const S = 280, C = S / 2, R = 118, n = SERVICES.length;
  if (!list.length) return <div className="cc-empty">No opportunities yet. They come from analysed, relevant stories, and each must cite real sources.</div>;
  const conf = (x: Opportunity) => CONF[x.evidence.some((e) => e.confidence === "high") ? "high" : x.evidence.some((e) => e.confidence === "medium") ? "medium" : "low"];
  return (
    <div className="cc-oppr">
      <svg viewBox={`-30 -14 ${S + 60} ${S + 28}`} className="cc-oppr-svg" role="group" aria-label="Opportunity radar">
        <defs><radialGradient id="oppr-bg"><stop offset="0" stopColor="#0f3558" stopOpacity=".55" /><stop offset="1" stopColor="#03101e" stopOpacity=".1" /></radialGradient></defs>
        <circle cx={C} cy={C} r={R} fill="url(#oppr-bg)" stroke="rgba(95,225,255,.35)" />
        {[0.33, 0.66].map((f) => <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="rgba(95,225,255,.14)" />)}
        {SERVICES.map((s, k) => {
          const a = (k / n) * Math.PI * 2 - Math.PI / 2, am = ((k + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
          return (
            <g key={s.id}>
              <line x1={C} y1={C} x2={C + R * Math.cos(a)} y2={C + R * Math.sin(a)} stroke="rgba(95,225,255,.12)" />
              <text x={C + (R + 10) * Math.cos(am)} y={C + (R + 10) * Math.sin(am)} textAnchor={Math.cos(am) > 0.2 ? "start" : Math.cos(am) < -0.2 ? "end" : "middle"} dominantBaseline="middle" className="cc-oppr-l">{s.label}</text>
            </g>
          );
        })}
        <g className="cc-oppr-sweep"><path d={`M${C},${C} L${C + R},${C} A${R},${R} 0 0 0 ${C + R * Math.cos(-0.5)},${C + R * Math.sin(-0.5)} Z`} fill="rgba(95,225,255,.10)" /></g>
        {list.map((x) => {
          const svc = serviceOf(`${x.title} ${x.detail.howWeCouldUseIt}`);
          const k = SERVICES.findIndex((s) => s.id === svc.id);
          const a = ((k + 0.2 + hash(x.id) * 0.6) / n) * Math.PI * 2 - Math.PI / 2;
          const r = R * (0.12 + (1 - x.score / 100) * 0.85);
          const on = o?.id === x.id;
          return (
            <g key={x.id} onClick={() => setSel(x.id)} style={{ cursor: "pointer" }}>
              <circle cx={C + r * Math.cos(a)} cy={C + r * Math.sin(a)} r={on ? 7 : 4 + Math.min(3, x.evidence.length)} fill={STATUS_COLOR[x.status] ?? "#5fe1ff"} stroke={on ? "#fff" : "#03101e"} strokeWidth={on ? 2 : 1.5} className="cc-oppr-dot" />
              <title>{`${x.title} — score ${x.score}`}</title>
            </g>
          );
        })}
      </svg>
      {o && (
        <div className="cc-oppr-d">
          <div className="cc-oppr-list">{list.slice(0, 6).map((x) => <button key={x.id} className={x.id === o.id ? "on" : ""} onClick={() => setSel(x.id)}><b>{x.score}</b> {x.title}</button>)}</div>
          <div className="cc-oppr-t">{o.title}</div>
          <dl>
            <dt>Observed</dt><dd>{o.detail.whatHappened}</dd>
            {o.detail.whyItMatters && <><dt>Why it matters</dt><dd>{o.detail.whyItMatters}</dd></>}
            <dt>Target customers</dt><dd>{o.detail.whoBenefits}</dd>
            <dt>Suggested service</dt><dd>{serviceOf(`${o.title} ${o.detail.howWeCouldUseIt}`).label} — {o.detail.howWeCouldUseIt}</dd>
            <dt>Next action</dt><dd>{o.detail.nextAction ?? "Investigate the sources below."}</dd>
            <dt>Evidence</dt><dd><ul>{o.evidence.map((e) => <li key={e.itemId}><a href={e.url} target="_blank" rel="noreferrer">{e.title}</a> <small>— {e.publisher} · {when(e.publishedAt)}</small></li>)}</ul></dd>
            <dt>Confidence · relevance</dt><dd>{conf(o)} · relevance {o.detail.scoreParts.relevance}/5 · score {o.score}/100</dd>
            <dt>Discovered · state</dt><dd>{when(o.createdAt)} · {o.status}</dd>
          </dl>
          <p className="cc-dim" title={rule}>Score rule: {rule}</p>
          <div className="cc-row">
            {(["investigating", "pursuing", "dismissed"] as const).map((s) => <button key={s} className={`cc-btn sm${o.status === s ? " on" : ""}`} onClick={() => onStatus(o.id, s)}>{s === "dismissed" ? "Dismiss" : s[0].toUpperCase() + s.slice(1)}</button>)}
          </div>
          <div className="cc-row">
            <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent to assign">
              <option value="darwin">DARWIN — find leads</option><option value="robin">RUBIN — outreach plan</option><option value="aston">ASTON — build a demo</option><option value="ev">EVIE — content &amp; research</option>
            </select>
            <button className="cc-btn sm" disabled={proposing === o.id} onClick={() => onPropose(o.id, agent)}>{proposing === o.id ? "Sending…" : "Send to JARVIS for approval"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
