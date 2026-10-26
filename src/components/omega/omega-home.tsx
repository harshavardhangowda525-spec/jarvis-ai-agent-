"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { STATE_COLOR } from "./tokens";
import { STATE_LABEL, type AgentState } from "@/lib/nexus/agents";
import type { HomePhase } from "./home-omega";

/**
 * JARVIS HOME — the OMEGA waveform. A luminous ribbon (cyan → violet) whose
 * shape follows JARVIS's REAL state: calm and nearly flat when idle (no fake
 * audio), driven by your microphone level while listening and by JARVIS's own
 * voice output while speaking; slow undulation while thinking, travelling
 * pulses while routing, quicker motion while executing. Under it, the state
 * row, the system state and the live agent network.
 */

const PHASES: HomePhase[] = ["IDLE", "LISTENING", "THINKING", "ROUTING", "EXECUTING", "RESPONDING"];
const PHASE_COLOR: Record<HomePhase, string> = { IDLE: "#8fa9c4", LISTENING: "#5fe1ff", THINKING: "#5fe1ff", ROUTING: "#7aa8ff", EXECUTING: "#b07cff", RESPONDING: "#c87bff" };
export type Mini = { id: string; name: string; color: string; state: AgentState; reason: string; chat: string | null };

/** The luminous ribbon itself (shared by the waveform home and the OMEGA stage). */
export function WaveCanvas({ phase, micLevel, voiceLevel, className }: { phase: HomePhase; micLevel: number; voiceLevel?: () => number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase), micRef = useRef(micLevel), voiceRef = useRef(voiceLevel);
  phaseRef.current = phase; micRef.current = micLevel; voiceRef.current = voiceLevel;
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, w = 0, h = 0, t = 0, last = performance.now();
    let amp = 0.04, speed = 0.4, energy = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1); const r = c.getBoundingClientRect();
      w = r.width; h = r.height; c.width = Math.max(1, w * dpr); c.height = Math.max(1, h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(c);
    const LINES = 7;
    const draw = (now: number) => {
      const dt = Math.min(50, now - last); last = now;
      const p = phaseRef.current;
      // targets from the real state (listening / responding follow real audio levels)
      const mic = Math.min(1, micRef.current * 2.2);
      const out = voiceRef.current ? Math.min(1, voiceRef.current() * 2.5) : 0;
      const targetAmp = p === "IDLE" ? 0.03 : p === "LISTENING" ? 0.06 + mic * 0.45 : p === "THINKING" ? 0.24 : p === "ROUTING" ? 0.3 : p === "EXECUTING" ? 0.36 : 0.18 + out * 0.4;
      const targetSpeed = p === "IDLE" ? 0.35 : p === "THINKING" ? 0.9 : p === "ROUTING" ? 1.4 : p === "EXECUTING" ? 2.1 : p === "LISTENING" ? 1.1 : 1.3;
      amp += (targetAmp - amp) * Math.min(1, dt / 220);
      speed += (targetSpeed - speed) * Math.min(1, dt / 400);
      energy += ((p === "IDLE" ? 0 : 1) - energy) * Math.min(1, dt / 500);
      t += (dt / 1000) * speed;
      ctx.clearRect(0, 0, w, h);
      const cy = h / 2, A = h * 0.95;
      // soft glow behind the ribbon
      const g = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, w * 0.45);
      g.addColorStop(0, `rgba(95,160,255,${0.10 + energy * 0.10})`); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < LINES; k++) {
        const grad = ctx.createLinearGradient(w * 0.06, 0, w * 0.94, 0);
        grad.addColorStop(0, "rgba(95,225,255,0)"); grad.addColorStop(0.2, "rgba(95,225,255,.9)"); grad.addColorStop(0.5, "rgba(110,140,255,.95)");
        grad.addColorStop(0.8, "rgba(190,110,255,.9)"); grad.addColorStop(1, "rgba(190,110,255,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = k === 3 ? 2.4 : 1.1;
        ctx.globalAlpha = k === 3 ? 1 : 0.35 + 0.08 * (3 - Math.abs(3 - k));
        ctx.shadowColor = k % 2 ? "rgba(170,120,255,.8)" : "rgba(95,225,255,.8)"; ctx.shadowBlur = k === 3 ? 18 : 8;
        ctx.beginPath();
        for (let i = 0; i <= 220; i++) {
          const x = w * 0.04 + (i / 220) * w * 0.92, u = (i / 220) * 2 - 1;
          const env = Math.exp(-u * u * 4.5); // strongest in the middle, calm at the edges
          const off = (k - 3) * 0.55;
          let y = Math.sin(u * (6 + k * 0.6) + t * (2.2 + k * 0.15) + off) * 0.6 + Math.sin(u * 13 - t * 3.1 + k) * 0.25 + Math.sin(u * 3 + t * 1.3) * 0.3;
          if (p === "ROUTING") y += Math.exp(-Math.pow((u - (((t * 0.6) % 2) - 1)) * 4, 2)) * 1.2; // a pulse travelling outward
          ctx[i ? "lineTo" : "moveTo"](x, cy + y * env * A * amp * (1 - Math.abs(k - 3) * 0.08));
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.globalCompositeOperation = "source-over";
      if (!reduce && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const onVis = () => { if (!document.hidden && !reduce) { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(draw); } };
    raf = requestAnimationFrame(draw);
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  return <canvas ref={canvas} className={className} aria-hidden />;
}

/** The six-state row and the system state line. */
export function PhaseRow({ phase }: { phase: HomePhase }) {
  return (
    <>
      <div className="oh-phases" aria-label={`JARVIS state: ${phase}`}>
        {PHASES.map((p) => <span key={p} className={p === phase ? "on" : ""} style={p === phase ? { color: PHASE_COLOR[p], borderColor: PHASE_COLOR[p] } : undefined}>{p}</span>)}
      </div>
      <div className="oh-state">SYSTEM STATE: <b style={{ color: PHASE_COLOR[phase] }}>{phase}</b></div>
    </>
  );
}

/** JARVIS and the agents as a small constellation (real states; click an agent to open it). */
export function AgentNet({ agents }: { agents: Mini[] | null }) {
  const router = useRouter();
  const nodes = agents ?? [];
  const NW = 520, NH = 150, hub = { x: NW / 2, y: NH / 2 };
  const pos = nodes.map((_, i) => {
    const a = Math.PI + (i / Math.max(1, nodes.length - 1)) * Math.PI; // a shallow arc
    const r = i % 2 ? 0.78 : 1;
    return { x: hub.x + Math.cos(a) * 230 * r, y: hub.y + Math.sin(a) * -58 * r + (i % 2 ? 22 : 0) };
  });

  return (
    <svg viewBox={`0 0 ${NW} ${NH}`} className="oh-net" role="group" aria-label="Agent network">
        {nodes.map((a, i) => (
          <line key={`l${a.id}`} x1={hub.x} y1={hub.y} x2={pos[i].x} y2={pos[i].y} stroke={a.state === "working" ? a.color : "rgba(120,200,255,.25)"} strokeWidth={a.state === "working" ? 1.6 : 0.8} strokeDasharray={a.state === "offline" ? "2 4" : a.state === "working" ? "3 6" : undefined} className={a.state === "working" ? "oh-flow" : undefined} />
        ))}
        {nodes.map((a, i) => i < nodes.length - 1 && <line key={`m${a.id}`} x1={pos[i].x} y1={pos[i].y} x2={pos[i + 1].x} y2={pos[i + 1].y} stroke="rgba(120,200,255,.12)" strokeWidth={0.6} />)}
        <circle cx={hub.x} cy={hub.y} r={9} className="oh-hub" />
        <text x={hub.x} y={hub.y + 24} textAnchor="middle" className="oh-hub-l">JARVIS</text>
        {nodes.map((a, i) => (
          <g key={a.id} transform={`translate(${pos[i].x},${pos[i].y})`} className="oh-node" role="button" tabIndex={0}
            onClick={() => a.chat ? router.push(a.chat) : router.push("/dashboard/nexus")} onKeyDown={(e) => { if (e.key === "Enter") a.chat ? router.push(a.chat) : router.push("/dashboard/nexus"); }}
            aria-label={`${a.name}: ${STATE_LABEL[a.state]}. ${a.reason}`}>
            <circle r={6} fill={STATE_COLOR[a.state]} stroke={a.color} strokeWidth={1.4} style={{ filter: `drop-shadow(0 0 6px ${a.color})` }} />
            <text y={-11} textAnchor="middle" className="oh-node-l">{a.name}</text>
            <title>{`${a.name} — ${STATE_LABEL[a.state]}: ${a.reason}`}</title>
          </g>
        ))}
    </svg>
  );
}

export function useAgentsMini() {
  const [agents, setAgents] = useState<Mini[] | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/nexus", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (!stop && j?.ok) setAgents(j.data.agents.map((a: Mini) => ({ id: a.id, name: a.name, color: a.color, state: a.state, reason: a.reason, chat: a.chat })));
    }).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return agents;
}

export function OmegaHome({ phase, micLevel, voiceLevel }: { phase: HomePhase; micLevel: number; voiceLevel?: () => number }) {
  const agents = useAgentsMini();
  return (
    <div className="oh" aria-label="JARVIS">
      <style dangerouslySetInnerHTML={{ __html: OH_CSS }} />
      <div className="oh-head">
        <div className="oh-title">JARVIS WAVEFORM</div>
        <div className="oh-sub">Conversational command area — JARVIS listens, thinks, routes work to the agents and responds.</div>
      </div>
      <WaveCanvas phase={phase} micLevel={micLevel} voiceLevel={voiceLevel} className="oh-wave" />
      <PhaseRow phase={phase} />
      <AgentNet agents={agents} />
    </div>
  );
}

export const OH_CSS = `
.oh{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 16px 96px;pointer-events:none;
  background:radial-gradient(1000px 520px at 50% 45%,rgba(40,80,170,.22),transparent 70%),radial-gradient(700px 400px at 80% 90%,rgba(155,123,255,.10),transparent 70%),linear-gradient(180deg,#040b17,#02050b)}
.oh::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(140,200,255,.08) 1px,transparent 1px);background-size:30px 30px;mask-image:radial-gradient(ellipse at center,#000 20%,transparent 70%)}
.oh-head{text-align:center;position:relative}
.oh-title{font:500 15px "Barlow Condensed",Barlow,sans-serif;letter-spacing:.42em;color:#e8f5ff;text-shadow:0 0 18px rgba(95,225,255,.35)}
.oh-sub{margin-top:6px;font:400 12.5px Barlow,sans-serif;color:#7f97b2}
.oh-wave{width:min(1100px,100%);height:clamp(150px,26vh,260px);display:block;position:relative}
.oh-phases{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(6px,2.4vw,34px);position:relative}
.oh-phases span{font:500 11px "Barlow Condensed",Barlow,sans-serif;letter-spacing:.3em;color:rgba(130,160,195,.55);padding:4px 2px;border-bottom:2px solid transparent;transition:color .35s,border-color .35s}
.oh-phases span.on{text-shadow:0 0 14px currentColor}
.oh-state{margin-top:14px;font:500 12px "Barlow Condensed",Barlow,sans-serif;letter-spacing:.32em;color:#9fb7d0;position:relative}
.oh-net{width:min(560px,100%);height:auto;margin-top:12px;pointer-events:auto;overflow:visible;position:relative}
.oh-hub{fill:#dff6ff;filter:drop-shadow(0 0 10px #5fe1ff)}
.oh-hub-l{fill:#cfe8ff;font:500 9px "Barlow Condensed",sans-serif;letter-spacing:.4em}
.oh-node{cursor:pointer}.oh-node:hover circle{stroke-width:2.4}
.oh-node-l{fill:#9fb7d0;font:500 8.5px "Barlow Condensed",sans-serif;letter-spacing:.22em}
.oh-flow{animation:oh-dash 1.2s linear infinite}
@keyframes oh-dash{to{stroke-dashoffset:-18}}
@media (max-width:640px){.oh{padding-bottom:150px;justify-content:flex-start;padding-top:10vh}.oh-sub{font-size:11.5px}.oh-phases span{letter-spacing:.16em;font-size:10px}}
@media (prefers-reduced-motion:reduce){.oh-flow{animation:none}.oh-phases span{transition:none}}
`;
