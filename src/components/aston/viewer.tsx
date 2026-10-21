"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Walkthrough, speakBrowser, type WalkHandle, type WalkStep } from "./walkthrough";

export type SiteDetail = {
  id: string; name: string; kind: string; niche: string | null; version: number; approvedVersion: number | null; approvedAt: string | null;
  url: string | null; walkthrough: WalkStep[]; assumptions: string[]; factsSource: string | null;
  versions: { n: number; status: string; feedback: string | null; at: string; jobId: string | null; url: string | null; checks: { passed: number; failed: string[]; warnings: string[] } }[];
};

const api = async (url: string, body?: unknown) => {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => null);
  return r.ok && j?.ok ? { ok: true as const, data: j.data } : { ok: false as const, error: (j?.error as string) ?? `HTTP ${r.status}` };
};

/**
 * One ASTON demo: the live preview (desktop / phone), its versions with their
 * check results, and the review loop — open in a new tab, guided walkthrough,
 * request changes (a new version), approve (a record only, nothing deploys).
 */
export function AstonViewer({ siteId, autoWalk, speak, onChangesRequested, onClose, compact }: {
  siteId: string; autoWalk?: boolean; speak?: (t: string) => Promise<void> | void;
  onChangesRequested?: (jobId: string) => void; onClose?: () => void; compact?: boolean;
}) {
  const [d, setD] = useState<SiteDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState<number | null>(null);
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [mode, setMode] = useState<null | "changes" | "versions">(null);
  const [fb, setFb] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [narrate, setNarrate] = useState(true);
  const [asked, setAsked] = useState(false);
  const walk = useRef<WalkHandle>(null);
  const walked = useRef(false);

  const load = useCallback(async () => {
    const r = await api(`/api/aston/sites/${siteId}`);
    if (!r.ok) { setErr(r.error); return; }
    setD(r.data.site); setErr(null);
    setN((cur) => cur ?? r.data.site.version);
  }, [siteId]);
  useEffect(() => { setD(null); setN(null); walked.current = false; void load(); }, [load]);
  useEffect(() => {
    if (!autoWalk || !d || walked.current) return;
    walked.current = true;
    const t = setTimeout(() => walk.current?.start(), 1500);
    return () => clearTimeout(t);
  }, [autoWalk, d]);

  const cur = d?.versions.find((v) => v.n === n) ?? null;
  const url = cur?.url ?? null;
  const voice = speak ?? (narrate ? speakBrowser : undefined);

  const openTab = () => {
    if (!url) return;
    const w = window.open(url, "_blank");
    if (w) w.opener = null;
    else setNote("Your browser blocked the new tab — use the link below.");
  };
  const sendChanges = async () => {
    const text = fb.trim();
    if (text.length < 3) return;
    const r = await api(`/api/aston/sites/${siteId}`, { action: "changes", feedback: text });
    if (!r.ok) { setNote(r.error); return; }
    setFb(""); setMode(null);
    setNote(`ASTON is making version ${(d?.version ?? 0) + 1}. Version ${d?.version} stays available.`);
    onChangesRequested?.(r.data.job.id);
  };
  const approve = async () => {
    if (!cur) return;
    const r = await api(`/api/aston/sites/${siteId}`, { action: "approve", version: cur.n });
    setNote(r.ok ? `Version ${cur.n} approved. Nothing was deployed or published.` : r.error);
    void load();
  };
  const rotate = async () => {
    if (!window.confirm("Make a new preview link? The old link will stop working.")) return;
    const r = await api(`/api/aston/sites/${siteId}`, { action: "rotate" });
    setNote(r.ok ? "New preview link made — the old one no longer works." : r.error);
    void load();
  };

  if (err) return <div className="av av-empty"><style dangerouslySetInnerHTML={{ __html: AV_CSS }} /><p>{err}</p>{onClose && <button type="button" onClick={onClose}>Close</button>}</div>;
  if (!d) return <div className="av av-empty"><style dangerouslySetInnerHTML={{ __html: AV_CSS }} /><p>Loading the demo…</p></div>;

  return (
    <div className={`av${compact ? " compact" : ""}`}>
      <style dangerouslySetInnerHTML={{ __html: AV_CSS }} />
      <header className="av-bar">
        <div className="av-name"><strong>{d.name}</strong><small>{d.kind === "app" ? "App demo" : "Website demo"} · v{cur?.n ?? d.version}{d.approvedVersion === cur?.n ? " · approved" : ""}</small></div>
        <div className="av-seg" role="group" aria-label="Screen size">
          <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>Desktop</button>
          <button type="button" aria-pressed={device === "phone"} onClick={() => setDevice("phone")}>Phone</button>
        </div>
        <button type="button" onClick={openTab} disabled={!url}>Open in new tab</button>
        {url && <a className="av-dl" href={`${url}${url.includes("?") ? "&" : "?"}download=1`} download>Download code</a>}
        <button type="button" className="pri" onClick={() => { setAsked(false); walk.current?.start(); }} disabled={!url}>Walk me through</button>
        <button type="button" onClick={() => setMode(mode === "changes" ? null : "changes")}>Request changes</button>
        <button type="button" onClick={approve} disabled={!cur || cur.status !== "ready" || d.approvedVersion === cur.n}>{d.approvedVersion === cur?.n ? "Approved" : `Approve v${cur?.n ?? ""}`}</button>
        <button type="button" onClick={() => setMode(mode === "versions" ? null : "versions")}>Versions ({d.versions.length})</button>
        {!speak && <label className="av-narr"><input type="checkbox" checked={narrate} onChange={(e) => setNarrate(e.target.checked)} /> Speak</label>}
        {onClose && <button type="button" onClick={onClose} aria-label="Close">×</button>}
      </header>
      {mode === "changes" && (
        <div className="av-drawer">
          <label htmlFor="av-fb">What should ASTON change? (it makes a new version — this one stays)</label>
          <textarea id="av-fb" rows={3} value={fb} onChange={(e) => setFb(e.target.value)} placeholder="e.g. Make the hero darker, add a 'Book a trial' button, move the gallery above the menu" />
          <div className="av-row"><button type="button" className="pri" onClick={sendChanges} disabled={fb.trim().length < 3}>Send to ASTON</button><button type="button" onClick={() => setMode(null)}>Cancel</button></div>
        </div>
      )}
      {mode === "versions" && (
        <div className="av-drawer">
          <ul className="av-vers">{d.versions.map((v) => (
            <li key={v.n}>
              <button type="button" className={v.n === n ? "on" : ""} disabled={!v.url} onClick={() => setN(v.n)}>
                <strong>v{v.n}</strong> {v.status === "ready" ? `✓ ${v.checks.passed} checks passed` : `✗ failed: ${v.checks.failed.join(", ")}`}
                {v.feedback ? <small>Change: {v.feedback}</small> : <small>First build</small>}
                <small>{new Date(v.at).toLocaleString()}{d.approvedVersion === v.n ? " · approved" : ""}</small>
              </button>
            </li>
          ))}</ul>
          {d.factsSource && <p className="av-mute">Business details from: {d.factsSource}</p>}
          {d.assumptions.length > 0 && <p className="av-mute">Assumptions: {d.assumptions.join(" · ")}</p>}
          <div className="av-row"><button type="button" onClick={rotate}>New preview link</button></div>
        </div>
      )}
      {url ? (
        <Walkthrough ref={walk} url={url} steps={d.walkthrough} speak={voice} device={device} onDevice={setDevice}
          onEnd={() => setAsked(true)} />
      ) : <div className="av-empty"><p>This version isn&apos;t a finished build.</p></div>}
      {asked && (
        <div className="av-ask" role="dialog" aria-label="Next step">
          <p>Would you like me to change anything, or is this version ready for approval?</p>
          <div className="av-row"><button type="button" onClick={() => { setAsked(false); setMode("changes"); }}>Request changes</button><button type="button" className="pri" onClick={() => { setAsked(false); void approve(); }}>Approve v{cur?.n}</button><button type="button" onClick={() => setAsked(false)}>Later</button></div>
        </div>
      )}
      {note && <div className="av-note" role="status">{note} {url && note.includes("blocked") ? <a href={url} target="_blank" rel="noreferrer">Open preview</a> : null}<button type="button" onClick={() => setNote(null)} aria-label="Dismiss">×</button></div>}
    </div>
  );
}

const AV_CSS = `
.av{position:relative;display:flex;flex-direction:column;min-height:0;min-width:0;flex:1;background:#0b1020;color:#e2e8f0;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.av button{font:inherit;cursor:pointer;min-height:36px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#131c30;color:#e2e8f0;white-space:nowrap}
.av .av-dl{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#131c30;color:#e2e8f0;white-space:nowrap;text-decoration:none}.av button:disabled{opacity:.45;cursor:default}.av button.pri{background:#f59e0b;border-color:#f59e0b;color:#111;font-weight:700}
.av-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);overflow-x:auto;scrollbar-width:thin}
.av-name{display:flex;flex-direction:column;min-width:140px;margin-right:auto}.av-name strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.av-name small{color:#94a3b8}
.av-seg{display:flex}.av-seg button{border-radius:0}.av-seg button:first-child{border-radius:10px 0 0 10px}.av-seg button:last-child{border-radius:0 10px 10px 0}.av-seg button[aria-pressed=true]{background:#1e3a5f;border-color:#38bdf8}
.av-narr{display:flex;gap:4px;align-items:center;color:#94a3b8;white-space:nowrap}
.av-drawer{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:8px;max-height:45%;overflow:auto}
.av-drawer textarea{font:inherit;color:#e2e8f0;background:#0f172a;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:8px 10px;resize:vertical}
.av-row{display:flex;gap:8px;flex-wrap:wrap}.av-mute{color:#94a3b8;margin:0;font-size:13px}
.av-vers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.av-vers button{width:100%;text-align:left;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:8px 10px;white-space:normal}.av-vers button.on{border-color:#f59e0b}.av-vers small{color:#94a3b8}
.av-empty{flex:1;display:grid;place-items:center;color:#94a3b8;padding:24px;text-align:center}
.av-ask{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);width:min(560px,calc(100% - 24px));background:#0f1a30;border:1px solid #f59e0b;border-radius:16px;padding:12px 14px;box-shadow:0 20px 40px -20px rgba(0,0,0,.8);z-index:5}.av-ask p{margin:0 0 8px}
.av-note{position:absolute;left:50%;top:60px;transform:translateX(-50%);z-index:6;background:#1e293b;border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:8px 12px;display:flex;gap:8px;align-items:center;max-width:calc(100% - 24px)}.av-note a{color:#fbbf24}.av-note button{min-height:28px;padding:0 6px;border:0;background:none}
@media (max-width:700px){.av-bar{flex-wrap:nowrap}}
`;
