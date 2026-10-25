"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/intel/topics";
import { api, when, type CC } from "./types";

type Headline = { n: number; itemId: string; title: string; publisher: string | null; url: string; publishedAt: string | null; category: string | null; analysis: { whyItMatters: string; recommendedAction: string; confidence: { level: string } } | null };
type Briefing = {
  kind: string; period: string; label: string; status: string; revision: number; trigger: string; error: string | null; generatedAt: string | null;
  content: { summary: { summary: string; actions: { action: string; cite: number[] }[]; risks: { text: string; cite: number[] }[]; by: string; provider?: string; rejected?: string }; headlines: Headline[]; itemsConsidered: number; trend: Record<string, { now: number; before: number }> | null; opportunities: { id: string; title: string; score: number }[]; internal: Internal | null } | null;
  sources: { ok: number; failed: string[]; youtube: { configured: boolean; message: string | null }; tavily: boolean } | null;
};
type Internal = { asOf: string; leadsByStage: Record<string, number>; leadsTotal: number; newLeads7d: number; activeClients: number; quotationsAwaiting: number; quotationsAccepted30d: number; payments30d: { count: number; amount: number }; darwinLeads7d: number | null; websiteProjects30d: number | null };

const TRIGGER: Record<string, string> = { scheduled: "scheduled", catch_up: "catch-up run", manual: "made on request" };

/** Text with [n] citations turned into links to the cited source. */
function Cited({ text, hs }: { text: string; hs: Headline[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return <>{parts.map((p, i) => {
    const m = /^\[(\d+)\]$/.exec(p);
    const h = m && hs.find((x) => x.n === Number(m[1]));
    return h ? <a key={i} href={h.url} target="_blank" rel="noreferrer" className="cc-cite" title={`${h.title} — ${h.publisher ?? ""}`}>{p}</a> : <span key={i}>{p}</span>;
  })}</>;
}

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function BriefingDrawer({ open, onClose, initial, cc, onSaved, speak, autoBrief = false }: { open: boolean; onClose: () => void; initial: "daily" | "weekly" | "internal" | "topics"; cc: CC | null; onSaved: () => void; speak: (t: string) => void; autoBrief?: boolean }) {
  const autoDone = useRef(false);
  const [tab, setTab] = useState(initial);
  const [b, setB] = useState<Briefing | null>(null);
  const [internal, setInternal] = useState<Internal | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [topics, setTopics] = useState(cc?.topics ?? []);
  const [draft, setDraft] = useState({ label: "", query: "", category: "ai" });
  useEffect(() => setTab(initial), [initial, open]);
  useEffect(() => { if (cc) setTopics(cc.topics); }, [cc]);

  const load = useCallback(async (kind: "daily" | "weekly"): Promise<Briefing | null> => {
    setErr(null);
    try { const got = (await api<{ briefing: Briefing | null }>(`/api/intel/briefings?kind=${kind}`)).briefing; setB(got); return got; } catch (e) { setErr((e as Error).message); return null; }
  }, []);
  useEffect(() => {
    if (!open) return;
    if (tab === "daily" || tab === "weekly") {
      void load(tab).then((got) => {
        // "open business environment" / "how's the business environment?": show today's whole briefing — write it first if there isn't one yet
        if (!autoBrief || tab !== "daily" || autoDone.current) return;
        autoDone.current = true;
        if (got?.status === "ready" && got.period === todayIST() && got.content) speak(got.content.summary.summary.replace(/\[\d+\]/g, ""));
        else if (got?.status !== "generating" || got.period !== todayIST()) void generate("daily");
      });
    }
    if (tab === "internal") api<Internal>("/api/intel/internal").then(setInternal).catch((e) => setErr((e as Error).message));
  }, [open, tab, load]);

  const generate = async (kind: "daily" | "weekly") => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ briefing: Briefing }>("/api/intel/briefings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      setB(r.briefing);
      if (r.briefing.status !== "ready") setErr(r.briefing.error ?? r.briefing.status);
      else if (r.briefing.content) speak(r.briefing.content.summary.summary.replace(/\[\d+\]/g, ""));
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const save = async (patch: Record<string, unknown>) => {
    try { await api("/api/intel/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }); onSaved(); } catch (e) { setErr((e as Error).message); }
  };

  if (!open) return null;
  const c = b?.content;
  return (
    <div className="cc-drawer" role="dialog" aria-label="Business intelligence">
      <div className="cc-drawer-head">
        <div className="cc-tabs" role="tablist">
          {(["daily", "weekly", "internal", "topics"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "daily" ? "Daily briefing" : t === "weekly" ? "Weekly review" : t === "internal" ? "Internal metrics" : "Topics & alerts"}
            </button>
          ))}
        </div>
        <button className="cc-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      {err && <div className="cc-warn">{err}</div>}

      {(tab === "daily" || tab === "weekly") && (
        <div className="cc-drawer-body">
          <div className="cc-row">
            <span className="cc-dim">{tab === "daily" ? "Every day at 08:00 IST" : "Every Sunday at 19:00 IST"}{b ? ` · showing ${b.label} (${b.status}${b.revision > 1 ? `, revision ${b.revision}` : ""}, ${TRIGGER[b.trigger] ?? b.trigger})` : ""}</span>
            <button className="cc-btn" onClick={() => generate(tab)} disabled={busy}>{busy ? "Working…" : tab === "daily" ? "Generate today's briefing" : "Generate this week's review"}</button>
          </div>
          {busy && <p className="cc-reply">Preparing {tab === "daily" ? "today's briefing" : "this week's review"} — reading the latest sources and analysing them. This takes about a minute…</p>}
          {!b && !busy && <p className="cc-dim">No {tab} briefing yet.</p>}
          {b && b.status !== "ready" && <p className="cc-warn">{b.status === "generating" ? "Being written…" : `Failed: ${b.error}`}</p>}
          {c && (
            <>
              <p className="cc-prose"><Cited text={c.summary.summary} hs={c.headlines} /></p>
              <p className="cc-dim">{c.summary.by === "ai" ? `Written by AI (${c.summary.provider}) from the ${c.headlines.length} cited sources; citations and numbers were checked.` : `Rule-based summary.${c.summary.rejected ? ` ${c.summary.rejected}` : ""}`} {c.itemsConsidered} items considered.</p>
              {c.summary.actions.length > 0 && <><h4>Recommended actions</h4><ul>{c.summary.actions.map((a, i) => <li key={i}><Cited text={a.action} hs={c.headlines} /> {a.cite.map((n) => <Cited key={n} text={` [${n}]`} hs={c.headlines} />)}</li>)}</ul></>}
              {c.summary.risks.length > 0 && <><h4>Risks</h4><ul>{c.summary.risks.map((a, i) => <li key={i}><Cited text={a.text} hs={c.headlines} /> {a.cite.map((n) => <Cited key={n} text={` [${n}]`} hs={c.headlines} />)}</li>)}</ul></>}
              <h4>Sources</h4>
              <ol className="cc-sources">{c.headlines.map((h) => <li key={h.n} value={h.n}><a href={h.url} target="_blank" rel="noreferrer">{h.title}</a> <span className="cc-dim">— {h.publisher ?? "unknown publisher"} · {when(h.publishedAt)}{h.analysis ? ` · confidence ${h.analysis.confidence.level}` : ""}</span></li>)}</ol>
              {c.opportunities.length > 0 && <><h4>Top opportunities</h4><ul>{c.opportunities.map((o) => <li key={o.id}>{o.title} <span className="cc-dim">score {o.score}</span></li>)}</ul></>}
              {c.trend && <><h4>Week vs previous week</h4><div className="cc-trend">{CATEGORIES.map((k) => c.trend![k.id] && <span key={k.id}>{k.label}: {c.trend![k.id].before} → <b>{c.trend![k.id].now}</b></span>)}</div></>}
              {b.sources && <p className="cc-dim">Sources answered: {b.sources.ok}{b.sources.failed.length ? ` · failed: ${b.sources.failed.slice(0, 3).join("; ")}` : ""}{b.sources.youtube.configured ? "" : " · YouTube not configured"}{b.sources.tavily ? "" : " · Tavily not configured"}</p>}
              {c.internal && <p className="cc-dim">Internal: {c.internal.leadsTotal} leads ({c.internal.newLeads7d} new in 7 days), {c.internal.activeClients} active clients, {c.internal.quotationsAwaiting} quotations awaiting a reply.</p>}
            </>
          )}
        </div>
      )}

      {tab === "internal" && (
        <div className="cc-drawer-body">
          <p className="cc-dim">From JARVIS&apos;s own records — RUBIN&apos;s CRM, DARWIN&apos;s leads and ASTON&apos;s projects. Counts as of {internal ? when(internal.asOf) : "…"}.</p>
          {internal && (
            <div className="cc-metrics">
              <div><b>{internal.leadsTotal}</b><span>Leads in CRM</span></div>
              <div><b>{internal.newLeads7d}</b><span>New leads, 7 days</span></div>
              <div><b>{internal.activeClients}</b><span>Active clients</span></div>
              <div><b>{internal.quotationsAwaiting}</b><span>Quotations awaiting reply</span></div>
              <div><b>{internal.quotationsAccepted30d}</b><span>Quotations accepted, 30 days</span></div>
              <div><b>₹{internal.payments30d.amount.toLocaleString("en-IN")}</b><span>{internal.payments30d.count} payments, 30 days</span></div>
              <div><b>{internal.darwinLeads7d ?? "—"}</b><span>DARWIN leads found, 7 days</span></div>
              <div><b>{internal.websiteProjects30d ?? "—"}</b><span>Website projects, 30 days</span></div>
            </div>
          )}
          {internal && Object.keys(internal.leadsByStage).length > 0 && <p className="cc-dim">By stage: {Object.entries(internal.leadsByStage).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>}
        </div>
      )}

      {tab === "topics" && cc && (
        <div className="cc-drawer-body">
          <h4>Watched topics</h4>
          <div className="cc-topics">
            {topics.map((t, i) => (
              <label key={t.id} className={`cc-chip${t.on ? " on" : ""}`}>
                <input type="checkbox" checked={t.on} onChange={(e) => { const next = topics.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)); setTopics(next); void save({ topics: next }); }} />
                {t.label} <span className="cc-dim">({CATEGORIES.find((c) => c.id === t.category)?.label})</span>
              </label>
            ))}
          </div>
          <form className="cc-row" onSubmit={(e) => { e.preventDefault(); if (!draft.label.trim() || draft.query.trim().length < 2) return; const next = [...topics, { id: `custom-${Date.now()}`, label: draft.label.trim(), query: draft.query.trim(), category: draft.category, on: true }]; setTopics(next); setDraft({ label: "", query: "", category: "ai" }); void save({ topics: next }); }}>
            <input placeholder="Topic name" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} aria-label="Topic name" />
            <input placeholder="Search words" value={draft.query} onChange={(e) => setDraft({ ...draft, query: e.target.value })} aria-label="Search words" />
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} aria-label="Category">{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            <button className="cc-btn" type="submit">Add topic</button>
          </form>
          <h4>Schedule &amp; notifications</h4>
          <div className="cc-topics">
            {([["dailyEnabled", "Daily briefing 08:00 IST"], ["weeklyEnabled", "Weekly review Sunday 19:00 IST"], ["notifyWhatsapp", "WhatsApp me"], ["notifyEmail", "Email me"]] as const).map(([k, label]) => (
              <label key={k} className={`cc-chip${cc.settings[k] ? " on" : ""}`}><input type="checkbox" defaultChecked={cc.settings[k]} onChange={(e) => void save({ [k]: e.target.checked })} /> {label}</label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
