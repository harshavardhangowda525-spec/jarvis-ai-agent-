"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Lock, LogOut } from "lucide-react";
import { AgentGlyph } from "./glyphs";
import { STATE_COLOR } from "./tokens";
import { WaveCanvas, PhaseRow, AgentNet, useAgentsMini, OH_CSS } from "./omega-home";
import type { HomePhase } from "./home-omega";
import { Globe } from "@/components/intel/globe";
import { NeuralCore } from "@/components/nexus/neural-core";
import { SERVICES, serviceOf } from "@/lib/intel/impact";
import { STATE_LABEL, NEXUS_AGENTS } from "@/lib/nexus/agents";
import type { CC } from "@/components/intel/types";
import type { AgentStatus } from "@/lib/nexus/status";
import type { JobView } from "@/lib/jobs/engine";
import type { CenterItem } from "@/lib/approvals/center";

/**
 * JARVIS OMEGA — the whole command environment on one screen, laid out like
 * the reference: JARVIS Home in the middle, Dashboard A (Business Environment
 * Intelligence) tilted on the left, Dashboard B (Agent Command Nexus) tilted
 * on the right, and the Approval & Activity Center below. Every panel shows
 * real data; each opens its full workspace.
 */

const ago = (iso: string | null | undefined) => {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const get = async <T,>(url: string): Promise<T | null> => { try { const r = await fetch(url, { cache: "no-store" }); const j = await r.json(); return r.ok && j?.ok ? (j.data as T) : null; } catch { return null; } };

function usePoll<T>(url: string, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(async () => { const d = await get<T>(url); if (d) setData(d); }, [url]);
  useEffect(() => { void load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]);
  return [data, load] as const;
}

export function OmegaStage({ phase, micLevel, voiceLevel, userName }: { phase: HomePhase; micLevel: number; voiceLevel?: () => number; userName: string }) {
  const router = useRouter();
  const agents = useAgentsMini();
  const [intel] = usePoll<CC>("/api/intel", 180_000);
  const [nexus] = usePoll<{ agents: AgentStatus[] }>("/api/nexus", 20_000);
  const [tl] = usePoll<{ jobs: JobView[] }>("/api/nexus/timeline?days=2", 30_000);
  const [ap, reloadAp] = usePoll<{ approvals: CenterItem[]; decisions: { id: string; kind: string; decision: string; detail: string | null; at: string }[] }>("/api/approvals", 30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [place, setPlace] = useState<string | null>(null);

  const decide = async (it: CenterItem) => {
    setBusy(it.id);
    await fetch("/api/approvals/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: it.kind, id: it.id, decision: "approve" }) }).catch(() => {});
    setBusy(null); void reloadAp();
  };
  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); router.push("/login"); router.refresh(); };
  const lock = async () => { await fetch("/api/gate/lock", { method: "POST" }).catch(() => {}); router.replace(`/unlock?next=${encodeURIComponent("/dashboard")}`); };

  const working = nexus?.agents.filter((a) => a.state === "working").length ?? 0;
  const stream = intel?.priority.slice(0, 9) ?? [];
  const videos = intel?.videos.slice(0, 2) ?? [];
  const opps = intel?.opportunities.slice(0, 8) ?? [];
  const globePlaces = (intel?.places ?? []).map((p) => ({ ...p, relevant: (intel?.priority ?? []).some((i) => (i.relevance ?? 0) >= 4 && i.places.some((x) => x.id === p.id)) }));
  const jobs = (tl?.jobs ?? []).slice(-6);
  const pending = ap?.approvals ?? [];

  return (
    <div className="os" aria-label="JARVIS OMEGA">
      <style dangerouslySetInnerHTML={{ __html: OH_CSS + OS_CSS }} />

      <header className="os-title">
        <h1>JARVIS <span>OMEGA</span></h1>
        <p>Cinematic, futuristic AI command environment</p>
      </header>

      {/* ───── Dashboard A: Business Environment Intelligence ───── */}
      <section className="os-panel os-left" aria-label="Dashboard A: Business Environment Intelligence">
        <div className="os-ph"><Link href="/dashboard/intel">Dashboard A: <b>Business Environment Intelligence</b></Link><span>Powered by EVIE</span></div>
        <div className="os-a">
          <div className="os-a-col">
            <div className="os-sec">
              <div className="os-st">Holographic global intelligence map</div>
              <div className="os-globe">{intel ? <Globe places={globePlaces} selected={place} onSelect={setPlace} /> : <div className="os-empty">Loading…</div>}</div>
              <div className="os-cap"><i />{globePlaces.length ? `${globePlaces.length} places named in today's stories` : "No story names a place yet"}</div>
            </div>
            <div className="os-sec">
              <div className="os-st">Cinematic video intelligence wall</div>
              {videos.length ? (
                <div className="os-vids">{videos.map((v) => (
                  <a key={v.id} href={v.url} target="_blank" rel="noreferrer" className="os-vid" style={v.media?.thumbnail ? { backgroundImage: `url(${v.media.thumbnail})` } : undefined}>
                    {v.media?.liveNow && <em>LIVE</em>}<span>{v.title}</span>
                  </a>))}</div>
              ) : <div className="os-empty sm">{intel?.status.youtube.configured ? "No official videos yet — refresh in Business Intelligence." : "Add YOUTUBE_API_KEY to show official videos and livestreams."}</div>}
            </div>
            <div className="os-sec">
              <div className="os-st">Opportunity radar</div>
              <MiniRadar opps={opps} />
            </div>
          </div>
          <div className="os-a-stream">
            <div className="os-st">Live intelligence stream</div>
            <ul>
              {stream.map((it) => (
                <li key={it.id}><a href={it.url} target="_blank" rel="noreferrer">
                  <b>{it.title}</b>
                  <span>{it.publisher ?? "source"} · {ago(it.publishedAt ?? it.fetchedAt)}</span>
                  {it.analysis && <small>{it.analysis.whyItMatters}</small>}
                </a></li>
              ))}
              {!stream.length && <li className="os-empty sm">{intel ? "No stories yet — open Business Intelligence and press Refresh." : "Loading…"}</li>}
            </ul>
          </div>
        </div>
      </section>

      {/* ───── JARVIS Home ───── */}
      <div className="os-center-label">JARVIS HOME</div>
      <section className="os-center" aria-label="JARVIS Home">
        <div className="os-bar">
          <span className="os-brand">JARVIS</span>
          <nav>
            <Link href="/dashboard" className="on">Home</Link>
            <Link href="/dashboard/intel">Business Intelligence</Link>
            <Link href="/dashboard/nexus">Agent Command Nexus</Link>
            <Link href="/dashboard/activity">Activity Center</Link>
          </nav>
          <div className="os-bar-r">
            <Link href="/dashboard/activity" className="os-ic" aria-label={`${pending.length} waiting for approval`}><Bell className="h-3.5 w-3.5" />{pending.length ? <em>{pending.length}</em> : null}</Link>
            <span className="os-av" title={userName}>{userName[0]?.toUpperCase()}</span>
            <button className="os-ic" onClick={lock} aria-label="Lock JARVIS" title="Lock"><Lock className="h-3.5 w-3.5" /></button>
            <button className="os-ic" onClick={logout} aria-label="Log out" title="Log out"><LogOut className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <div className="os-home">
          <div className="oh-title">JARVIS WAVEFORM</div>
          <div className="oh-sub">Conversational command area — JARVIS listens, thinks, routes work to the agents and responds.</div>
          <WaveCanvas phase={phase} micLevel={micLevel} voiceLevel={voiceLevel} className="os-wave" />
          <PhaseRow phase={phase} />
          <div className="os-net"><AgentNet agents={agents} /></div>
        </div>
      </section>

      {/* ───── Dashboard B: Agent Command Nexus ───── */}
      <section className="os-panel os-right" aria-label="Dashboard B: Agent Command Nexus">
        <div className="os-ph"><Link href="/dashboard/nexus">Dashboard B: <b>Agent Command Nexus</b></Link><span>{working ? `${working} working` : "live"}</span></div>
        <div className="os-sec os-core">
          <div>
            <div className="os-st">Central AI neural core</div>
            <p>JARVIS plans each request, dispatches it to the right agents, waits for your approval before anything external, and collects the results.</p>
          </div>
          <div className="os-core-v"><NeuralCore energy={Math.min(1, working * 0.3 + (phase !== "IDLE" ? 0.35 : 0))} pulseKey={0} className="os-core-c" /><span>JARVIS</span></div>
        </div>
        <div className="os-sec">
          <div className="os-st">Agent entities</div>
          <div className="os-ents">
            {(nexus?.agents ?? NEXUS_AGENTS.map((a) => ({ ...a, state: "unknown" as const, reason: "" }))).map((a) => (
              <Link key={a.id} href={a.chat ?? "/dashboard/nexus"} className="os-ent" style={{ ["--ac" as string]: a.color }} title={`${a.name} — ${STATE_LABEL[a.state]}${a.reason ? `: ${a.reason}` : ""}`}>
                <span className="os-hex"><svg viewBox="-30 -30 60 60" aria-hidden><polygon points="0,-26 22.5,-13 22.5,13 0,26 -22.5,13 -22.5,-13" /></svg><span><AgentGlyph motif={a.motif} size={16} color={a.color} /></span></span>
                <span className="os-ent-t"><b>{a.name}</b><small>{a.title}</small><i><u style={{ background: STATE_COLOR[a.state] }} />{STATE_LABEL[a.state]}</i></span>
              </Link>
            ))}
          </div>
        </div>
        <div className="os-sec">
          <div className="os-st">Live neural connections</div>
          <p className="os-p">{jobs.length ? `${jobs.filter((j) => ["planning", "assigned", "running"].includes(j.status)).length} task(s) in flight · ${jobs.filter((j) => j.status === "waiting_approval").length} waiting for approval · ${jobs.filter((j) => j.status === "completed").length} completed recently. Pathways light in the Nexus as each task moves.` : "No tasks in the last two days. Ask JARVIS for something and the agents' pathways light up as it's dispatched."}</p>
        </div>
        <div className="os-sec">
          <div className="os-st">Task orchestration timeline</div>
          <MiniTimeline jobs={jobs} />
        </div>
      </section>

      {/* ───── Approval & Activity Center ───── */}
      <section className="os-panel os-bottom" aria-label="Approval and Activity Center">
        <div className="os-ph center"><Link href="/dashboard/activity"><b>Approval &amp; Activity Center</b></Link></div>
        <div className="os-st">Actions</div>
        <div className="os-acts">
          {pending.slice(0, 3).map((it) => {
            const a = NEXUS_AGENTS.find((x) => x.id === it.agent);
            return (
              <div key={`${it.kind}-${it.id}`} className="os-act" style={{ ["--ac" as string]: a?.color ?? "#5fe1ff" }}>
                <div className="os-act-v"><span><AgentGlyph motif={a?.motif ?? ""} size={20} color={a?.color} /></span></div>
                <b>{it.title}</b>
                <small>{it.effect}</small>
                <div className="os-act-b">
                  {it.actions.includes("approve") && <button disabled={busy === it.id} onClick={() => decide(it)}>{busy === it.id ? "…" : "Approve"}</button>}
                  <Link href="/dashboard/activity">Review</Link>
                </div>
              </div>
            );
          })}
          {!pending.length && (ap?.decisions ?? []).slice(0, 3).map((d) => (
            <div key={d.id} className="os-act done"><div className="os-act-v"><span>✓</span></div><b>{d.decision} · {d.kind.replace("_", " ")}</b><small>{d.detail}</small><div className="os-act-b"><span>{ago(d.at)}</span></div></div>
          ))}
          {!pending.length && !(ap?.decisions ?? []).length && <div className="os-empty sm">Nothing is waiting for your approval.</div>}
        </div>
      </section>
    </div>
  );
}

function MiniRadar({ opps }: { opps: CC["opportunities"] }) {
  const S = 150, C = S / 2, R = 62, n = SERVICES.length;
  const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; };
  return (
    <div className="os-radar">
      <svg viewBox={`0 0 ${S} ${S}`} aria-label="Opportunity radar">
        <circle cx={C} cy={C} r={R} className="os-r0" />{[0.33, 0.66].map((f) => <circle key={f} cx={C} cy={C} r={R * f} className="os-r1" />)}
        {SERVICES.map((_, k) => { const a = (k / n) * Math.PI * 2 - Math.PI / 2; return <line key={k} x1={C} y1={C} x2={C + R * Math.cos(a)} y2={C + R * Math.sin(a)} className="os-r1" />; })}
        <g className="os-sweep"><path d={`M${C},${C} L${C + R},${C} A${R},${R} 0 0 0 ${C + R * Math.cos(-0.5)},${C + R * Math.sin(-0.5)} Z`} fill="rgba(95,225,255,.14)" /></g>
        {opps.map((o) => { const k = SERVICES.findIndex((s) => s.id === serviceOf(`${o.title} ${o.detail.howWeCouldUseIt}`).id); const a = ((k + 0.2 + hash(o.id) * 0.6) / n) * Math.PI * 2 - Math.PI / 2; const r = R * (0.12 + (1 - o.score / 100) * 0.85); return <circle key={o.id} cx={C + r * Math.cos(a)} cy={C + r * Math.sin(a)} r={3.2} className="os-blip"><title>{`${o.title} — ${o.score}`}</title></circle>; })}
      </svg>
      <ul>{opps.slice(0, 3).map((o) => <li key={o.id}><b>{o.score}</b> {o.title}</li>)}{!opps.length && <li className="os-empty sm">No opportunities yet.</li>}</ul>
    </div>
  );
}

const ST_COLOR: Record<string, string> = { planning: "#9b7bff", assigned: "#7f97b2", running: "#5fe1ff", waiting_approval: "#f4c35a", completed: "#4ce0a6", failed: "#ff6b7a", cancelled: "#5d7590" };
const ST_LABEL: Record<string, string> = { planning: "Planning", assigned: "Queued", running: "Running", waiting_approval: "Waiting", completed: "Done", failed: "Failed", cancelled: "Cancelled" };
function MiniTimeline({ jobs }: { jobs: JobView[] }) {
  if (!jobs.length) return <div className="os-empty sm">No tasks yet.</div>;
  const t0 = Math.min(...jobs.map((j) => Date.parse(j.createdAt))), t1 = Date.now(), span = Math.max(60_000, t1 - t0);
  const x = (t: number) => `${((t - t0) / span) * 100}%`;
  return (
    <div className="os-tl">
      {jobs.map((j) => {
        const s = Date.parse(j.startedAt ?? j.createdAt), e = Date.parse(j.finishedAt ?? new Date().toISOString());
        return (
          <div key={j.id} className="os-tl-row" title={`${j.agentName}: ${j.title} — ${ST_LABEL[j.status] ?? j.status}`}>
            <span className="os-tl-n">{j.agentName}</span>
            <span className="os-tl-track"><i style={{ left: x(Date.parse(j.createdAt)), width: `calc(${x(e)} - ${x(Date.parse(j.createdAt))})`, background: ST_COLOR[j.status] }} /><u style={{ left: x(s), background: ST_COLOR[j.status] }} /></span>
            <span className="os-tl-s" style={{ color: ST_COLOR[j.status], borderColor: ST_COLOR[j.status] }}>{ST_LABEL[j.status] ?? j.status}</span>
          </div>
        );
      })}
    </div>
  );
}

const OS_CSS = `
.os{position:absolute;inset:0;overflow:hidden;font-family:Barlow,system-ui,sans-serif;color:#e8f3ff;
  background:radial-gradient(1200px 700px at 50% 38%,rgba(40,90,190,.26),transparent 70%),radial-gradient(900px 600px at 0% 100%,rgba(30,120,200,.12),transparent 70%),radial-gradient(900px 600px at 100% 100%,rgba(155,123,255,.12),transparent 70%),linear-gradient(180deg,#040b17,#02050b)}
.os::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(140,200,255,.07) 1px,transparent 1px);background-size:28px 28px;mask-image:radial-gradient(ellipse at 50% 45%,#000 25%,transparent 75%)}
.os a{color:inherit;text-decoration:none}
.os-title{position:absolute;left:50%;top:1.2%;transform:translateX(-50%);text-align:center;z-index:3;pointer-events:none}
.os-title h1{margin:0;font:600 clamp(20px,2.3vw,34px) "Barlow Condensed",Barlow,sans-serif;letter-spacing:.24em;color:#f2f8ff}
.os-title h1 span{background:linear-gradient(90deg,#7ab8ff,#b07cff);-webkit-background-clip:text;background-clip:text;color:transparent}
.os-title p{margin:2px 0 0;font-size:12px;color:#9fb7d0;letter-spacing:.06em}
.os-panel{position:absolute;z-index:2;overflow:hidden;border-radius:14px;border:1px solid rgba(120,200,255,.22);background:linear-gradient(180deg,rgba(10,24,46,.82),rgba(4,12,24,.88));box-shadow:0 30px 80px rgba(0,0,0,.6),inset 0 1px 0 rgba(200,235,255,.06);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:10px 12px;display:flex;flex-direction:column;gap:8px;transition:transform .6s cubic-bezier(.2,.8,.2,1)}
.os-left{left:1%;top:10%;bottom:6%;width:27.5%;transform:perspective(1700px) rotateY(17deg) scale(.97);transform-origin:left center}
.os-right{right:1%;top:10%;bottom:6%;width:27.5%;transform:perspective(1700px) rotateY(-17deg) scale(.97);transform-origin:right center}
.os-left:hover{transform:perspective(1700px) rotateY(9deg)}.os-right:hover{transform:perspective(1700px) rotateY(-9deg)}
.os-ph{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font:500 10.5px "Barlow Condensed",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#7fb8e6;border-bottom:1px solid rgba(120,200,255,.14);padding-bottom:6px}
.os-ph b{color:#eaf6ff;font-weight:600}.os-ph span{color:#7f97b2;font-size:9.5px}.os-ph.center{justify-content:center}
.os-st{font:600 9.5px "Barlow Condensed",sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#cfe8ff;margin-bottom:5px}
.os-sec{border:1px solid rgba(120,200,255,.12);border-radius:10px;padding:7px 8px;background:rgba(4,12,24,.45);min-height:0}
.os-empty{color:#6f87a0;font-size:11px;padding:8px 2px}.os-empty.sm{font-size:10.5px;padding:4px 0}
.os-a{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:8px;flex:1;min-height:0}
.os-a-col{display:flex;flex-direction:column;gap:8px;min-height:0}
.os-globe{height:clamp(130px,22vh,240px);border-radius:8px;overflow:hidden}
.os-globe .cc-globe{height:100%!important}
.os-cap{display:flex;gap:5px;align-items:center;font-size:10px;color:#7f97b2;margin-top:4px}.os-cap i{width:6px;height:6px;border-radius:50%;background:#5fe1ff;box-shadow:0 0 6px #5fe1ff}
.os-vids{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.os-vid{position:relative;aspect-ratio:16/10;border-radius:7px;background:#071a2c center/cover no-repeat;border:1px solid rgba(120,200,255,.18);overflow:hidden;display:flex;align-items:flex-end}
.os-vid span{display:block;width:100%;padding:3px 5px;font-size:9.5px;line-height:1.25;background:linear-gradient(transparent,rgba(0,0,0,.85));color:#eef6ff;max-height:3.2em;overflow:hidden}
.os-vid em{position:absolute;top:4px;right:4px;font:700 8.5px Barlow,sans-serif;font-style:normal;color:#4ce0a6;border:1px solid #4ce0a6;background:rgba(0,30,15,.8);border-radius:4px;padding:0 4px}
.os-radar{display:flex;flex-direction:column;align-items:center;gap:6px}
.os-radar svg{width:min(100%,130px);height:auto}
.os-r0{fill:rgba(15,53,88,.4);stroke:rgba(95,225,255,.35)}.os-r1{fill:none;stroke:rgba(95,225,255,.13)}
.os-blip{fill:#5fe1ff;filter:drop-shadow(0 0 4px #5fe1ff)}
.os-sweep{transform-origin:75px 75px;animation:os-spin 6s linear infinite}
@keyframes os-spin{to{transform:rotate(360deg)}}
.os-radar ul{list-style:none;margin:0;padding:0;font-size:10px;color:#9fb7d0;display:grid;gap:3px;width:100%}.os-radar li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.os-radar li b{color:#5fe1ff;margin-right:3px}
.os-a-stream{border:1px solid rgba(120,200,255,.12);border-radius:10px;padding:7px 8px;background:rgba(4,12,24,.45);display:flex;flex-direction:column;min-height:0;overflow:hidden}
.os-a-stream ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;overflow:hidden}
.os-a-stream li a{display:flex;flex-direction:column;gap:2px;padding:6px 7px;border-radius:8px;border:1px solid rgba(120,200,255,.10);background:rgba(8,20,38,.6)}
.os-a-stream li a:hover{border-color:rgba(95,225,255,.4)}
.os-a-stream b{font-size:11px;line-height:1.3;color:#eef6ff;font-weight:600}
.os-a-stream span{font-size:9.5px;color:#6f87a0}
.os-a-stream small{font-size:9.5px;color:#9fb7d0;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.os-center-label{position:absolute;left:50%;top:9.2%;transform:translateX(-50%);z-index:3;font:500 11px "Barlow Condensed",sans-serif;letter-spacing:.36em;color:#cfe8ff}
.os-center{position:absolute;z-index:2;left:29.6%;right:29.6%;top:12.5%;bottom:31%;border-radius:14px;border:1px solid rgba(120,200,255,.28);background:linear-gradient(180deg,rgba(8,18,36,.9),rgba(3,9,20,.92));box-shadow:0 0 0 1px rgba(95,225,255,.06),0 40px 100px rgba(0,0,0,.7),0 0 60px rgba(70,120,255,.12);overflow:hidden;display:flex;flex-direction:column}
.os-bar{display:flex;align-items:center;gap:12px;height:38px;padding:0 12px;border-bottom:1px solid rgba(120,200,255,.12);background:rgba(4,10,22,.85);flex:none}
.os-brand{font:500 14px "Barlow Condensed",sans-serif;letter-spacing:.38em;color:#eef7ff}
.os-bar nav{display:flex;gap:2px;height:100%}
.os-bar nav a{position:relative;display:flex;align-items:center;padding:0 9px;font:500 9px "Barlow Condensed",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#7f97b2;white-space:nowrap}
.os-bar nav a:hover{color:#e8f3ff}.os-bar nav a.on{color:#f2f9ff}.os-bar nav a.on::after{content:"";position:absolute;left:8px;right:8px;bottom:0;height:2px;background:linear-gradient(90deg,#5fe1ff,#9b7bff)}
.os-bar-r{margin-left:auto;display:flex;align-items:center;gap:4px}
.os-ic{position:relative;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;color:#8fa9c4}.os-ic:hover{background:rgba(95,225,255,.08);color:#fff}
.os-ic em{position:absolute;top:0;right:-2px;min-width:13px;height:13px;border-radius:99px;background:#f4c35a;color:#1a1200;font:700 8.5px/13px Barlow,sans-serif;font-style:normal;text-align:center}
.os-av{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#5fe1ff,#4f5fd8 60%,#2a1e6e);font:600 11px Barlow,sans-serif;color:#fff}
.os-home{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:14px 14px 70px;min-height:0}
.os-wave{width:100%;height:clamp(90px,17vh,200px);display:block}
.os-home .oh-phases{gap:clamp(4px,1.4vw,22px)}
.os-home .oh-phases span{font-size:9.5px;letter-spacing:.24em}
.os-home .oh-state{margin-top:8px;font-size:10.5px}
.os-net{width:min(420px,100%);margin-top:2px}.os-net .oh-net{margin-top:0}
.os-right .os-core{display:grid;grid-template-columns:1fr 120px;gap:6px;align-items:center}
.os-right p,.os-p{margin:0;font-size:10.5px;color:#9fb7d0;line-height:1.45}
.os-core-v{position:relative;width:120px;height:120px}
.os-core-c{position:absolute;left:50%;top:50%;width:190px;height:190px;transform:translate(-50%,-50%)}
.os-core-v span{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:600 10px "Barlow Condensed",sans-serif;letter-spacing:.35em;color:#fff;text-shadow:0 0 10px #5fe1ff}
.os-ents{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.os-ent{display:flex;gap:5px;align-items:center;padding:5px;border-radius:8px;border:1px solid color-mix(in srgb,var(--ac) 30%,transparent);background:linear-gradient(160deg,color-mix(in srgb,var(--ac) 9%,rgba(6,16,30,.85)),rgba(4,10,20,.85));min-width:0}
.os-ent:hover{border-color:var(--ac)}
.os-hex{position:relative;flex:none;width:30px;height:30px;display:flex;align-items:center;justify-content:center}
.os-hex>svg{position:absolute;inset:0;width:100%;height:100%}
.os-hex polygon{fill:rgba(4,14,28,.9);stroke:var(--ac);stroke-width:1.6;filter:drop-shadow(0 0 4px var(--ac))}
.os-hex>span{position:relative;display:flex}
.os-ent-t{display:flex;flex-direction:column;min-width:0}
.os-ent-t b{font:600 10px "Barlow Condensed",sans-serif;letter-spacing:.18em;color:var(--ac)}
.os-ent-t small{font-size:9px;color:#9fb7d0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-ent-t i{display:flex;gap:3px;align-items:center;font-size:8.5px;font-style:normal;color:#cfe2f5;white-space:nowrap;overflow:hidden}
.os-ent-t i u{width:5px;height:5px;border-radius:50%;display:inline-block;text-decoration:none;flex:none}
.os-tl{display:flex;flex-direction:column;gap:4px}
.os-tl-row{display:grid;grid-template-columns:52px 1fr 58px;gap:6px;align-items:center;font-size:9px}
.os-tl-n{font:600 8.5px "Barlow Condensed",sans-serif;letter-spacing:.14em;color:#9fb7d0}
.os-tl-track{position:relative;height:10px;border-radius:99px;background:rgba(120,200,255,.06)}
.os-tl-track i{position:absolute;top:4px;height:2px;border-radius:2px;opacity:.7;min-width:3px}
.os-tl-track u{position:absolute;top:1px;width:8px;height:8px;border-radius:50%;box-shadow:0 0 6px currentColor}
.os-tl-s{font-size:8.5px;border:1px solid;border-radius:99px;padding:0 5px;text-align:center;white-space:nowrap}
.os-bottom{left:32.5%;right:32.5%;top:71.5%;bottom:1.5%;padding:8px 12px}
.os-acts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;flex:1;min-height:0}
.os-act{display:flex;flex-direction:column;gap:3px;border:1px solid color-mix(in srgb,var(--ac,#5fe1ff) 30%,transparent);border-radius:9px;padding:0 7px 7px;background:rgba(4,12,24,.6);overflow:hidden;min-height:0}
.os-act-v{flex:1;min-height:28px;margin:0 -7px 3px;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 130%,color-mix(in srgb,var(--ac,#5fe1ff) 45%,transparent),transparent 70%),rgba(8,22,42,.9)}
.os-act-v span{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;border:1px solid var(--ac,#5fe1ff);box-shadow:0 0 12px color-mix(in srgb,var(--ac,#5fe1ff) 50%,transparent);color:#4ce0a6;font-size:12px}
.os-act b{font-size:10.5px;line-height:1.25;color:#eef6ff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-transform:none}
.os-act small{font-size:9px;color:#8fa9c4;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.os-act-b{margin-top:4px;display:flex;gap:5px;font-size:9.5px;color:#6f87a0}
.os-act-b button,.os-act-b a{flex:1;text-align:center;border:1px solid rgba(120,200,255,.3);border-radius:6px;padding:3px 0;background:rgba(20,48,84,.5);color:#e8f3ff;font:500 9.5px Barlow,sans-serif;cursor:pointer}
.os-act-b button{background:linear-gradient(135deg,rgba(40,140,230,.6),rgba(120,90,240,.5));border-color:transparent}
.os-act-b button:disabled{opacity:.5}
/* the console's own controls inside the JARVIS Home window */
.os-cmd{position:absolute;left:0;right:0;bottom:20px;z-index:20;display:flex;flex-direction:column;align-items:center;padding:0 16px}
.os-heard{position:absolute;left:0;right:0;bottom:5.6rem;z-index:20;display:flex;justify-content:center;padding:0 24px;pointer-events:none}
.os-reply{position:absolute;left:50%;top:3.5%;z-index:20;width:min(92vw,44rem);transform:translateX(-50%)}
@media (min-width:1180px){
  .os-cmd{left:30.5%;right:30.5%;bottom:calc(31% + 12px);padding:0}
  .os-cmd .jv-bar{max-width:100%!important}
  .os-heard{left:30%;right:30%;bottom:calc(31% + 60px)}
  .os-reply{top:calc(12.5% + 46px);width:min(39%,44rem)}
}
@media (max-width:1179px){
  .os-title,.os-left,.os-right,.os-bottom,.os-center-label{display:none}
  .os-center{left:0;right:0;top:0;bottom:0;border-radius:0;border:0}
  .os-bar nav{display:none}
  .os-home{justify-content:center;padding-bottom:110px}
  .os-wave{height:clamp(120px,24vh,240px)}
}
@media (max-height:860px) and (min-width:1180px){.os-net{display:none}}
@media (max-width:1500px){.os-bar{gap:6px;padding:0 8px}.os-bar nav a{padding:0 5px;letter-spacing:.1em}.os-brand{letter-spacing:.24em}}
@media (prefers-reduced-motion:reduce){.os-sweep{animation:none}.os-panel{transition:none}}
`;
