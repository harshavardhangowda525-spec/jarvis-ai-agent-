"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VIEWS } from "@/lib/friday/plan";
import { highlight } from "@/components/aston/highlight";

/**
 * Friday at work, live: every step of preparing a 3D model as it happens —
 * the specs, the plan being written, each part Blender builds, materials,
 * lighting, cameras, the export, each render as it finishes, the checks.
 * Everything shown is what the task itself reported.
 */

type Stage = "specs" | "plan" | "materials" | "geometry" | "modifiers" | "validate" | "lighting" | "cameras" | "save" | "export" | "render" | "verify" | "done" | "failed";
type Part = { id: string; name: string; shape: string; group: string; status: "building" | "built"; material?: string; faces?: number; cutter?: boolean; conceptual?: boolean; internal?: boolean; done?: number | null; total?: number | null };
type Render = { view: string; label: string; url: string; seconds: number | null; done: number | null; total: number | null; reused?: boolean };
interface Snap {
  stage: { stage: Stage; note: string } | null;
  log: { text: string; kind?: string; at: string }[];
  plan: string;
  materials: { id: string; name: string; color: string }[];
  parts: Part[];
  model: string | null;
  renders: Render[];
  result: { projectId: string; version: number; ok: boolean; text: string } | null;
  stages: Stage[];
}
const EMPTY: Snap = { stage: null, log: [], plan: "", materials: [], parts: [], model: null, renders: [], result: null, stages: [] };

const STEPS: { id: Stage; label: string }[] = [
  { id: "specs", label: "Specs" }, { id: "plan", label: "Plan" }, { id: "materials", label: "Materials" }, { id: "geometry", label: "Geometry" },
  { id: "modifiers", label: "Details" }, { id: "validate", label: "Check" }, { id: "lighting", label: "Lighting" }, { id: "cameras", label: "Cameras" },
  { id: "save", label: "Save .blend" }, { id: "export", label: "Export GLB" }, { id: "render", label: "Render" }, { id: "verify", label: "Verify" }, { id: "done", label: "Done" },
];

export function FridayProcess({ jobId, title, running, onCancel, onClose, onModel, compact = false }: {
  jobId: string; title: string; running: boolean; compact?: boolean;
  onCancel?: () => void; onClose?: () => void; onModel?: (url: string) => void;
}) {
  const [s, setS] = useState<Snap>(EMPTY);
  const [live, setLive] = useState(true);
  const planBuf = useRef("");
  const onModelRef = useRef(onModel); onModelRef.current = onModel;

  useEffect(() => {
    setS(EMPTY); planBuf.current = "";
    const es = new EventSource(`/api/friday/live?job=${encodeURIComponent(jobId)}`);
    es.addEventListener("snapshot", (m) => { const snap = JSON.parse((m as MessageEvent).data) as Snap; planBuf.current = snap.plan; setS(snap); if (snap.model) onModelRef.current?.(snap.model); });
    es.addEventListener("e", (m) => {
      const e = JSON.parse((m as MessageEvent).data);
      if (e.type === "plan") { planBuf.current += e.text; return; } // applied a few times a second below
      setS((x) => {
        switch (e.type) {
          case "stage": return { ...x, stage: { stage: e.stage, note: e.note }, stages: x.stages.includes(e.stage) ? x.stages : [...x.stages, e.stage] };
          case "log": return { ...x, log: [...x.log, e].slice(-300) };
          case "plan_reset": planBuf.current = ""; return { ...x, plan: "" };
          case "material": return x.materials.some((mm) => mm.id === e.id) ? x : { ...x, materials: [...x.materials, e] };
          case "part": { const i = x.parts.findIndex((p) => p.id === e.id); const parts = [...x.parts]; if (i >= 0) parts[i] = { ...parts[i], ...e }; else parts.push(e); return { ...x, parts }; }
          case "model": onModelRef.current?.(e.url); return { ...x, model: e.url };
          case "render": { const i = x.renders.findIndex((r) => r.view === e.view); const renders = [...x.renders]; if (i >= 0) renders[i] = e; else renders.push(e); return { ...x, renders }; }
          case "result": return { ...x, result: e };
          default: return x;
        }
      });
    });
    es.onerror = () => setLive(false);
    es.onopen = () => setLive(true);
    const iv = setInterval(() => setS((x) => (x.plan === planBuf.current ? x : { ...x, plan: planBuf.current })), 150);
    return () => { es.close(); clearInterval(iv); };
  }, [jobId]);

  const cur = s.stage?.stage ?? null;
  const failed = cur === "failed";
  const reached = (id: Stage) => s.stages.includes(id);
  const planHtml = useMemo(() => highlight(s.plan, "plan.json"), [s.plan]);
  const planRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (cur === "plan" && planRef.current) planRef.current.scrollTop = planRef.current.scrollHeight; }, [s.plan, cur]);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [s.log.length]);
  const visibleParts = s.parts.filter((p) => !p.cutter);
  const built = s.parts.filter((p) => p.status === "built").length;
  const partTotal = s.parts.find((p) => p.total)?.total ?? s.parts.length;
  const rendersDone = s.renders.filter((r) => !r.reused).length + s.renders.filter((r) => r.reused).length;
  const renderTotal = s.renders.find((r) => r.total)?.total ?? (reached("render") ? VIEWS.length : 0);
  const renderingNow = cur === "render" ? VIEWS.find((v) => !s.renders.some((r) => r.view === v.id))?.id : null;

  return (
    <section className={`fp${compact ? " compact" : ""}`} aria-label="Friday at work">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="fp-h">
        <div><b>{title}</b><small aria-live="polite">{failed ? `Stopped — ${s.stage?.note}` : s.stage?.note ?? (running ? "Starting…" : "")}{!live && running ? " · reconnecting…" : ""}</small></div>
        <div className="fp-acts">{running && onCancel && <button onClick={onCancel}>Cancel</button>}{onClose && <button onClick={onClose} aria-label={running ? "Hide (Friday keeps working)" : "Close"} title={running ? "Hide — Friday keeps working" : "Close"}>{running ? "–" : "×"}</button>}</div>
      </header>
      <ol className="fp-steps">
        {STEPS.map((st) => {
          const on = st.id === cur && st.id !== "done";
          const done = cur === "done" || (reached(st.id) && st.id !== cur);
          return <li key={st.id} className={on ? "on" : done ? "done" : ""}>{st.label}{st.id === "geometry" && partTotal ? ` ${built}/${partTotal}` : ""}{st.id === "render" && renderTotal ? ` ${rendersDone}/${renderTotal}` : ""}</li>;
        })}
        {failed && <li className="bad">Stopped</li>}
      </ol>
      <div className="fp-grid">
        <div className="fp-col">
          {(s.plan || cur === "plan") && (
            <div className="fp-box">
              <h4>Model plan {cur === "plan" ? <span className="fp-live">writing…</span> : null}</h4>
              <pre ref={planRef} className="fp-code"><code dangerouslySetInnerHTML={{ __html: planHtml || "…" }} />{cur === "plan" && <span className="fp-caret" />}</pre>
            </div>
          )}
          {!!s.materials.length && (
            <div className="fp-box"><h4>Materials</h4><div className="fp-mats">{s.materials.map((m) => <span key={m.id}><i style={{ background: m.color }} />{m.name}</span>)}</div></div>
          )}
          {!!s.parts.length && (
            <div className="fp-box">
              <h4>Parts {built}/{partTotal}{s.parts.some((p) => p.cutter) ? <small> (incl. {s.parts.filter((p) => p.cutter).length} cutter{s.parts.filter((p) => p.cutter).length === 1 ? "" : "s"})</small> : null}</h4>
              <ul className="fp-parts">{s.parts.map((p) => (
                <li key={p.id} className={p.status}>
                  <b>{p.status === "built" ? "✓" : <span className="fp-spin" />}</b>
                  <span className="n">{p.name}</span>
                  <span className="d">{p.shape.replace(/_/g, " ")}{p.material && !p.cutter ? ` · ${p.material}` : ""}{p.faces != null ? ` · ${p.faces} faces` : ""}</span>
                  {p.cutter && <em>cutter</em>}{p.conceptual && <em>concept</em>}{p.internal && <em>internal</em>}
                </li>
              ))}</ul>
              {!!visibleParts.length && <small className="fp-dim">{new Set(visibleParts.map((p) => p.group)).size} groups: {[...new Set(visibleParts.map((p) => p.group))].join(", ")}</small>}
            </div>
          )}
        </div>
        <div className="fp-col">
          {reached("render") || s.renders.length ? (
            <div className="fp-box">
              <h4>Renders {rendersDone}/{renderTotal || VIEWS.length}</h4>
              <div className="fp-renders">{VIEWS.map((v) => {
                const r = s.renders.find((x) => x.view === v.id);
                return (
                  <figure key={v.id} className={r ? "ok" : v.id === renderingNow ? "now" : ""}>
                    {r ? <a href={r.url} target="_blank" rel="noreferrer"><img src={r.url} alt={`${v.label} render`} /></a> : <div className="fp-slot">{v.id === renderingNow ? "rendering…" : "waiting"}</div>}
                    <figcaption>{v.label}{r?.seconds != null ? ` · ${r.seconds}s` : r?.reused ? " · reused" : ""}</figcaption>
                  </figure>
                );
              })}</div>
            </div>
          ) : null}
          <div className="fp-box">
            <h4>Activity</h4>
            <div className="fp-log" ref={logRef}>
              {s.log.map((l, i) => <div key={i} className={`l-${l.kind ?? "info"}`}><time>{new Date(l.at).toLocaleTimeString()}</time> {l.text}</div>)}
              {!s.log.length && <span className="fp-dim">{running ? "Waiting for Friday to start…" : "No activity recorded for this task (it ran before this screen was open, or JARVIS restarted since)."}</span>}
            </div>
          </div>
        </div>
      </div>
      {s.result && <p className={`fp-result${s.result.ok ? "" : " bad"}`}>{s.result.text.split("\n")[0]}</p>}
    </section>
  );
}

const CSS = `
.fp{border:1px solid var(--line,rgba(34,211,238,.22));background:var(--pan,rgba(8,20,32,.86));border-radius:14px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;color:var(--tx,#d7f6ff)}
.fp-h{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.fp-h>div:first-child{display:flex;flex-direction:column;min-width:0}.fp-h small{color:var(--c,#22d3ee)}
.fp-acts button{background:none;border:1px solid var(--line,rgba(34,211,238,.22));border-radius:8px;padding:2px 10px;color:inherit;cursor:pointer}
.fp-steps{display:flex;flex-wrap:wrap;gap:4px;list-style:none;margin:0;padding:0}
.fp-steps li{font:11px ui-monospace,Menlo,monospace;padding:2px 8px;border-radius:999px;border:1px solid rgba(127,163,179,.3);color:#7fa3b3}
.fp-steps li.done{color:#4ade80;border-color:rgba(74,222,128,.35)}.fp-steps li.on{background:#22d3ee;color:#001018;border-color:#22d3ee}.fp-steps li.bad{background:#7f1d1d;color:#fff}
.fp-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
.fp-col{display:flex;flex-direction:column;gap:10px;min-width:0}
.fp-box{border:1px solid rgba(34,211,238,.15);border-radius:10px;padding:8px 10px;background:rgba(3,8,14,.55);min-width:0}
.fp-box h4{margin:0 0 6px;font:600 11px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#22d3ee}.fp-box h4 small{color:#7fa3b3;letter-spacing:0;text-transform:none}
.fp-live{color:#fbbf24;letter-spacing:0;text-transform:none}
.fp-code{margin:0;max-height:240px;overflow:auto;font:11.5px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.fp-caret{display:inline-block;width:6px;height:12px;background:#fbbf24;animation:fpb .8s infinite;vertical-align:text-bottom}
@keyframes fpb{50%{opacity:.2}}
.hl-t{color:#7dd3fc}.hl-a{color:#fbbf24}.hl-s{color:#86efac}.hl-c{color:#64748b}.hl-k{color:#c4b5fd}.hl-n{color:#fda4af}.hl-p{color:#93c5fd}
.fp-mats{display:flex;flex-wrap:wrap;gap:6px}.fp-mats span{display:flex;align-items:center;gap:5px;font-size:12px;border:1px solid rgba(127,163,179,.25);border-radius:999px;padding:1px 8px}.fp-mats i{width:10px;height:10px;border-radius:50%;border:1px solid #fff4}
.fp-parts{list-style:none;margin:0;padding:0;max-height:260px;overflow:auto;font-size:12.5px}
.fp-parts li{display:grid;grid-template-columns:18px minmax(0,auto) 1fr auto auto;gap:6px;align-items:baseline;padding:2px 0;border-bottom:1px solid rgba(127,163,179,.1)}
.fp-parts li b{color:#4ade80}.fp-parts .n{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fp-parts .d{color:#7fa3b3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-parts em{font-style:normal;font-size:10px;border:1px solid rgba(251,191,36,.4);color:#fbbf24;border-radius:999px;padding:0 6px}
.fp-spin{display:inline-block;width:10px;height:10px;border:2px solid #22d3ee;border-right-color:transparent;border-radius:50%;animation:fps .7s linear infinite}
@keyframes fps{to{transform:rotate(360deg)}}
.fp-renders{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.fp-renders figure{margin:0;display:flex;flex-direction:column;gap:2px}.fp-renders img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:4px;border:1px solid rgba(34,211,238,.2);display:block}
.fp-slot{aspect-ratio:4/3;border:1px dashed rgba(127,163,179,.3);border-radius:4px;display:grid;place-items:center;font-size:10px;color:#7fa3b3}
.fp-renders figure.now .fp-slot{border-color:#22d3ee;color:#22d3ee;animation:fpb 1.2s infinite}
.fp-renders figcaption{font-size:10px;color:#7fa3b3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-log{max-height:220px;overflow:auto;font:11.5px/1.5 ui-monospace,Menlo,monospace}.fp-log time{color:#3f6b7c}.fp-log .l-ok{color:#86efac}.fp-log .l-error{color:#f87171}
.fp-dim{color:#7fa3b3}.fp-result{margin:0;color:#86efac}.fp-result.bad{color:#f87171}
.fp.compact .fp-grid{grid-template-columns:1fr}.fp.compact .fp-code{max-height:140px}.fp.compact .fp-parts{max-height:150px}.fp.compact .fp-log{max-height:130px}.fp.compact .fp-renders{grid-template-columns:repeat(5,minmax(0,1fr))}
@media (max-width:760px){.fp-grid{grid-template-columns:1fr}.fp-renders{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;
