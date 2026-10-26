"use client";

import { useState } from "react";
import { CATEGORIES } from "@/lib/intel/topics";
import { ago, when, type ItemView } from "./types";

/**
 * LIVE INTELLIGENCE STREAM — every story with its source, original link,
 * publication time, retrieval time and verification status. Duplicates from
 * other publishers are folded in ("also reported by"); the impact score shows
 * which parts are measured and which are AI judgement.
 */

const VERIFY_COLOR: Record<string, string> = { official: "#4ce0a6", corroborated: "#5fe1ff", single: "#8aa1b8" };

export function StreamItem({ it, on, now, onOpen, onSave }: { it: ItemView; on: boolean; now: number; onOpen: () => void; onSave: (saved: boolean) => void }) {
  const cat = CATEGORIES.find((c) => c.id === it.category)?.label ?? "—";
  return (
    <article className={`cc-si${on ? " on" : ""}`}>
      <button className="cc-si-main" onClick={onOpen}>
        <div className="cc-si-top">
          <span className="cc-si-cat">{cat}</span>
          {it.impact && <span className="cc-si-score" title="Business impact score (see the breakdown)">{it.impact.score}</span>}
        </div>
        <div className="cc-si-t">{it.title}</div>
        <div className="cc-si-m">
          <span>{it.publisher ?? "Unknown publisher"}</span> · <span title={it.publishedAt ?? ""}>published {it.publishedAt ? ago(it.publishedAt, now) : "date unknown"}</span> · <span>retrieved {ago(it.fetchedAt, now)}</span>
        </div>
        <div className="cc-si-v"><span className="om-dot" style={{ ["--c" as string]: VERIFY_COLOR[it.verification.level] }} />{it.verification.label}{it.places.length ? ` · ${it.places.map((p) => p.name).join(", ")}` : ""}</div>
        {it.analysis && <div className="cc-si-s">{it.analysis.whyItMatters}</div>}
        {!!it.alsoReportedBy?.length && <div className="cc-si-also">Also reported by {it.alsoReportedBy.map((a) => a.publisher ?? "another source").filter((v, i, x) => x.indexOf(v) === i).join(", ")}</div>}
      </button>
      <div className="cc-si-actions">
        <a href={it.url} target="_blank" rel="noreferrer" className="cc-btn sm">Original ↗</a>
        <button className={`cc-btn sm${it.saved ? " on" : ""}`} onClick={() => onSave(!it.saved)} aria-pressed={it.saved}>{it.saved ? "★ Saved" : "☆ Save"}</button>
      </div>
    </article>
  );
}

const BASIS: Record<string, string> = { measured: "measured", ai_judgement: "AI judgement", mixed: "measured + AI" };

export function AnalystModal({ it, onClose, onSave, onPropose, proposing }: { it: ItemView; onClose: () => void; onSave: (saved: boolean) => void; onPropose: (agent: string) => void; proposing: boolean }) {
  const [agent, setAgent] = useState("darwin");
  const a = it.analysis;
  const rows: [string, string][] = a ? [
    ["What happened", a.whatHappened], ["Why it matters", a.whyItMatters], ["Business impact", a.businessImpact], ["Opportunity", a.opportunity],
    ["Risk", a.risk], ["Recommended action", a.recommendedAction], ["Source confidence", `${a.confidence.level[0].toUpperCase() + a.confidence.level.slice(1)} — ${a.confidence.reason}`],
  ] : [];
  return (
    <div className="cc-modal" role="dialog" aria-label="Business environment analyst" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cc-analyst om-fade-in">
        <div className="cc-analyst-h"><span className="cc-logo">◈</span> EVIE · BUSINESS ENVIRONMENT ANALYST <button className="cc-x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="cc-analyst-t">{it.title}</div>
        <div className="cc-dim">{it.publisher ?? "Unknown publisher"} · published {when(it.publishedAt)} · retrieved {when(it.fetchedAt)} · {it.verification.label}</div>
        {a ? (
          <>
            <table><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k.toUpperCase()}</th><td>{v}</td></tr>)}</tbody></table>
            <div className="cc-dim">AI opinion based on: {a.basis} Sources carrying it: {a.confidence.publishers.join(", ")}.</div>
          </>
        ) : <div className="cc-dim">Not analysed yet — the analysis runs after a refresh when an AI provider is available.</div>}
        {it.impact && (
          <div className="cc-impact">
            <div className="cc-sub">Business impact score: <b>{it.impact.score}</b>/100</div>
            {it.impact.parts.map((p) => (
              <div key={p.key} className="cc-impact-row">
                <span>{p.label} <em>({BASIS[p.basis]}, weight {Math.round(it.impact!.weights[p.key] * 100)}%)</em></span>
                <span className="cc-impact-bar"><i style={{ width: `${Math.round(p.value * 100)}%` }} /></span>
                <span className="cc-dim">{p.why}</span>
              </div>
            ))}
          </div>
        )}
        {!!it.alsoReportedBy?.length && <div className="cc-dim">Also reported by: {it.alsoReportedBy.map((x, i) => <a key={i} href={x.url} target="_blank" rel="noreferrer">{x.publisher ?? "source"}</a>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}</div>}
        <div className="cc-row" style={{ marginTop: 10 }}>
          <a className="cc-btn sm" href={it.url} target="_blank" rel="noreferrer">Read the original ↗</a>
          <button className={`cc-btn sm${it.saved ? " on" : ""}`} onClick={() => onSave(!it.saved)}>{it.saved ? "★ Saved" : "☆ Save story"}</button>
          <span style={{ flex: 1 }} />
          <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent to assign">
            <option value="darwin">DARWIN — find leads</option><option value="robin">RUBIN — outreach plan</option><option value="aston">ASTON — build a demo</option><option value="ev">EVIE — content &amp; research</option>
          </select>
          <button className="cc-btn sm" disabled={proposing} onClick={() => onPropose(agent)}>{proposing ? "Sending…" : "Send to JARVIS for approval"}</button>
        </div>
      </div>
    </div>
  );
}
