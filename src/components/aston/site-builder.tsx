"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assembleSite, cleanCss, cleanHtml, headerHtml, RUNTIME_JS, type SitePlan, type SiteSection } from "@/lib/aston/site/assemble";
import { highlight, langOf } from "@/lib/aston/site/highlight";

interface SiteDTO {
  id: string; title: string; brief: string; status: string; error: string | null;
  plan: SitePlan | null; css: string | null; sections: SiteSection[];
  revisions: number; startedAt: string; completedAt: string | null;
}
type StepInfo = { kind: "plan" | "css" | "section"; id?: string; title: string; file: string; index: number; total: number };
type Ev =
  | { t: "step"; step: StepInfo } | { t: "d"; d: string }
  | { t: "saved" | "complete"; site: SiteDTO }
  | { t: "wait"; until: string; message: string } | { t: "error"; message: string };

const FILES = ["plan.json", "styles.css", "index.html", "script.js"] as const;
type File = (typeof FILES)[number];
const TARGET_MS = 5 * 60_000;
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Read a newline-delimited JSON event stream. Returns the last event. */
async function readEvents(body: ReadableStream<Uint8Array>, on: (ev: Ev) => void): Promise<Ev | null> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "", last: Ev | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { const ev = JSON.parse(line) as Ev; last = ev; on(ev); } catch { /* partial line */ }
    }
  }
  return last;
}

function Code({ code, file, live }: { code: string; file: string; live: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const toks = useMemo(() => highlight(code, langOf(file)), [code, file]);
  const lines = useMemo(() => code.split("\n").length, [code]);
  useEffect(() => { if (live && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [code, live]);
  return (
    <pre ref={ref} className="lg-code" aria-label={`${file} source`}>
      <span className="lg-gutter" aria-hidden>{Array.from({ length: lines }, (_, i) => i + 1).join("\n")}</span>
      <code>{toks.map((t, i) => (t.c ? <span key={i} className={`hl-${t.c}`}>{t.t}</span> : t.t))}{live && <span className="lg-caret" />}</code>
    </pre>
  );
}

/**
 * The liquid-glass build window: ASTON writes the website live — plan, style
 * system, then each section — with the code streaming into the editor and the
 * page assembling in the preview beside it.
 */
export function SiteBuilder({ siteId, onClose, onSpeak, onBusy }: { siteId: string; onClose: () => void; onSpeak?: (t: string) => void; onBusy?: (b: boolean) => void }) {
  const [site, setSite] = useState<SiteDTO | null>(null);
  const [step, setStep] = useState<StepInfo | null>(null);
  const [stream, setStream] = useState("");
  const [file, setFile] = useState<File>("plan.json");
  const [follow, setFollow] = useState(true);
  const [running, setRunning] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState<"code" | "preview">("code");
  const [srcDoc, setSrcDoc] = useState("");
  const [ask, setAsk] = useState("");
  const streamRef = useRef("");
  const flushRef = useRef(0);
  const alive = useRef(true);
  const stopRef = useRef(false);

  useEffect(() => { alive.current = true; return () => { alive.current = false; stopRef.current = true; }; }, []);
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(iv); }, []);
  useEffect(() => { onBusy?.(running); }, [running, onBusy]);

  const onEvent = useCallback((ev: Ev) => {
    if (!alive.current) return;
    if (ev.t === "step") {
      setStep(ev.step);
      streamRef.current = "";
      setStream("");
      setError(null);
      if (follow) setFile(ev.step.kind === "plan" ? "plan.json" : ev.step.kind === "css" ? "styles.css" : "index.html");
    } else if (ev.t === "d") {
      streamRef.current += ev.d;
      if (!flushRef.current) flushRef.current = requestAnimationFrame(() => { flushRef.current = 0; setStream(streamRef.current); });
    } else if (ev.t === "saved" || ev.t === "complete") {
      setSite(ev.site);
      streamRef.current = "";
      setStream("");
      if (ev.t === "complete") setStep(null);
    } else if (ev.t === "wait") {
      setWaitUntil(Date.parse(ev.until));
    } else if (ev.t === "error") {
      setError(ev.message);
    }
  }, [follow]);

  // ------------------------------------------------------------ the build loop
  const run = useCallback(async (path: "next" | "revise", body?: unknown) => {
    if (running) return;
    stopRef.current = false;
    setRunning(true);
    setError(null);
    try {
      for (let guard = 0; guard < 40 && !stopRef.current; guard++) {
        const res = await fetch(`/api/aston/sites/${siteId}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          setError(j.error || `HTTP ${res.status}`);
          break;
        }
        const last = await readEvents(res.body, onEvent);
        if (!last || last.t === "error") break;
        if (last.t === "complete") {
          if (path === "next") {
            const secs = Math.round((Date.parse(last.site.completedAt ?? new Date().toISOString()) - Date.parse(last.site.startedAt)) / 1000);
            onSpeak?.(`Your website for ${last.site.plan?.siteName ?? "your client"} is ready. It took ${Math.floor(secs / 60)} minutes ${secs % 60} seconds.`);
          } else onSpeak?.("Done. I've updated the website.");
          setFile("index.html");
          break;
        }
        if (last.t === "wait") {
          // Groq asked us to slow down: count down, then carry on from the saved step.
          const until = Date.parse(last.until);
          while (Date.now() < until && !stopRef.current) await new Promise((r) => setTimeout(r, 500));
          setWaitUntil(null);
          if (path === "revise") break;
        }
      }
    } catch {
      setError("Lost the connection — press Resume to continue from the last saved step.");
    } finally {
      if (alive.current) setRunning(false);
    }
  }, [onEvent, onSpeak, running, siteId]);

  // load, then start (or resume) the build
  useEffect(() => {
    let off = false;
    fetch(`/api/aston/sites/${siteId}`).then((r) => r.json()).then((j) => {
      if (off || !j.ok) { if (!off) setError(j.error ?? "Couldn't open this website."); return; }
      setSite(j.data);
      if (j.data.status !== "done") run("next");
      else setFile("index.html");
    }).catch(() => !off && setError("Couldn't reach ASTON."));
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // ------------------------------------------------------------ files (what's written so far + what's streaming)
  const plan = site?.plan ?? null;
  const live = { css: step?.kind === "css" ? cleanCss(stream) : null, sectionId: step?.kind === "section" ? step.id : null };
  const sections = useMemo<SiteSection[]>(() => (site?.sections ?? []).map((s) => (s.id === live.sectionId && stream ? { ...s, html: cleanHtml(stream) } : s)), [site, live.sectionId, stream]);
  const files: Record<File, string> = {
    "plan.json": step?.kind === "plan" ? stream : plan ? JSON.stringify({ ...plan, sections: (site?.sections ?? []).map(({ id, type, title, brief }) => ({ id, type, title, brief })) }, null, 2) : "",
    "styles.css": live.css ?? site?.css ?? "",
    "index.html": plan ? [headerHtml(plan, sections), ...sections.filter((s) => s.html).map((s) => s.html as string)].join("\n\n") : "",
    "script.js": `// ASTON runtime — header, mobile menu, scroll reveals\n${RUNTIME_JS}`,
  };
  const streamingFile: File | null = step ? (step.kind === "plan" ? "plan.json" : step.kind === "css" ? "styles.css" : "index.html") : null;

  // live preview, throttled so the page doesn't flicker on every token
  const previewKey = `${site?.css?.length ?? 0}|${sections.map((s) => s.html?.length ?? 0).join(",")}|${live.css?.length ?? 0}`;
  const lastPreview = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, 1200 - (Date.now() - lastPreview.current));
    const t = setTimeout(() => {
      lastPreview.current = Date.now();
      setSrcDoc(assembleSite({ plan, css: live.css ?? site?.css ?? null, sections: plan ? sections : null, building: site?.status !== "done" }));
    }, wait);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, plan]);

  const done = site?.status === "done";
  const started = site ? Date.parse(site.startedAt) : now;
  const elapsed = (site?.completedAt ? Date.parse(site.completedAt) : now) - started;
  const total = step?.total ?? (site?.sections?.length ? site.sections.length + 2 : 9);
  const doneSteps = site ? (site.plan ? 1 : 0) + (site.css ? 1 : 0) + (site.sections ?? []).filter((s) => s.html).length : 0;
  const pct = done ? 100 : Math.min(99, Math.round((doneSteps / total) * 100));
  const status = done ? (running ? "Updating…" : "Ready") : waitUntil ? `Pausing for Groq's free limit — resuming in ${mmss(waitUntil - now)}` : step?.title ? `${step.title}…` : running ? "Starting…" : error ? "Paused" : "Ready to continue";

  return (
    <div className="lg-overlay" role="dialog" aria-modal="true" aria-label="ASTON website builder">
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id="lg-liquid" x="-20%" y="-20%" width="140%" height="140%">
          {/* static noise: the warp is computed once; the layer's drift animates on the GPU */}
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="38" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div className="liquid-glass lg-window" onPointerMove={liquid}>
        <div className="lg-sheen" aria-hidden />
        <header className="lg-head">
          <div className="min-w-0">
            <p className="lg-kicker">ASTON · Website builder</p>
            <h2 className="lg-title">{plan?.siteName ?? site?.title ?? "Preparing…"}</h2>
          </div>
          <div className="lg-meta">
            <span className={elapsed > TARGET_MS && !done ? "text-amber-300" : ""}>{mmss(elapsed)}<span className="opacity-50"> / 5:00</span></span>
            <button className="lg-x" onClick={() => { stopRef.current = true; onClose(); }} aria-label="Close">×</button>
          </div>
        </header>

        <div className="lg-progress" aria-label={`${pct}% complete`}><span style={{ width: `${pct}%` }} /></div>
        <p className="lg-status" aria-live="polite">{error ? <span className="text-amber-300">{error}</span> : status}</p>

        <div className="lg-mobile-tabs">
          <button className={view === "code" ? "on" : ""} onClick={() => setView("code")}>Code</button>
          <button className={view === "preview" ? "on" : ""} onClick={() => setView("preview")}>Preview</button>
        </div>

        <div className="lg-body">
          <section className={`glass-inset lg-editor ${view === "code" ? "" : "lg-hide-sm"}`}>
            <nav className="lg-tabs">
              {FILES.map((f) => (
                <button key={f} className={file === f ? "on" : ""} onClick={() => { setFile(f); setFollow(f === streamingFile || !running); }}>
                  {f}{streamingFile === f && <span className="lg-dot" />}
                </button>
              ))}
            </nav>
            {files[file] ? <Code code={files[file]} file={file} live={streamingFile === file} /> : <div className="lg-empty">{running ? "Waiting for ASTON…" : "Nothing here yet."}</div>}
          </section>
          <section className={`glass-inset lg-preview ${view === "preview" ? "" : "lg-hide-sm"}`}>
            <div className="lg-browser"><i /><i /><i /><span>{plan ? `${plan.siteName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.site` : "preview"}</span></div>
            {/* sandboxed: the generated page can't reach JARVIS */}
            <iframe title="Website preview" sandbox="allow-scripts" srcDoc={srcDoc} style={{ background: plan?.palette.bg ?? "#0b1020" }} />
          </section>
        </div>

        <footer className="lg-foot">
          {done ? (
            <>
              <form className="lg-ask" onSubmit={(e) => { e.preventDefault(); const a = ask.trim(); if (a.length >= 3) { setAsk(""); run("revise", { instruction: a }); } }}>
                <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask for a change — “make the hero darker”" maxLength={800} disabled={running} />
              </form>
              <a className="lg-btn" href={`/api/aston/sites/${siteId}/html`} target="_blank" rel="noopener noreferrer">Open full screen</a>
              <a className="lg-btn lg-btn-primary" href={`/api/aston/sites/${siteId}/html?download=1`}>Download</a>
            </>
          ) : running ? (
            <button className="lg-btn" onClick={() => { stopRef.current = true; }}>Pause after this step</button>
          ) : (
            <button className="lg-btn lg-btn-primary" onClick={() => run("next")}>Resume</button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Liquid highlight: move the sheen toward the pointer (one style write per frame at most). */
let liquidFrame = 0;
function liquid(e: React.PointerEvent<HTMLDivElement>) {
  const el = e.currentTarget, x = e.clientX, y = e.clientY;
  if (liquidFrame) return;
  liquidFrame = requestAnimationFrame(() => {
    liquidFrame = 0;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", ((x - r.left) / r.width - 0.5).toFixed(3));
    el.style.setProperty("--my", ((y - r.top) / r.height - 0.5).toFixed(3));
  });
}

/** A small glass list of the owner's websites. */
export function SiteList({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState<{ id: string; title: string; status: string; createdAt: string }[] | null>(null);
  useEffect(() => { fetch("/api/aston/sites").then((r) => r.json()).then((j) => setRows(j.ok ? j.data : [])).catch(() => setRows([])); }, []);
  return (
    <div className="lg-overlay" role="dialog" aria-modal="true" aria-label="Your websites">
      <div className="liquid-glass lg-list" onPointerMove={liquid}>
        <div className="lg-sheen" aria-hidden />
        <header className="lg-head">
          <h2 className="lg-title">Your websites</h2>
          <button className="lg-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        {!rows ? <p className="lg-status">Loading…</p> : !rows.length ? <p className="lg-status">None yet — say “build a website for …”.</p> : (
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => onOpen(r.id)}>
                  <span>{r.title}</span>
                  <span className="opacity-60">{r.status === "done" ? "Ready" : "Unfinished — resume"} · {new Date(r.createdAt).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
