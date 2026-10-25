"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CATEGORIES } from "@/lib/intel/topics";
import { voiceWasOn } from "@/hooks/useVoice";
import { isVoiceSilent } from "@/lib/voice/silence";
import { claimRecognizer, releaseRecognizer } from "@/lib/voice/mic-lock";
import { TechRadar } from "./radar";
import { BriefingDrawer } from "./briefing-drawer";
import { CC_CSS } from "./styles";
import { ago, api, when, type CC, type ItemView, type Opportunity } from "./types";

/**
 * MAIN ENVIRONMENT INTERFACE — the external business environment for
 * Infinity Web & Apps. Everything on screen is a stored, real item with its
 * source; empty panels say why they're empty. Internal CRM numbers live in
 * the drawer (Internal metrics), not on this screen.
 */

const FILTERS = [{ id: "all", label: "All Intelligence" }, ...CATEGORIES];
const CONF_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

async function say(text: string, force = false) {
  if (!force && (!voiceWasOn() || isVoiceSilent())) return;
  try {
    const r = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 600), agent: "jarvis" }) });
    if (!r.ok) throw new Error("tts");
    const url = URL.createObjectURL(await r.blob());
    const a = new Audio(url); a.onended = () => URL.revokeObjectURL(url); await a.play();
  } catch {
    try { if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* no voice */ }
  }
}

function Panel({ title, children, className = "", actions }: { title: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={`cc-panel ${className}`}>
      <header><h2>{title}</h2>{actions}</header>
      {children}
    </section>
  );
}

function Analyst({ it, onClose }: { it: ItemView; onClose?: () => void }) {
  const a = it.analysis;
  const rows: [string, string | undefined][] = a ? [
    ["What happened", a.whatHappened], ["Why it matters", a.whyItMatters], ["Business impact", a.businessImpact], ["Opportunity", a.opportunity], ["Risk", a.risk], ["Recommended action", a.recommendedAction],
    ["Source confidence", `${CONF_LABEL[a.confidence.level]} — ${a.confidence.reason}`],
  ] : [];
  return (
    <div className="cc-analyst" aria-live="polite">
      <div className="cc-analyst-h"><span className="cc-logo">◈</span> JARVIS · BUSINESS ENVIRONMENT ANALYST {onClose && <button className="cc-x" onClick={onClose} aria-label="Close analysis">×</button>}</div>
      <div className="cc-analyst-t">{it.title}</div>
      {a ? (
        <>
          <table><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k.toUpperCase()}</th><td>{v}</td></tr>)}</tbody></table>
          <div className="cc-dim">{a.basis} Sources carrying it: {a.confidence.publishers.join(", ")}.</div>
        </>
      ) : <div className="cc-dim">Not analysed yet — the analysis runs after each refresh when an AI provider is available. Headline and link below are the real item.</div>}
      <a className="cc-link" href={it.url} target="_blank" rel="noreferrer">Original: {it.publisher ?? "source"} · {when(it.publishedAt)} ↗</a>
    </div>
  );
}

function FeedCard({ it, on, onClick }: { it: ItemView; on: boolean; onClick: () => void }) {
  const cat = CATEGORIES.find((c) => c.id === it.category)?.label ?? it.category ?? "—";
  return (
    <button className={`cc-card${on ? " on" : ""}`} onClick={onClick}>
      <div className="cc-card-t">{it.title}</div>
      <div className="cc-card-m">{it.publisher ?? "Unknown publisher"} · {when(it.publishedAt)}</div>
      <div className="cc-card-k"><span>Category:</span> {cat}</div>
      <div className="cc-card-k"><span>Importance:</span> {it.importance == null ? "not rated yet" : ["", "Low", "Low", "Medium", "High", "Critical"][it.importance]}{it.relevance != null && <> · <span>Relevance:</span> {it.relevance}/5</>}</div>
      {it.summary && <div className="cc-card-s"><span>Short summary:</span> {it.summary.slice(0, 160)}{it.summary.length > 160 ? "…" : ""}</div>}
      {it.analysis && <div className="cc-card-s"><span>Why it matters:</span> {it.analysis.whyItMatters}</div>}
      {it.analysis && <div className="cc-card-s"><span>Business relevance:</span> {it.analysis.businessImpact}</div>}
      <div className="cc-card-l">Original link ↗</div>
    </button>
  );
}

function VideoPanel({ videos, yt, now }: { videos: ItemView[]; yt: CC["status"]["youtube"]; now: number }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const main = videos.find((v) => v.id === pick) ?? videos[0];
  if (!yt.configured) return <div className="cc-empty"><b>Live intelligence is off.</b><br />{yt.message}</div>;
  if (!main) return <div className="cc-empty">No official videos collected yet — press Refresh.</div>;
  const m = main.media!;
  return (
    <div className="cc-video">
      <div className="cc-player">
        {playing === m.videoId
          ? <iframe src={`https://www.youtube-nocookie.com/embed/${m.videoId}?rel=0`} title={main.title} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          : <button className="cc-thumb" onClick={() => setPlaying(m.videoId)} aria-label={`Play ${main.title}`} style={m.thumbnail ? { backgroundImage: `url(${m.thumbnail})` } : undefined}><span className="cc-play">▶</span></button>}
        {m.liveNow ? <span className="cc-live">● LIVE</span> : m.live === "upcoming" ? <span className="cc-upcoming">UPCOMING</span> : null}
      </div>
      <div className="cc-video-t">{main.title}</div>
      <div className="cc-dim">Publisher: {m.channel}</div>
      <div className="cc-dim">Published: {when(main.publishedAt)}{m.liveNow && m.viewers != null ? ` · ${m.viewers.toLocaleString("en-IN")} watching` : ""}</div>
      <div className="cc-dim">
        Live status: {m.liveNow ? "live" : m.stale ? `was live when last checked (${ago(m.checkedAt, now)}) — not re-checked since` : m.live === "upcoming" ? `scheduled ${when(m.scheduledStart)}` : "not live"} · checked {ago(m.checkedAt, now)}
      </div>
      <a className="cc-link" href={main.url} target="_blank" rel="noreferrer">Original source: YouTube ↗</a>
      {videos.length > 1 && (
        <>
          <div className="cc-sub">Related recent videos</div>
          <div className="cc-vlist">
            {videos.slice(0, 8).filter((v) => v.id !== main.id).slice(0, 6).map((v) => (
              <button key={v.id} className="cc-vitem" onClick={() => { setPick(v.id); setPlaying(null); }}>
                <span className="cc-vthumb" style={v.media?.thumbnail ? { backgroundImage: `url(${v.media.thumbnail})` } : undefined}>{v.media?.liveNow && <i>LIVE</i>}</span>
                <span>{v.title}<small>{v.media?.channel} · {ago(v.publishedAt, now)}</small></span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Opportunities({ list, rule, onStatus }: { list: Opportunity[]; rule: string; onStatus: (id: string, s: string) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const o = list.find((x) => x.id === sel) ?? list[0];
  if (!o) return <div className="cc-empty">No opportunities yet. They&apos;re found from analysed, relevant items — each must cite real sources.</div>;
  return (
    <div className="cc-opp">
      <div className="cc-opp-list">
        {list.slice(0, 7).map((x) => <button key={x.id} className={x.id === o.id ? "on" : ""} onClick={() => setSel(x.id)}><b>{x.score}</b> {x.title}</button>)}
      </div>
      <div className="cc-opp-d">
        <div className="cc-opp-t">{o.title}</div>
        <p><span>What happened:</span> {o.detail.whatHappened}</p>
        <p><span>Who benefits:</span> {o.detail.whoBenefits}</p>
        <p><span>How Infinity Web &amp; Apps could use it:</span> {o.detail.howWeCouldUseIt}</p>
        <p><span>Investigation difficulty:</span> {o.detail.difficulty[0].toUpperCase() + o.detail.difficulty.slice(1)}</p>
        <p><span>Evidence supporting it:</span></p>
        <ul>{o.evidence.map((e) => <li key={e.itemId}><a href={e.url} target="_blank" rel="noreferrer">{e.title}</a> <small>— {e.publisher} · {when(e.publishedAt)}</small></li>)}</ul>
        <p><span>Confidence level:</span> {CONF_LABEL[o.evidence.some((e) => e.confidence === "high") ? "high" : o.evidence.some((e) => e.confidence === "medium") ? "medium" : "low"]} · <span>Score:</span> {o.score}/100</p>
        <p className="cc-dim" title={rule}>{rule}</p>
        <div className="cc-row">
          {(["investigating", "pursuing", "dismissed"] as const).map((s) => <button key={s} className={`cc-btn sm${o.status === s ? " on" : ""}`} onClick={() => onStatus(o.id, s)}>{s === "dismissed" ? "Dismiss" : s[0].toUpperCase() + s.slice(1)}</button>)}
        </div>
      </div>
    </div>
  );
}

export function CommandCenter() {
  const params = useSearchParams();
  const [cc, setCc] = useState<CC | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [liveOnly, setLiveOnly] = useState(false);
  const [highRel, setHighRel] = useState(false);
  const [emerging, setEmerging] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [analystOpen, setAnalystOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{ open: boolean; tab: "daily" | "weekly" | "internal" | "topics" }>({ open: false, tab: "daily" });
  const [cmd, setCmd] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const recRef = useRef<{ stop: () => void } | null>(null);
  const oppRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (category !== "all") p.set("category", category);
      if (q) p.set("q", q);
      if (highRel) p.set("minRelevance", "4");
      setCc(await api<CC>(`/api/intel?${p}`));
      setErr(null);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [category, q, highRel]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => { setNow(Date.now()); void load(); }, 5 * 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const b = params.get("briefing");
    if (b) setDrawer({ open: true, tab: b.startsWith("weekly") ? "weekly" : "daily" });
  }, [params]);

  const refresh = useCallback(async () => {
    setRefreshing(true); setErr(null);
    try {
      const r = await api<{ report: { added: number; sources: { ok: boolean }[] }; analysis: { analyzed: number } | null; ai: boolean }>("/api/intel/refresh", { method: "POST" });
      const failed = r.report.sources.filter((s) => !s.ok).length;
      setReply(`Refreshed: ${r.report.added} new item${r.report.added === 1 ? "" : "s"}${r.analysis ? `, ${r.analysis.analyzed} analysed` : r.ai ? "" : " (no AI provider — not analysed)"}${failed ? `, ${failed} source${failed === 1 ? "" : "s"} failed` : ""}.`);
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setRefreshing(false); }
  }, [load]);

  // first visit with nothing cached → fetch once
  const autoRefreshed = useRef(false);
  useEffect(() => { if (cc && !cc.status.lastRefreshAt && !autoRefreshed.current) { autoRefreshed.current = true; void refresh(); } }, [cc, refresh]);

  const emergingCats = useMemo(() => new Set(cc?.radar.filter((r) => r.emerging).map((r) => r.id) ?? []), [cc]);
  const feed = useMemo(() => (cc?.priority ?? []).filter((i) => !emerging || emergingCats.has(i.category ?? "")), [cc, emerging, emergingCats]);
  const featured = feed.find((i) => i.id === sel) ?? feed[0];
  const videos = useMemo(() => (cc?.videos ?? []).filter((v) => !liveOnly || v.media?.liveNow), [cc, liveOnly]);
  const relatedVideo = featured && cc?.videos.find((v) => v.media && featured.title.toLowerCase().split(/\W+/).filter((w) => w.length > 4).some((w) => v.title.toLowerCase().includes(w)));

  const select = (id: string) => { setSel(id); setAnalystOpen(true); };

  const run = (text: string) => {
    const t = text.toLowerCase().trim();
    if (!t) return;
    const cat = FILTERS.find((f) => t.includes(f.label.toLowerCase()) || new RegExp(`\\b${f.id}\\b`).test(t));
    let msg = "";
    if (/refresh|update|reload/.test(t)) { void refresh(); msg = "Refreshing sources…"; }
    else if (/brief|briefing|summary of today/.test(t)) { setDrawer({ open: true, tab: /week/.test(t) ? "weekly" : "daily" }); msg = `Opening the ${/week/.test(t) ? "weekly review" : "daily briefing"}.`; }
    else if (/internal|crm|leads|clients/.test(t)) { setDrawer({ open: true, tab: "internal" }); msg = "Opening internal metrics."; }
    else if (/topic|alert|notif/.test(t)) { setDrawer({ open: true, tab: "topics" }); msg = "Opening topics and alerts."; }
    else if (/opportunit/.test(t)) { oppRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); const o = cc?.opportunities[0]; msg = o ? `Top opportunity: ${o.title}, score ${o.score}.` : "No opportunities found yet."; }
    else if (/live/.test(t)) { setLiveOnly(true); liveRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); const n = cc?.status.counts.liveNow ?? 0; msg = cc?.status.youtube.configured ? (n ? `${n} official livestream${n === 1 ? " is" : "s are"} live now.` : "No official livestreams are live right now.") : "Live videos aren't configured — YOUTUBE_API_KEY is missing."; }
    else if (/emerging/.test(t)) { setEmerging(true); msg = emergingCats.size ? `Emerging now: ${[...emergingCats].map((c) => CATEGORIES.find((x) => x.id === c)?.label).join(", ")}.` : "Nothing is clearly emerging right now."; }
    else if (/high relevance|relevant/.test(t)) { setHighRel(true); msg = "Showing high-relevance items."; }
    else if (/^(search|find|show me|look for)\s+(.+)/.test(t) && !cat) { const m = /^(?:search|find|show me|look for)\s+(?:for\s+)?(.+)/.exec(t)!; setQ(m[1]); msg = `Searching for “${m[1]}”.`; }
    else if (/clear|reset|everything|all intelligence/.test(t)) { setCategory("all"); setQ(""); setLiveOnly(false); setHighRel(false); setEmerging(false); msg = "Showing all intelligence."; }
    else if (cat) { setCategory(cat.id); msg = `Showing ${cat.label}.`; }
    else if (/(top|first|main|featured) (story|item)|what('?s| is) (the )?(top|biggest)/.test(t)) { if (featured) { select(featured.id); msg = `Top item: ${featured.title}, from ${featured.publisher ?? "an unknown publisher"}.${featured.analysis ? ` ${featured.analysis.whyItMatters}` : ""}`; } else msg = "There are no items yet."; }
    else { setQ(text.trim()); msg = `Searching headlines for “${text.trim()}”. For anything else, ask JARVIS in chat.`; }
    setReply(msg);
    void say(msg, listening);
  };

  const listen = () => {
    type SR = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void };
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
    if (!Ctor) { setReply("Voice commands need a browser with speech recognition (Chrome or Edge). Type the command instead."); return; }
    if (listening) { recRef.current?.stop(); return; }
    const id = Symbol("intel");
    const rec = new Ctor();
    if (!claimRecognizer({ id, name: "intel", standDown: () => rec.stop() }, true)) return;
    rec.lang = "en-IN"; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => { const t = e.results[0][0].transcript; setCmd(t); run(t); };
    rec.onend = () => { setListening(false); releaseRecognizer(id); };
    rec.onerror = () => { setListening(false); releaseRecognizer(id); };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const setOppStatus = async (id: string, status: string) => {
    try { await api("/api/intel/opportunities", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) }); await load(); } catch (e) { setErr((e as Error).message); }
  };

  const st = cc?.status;
  const failedSources = st?.report?.sources.filter((s) => !s.ok) ?? [];

  return (
    <div className="cc">
      <style dangerouslySetInnerHTML={{ __html: CC_CSS }} />
      <div className="cc-top">
        <div className="cc-brand"><span className="cc-logo">◈</span> JARVIS</div>
        <div className="cc-title">MAIN ENVIRONMENT INTERFACE</div>
        <div className="cc-actions">
          <button className={`cc-icon${listening ? " on" : ""}`} onClick={listen} aria-label={listening ? "Stop listening" : "Voice command"} title="Voice command">🎙</button>
          <button className="cc-icon" onClick={() => setDrawer({ open: true, tab: "daily" })} aria-label="Briefings" title="Briefings">🔔</button>
          <Link className="cc-icon" href="/dashboard/chat" aria-label="Ask JARVIS" title="Ask JARVIS">💬</Link>
        </div>
      </div>

      <form className="cc-cmd" onSubmit={(e) => { e.preventDefault(); run(cmd); }}>
        <span className="cc-dim">COMMAND</span>
        <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder={'Try "show AI", "live now", "search smart glasses", "opportunities", "brief me", "refresh"'} aria-label="Command" />
        <button className="cc-btn" type="submit">Run</button>
        <button className="cc-btn" type="button" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
      </form>
      {reply && <div className="cc-reply" role="status">{reply}</div>}
      {err && <div className="cc-warn" role="alert">{err}</div>}

      <div className="cc-filters">
        <span className="cc-label">ENVIRONMENT FILTERS</span>
        <div className="cc-chips">
          {FILTERS.map((f) => <button key={f.id} className={`cc-chip${category === f.id ? " on" : ""}${emergingCats.has(f.id) ? " em" : ""}`} onClick={() => setCategory(f.id)}>{f.label}</button>)}
          {q && <button className="cc-chip on" onClick={() => setQ("")}>“{q}” ×</button>}
        </div>
        <div className="cc-chips right">
          <button className={`cc-chip${liveOnly ? " on" : ""}`} onClick={() => setLiveOnly((v) => !v)}>Live now</button>
          <button className={`cc-chip${highRel ? " on" : ""}`} onClick={() => setHighRel((v) => !v)}>High relevance</button>
          <button className={`cc-chip${emerging ? " on" : ""}`} onClick={() => setEmerging((v) => !v)}>Emerging Opportunities</button>
        </div>
      </div>

      <div className="cc-grid">
        <div className="cc-left">
          <Panel title="GLOBAL TECH RADAR">
            <div className="cc-dim">Every blip is a real item — nearer the centre is newer, bigger is more important. Click a sector to filter.</div>
            {cc ? <TechRadar radar={cc.radar} items={cc.priority} selected={featured?.id ?? null} onSelect={select} category={category} onCategory={setCategory} now={now} /> : <div className="cc-empty">Loading…</div>}
          </Panel>
          <Panel title="RADAR READOUT" className="cc-readout">
            <ul className="cc-rlist">
              {cc?.radar.map((r) => <li key={r.id} className={r.emerging ? "em" : ""}><button onClick={() => setCategory(r.id)}>{r.label}</button><span>{r.total} · {r.last24} in 24h{r.emerging ? " · emerging" : ""}</span></li>)}
            </ul>
            {featured && (
              <div className="cc-readout-sel">
                <div className="cc-sub">{featured.title}</div>
                {featured.analysis ? <><p><span>What happened:</span> {featured.analysis.whatHappened}</p><p><span>Why it matters:</span> {featured.analysis.whyItMatters}</p></> : <p className="cc-dim">Not analysed yet.</p>}
                <a className="cc-link" href={featured.url} target="_blank" rel="noreferrer">Original link ↗</a>
              </div>
            )}
          </Panel>
        </div>

        <div className="cc-center">
          <div className="cc-center-top">
            <Panel title="PRIORITY INTELLIGENCE FEED" className="cc-feed-mini">
              {(() => { const it = feed.find((x) => x.id !== featured?.id); return it ? <FeedCard it={it} on={false} onClick={() => select(it.id)} /> : <div className="cc-empty">{loading ? "Loading…" : "No items match."}</div>; })()}
            </Panel>
            <Panel title="CENTRAL INTELLIGENCE SCREEN" className="cc-central">
              {featured ? (
                <div className="cc-feature">
                  <div className="cc-feature-l">
                    <div className="cc-sub">Featured story</div>
                    <h3>{featured.title}</h3>
                    <div className="cc-dim">{featured.publisher ?? "Unknown publisher"} · {when(featured.publishedAt)} · {CATEGORIES.find((c) => c.id === featured.category)?.label}</div>
                    {featured.summary && <p>{featured.summary.slice(0, 260)}{featured.summary.length > 260 ? "…" : ""}</p>}
                    <a className="cc-link" href={featured.url} target="_blank" rel="noreferrer">Read the original ↗</a>
                    {relatedVideo && <a className="cc-link" href={relatedVideo.url} target="_blank" rel="noreferrer">Related broadcast: {relatedVideo.title} ↗</a>}
                  </div>
                  <div className="cc-feature-r">
                    <div className="cc-sub">Why it matters</div>
                    {featured.analysis ? (
                      <>
                        <p>{featured.analysis.whyItMatters}</p>
                        <p><span>Business relevance:</span> {featured.analysis.businessImpact}</p>
                        <button className="cc-btn sm" onClick={() => setAnalystOpen(true)}>Full analysis</button>
                      </>
                    ) : <p className="cc-dim">Not analysed yet.</p>}
                  </div>
                </div>
              ) : <div className="cc-empty">{loading ? "Loading…" : cc?.status.lastRefreshAt ? "No items match these filters." : "Collecting the first sources…"}</div>}
            </Panel>
          </div>

          <Panel title="PRIORITY INTELLIGENCE FEED" className="cc-feed" actions={<span className="cc-dim">{feed.length} items · last 7 days</span>}>
            <div className="cc-cards">
              {feed.filter((x) => x.id !== feed.find((y) => y.id !== featured?.id)?.id).slice(0, 13).map((it) => <FeedCard key={it.id} it={it} on={featured?.id === it.id} onClick={() => select(it.id)} />)}
              {feed.length <= 2 && <div className="cc-empty">{loading ? "Loading…" : "Nothing more for these filters."}</div>}
            </div>
            {analystOpen && featured && <div className="cc-analyst-wrap"><Analyst it={featured} onClose={() => setAnalystOpen(false)} /></div>}
          </Panel>
        </div>

        <div className="cc-right">
          <div ref={liveRef}>
            <Panel title="LIVE INTELLIGENCE" actions={st?.youtube.configured ? <span className="cc-dim">{st.counts.liveNow} live now</span> : undefined}>
              {cc ? <VideoPanel videos={videos.length ? videos : liveOnly ? [] : cc.videos} yt={cc.status.youtube} now={now} /> : <div className="cc-empty">Loading…</div>}
              {liveOnly && cc?.status.youtube.configured && !videos.length && <div className="cc-dim">No official channel is live right now. <button className="cc-btn sm" onClick={() => setLiveOnly(false)}>Show recent videos</button></div>}
            </Panel>
          </div>
          <div ref={oppRef}>
            <Panel title="OPPORTUNITY DETECTOR">
              <div className="cc-dim">Actionable business possibilities worth investigating — each cites real sources.</div>
              {cc && <Opportunities list={cc.opportunities} rule={cc.scoreRule} onStatus={setOppStatus} />}
            </Panel>
          </div>
        </div>
      </div>

      <footer className="cc-status">
        <span className="cc-label">● LIVE STATUS AND DATA TRANSPARENCY</span>
        <div><b>Latest news refresh</b><span>{st ? ago(st.lastRefreshAt, now) : "…"}</span></div>
        <div><b>Sources</b><span>{st?.report ? `${st.report.sources.length - failedSources.length}/${st.report.sources.length} answered${failedSources.length ? ` · failed: ${failedSources.slice(0, 2).map((s) => s.name).join(", ")}` : ""}` : "not fetched yet"}</span></div>
        <div><b>Feed</b><span>{loading || refreshing ? "loading…" : `${st?.counts.news ?? 0} items · ${st?.counts.analysed ?? 0} analysed`}</span></div>
        <div><b>Video</b><span>{st?.youtube.configured ? `${st.counts.videos} official videos · ${st.counts.liveNow} live` : "YOUTUBE_API_KEY missing"}</span></div>
        <div><b>Search</b><span>{st?.report?.tavily ? "Tavily on" : "Tavily off (SEARCH_API_KEY)"}</span></div>
        <div className="cc-honest">Every item links to its source. Live status is YouTube&apos;s own at the time shown. Nothing here is generated or simulated.</div>
        <button className="cc-btn sm" onClick={() => setDrawer({ open: true, tab: "internal" })}>Internal metrics</button>
        <button className="cc-btn sm" onClick={() => setDrawer({ open: true, tab: "topics" })}>Topics &amp; alerts</button>
      </footer>

      <BriefingDrawer open={drawer.open} initial={drawer.tab} cc={cc} onClose={() => setDrawer((d) => ({ ...d, open: false }))} onSaved={load} speak={(t) => void say(t)} />
    </div>
  );
}
