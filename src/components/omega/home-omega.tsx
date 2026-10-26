"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { OmegaNav } from "./omega-nav";
import { STATE_COLOR } from "./tokens";
import { STATE_LABEL, type AgentState } from "@/lib/nexus/agents";

/**
 * The OMEGA layer on JARVIS home: the workspace navigation, the six-state
 * strip (lit from the console's real voice/agent state) and a compact agent
 * constellation (each agent's real status, from /api/nexus).
 */
export const HOME_PHASES = ["IDLE", "LISTENING", "THINKING", "ROUTING", "EXECUTING", "RESPONDING"] as const;
export type HomePhase = (typeof HOME_PHASES)[number];

type Mini = { id: string; name: string; color: string; state: AgentState; reason: string };

export function HomeOmega({ phase }: { phase: HomePhase }) {
  const [agents, setAgents] = useState<Mini[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/nexus", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!stop && j?.ok) setAgents(j.data.agents.map((a: Mini) => ({ id: a.id, name: a.name, color: a.color, state: a.state, reason: a.reason }))); }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  const busy = agents?.filter((a) => a.state === "working").length ?? 0;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ho-nav"><OmegaNav compact /></div>
      <div className="ho-phases" aria-label={`JARVIS state: ${phase}`}>
        {HOME_PHASES.map((p) => <span key={p} className={p === phase ? "on" : ""}>{p}</span>)}
      </div>
      <div className={`ho-const${open ? " open" : ""}`}>
        <button className="ho-const-h" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="ho-dots">{(agents ?? []).map((a) => <i key={a.id} style={{ background: STATE_COLOR[a.state], boxShadow: a.state === "working" ? `0 0 8px ${a.color}` : undefined }} title={`${a.name}: ${STATE_LABEL[a.state]}`} />)}</span>
          <span>Agents{agents ? ` · ${busy ? `${busy} working` : "all quiet"}` : ""}</span>
        </button>
        {open && agents && (
          <ul>
            {agents.map((a) => <li key={a.id}><span className="ho-n" style={{ color: a.color }}>{a.name}</span><span className="ho-s"><i style={{ background: STATE_COLOR[a.state] }} />{STATE_LABEL[a.state]}</span><span className="ho-r">{a.reason}</span></li>)}
            <li className="ho-link"><Link href="/dashboard/nexus">Open the Agent Command Nexus →</Link></li>
          </ul>
        )}
      </div>
    </>
  );
}

const CSS = `
.ho-nav{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:25;max-width:calc(100% - 24px)}
.ho-phases{position:absolute;left:50%;bottom:92px;transform:translateX(-50%);z-index:12;display:flex;gap:4px;flex-wrap:wrap;justify-content:center;pointer-events:none}
.ho-phases span{font:500 9.5px "Barlow Condensed",sans-serif;letter-spacing:.26em;color:rgba(130,160,190,.45);padding:3px 8px;border-radius:999px;border:1px solid transparent;transition:all .35s}
.ho-phases span.on{color:#eaf8ff;border-color:rgba(95,225,255,.5);background:rgba(95,225,255,.10);box-shadow:0 0 14px rgba(95,225,255,.25)}
.ho-const{position:absolute;left:14px;top:62px;z-index:24;font-family:Barlow,sans-serif;max-width:min(360px,calc(100vw - 28px))}
.ho-const-h{display:flex;gap:8px;align-items:center;background:rgba(4,12,24,.6);border:1px solid rgba(120,200,255,.18);border-radius:999px;padding:6px 12px;color:#9fb7d0;font-size:11.5px;cursor:pointer;backdrop-filter:blur(10px)}
.ho-dots{display:flex;gap:4px}.ho-dots i{width:7px;height:7px;border-radius:50%;display:inline-block}
.ho-const ul{list-style:none;margin:6px 0 0;padding:8px 10px;background:rgba(3,10,20,.85);border:1px solid rgba(120,200,255,.18);border-radius:12px;display:grid;gap:6px;font-size:12px;backdrop-filter:blur(12px)}
.ho-const li{display:grid;grid-template-columns:70px 110px 1fr;gap:6px;align-items:center}
.ho-n{font:600 11px "Barlow Condensed",sans-serif;letter-spacing:.2em}
.ho-s{display:flex;gap:5px;align-items:center;color:#cfe2f5}.ho-s i{width:6px;height:6px;border-radius:50%;display:inline-block}
.ho-r{color:#6f87a0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ho-link{grid-template-columns:1fr!important}.ho-link a{color:#5fe1ff;font-size:12px}
@media (max-width:640px){.ho-phases{bottom:120px}.ho-phases span{padding:2px 5px;letter-spacing:.14em}.ho-const{top:96px}.ho-const li{grid-template-columns:62px 1fr}.ho-r{display:none}}
@media (prefers-reduced-motion:reduce){.ho-phases span{transition:none}}
`;
