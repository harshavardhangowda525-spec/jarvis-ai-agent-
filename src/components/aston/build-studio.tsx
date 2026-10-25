"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useJobs } from "@/components/jobs/use-jobs";
import { STATES, STATE_LABEL, type StudioState } from "@/lib/aston/studio/spec";
import type { StudioDetail } from "@/lib/aston/studio/service";
import { highlight } from "./highlight";
import { voiceWasOn } from "@/hooks/useVoice";
import { isVoiceSilent } from "@/lib/voice/silence";

/** JARVIS says how the build ended — only if you're using voice, and only what really happened. */
async function speak(text: string) {
  if (!voiceWasOn() || isVoiceSilent()) return;
  try {
    const r = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, agent: "jarvis" }) });
    if (!r.ok) throw new Error("tts");
    const url = URL.createObjectURL(await r.blob());
    const a = new Audio(url); a.onended = () => URL.revokeObjectURL(url); await a.play();
  } catch {
    try { if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* no voice here */ }
  }
}

/**
 * ASTON's studio: the code being written on the left, the live website on the
 * right. Everything shown comes from the build itself — the files as the brain
 * writes them, the preview server, and the browser tests.
 */

type FileState = { path: string; content: string; done: boolean };
type LogLine = { text: string; kind?: string; at: string };
type ProjectRow = { id: string; name: string; client: string | null; stateLabel: string; state: string; version: number; preview: string | null; updatedAt: string; tests: { passed?: number; failed?: number } | null };
const VIEWPORTS = { desktop: 1440, tablet: 834, mobile: 390 } as const;
type Vp = keyof typeof VIEWPORTS;
const BUSY: StudioState[] = ["understanding", "planning", "designing", "coding", "running", "testing", "refining"];
const order = (p: string) => (p === "plan.json" || p === "change-plan.json" ? 0 : p.endsWith(".html") ? (p === "index.html" ? 1 : 2) : p.startsWith("css/") ? 3 : p.startsWith("js/") ? 4 : 5);

export function BuildStudio() {
  const params = useSearchParams();
  const id = params.get("project");
  return id ? <Project id={id} /> : <Home />;
}

function Home() {
  const router = useRouter();
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [req, setReq] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void fetch("/api/aston/projects", { cache: "no-store" }).then((r) => r.json()).then((j) => setRows(j?.data?.projects ?? [])).catch(() => setRows([])); }, []);
  const start = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/aston/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: req }) }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r?.ok) router.push(r.data.studio); else setErr(r?.error ?? "ASTON couldn't start.");
  };
  return (
    <div className="bs-home">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header><h1>ASTON · Website studio</h1><Link href="/dashboard/aston">App &amp; demo previews →</Link></header>
      <section className="bs-new">
        <label htmlFor="bs-brief">Describe the website</label>
        <textarea id="bs-brief" rows={5} value={req} onChange={(e) => setReq(e.target.value)} placeholder="e.g. A premium gym website for Iron Temple in Indiranagar with membership plans, a class timetable and a working trial-booking form. Phone 98450 44444." />
        <button disabled={busy || req.trim().length < 5} onClick={start}>{busy ? "Starting…" : "Build it"}</button>
        {err && <p className="bs-bad">{err}</p>}
      </section>
      <h2>Website projects</h2>
      {rows === null ? <p className="bs-dim">Loading…</p> : !rows.length ? <p className="bs-dim">No websites yet.</p> : (
        <ul className="bs-list">{rows.map((p) => (
          <li key={p.id}><Link href={`/dashboard/aston/studio?project=${p.id}`}><b>{p.name}</b><span>{p.stateLabel}{p.version ? ` · v${p.version}` : ""}{p.tests ? ` · tests ${p.tests.passed ?? 0}✓ ${p.tests.failed ?? 0}✗` : ""}</span><small>{new Date(p.updatedAt).toLocaleString()}</small></Link></li>
        ))}</ul>
      )}
    </div>
  );
}

function Project({ id }: { id: string }) {
  const [d, setD] = useState<StudioDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [files, setFiles] = useState<Map<string, FileState>>(new Map());
  const [liveVersion, setLiveVersion] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [log, setLog] = useState<LogLine[]>([]);
  const [state, setState] = useState<{ state: string; note?: string } | null>(null);
  const [vp, setVp] = useState<Vp>("desktop");
  const [page, setPage] = useState("index.html");
  const [previewKey, setPreviewKey] = useState(0);
  const [tab, setTab] = useState<"log" | "tests" | "tasks" | "forms" | "details">("log");
  const [change, setChange] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [deployCheck, setDeployCheck] = useState<{ ready: boolean; checks: { ok: boolean; text: string }[]; zipUrl: string; provider: string | null } | null>(null);
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  const jobs = useJobs({ status: "active" }); // starts ASTON's task if it's waiting to run
  const jobsRef = useRef(jobs); jobsRef.current = jobs;
  const filesRef = useRef(files); filesRef.current = files;
  const pending = useRef(new Map<string, string>());
  const sawBuild = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/aston/projects/${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) { setErr(r?.error ?? "Couldn't load the project."); return null; }
    setD(r.data.project); return r.data.project as StudioDetail;
  }, [id]);

  // live: snapshot, then every piece of code as it's written
  useEffect(() => {
    void load().then(() => jobsRef.current.refresh()); // a build that's waiting to start starts now
    const es = new EventSource(`/api/aston/projects/${id}/live`);
    const reloadSoon = () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); reloadTimer.current = setTimeout(() => setPreviewKey((k) => k + 1), 700); };
    es.addEventListener("snapshot", (m) => {
      const s = JSON.parse((m as MessageEvent).data) as { state: { state: string; note?: string } | null; version: number; files: FileState[]; log: LogLine[] };
      if (s.files.length) { setFiles(new Map(s.files.map((f) => [f.path, f]))); setLiveVersion(s.version); }
      if (s.state) setState(s.state);
      setLog(s.log);
    });
    es.addEventListener("e", (m) => {
      const e = JSON.parse((m as MessageEvent).data);
      if (e.type === "open") {
        setLiveVersion((v) => { if (v !== e.version) { setFiles(new Map()); } return e.version; });
        setFiles((all) => new Map(all).set(e.path, { path: e.path, content: "", done: false }));
        setFollowTarget(e.path);
      } else if (e.type === "delta") {
        pending.current.set(e.path, (pending.current.get(e.path) ?? "") + e.text);
      } else if (e.type === "close") {
        flush();
        setFiles((all) => { const f = all.get(e.path); return f ? new Map(all).set(e.path, { ...f, done: true }) : all; });
        if (/\.(html|css|js|svg)$/.test(e.path)) reloadSoon();
      } else if (e.type === "state") {
        setState({ state: e.state, note: e.note });
        if (BUSY.includes(e.state)) sawBuild.current = true;
        if (["review", "failed", "deployed"].includes(e.state)) setNote(null); // "planning the change…" is over
        if (["review", "failed", "deployed"].includes(e.state)) void load().then((p) => {
          if (!sawBuild.current || !p) return;
          sawBuild.current = false;
          const t = p.tests as { passed?: number; failed?: number } | null;
          void speak(e.state === "failed" ? `The build of ${p.name} stopped: ${p.error ?? e.note ?? "an error"}.`
            : `The website is ready for review. The preview is open next to the code. ${t ? `Browser tests: ${t.passed} passed${t.failed ? `, ${t.failed} still failing` : ", none failing"}.` : "It wasn't browser-tested."}`);
        });
      }
      else if (e.type === "log") setLog((l) => [...l, { text: e.text, kind: e.kind, at: new Date().toISOString() }].slice(-300));
      else if (e.type === "tests" || e.type === "version") void load();
    });
    // stream pieces are applied a few times a second (smooth, and cheap for big files)
    const flush = () => {
      if (!pending.current.size) return;
      const add = new Map(pending.current); pending.current.clear();
      setFiles((all) => { const n = new Map(all); for (const [p, t] of add) { const f = n.get(p); if (f) n.set(p, { ...f, content: f.content + t }); } return n; });
    };
    const iv = setInterval(flush, 120);
    return () => { es.close(); clearInterval(iv); };
  }, [id, load]); // eslint-disable-line react-hooks/exhaustive-deps
  const followRef = useRef(follow); followRef.current = follow;
  const setFollowTarget = (p: string) => { if (followRef.current) setActive(p); };

  // while building, keep the details fresh (tasks, tests)
  const live = state?.state ?? d?.state ?? "";
  const building = BUSY.includes(live as StudioState);
  useEffect(() => {
    if (!building) return;
    const iv = setInterval(() => void load(), 5000);
    return () => clearInterval(iv);
  }, [building, load]);

  // not building: show a finished version's files
  const version = shownVersion ?? (building && liveVersion ? liveVersion : d?.currentVersion || d?.latestVersion || 0);
  const versionInfo = d?.versions.find((v) => v.n === version);
  const usingLive = building && version === liveVersion && files.size > 0;
  const [stored, setStored] = useState<Map<string, string>>(new Map());
  useEffect(() => { setStored(new Map()); }, [version]);
  const fileList = useMemo(() => {
    const names = usingLive ? [...files.keys()] : (versionInfo?.files ?? []);
    return [...names].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  }, [usingLive, files, versionInfo]);
  const shown = active && fileList.includes(active) ? active : fileList.find((f) => f === "index.html") ?? fileList[0] ?? null;
  useEffect(() => {
    if (usingLive || !shown || stored.has(shown) || !version) return;
    const rel = shown.endsWith(".json") ? shown : `site/${shown}`;
    void fetch(`/api/aston/projects/${id}/file?v=${version}&path=${encodeURIComponent(rel)}`).then((r) => (r.ok ? r.text() : `(couldn't load ${shown})`)).then((t) => setStored((m) => new Map(m).set(shown, t)));
  }, [usingLive, shown, stored, version, id]);
  const code = shown ? (usingLive ? files.get(shown)?.content ?? "" : stored.get(shown) ?? "Loading…") : "";
  const writing = usingLive && shown ? !files.get(shown)?.done : false;

  const codeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (writing && codeRef.current) codeRef.current.scrollTop = codeRef.current.scrollHeight; }, [code, writing]);
  const html = useMemo(() => highlight(code, shown ?? ""), [code, shown]);

  const pages = d?.spec?.pages ?? [];
  const hasIndex = usingLive ? files.get("index.html")?.done : !!versionInfo?.files.includes("index.html");
  const previewSrc = d && version ? `/s/${d.previewToken}/v${version}/${page}` : "";

  const act = async (body: Record<string, unknown>, msg: string) => {
    setNote(msg);
    const r = await fetch(`/api/aston/projects/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) { setNote(r?.error ?? "That didn't work."); return null; }
    setShownVersion(null); setFollow(true); void load();
    if (r.data?.job) void jobsRef.current.refresh(); // start it now, not at the next check
    return r.data;
  };

  if (err) return <div className="bs-home"><style dangerouslySetInnerHTML={{ __html: CSS }} /><p className="bs-bad">{err}</p><Link href="/dashboard/aston/studio">← All websites</Link></div>;
  if (!d) return <div className="bs-home"><style dangerouslySetInnerHTML={{ __html: CSS }} /><p className="bs-dim">Loading the studio…</p></div>;
  const tests = versionInfo?.tests ?? null;
  const st = (state?.state ?? d.state) as StudioState;
  const failedState = st === "failed";

  return (
    <div className="bs">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="bs-top">
        <Link href="/dashboard/aston/studio" className="bs-back" aria-label="All websites">←</Link>
        <div className="bs-title"><b>{d.name}</b><small>{d.client ? `${d.client} · ` : ""}{d.style?.replace(/_/g, " ") ?? ""} · {d.stack}</small></div>
        <ol className="bs-states" aria-label="Progress">
          {STATES.filter((s) => s !== "deployed" || st === "deployed").map((s) => {
            const i = STATES.indexOf(s), cur = STATES.indexOf(st as (typeof STATES)[number]);
            return <li key={s} className={s === st ? "on" : !failedState && cur > i ? "done" : ""}>{STATE_LABEL[s]}</li>;
          })}
          {failedState && <li className="bad">Failed</li>}
        </ol>
        <div className="bs-acts">
          <select aria-label="Version" value={version} onChange={(e) => setShownVersion(Number(e.target.value))}>
            {d.versions.map((v) => <option key={v.n} value={v.n}>v{v.n} · {v.status}</option>)}
          </select>
          <button disabled={building || !d.currentVersion} onClick={() => act({ action: "test" }, "Re-testing…")}>Run tests</button>
          <button disabled={building || !d.currentVersion} onClick={() => act({ action: "fix" }, "Fixing what the tests found…")}>Fix issues</button>
          <button disabled={building || !d.currentVersion} onClick={async () => { const r = await act({ action: "prepare_deploy" }, "Checking it for deployment…"); if (r) { setDeployCheck(r.check); setNote(null); } }}>Prepare deploy</button>
        </div>
      </header>
      <p className="bs-note" aria-live="polite">{state?.note ?? d.stateNote ?? ""}{d.error ? ` — ${d.error}` : ""}</p>

      <div className="bs-split">
        <section className="bs-code" aria-label="Code">
          <nav className="bs-files" aria-label="Files">
            {fileList.map((f) => {
              const fs = usingLive ? files.get(f) : null;
              return <button key={f} className={f === shown ? "on" : ""} onClick={() => { setActive(f); setFollow(false); }}>{fs && !fs.done ? <i className="dot" /> : null}{f}</button>;
            })}
            {!fileList.length && <span className="bs-dim">{building ? "Waiting for the first file…" : "No files."}</span>}
            {building && <label className="bs-follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow</label>}
          </nav>
          <div className="bs-editor" ref={codeRef}>
            {shown && <div className="bs-path">{shown}{writing ? <span className="bs-writing"> — writing…</span> : ""}{!usingLive && version ? <span className="bs-dim"> · v{version}</span> : ""}</div>}
            <pre><code dangerouslySetInnerHTML={{ __html: html }} />{writing && <span className="bs-caret" />}</pre>
          </div>
        </section>
        <section className="bs-preview" aria-label="Live preview">
          <div className="bs-pbar">
            {(Object.keys(VIEWPORTS) as Vp[]).map((v) => <button key={v} className={vp === v ? "on" : ""} onClick={() => setVp(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
            <select aria-label="Page" value={page} onChange={(e) => setPage(e.target.value)}>{(pages.length ? pages : [{ file: "index.html", nav: "Home" }]).map((p) => <option key={p.file} value={p.file}>{p.nav} · {p.file}</option>)}</select>
            <button onClick={() => setPreviewKey((k) => k + 1)} title="Reload">↻</button>
            {previewSrc && hasIndex && <a href={previewSrc} target="_blank" rel="noreferrer">Open ↗</a>}
          </div>
          <Frame src={hasIndex ? previewSrc : ""} width={VIEWPORTS[vp]} k={previewKey} building={building} />
        </section>
      </div>

      <section className="bs-bottom">
        <div className="bs-tabs" role="tablist">
          {(["log", "tests", "tasks", "forms", "details"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "tests" && tests ? `Tests ${tests.passed}✓ ${tests.failed}✗` : t[0].toUpperCase() + t.slice(1)}</button>)}
          <form className="bs-change" onSubmit={(e) => { e.preventDefault(); if (change.trim().length > 2) { void act({ action: "change", change }, "ASTON is planning the change…"); setChange(""); } }}>
            <input value={change} onChange={(e) => setChange(e.target.value)} placeholder="Tell ASTON what to change — e.g. “make the typography more editorial”, “add a story page”" aria-label="Change request" disabled={building} />
            <button disabled={building || change.trim().length < 3}>Change</button>
          </form>
        </div>
        {note && <p className="bs-note2">{note} <button onClick={() => setNote(null)} aria-label="Dismiss">×</button></p>}
        {deployCheck && <div className="bs-deploy"><b>{deployCheck.ready ? "Ready to deploy" : "Not ready to deploy yet"}</b><ul>{deployCheck.checks.map((c, i) => <li key={i} className={c.ok ? "ok" : "bad"}>{c.ok ? "✓" : "✗"} {c.text}</li>)}</ul>
          <a href={deployCheck.zipUrl}>Download the site (zip)</a>
          {deployCheck.provider && <button onClick={async () => { if (!confirm(`Publish ${d.name} v${d.currentVersion} to ${deployCheck.provider}? It becomes public.`)) return; const r = await act({ action: "deploy", confirm: true }, "Deploying…"); if (r) setNote(`Deployed: ${r.deploy.url} (${r.deploy.status})`); }}>Deploy to {deployCheck.provider}</button>}
          <button onClick={() => setDeployCheck(null)}>Close</button></div>}
        <div className="bs-panel">
          {tab === "log" && <div className="bs-log">{log.slice(-150).map((l, i) => <div key={i} className={`l-${l.kind ?? "info"}`}><time>{new Date(l.at).toLocaleTimeString()}</time> {l.text}</div>)}{!log.length && <span className="bs-dim">The build log appears here while ASTON works.</span>}</div>}
          {tab === "tests" && (tests ? (
            <div className="bs-tests">
              <p>{tests.browser} · {new Date(tests.at).toLocaleString()} · {tests.passed} passed · {tests.failed} failed · {tests.warnings} warnings</p>
              <ul>{tests.checks.filter((c) => c.status !== "pass").concat(tests.checks.filter((c) => c.status === "pass")).map((c, i) => <li key={i} className={c.status}>{c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "!"} {c.detail}</li>)}</ul>
              <div className="bs-shots">{tests.screenshots.map((s) => <a key={s.file} href={`/api/aston/projects/${id}/file?v=${version}&path=${encodeURIComponent(s.file)}`} target="_blank" rel="noreferrer"><img src={`/api/aston/projects/${id}/file?v=${version}&path=${encodeURIComponent(s.file)}`} alt={`${s.page} at ${s.viewport}`} loading="lazy" /><span>{s.page} · {s.viewport}</span></a>)}</div>
            </div>) : <p className="bs-dim">{building ? "Tests run once the code is written." : "This version hasn't been tested."}</p>)}
          {tab === "tasks" && <ul className="bs-tasks">{(d.tasks as { id: string; text: string; status: string; note?: string }[]).map((t) => <li key={t.id} className={t.status}><b>{t.status === "done" ? "✓" : t.status === "failed" ? "✗" : t.status === "waiting" ? "…" : "○"}</b> {t.text}{t.note ? <small> — {t.note}</small> : null}</li>)}</ul>}
          {tab === "forms" && (d.submissions.length ? <ul className="bs-subs">{d.submissions.map((s) => <li key={s.id}><b>{s.form}</b> {s.slot ? `· ${s.slot}` : ""} <small>{new Date(s.at).toLocaleString()}</small><code>{JSON.stringify(s.data)}</code></li>)}</ul> : <p className="bs-dim">{d.spec?.forms.length ? `No submissions yet. Forms: ${d.spec.forms.map((f) => f.id).join(", ")}.` : "This site has no forms."}</p>)}
          {tab === "details" && <dl className="bs-dl">
            <dt>Project folder</dt><dd><code>{d.dir}</code></dd>
            <dt>Stack</dt><dd>{d.stack}</dd>
            <dt>Preview</dt><dd><a href={d.preview} target="_blank" rel="noreferrer">{d.preview}</a></dd>
            <dt>State</dt><dd>{d.stateLabel}{d.stateNote ? ` — ${d.stateNote}` : ""}</dd>
            <dt>Last successful build</dt><dd>{d.lastBuildAt ? `${new Date(d.lastBuildAt).toLocaleString()} (v${d.currentVersion})` : "—"}</dd>
            <dt>Environment variables</dt><dd>{d.envVars.length ? d.envVars.map((e) => `${e.name} — ${e.why}`).join("; ") : "None needed"}</dd>
            <dt>Deployment</dt><dd>{d.deploy ? <>{(d.deploy as { status: string }).status} {(d.deploy as { url?: string }).url && <a href={(d.deploy as { url: string }).url} target="_blank" rel="noreferrer">{(d.deploy as { url: string }).url}</a>}</> : "Not deployed"}</dd>
            <dt>Brief</dt><dd>{d.brief}</dd>
          </dl>}
        </div>
      </section>
    </div>
  );
}

/** The site at a real width, scaled to fit the pane (so mobile is really 390px wide). */
function Frame({ src, width, k, building }: { src: string; width: number; k: number; building: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, size.w / width);
  return (
    <div className="bs-frame" ref={box}>
      {src ? (
        <iframe key={`${src}-${k}`} src={src} title="Website preview" sandbox="allow-scripts allow-forms allow-popups allow-modals"
          style={{ width, height: size.h / scale, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
      ) : <p className="bs-dim bs-wait">{building ? "The preview appears as soon as the homepage is written." : "Nothing to preview."}</p>}
    </div>
  );
}

const CSS = `
.bs,.bs-home{--bg:#070b12;--pan:#0d1420;--line:#1d2a3a;--tx:#e6edf6;--dim:#7f93a8;--ac:#f59e0b;--ok:#4ade80;--bad:#f87171;color:var(--tx);background:var(--bg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.bs{display:grid;grid-template-rows:auto auto 1fr auto;height:calc(100dvh - 4rem);min-height:620px}
.bs button,.bs select,.bs input,.bs-home button,.bs-home textarea{font:inherit;color:inherit}
.bs-dim{color:var(--dim)}.bs-bad,.bs .bad{color:var(--bad)}.bs .ok{color:var(--ok)}
.bs-top{display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.bs-back{color:var(--dim);text-decoration:none;font-size:18px}
.bs-title{display:flex;flex-direction:column;min-width:0}.bs-title small{color:var(--dim)}
.bs-states{display:flex;gap:4px;list-style:none;margin:0 auto 0 8px;padding:0;flex-wrap:wrap}
.bs-states li{font:11px ui-monospace,Menlo,monospace;letter-spacing:.04em;padding:2px 8px;border:1px solid var(--line);border-radius:999px;color:var(--dim)}
.bs-states li.done{color:var(--ok);border-color:#1f4d33}.bs-states li.on{color:#111;background:var(--ac);border-color:var(--ac)}.bs-states li.bad{color:#fff;background:#7f1d1d}
.bs-acts{display:flex;gap:6px;flex-wrap:wrap}.bs-acts button,.bs-acts select{background:var(--pan);border:1px solid var(--line);border-radius:8px;padding:4px 10px}.bs-acts button:disabled{opacity:.4}
.bs-note{margin:0;padding:4px 12px;color:var(--ac);font-size:13px;min-height:1.5em}
.bs-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:0;border-top:1px solid var(--line)}
.bs-code{display:grid;grid-template-columns:170px minmax(0,1fr);min-height:0;border-right:1px solid var(--line)}
.bs-files{overflow:auto;border-right:1px solid var(--line);padding:6px;display:flex;flex-direction:column;gap:2px;background:var(--pan)}
.bs-files button{all:unset;cursor:pointer;font:12px ui-monospace,Menlo,monospace;padding:3px 6px;border-radius:5px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-files button.on{background:#17263a;color:var(--tx)}.bs-files .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ac);margin-right:5px;animation:bsp 1s infinite}
.bs-follow{font-size:11px;color:var(--dim);margin-top:auto}
@keyframes bsp{50%{opacity:.3}}
.bs-editor{overflow:auto;min-height:0;background:#060a10}
.bs-path{position:sticky;top:0;background:#0a111b;font:12px ui-monospace,monospace;padding:4px 10px;border-bottom:1px solid var(--line);z-index:1}
.bs-writing{color:var(--ac)}
.bs-editor pre{margin:0;padding:10px 12px;font:12.5px/1.55 ui-monospace,"Cascadia Code",Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;tab-size:2}
.bs-caret{display:inline-block;width:7px;height:14px;background:var(--ac);vertical-align:text-bottom;animation:bsp .8s infinite}
.hl-t{color:#7dd3fc}.hl-a{color:#fbbf24}.hl-s{color:#86efac}.hl-c{color:#64748b;font-style:italic}.hl-k{color:#c4b5fd}.hl-n{color:#fda4af}.hl-p{color:#93c5fd}
.bs-preview{display:flex;flex-direction:column;min-height:0;min-width:0}
.bs-pbar{display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.bs-pbar button,.bs-pbar select{background:var(--pan);border:1px solid var(--line);border-radius:7px;padding:2px 9px}.bs-pbar button.on{border-color:var(--ac);color:var(--ac)}.bs-pbar a{color:var(--ac);margin-left:auto}
.bs-frame{flex:1;min-height:0;overflow:hidden;background:#fff;position:relative}.bs-frame iframe{border:0;display:block;background:#fff}
.bs-wait{position:absolute;inset:0;display:grid;place-items:center;background:var(--bg);margin:0;padding:20px;text-align:center}
.bs-bottom{border-top:1px solid var(--line);display:flex;flex-direction:column;max-height:34vh;min-height:150px}
.bs-tabs{display:flex;gap:4px;align-items:center;padding:4px 8px;flex-wrap:wrap}
.bs-tabs>button{background:none;border:1px solid transparent;border-radius:7px;padding:2px 10px;color:var(--dim)}.bs-tabs>button.on{color:var(--tx);border-color:var(--line);background:var(--pan)}
.bs-change{display:flex;gap:6px;margin-left:auto;flex:1;min-width:260px;max-width:640px}.bs-change input{flex:1;min-width:0;background:var(--pan);border:1px solid var(--line);border-radius:8px;padding:5px 10px}
.bs-change button{background:var(--ac);color:#111!important;border:0;border-radius:8px;padding:0 14px;font-weight:600}.bs-change button:disabled{opacity:.4}
.bs-note2{margin:0 8px;padding:4px 8px;background:#1c1a0f;border:1px solid #4a3b0f;border-radius:8px;color:#fde68a}.bs-note2 button{background:none;border:0;color:inherit;cursor:pointer}
.bs-deploy{margin:4px 8px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--pan)}.bs-deploy ul{margin:4px 0;padding-left:0;list-style:none}.bs-deploy a{color:var(--ac);margin-right:12px}.bs-deploy button{background:var(--pan);border:1px solid var(--line);border-radius:7px;padding:2px 10px;margin-right:6px}
.bs-panel{overflow:auto;padding:4px 12px 10px;min-height:0}
.bs-log{font:12px/1.5 ui-monospace,Menlo,monospace}.bs-log time{color:#3e5469}.bs-log .l-ok{color:#86efac}.bs-log .l-error{color:var(--bad)}
.bs-tests ul,.bs-tasks,.bs-subs{list-style:none;padding:0;margin:4px 0}.bs-tests li{padding:1px 0}.bs-tests li.fail{color:var(--bad)}.bs-tests li.warn{color:#fbbf24}.bs-tests li.pass{color:#9fb3c8}
.bs-shots{display:flex;gap:8px;overflow-x:auto;padding:6px 0}.bs-shots a{display:flex;flex-direction:column;gap:2px;color:var(--dim);font-size:11px;text-decoration:none}.bs-shots img{height:120px;width:auto;border:1px solid var(--line);border-radius:4px;object-fit:cover;object-position:top}
.bs-tasks li.done b{color:var(--ok)}.bs-tasks li.failed b{color:var(--bad)}.bs-tasks li.waiting b{color:#fbbf24}.bs-tasks small{color:var(--dim)}
.bs-subs li{padding:4px 0;border-bottom:1px solid var(--line)}.bs-subs code{display:block;font-size:12px;color:var(--dim);white-space:pre-wrap}
.bs-dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:4px 0}.bs-dl dt{color:var(--dim)}.bs-dl dd{margin:0;overflow-wrap:anywhere}.bs-dl a{color:var(--ac)}
.bs-home{max-width:900px;margin:0 auto;padding:20px 16px;min-height:calc(100dvh - 4rem)}.bs-home header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}.bs-home h1{font-size:1.3rem;margin:0}.bs-home a{color:var(--ac)}
.bs-new{display:flex;flex-direction:column;gap:8px;margin:16px 0 24px}.bs-new textarea{background:var(--pan);border:1px solid var(--line);border-radius:10px;padding:10px;resize:vertical}.bs-new button{align-self:flex-start;background:var(--ac);color:#111;border:0;border-radius:999px;padding:8px 18px;font-weight:600}.bs-new button:disabled{opacity:.4}
.bs-list{list-style:none;padding:0;display:grid;gap:8px}.bs-list a{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--pan);color:var(--tx)!important;text-decoration:none}.bs-list span{color:var(--dim);font-size:13px}.bs-list small{grid-column:1/-1;color:var(--dim)}
@media (max-width:900px){.bs{height:auto}.bs-split{grid-template-columns:1fr}.bs-code{grid-template-columns:1fr;border-right:0}.bs-files{flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line)}.bs-editor{max-height:50vh}.bs-frame{height:70vh;flex:none}.bs-states{margin:0}}
`;
