"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CATEGORIES } from "@/lib/intel/topics";
import { voiceWasOn } from "@/hooks/useVoice";
import { isVoiceSilent } from "@/lib/voice/silence";
import { claimRecognizer, releaseRecognizer } from "@/lib/voice/mic-lock";
import { OMEGA_CSS } from "@/components/omega/tokens";
import { Globe } from "./globe";
import { OpportunityRadar } from "./opportunity-radar";
import { StreamItem, AnalystModal } from "./stream";
import { BriefingDrawer } from "./briefing-drawer";
import { CC_CSS } from "./styles";
import { ago, api, when, type CC, type ItemView } from "./types";

/**
 * MAIN ENVIRONMENT INTERFACE — the external business environment for
 * Infinity Web & Apps. Everything on screen is a stored, real item with its
 * source; empty panels say why they're empty. Internal CRM numbers live in
 * the drawer (Internal metrics), not on this screen.
 */

const FILTERS = [{ id: "all", label: "All Intelligence" }, ...CATEGORIES];

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



function VideoPanel({ videos, yt, now, last }: { videos: ItemView[]; yt: CC["status"]["youtube"]; now: number; last: NonNullable<CC["status"]["report"]>["youtube"] | null }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const main = videos.find((v) => v.id === pick) ?? videos[0];
  if (!yt.configured) return <div className="cc-empty"><b>Live intelligence is off.</b><br />{yt.message}</div>;
  if (!main) return (
    <div className="cc-empty">
      {last?.configured && last.errors.length
        ? <><b>YouTube answered with an error:</b><br />{last.errors.slice(0, 3).map((e, i) => <span key={i}>{e}<br /></span>)}<span className="cc-dim">Check the key in Google Cloud: YouTube Data API v3 enabled, and no website/IP restriction on the key. Then press Refresh.</span></>
        : last && !last.configured ? <>The key was added after the last refresh — press Refresh.</>
        : <>No official videos collected yet — press Refresh.</>}
    </div>
  );
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
  const [source, setSource] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [placeSel, setPlaceSel] = useState<string | null>(null);
  const [proposing, setProposing] = useState<string | null>(null);
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
      if (source) p.set("source", source);
      if (savedOnly) p.set("saved", "1");
      setCc(await api<CC>(`/api/intel?${p}`));
      setErr(null);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [category, q, highRel, source, savedOnly]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => { setNow(Date.now()); void load(); }, 5 * 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const b = params.get("briefing");
    if (b) setDrawer({ open: true, tab: b.startsWith("weekly") ? "weekly" : "daily" });
    if (params.get("brief")) setDrawer({ open: true, tab: "daily" });
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
  const open = select;
  const stream = useMemo(() => feed.filter((i) => !placeSel || i.places.some((p) => p.id === placeSel)), [feed, placeSel]);
  const selItem = (cc?.priority ?? []).find((i) => i.id === sel) ?? null;
  const globePlaces = useMemo(() => (cc?.places ?? []).map((p) => ({ ...p, relevant: (cc?.priority ?? []).some((i) => (i.relevance ?? 0) >= 4 && i.places.some((x) => x.id === p.id)) })), [cc]);
  const save = async (id: string, saved: boolean) => {
    try { await api("/api/intel/items", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, saved }) }); setCc((c) => (c ? { ...c, priority: c.priority.map((i) => (i.id === id ? { ...i, saved } : i)) } : c)); } catch (e) { setErr((e as Error).message); }
  };
  const propose = async (refKind: "intel_item" | "intel_opportunity", refId: string, agent: string) => {
    setProposing(refId);
    try {
      const r = await api<{ proposal: { title: string } }>("/api/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refKind, refId, agent }) });
      setReply(`Sent to JARVIS for your approval: “${r.proposal.title}”. Approve it in the Activity Center — nothing runs until you do.`);
    } catch (e) { setErr((e as Error).message); } finally { setProposing(null); }
  };

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
    <div className="cc om">
      <style dangerouslySetInnerHTML={{ __html: OMEGA_CSS + CC_CSS }} />
      <div className="cc-top">
        <div>
          <div className="om-title">Dashboard A</div>
          <h1 className="om-h1">Business Environment Intelligence</h1>
          <div className="cc-dim">Powered by EVIE · for Infinity Web &amp; Apps</div>
        </div>
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
        <span className="cc-label">FILTERS</span>
        <div className="cc-chips">
          {FILTERS.map((f) => <button key={f.id} className={`cc-chip${category === f.id ? " on" : ""}${emergingCats.has(f.id) ? " em" : ""}`} onClick={() => setCategory(f.id)}>{f.label}</button>)}
          {q && <button className="cc-chip on" onClick={() => setQ("")}>“{q}” ×</button>}
          {placeSel && <button className="cc-chip on" onClick={() => setPlaceSel(null)}>📍 {cc?.places.find((p) => p.id === placeSel)?.name ?? placeSel} ×</button>}
        </div>
        <div className="cc-chips right">
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" className="cc-select">
            <option value="">All sources</option>
            {cc?.publishers.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.count})</option>)}
          </select>
          <button className={`cc-chip${savedOnly ? " on" : ""}`} onClick={() => setSavedOnly((v) => !v)}>★ Saved</button>
          <button className={`cc-chip${liveOnly ? " on" : ""}`} onClick={() => setLiveOnly((v) => !v)}>Live now</button>
          <button className={`cc-chip${highRel ? " on" : ""}`} onClick={() => setHighRel((v) => !v)}>High relevance</button>
          <button className={`cc-chip${emerging ? " on" : ""}`} onClick={() => setEmerging((v) => !v)}>Emerging</button>
        </div>
      </div>

      <div className="cc-obs">
        <div className="cc-obs-main">
          <Panel title="HOLOGRAPHIC GLOBAL INTELLIGENCE MAP" className="cc-map" actions={<span className="cc-dim">{cc?.places.length ?? 0} places named in {feed.length} stories</span>}>
            {cc ? <Globe places={globePlaces} selected={placeSel} onSelect={setPlaceSel} /> : <div className="cc-empty">Loading…</div>}
            <div className="cc-dim cc-map-legend"><span className="om-dot" style={{ ["--c" as string]: "#5fe1ff" }} /> city named in a story · <span className="om-dot" style={{ ["--c" as string]: "#9b7bff" }} /> country / region named · height = number of stories · arc to Bengaluru = rated highly relevant to you. Stories that name no place aren&apos;t on the map.</div>
            {placeSel && cc && (() => { const p = cc.places.find((x) => x.id === placeSel); return p ? <div className="cc-place"><b>{p.name}</b> <span className="cc-dim">({p.level === "city" ? "city" : "country/region"} named in {p.count} stor{p.count === 1 ? "y" : "ies"})</span><ul>{p.items.map((x) => <li key={x.id}><button onClick={() => open(x.id)}>{x.title}</button></li>)}</ul></div> : null; })()}
          </Panel>
          <div className="cc-obs-row">
            <div ref={liveRef}>
              <Panel title="CINEMATIC VIDEO INTELLIGENCE WALL" actions={st?.youtube.configured ? <span className="cc-dim">{st.counts.liveNow} live now</span> : undefined}>
                {cc ? <VideoPanel videos={videos.length ? videos : liveOnly ? [] : cc.videos} yt={cc.status.youtube} now={now} last={cc.status.report?.youtube ?? null} /> : <div className="cc-empty">Loading…</div>}
                {liveOnly && cc?.status.youtube.configured && !videos.length && <div className="cc-dim">No official channel is live right now. <button className="cc-btn sm" onClick={() => setLiveOnly(false)}>Show recent videos</button></div>}
                <div className="cc-dim" style={{ marginTop: 6 }}>Takeaways for a video come only from its title and description — JARVIS doesn&apos;t watch videos.</div>
              </Panel>
            </div>
            <div ref={oppRef}>
              <Panel title="OPPORTUNITY RADAR">
                {cc && <OpportunityRadar list={cc.opportunities} rule={cc.scoreRule} onStatus={setOppStatus} onPropose={(id, ag) => propose("intel_opportunity", id, ag)} proposing={proposing} />}
              </Panel>
            </div>
          </div>
        </div>

        <Panel title="LIVE INTELLIGENCE STREAM" className="cc-stream" actions={<span className="cc-dim">{stream.length} stories · ranked by impact</span>}>
          <div className="cc-stream-list om-scroll">
            {stream.length ? stream.map((it) => <StreamItem key={it.id} it={it} on={sel === it.id} now={now} onOpen={() => open(it.id)} onSave={(v) => save(it.id, v)} />)
              : <div className="cc-empty">{loading ? "Loading…" : cc?.status.lastRefreshAt ? "No stories match these filters." : "Collecting the first sources…"}</div>}
          </div>
        </Panel>
      </div>

      {analystOpen && selItem && <AnalystModal it={selItem} onClose={() => setAnalystOpen(false)} onSave={(v) => save(selItem.id, v)} onPropose={(ag) => propose("intel_item", selItem.id, ag)} proposing={proposing === selItem.id} />}

      <footer className="cc-status">
        <span className="cc-label">● LIVE STATUS AND DATA TRANSPARENCY</span>
        <div><b>Latest news refresh</b><span>{st ? ago(st.lastRefreshAt, now) : "…"}</span></div>
        <div><b>Sources</b><span>{st?.report ? `${st.report.sources.length - failedSources.length}/${st.report.sources.length} answered${failedSources.length ? ` · failed: ${failedSources.slice(0, 2).map((s) => s.name).join(", ")}` : ""}` : "not fetched yet"}</span></div>
        <div><b>Feed</b><span>{loading || refreshing ? "loading…" : `${st?.counts.news ?? 0} items · ${st?.counts.analysed ?? 0} analysed`}</span></div>
        <div><b>Video</b><span>{!st?.youtube.configured ? "YOUTUBE_API_KEY missing" : st.report?.youtube.errors.length && !st.counts.videos ? `YouTube error: ${st.report.youtube.errors[0].slice(0, 80)}` : `${st.counts.videos} official videos · ${st.counts.liveNow} live`}</span></div>
        <div><b>Search</b><span>{st?.report?.tavily ? "Tavily on" : "Tavily off (SEARCH_API_KEY)"}</span></div>
        <div className="cc-honest">Every item links to its source. Live status is YouTube&apos;s own at the time shown. Nothing here is generated or simulated.</div>
        <button className="cc-btn sm" onClick={() => setDrawer({ open: true, tab: "internal" })}>Internal metrics</button>
        <button className="cc-btn sm" onClick={() => setDrawer({ open: true, tab: "topics" })}>Topics &amp; alerts</button>
      </footer>

      <BriefingDrawer open={drawer.open} initial={drawer.tab} cc={cc} autoBrief={!!params.get("brief")} onClose={() => setDrawer((d) => ({ ...d, open: false }))} onSaved={load} speak={(t) => void say(t)} />
    </div>
  );
}
