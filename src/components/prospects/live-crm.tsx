"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The live CRM window the JARVIS Operator opens next to Google Maps: while
 * JARVIS searches on the left, every lead it adds lands here on the right —
 * with an "incoming" beam on the edge that faces Maps, cards dropping in, and
 * counters ticking up. Read-only; the operator hands it its token by message
 * (never in the address bar).
 */
interface Search { category: string; area: string; city: string; limit: number; status: string; visited: number; withWebsite: number; kept: number; added: number; duplicates: number; currentText: string | null; error: string | null }
interface Lead { id: string; businessName: string; category: string | null; area: string | null; rating: number | null; reviews: number | null; leadScore: number; websiteStatus: string; signals: string[]; phone: string | null; createdAt: string; searchId: string | null }
interface Feed { search: Search | null; recent: Lead[]; addedToday: number; dailyLimit: number; total: number }

const KEY = "jarvis-live-token";
const LIVE = new Set(["queued", "running", "stopping"]);
const web: Record<string, string> = { none: "No website", social_only: "Social page only", broken: "Site down", outdated: "Outdated site", ok: "Website" };

function useCount(target: number) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current; if (from === target) return;
    const t0 = performance.now(); let raf = 0;
    const step = (now: number) => { const k = Math.min(1, (now - t0) / 600); const x = Math.round(from + (target - from) * (1 - (1 - k) ** 3)); cur.current = x; setV(x); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

export function LiveCrm() {
  const [token, setToken] = useState<string | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    try { const t = sessionStorage.getItem(KEY); if (t) setToken(t); } catch { /* none */ }
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || typeof e.data?.jarvisLiveToken !== "string" || !e.data.jarvisLiveToken.startsWith("jmf_")) return;
      try { sessionStorage.setItem(KEY, e.data.jarvisLiveToken); } catch { /* ok */ }
      setToken(e.data.jarvisLiveToken);
    };
    window.addEventListener("message", on); return () => window.removeEventListener("message", on);
  }, []);

  useEffect(() => {
    if (!token) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/prospects/finder/device", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "live" }) });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error ?? `JARVIS answered ${r.status}`);
        const d = j.data as Feed;
        // the first load is history; everything after it is "just arrived"
        if (!seen.current) seen.current = new Set(d.recent.map((l) => l.id));
        else {
          const arrived = d.recent.filter((l) => !seen.current!.has(l.id)).map((l) => l.id);
          if (arrived.length) {
            arrived.forEach((id) => seen.current!.add(id));
            setFresh((f) => new Set([...f, ...arrived])); setPulse((p) => p + 1);
            setTimeout(() => setFresh((f) => { const n = new Set(f); arrived.forEach((id) => n.delete(id)); return n; }), 9000);
          }
        }
        setFeed(d); setErr(null);
      } catch (e) { setErr((e as Error).message); }
      if (!stop) setTimeout(tick, 1500);
    };
    void tick(); return () => { stop = true; };
  }, [token]);

  const s = feed?.search ?? null;
  const live = !!s && LIVE.has(s.status);
  const added = useCount(s?.added ?? 0), visited = useCount(s?.visited ?? 0), kept = useCount(s?.kept ?? 0), withSite = useCount(s?.withWebsite ?? 0), today = useCount(feed?.addedToday ?? 0), total = useCount(feed?.total ?? 0);
  const pct = s ? Math.min(100, Math.round((s.added / Math.max(1, s.limit)) * 100)) : 0;

  return (
    <div className="lc">
      <style>{CSS}</style>
      <div className={`beam ${live ? "on" : ""}`}><span key={pulse} className="shot" /></div>
      <header>
        <div className="brand"><span className={`dot ${live ? "on" : ""}`} />JARVIS <b>CRM</b><i>LIVE</i></div>
        <div className="sub">{!token ? "Waiting for JARVIS…" : !s ? "No searches yet." : live ? <>Searching Google Maps: <b>{s.category}</b> in <b>{s.area}</b></> : <>Last search: {s.category} in {s.area} · {s.status}</>}</div>
        {s?.currentText && live && <div className="now">{s.currentText}</div>}
        {s?.error && <div className="error">{s.error}</div>}
        {err && <div className="error">{err}</div>}
      </header>

      {s && (
        <section className="stats">
          <div className="bar"><span style={{ width: `${pct}%` }} /><em>{added}/{s.limit} new leads</em></div>
          <div className="grid">
            <Stat n={visited} l="looked at" /><Stat n={kept} l="no working site" /><Stat n={withSite} l="has a website" /><Stat n={added} l="added" hot />
          </div>
          <div className="foot">{today}/{feed?.dailyLimit ?? 30} today · {total} in the CRM</div>
        </section>
      )}

      <ul className="cards">
        {(feed?.recent ?? []).slice(0, 30).map((l) => (
          <li key={l.id} className={fresh.has(l.id) ? "new" : ""}>
            <div className="ring" style={{ ["--p" as string]: `${l.leadScore}` }}><span>{l.leadScore}</span></div>
            <div className="body">
              <div className="name">{l.businessName}</div>
              <div className="meta">{[l.category, l.area].filter(Boolean).join(" · ")}{l.rating != null ? ` · ★ ${l.rating}${l.reviews != null ? ` (${l.reviews})` : ""}` : ""}</div>
              <div className="tags"><span className="tag warn">{web[l.websiteStatus] ?? l.websiteStatus}</span>{l.phone && <span className="tag">📞 {l.phone}</span>}{fresh.has(l.id) && <span className="tag new">✓ just added by JARVIS</span>}</div>
            </div>
          </li>
        ))}
        {token && feed && !feed.recent.length && <li className="empty">Leads JARVIS finds on Google Maps land here as they&apos;re added.</li>}
      </ul>
    </div>
  );
}

function Stat({ n, l, hot }: { n: number; l: string; hot?: boolean }) {
  return <div className={`stat ${hot ? "hot" : ""}`}><b>{n}</b><span>{l}</span></div>;
}

const CSS = `
.lc{position:relative;min-height:100dvh;background:radial-gradient(1200px 600px at -10% 0%,rgba(34,211,238,.10),transparent 60%),#050c14;color:#dff7ff;font:500 14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:18px 18px 18px 30px;overflow-x:hidden}
.beam{position:fixed;left:0;top:0;bottom:0;width:6px;background:linear-gradient(180deg,transparent,rgba(34,211,238,.35),transparent);box-shadow:0 0 18px rgba(34,211,238,.35)}
.beam.on{animation:breathe 2.2s ease-in-out infinite}
@keyframes breathe{50%{box-shadow:0 0 34px rgba(34,211,238,.75);background:linear-gradient(180deg,transparent,rgba(103,232,249,.75),transparent)}}
.beam .shot{position:absolute;left:0;width:100vw;max-width:60vw;height:3px;top:96px;background:linear-gradient(90deg,#67e8f9,rgba(103,232,249,0));filter:drop-shadow(0 0 8px #22d3ee);transform:translateX(-100%);animation:shot .9s ease-out}
@keyframes shot{0%{transform:translateX(-100%);opacity:0}20%{opacity:1}100%{transform:translateX(30%);opacity:0}}
header{margin-bottom:14px}
.brand{display:flex;align-items:center;gap:8px;letter-spacing:.32em;font-size:13px;color:#9be9f7}
.brand b{color:#fff;font-weight:800}.brand i{font-style:normal;font-size:10px;letter-spacing:.2em;padding:2px 6px;border:1px solid rgba(34,211,238,.5);border-radius:6px;color:#67e8f9}
.dot{width:9px;height:9px;border-radius:50%;background:#334155}.dot.on{background:#22d3ee;box-shadow:0 0 12px #22d3ee;animation:blink 1.1s infinite}@keyframes blink{50%{opacity:.35}}
.sub{margin-top:8px;font-size:15px;color:#e6fbff}.sub b{color:#67e8f9}
.now{margin-top:4px;font-size:12px;color:#7dd3e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.error{margin-top:6px;font-size:12px;color:#fca5a5}
.stats{border:1px solid rgba(34,211,238,.18);background:rgba(8,20,32,.7);border-radius:16px;padding:12px;margin-bottom:14px}
.bar{position:relative;height:22px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden}
.bar span{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#0891b2,#22d3ee,#a5f3fc);box-shadow:0 0 16px rgba(34,211,238,.6);transition:width .7s cubic-bezier(.2,.8,.2,1)}
.bar span::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);animation:sheen 1.6s linear infinite}
@keyframes sheen{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
.bar em{position:relative;display:block;text-align:center;font-style:normal;font-size:12px;line-height:22px;color:#fff;font-weight:700;text-shadow:0 1px 2px #000}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}
.stat{border-radius:12px;background:rgba(255,255,255,.04);padding:8px;text-align:center}.stat b{display:block;font-size:22px;color:#fff;font-variant-numeric:tabular-nums}.stat span{font-size:11px;color:#94a3b8}
.stat.hot b{color:#67e8f9;text-shadow:0 0 12px rgba(34,211,238,.7)}
.foot{margin-top:8px;font-size:12px;color:#94a3b8}
.cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.cards li{display:flex;gap:12px;align-items:center;border:1px solid rgba(255,255,255,.08);background:rgba(10,22,36,.75);border-radius:14px;padding:10px 12px}
.cards li.new{border-color:rgba(34,211,238,.7);box-shadow:0 0 0 1px rgba(34,211,238,.35),0 0 26px -4px rgba(34,211,238,.7);animation:drop .75s cubic-bezier(.2,.9,.25,1.15)}
@keyframes drop{0%{opacity:0;transform:translateX(-60px) scale(.96);filter:blur(4px)}60%{opacity:1;filter:none}100%{transform:none}}
.cards li.empty{justify-content:center;color:#94a3b8;font-size:13px;border-style:dashed}
.ring{--p:0;flex:none;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#22d3ee calc(var(--p)*1%),rgba(255,255,255,.08) 0)}
.ring span{width:36px;height:36px;border-radius:50%;background:#071420;display:grid;place-items:center;font-weight:800;font-size:13px;color:#e6fbff}
.body{min-width:0;flex:1}.name{color:#fff;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{font-size:12px;color:#94a3b8;margin-top:1px}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}.tag{font-size:11px;border-radius:6px;padding:1px 6px;background:rgba(255,255,255,.08);color:#cbd5e1}
.tag.warn{background:rgba(251,191,36,.14);color:#fde68a}.tag.new{background:rgba(34,211,238,.16);color:#a5f3fc}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
