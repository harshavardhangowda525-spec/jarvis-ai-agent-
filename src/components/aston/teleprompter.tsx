"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clamp, parseCommand, speedPx, type TeleAction } from "@/lib/aston/scripts/commands";
import {
  detectKind, fromEditText, KIND_LABEL, SCRIPT_KINDS, splitDirections, toEditText, wordCount,
  type ScriptDetails, type ScriptKind, type ScriptSection,
} from "@/lib/aston/scripts/format";


interface Script {
  id: string; title: string; kind: ScriptKind; kindLabel: string; businessType: string | null;
  details: ScriptDetails; sections: ScriptSection[]; request: string; saved: boolean; updatedAt: string;
}
interface ListRow { id: string; title: string; kind: ScriptKind; kindLabel: string; businessType: string | null; saved: boolean; updatedAt: string }
type Phase = "generating" | "ready" | "error" | "edit" | "customize" | "library";
type VoiceState = "off" | "on" | "unsupported" | "denied" | "needs-tap";

interface Prefs { speed: number; font: number; align: "left" | "center"; spacing: number }
const DEFAULT_PREFS: Prefs = { speed: 4, font: 40, align: "left", spacing: 1.5 };
const PREFS_KEY = "aston.teleprompter.prefs";
const GUIDE = 0.32; // the reading line sits at 32% of the screen height

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || (r.status === 401 ? "Signed out — sign in again." : `Request failed (HTTP ${r.status}).`));
  return j.data as T;
}

function loadPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; } catch { return DEFAULT_PREFS; }
}

/* ------------------------------------------------------------------ voice */

/**
 * Continuous listening for "ASTON, …" commands while the teleprompter is open.
 * Browsers stop recognition after silence, so it restarts itself. Only
 * wake-word commands act; everything else you say is ignored.
 */
function useVoiceCommands(enabled: boolean, onAction: (a: TeleAction, heard: string) => void): [VoiceState, () => void] {
  const [state, setState] = useState<VoiceState>("off");
  const rec = useRef<any>(null);
  const want = useRef(enabled);
  const cb = useRef(onAction);
  cb.current = onAction;

  const start = useCallback(() => {
    const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
    if (!SR) { setState("unsupported"); return; }
    if (rec.current) return;
    const r = new SR();
    r.lang = "en-IN";
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 3;
    r.onstart = () => setState("on");
    r.onresult = (ev: any) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) continue;
        for (let k = 0; k < ev.results[i].length; k++) {
          const heard = String(ev.results[i][k].transcript ?? "");
          const a = parseCommand(heard);
          if (a) { cb.current(a, heard.trim()); break; }
        }
      }
    };
    r.onerror = (ev: any) => {
      if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed") { want.current = false; setState("denied"); }
      else if (ev?.error === "audio-capture") { want.current = false; setState("denied"); }
    };
    r.onend = () => {
      rec.current = null;
      if (want.current) setTimeout(() => { if (want.current && !rec.current) start(); }, 250);
      else setState((s) => (s === "denied" || s === "unsupported" ? s : "off"));
    };
    rec.current = r;
    try { r.start(); } catch { rec.current = null; setState("needs-tap"); }
  }, []);

  useEffect(() => {
    want.current = enabled;
    if (enabled) start();
    else { try { rec.current?.stop(); } catch { /* not running */ } rec.current = null; setState((s) => (s === "unsupported" || s === "denied" ? s : "off")); }
    return () => { want.current = false; try { rec.current?.abort(); } catch { /* gone */ } rec.current = null; };
  }, [enabled, start]);

  // A user tap re-tries (Android needs a gesture before the mic can start)
  const retry = useCallback(() => { want.current = true; setState("off"); start(); }, [start]);
  return [state, retry];
}

/* ------------------------------------------------------------------ screen wake lock */

function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: any = null, gone = false;
    const take = async () => { try { lock = await (navigator as any).wakeLock.request("screen"); } catch { /* not allowed — the screen may dim */ } };
    const onVis = () => { if (document.visibilityState === "visible" && !gone) take(); };
    take();
    document.addEventListener("visibilitychange", onVis);
    return () => { gone = true; document.removeEventListener("visibilitychange", onVis); try { lock?.release(); } catch { /* released */ } };
  }, [active]);
}

/* ------------------------------------------------------------------ the reader */

function Line({ who, text }: { who: string; text: string }) {
  if (who === "client") return <p className="tp-client"><span className="tp-tag">Client</span>{text}</p>;
  if (who === "note") return <p className="tp-note">[{text.replace(/^\[|\]$/g, "")}]</p>;
  return <p className="tp-you">{splitDirections(text).map((p, i) => (p.dir ? <span key={i} className="tp-dir">{p.t}</span> : p.slot ? <span key={i} className="tp-slot">{p.t}</span> : p.t))}</p>;
}

/**
 * ASTON's teleprompter: generate → read → control by voice or touch. Playback
 * never changes the stored script; edits are saved explicitly.
 */
export function Teleprompter({ request, scriptId, library, onClose, onSpeak }: {
  request?: string; scriptId?: string; library?: boolean; onClose: () => void; onSpeak?: (t: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>(library ? "library" : request ? "generating" : "ready");
  const [script, setScript] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [more, setMore] = useState(false);
  const [focus, setFocus] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [heard, setHeard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pos = useRef(0);
  const hold = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastRequest = useRef(request ?? "");

  useEffect(() => { setPrefs(loadPrefs()); }, []);
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ } }, [prefs]);
  const flash = useCallback((t: string) => { setToast(t); setTimeout(() => setToast((x) => (x === t ? null : x)), 1800); }, []);

  // ---------------------------------------------------------------- load / generate
  const generate = useCallback(async (req: string, extra?: { kind?: ScriptKind; details?: ScriptDetails; id?: string }) => {
    setPhase("generating"); setError(null); setPlaying(false);
    try {
      const s = extra?.id
        ? await api<Script>(`/api/aston/scripts/${extra.id}/regenerate`, { method: "POST", body: JSON.stringify({ request: req, kind: extra.kind, details: extra.details }) })
        : await api<Script>("/api/aston/scripts", { method: "POST", body: JSON.stringify({ request: req, kind: extra?.kind, details: extra?.details }) });
      setScript(s); setPhase("ready"); pos.current = 0; setProgress(0);
      if (scroller.current) scroller.current.scrollTop = 0;
      onSpeak?.(`Your ${s.kindLabel.toLowerCase()} script is ready. Say "ASTON, start" when you are.`);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't write the script."); setPhase("error");
    }
  }, [onSpeak]);

  const open = useCallback(async (id: string) => {
    setError(null); setPlaying(false);
    try { const s = await api<Script>(`/api/aston/scripts/${id}`); setScript(s); setPhase("ready"); pos.current = 0; setProgress(0); if (scroller.current) scroller.current.scrollTop = 0; }
    catch (e: any) { setError(e?.message ?? "Couldn't open the script."); setPhase("error"); }
  }, []);

  useEffect(() => {
    if (request) generate(request);
    else if (scriptId) open(scriptId);
    else if (!library) {
      // "open teleprompter": the most recent script, or the library if there is none
      api<{ scripts: ListRow[] }>("/api/aston/scripts?scope=recent").then((r) => (r.scripts[0] ? open(r.scripts[0].id) : setPhase("library"))).catch(() => setPhase("library"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- scrolling engine
  const px = speedPx(prefs.speed, prefs.font, prefs.spacing);
  const pxRef = useRef(px);
  pxRef.current = px;

  useEffect(() => {
    const el = scroller.current;
    if (!playing || !el) return;
    let raf = 0, last = performance.now(), lastUi = 0;
    pos.current = el.scrollTop;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const max = el.scrollHeight - el.clientHeight;
      if (hold.current) pos.current = el.scrollTop; // your finger is on it — follow, don't fight
      else {
        pos.current = Math.min(max, pos.current + pxRef.current * dt);
        el.scrollTop = pos.current;
        if (pos.current >= max - 0.5) { setPlaying(false); flash("End of script"); }
      }
      if (now - lastUi > 250) { lastUi = now; setProgress(max > 0 ? el.scrollTop / max : 1); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, flash]);

  useWakeLock(playing);

  // Keep the reading position when text size / spacing changes
  const ratio = useRef(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = ratio.current * max; pos.current = el.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.font, prefs.spacing, prefs.align]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    ratio.current = max > 0 ? el.scrollTop / max : 0;
    if (!playing) { pos.current = el.scrollTop; setProgress(ratio.current); }
  };
  const grab = () => { hold.current = true; clearTimeout(holdTimer.current); };
  const release = (ms = 450) => { clearTimeout(holdTimer.current); holdTimer.current = setTimeout(() => { hold.current = false; }, ms); };

  // ---------------------------------------------------------------- sections
  const sectionTops = () => {
    const el = scroller.current;
    if (!el) return [] as number[];
    const guide = el.clientHeight * GUIDE;
    return [...el.querySelectorAll<HTMLElement>("[data-sec]")].map((s) => Math.max(0, s.offsetTop - guide + 4));
  };
  const jump = (top: number) => { const el = scroller.current; if (!el) return; el.scrollTop = top; pos.current = el.scrollTop; onScroll(); };
  const nextSection = () => { const t = sectionTops(); const cur = scroller.current?.scrollTop ?? 0; const n = t.find((x) => x > cur + 8); if (n !== undefined) jump(n); else flash("Last section"); };
  const repeatSection = () => {
    const t = sectionTops(); const cur = scroller.current?.scrollTop ?? 0;
    let i = t.findLastIndex((x) => x <= cur + 8);
    if (i > 0 && cur - t[i] < 40) i -= 1; // already at the start of this one → the one before
    jump(t[Math.max(0, i)] ?? 0);
  };

  // ---------------------------------------------------------------- actions (touch, keys and voice share these)
  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const act = useCallback((a: TeleAction) => {
    if (phase !== "ready" && a !== "close") return;
    switch (a) {
      case "start": case "resume": {
        const el = scroller.current;
        if (el && el.scrollTop >= el.scrollHeight - el.clientHeight - 1) jump(0); // at the end → from the top
        setPlaying(true); setChrome(false); break;
      }
      case "pause": setPlaying(false); setChrome(true); break;
      case "stop": setPlaying(false); jump(0); setChrome(true); break;
      case "restart": jump(0); setPlaying(true); break;
      case "faster": setPrefs((p) => ({ ...p, speed: clamp(p.speed + 1, 1, 10) })); break;
      case "slower": setPrefs((p) => ({ ...p, speed: clamp(p.speed - 1, 1, 10) })); break;
      case "bigger": setPrefs((p) => ({ ...p, font: clamp(p.font + 4, 20, 88) })); break;
      case "smaller": setPrefs((p) => ({ ...p, font: clamp(p.font - 4, 20, 88) })); break;
      case "next": nextSection(); break;
      case "repeat": repeatSection(); break;
      case "edit": setPlaying(false); setPhase("edit"); break;
      case "fullscreen": toggleFocus(); break;
      case "close": close(); break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const [voice, retryVoice] = useVoiceCommands(voiceOn && (phase === "ready"), (a, h) => { act(a); setHeard(h); setTimeout(() => setHeard((x) => (x === h ? null : x)), 1600); });

  const toggleFocus = () => {
    const el = root.current as any;
    if (!document.fullscreenElement && el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setFocus((f) => !f);
  };
  const close = () => { setPlaying(false); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); onClose(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "ready" || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      const map: Record<string, TeleAction> = { " ": playing ? "pause" : "start", ArrowUp: "faster", ArrowDown: "slower", "+": "bigger", "=": "bigger", "-": "smaller", ArrowRight: "next", ArrowLeft: "repeat", Escape: "close", f: "fullscreen", r: "restart", e: "edit" };
      const a = map[e.key];
      if (a) { e.preventDefault(); act(a); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [act, phase, playing]);

  // show the controls briefly on a tap while reading
  const chromeTimer = useRef<ReturnType<typeof setTimeout>>();
  const tapReader = () => {
    setChrome(true);
    clearTimeout(chromeTimer.current);
    if (playing) chromeTimer.current = setTimeout(() => setChrome(false), 3500);
  };

  // ---------------------------------------------------------------- saving / editing
  const patch = async (body: Record<string, unknown>, msg: string) => {
    if (!script) return;
    setBusy(true);
    try { const s = await api<Script>(`/api/aston/scripts/${script.id}`, { method: "PATCH", body: JSON.stringify(body) }); setScript(s); flash(msg); return s; }
    catch (e: any) { flash(e?.message ?? "Couldn't save."); }
    finally { setBusy(false); }
  };
  const save = () => patch({ saved: true }, "Saved to your library");
  const rename = () => { const t = window.prompt("Script name", script?.title ?? ""); if (t && t.trim()) patch({ title: t.trim() }, "Renamed"); };
  const regenerate = () => { if (script && window.confirm("Rewrite this script with Groq? Your current text will be replaced.")) generate(script.request, { id: script.id, kind: script.kind, details: script.details }); };

  const words = useMemo(() => (script ? wordCount(script.sections) : 0), [script]);
  // how far there is to scroll (measured after layout, and again when the size or text changes)
  const [maxScroll, setMaxScroll] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setMaxScroll(Math.max(0, el.scrollHeight - el.clientHeight));
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => ro?.disconnect();
  }, [script, phase, prefs.font, prefs.spacing, prefs.align]);
  const remainingSec = px > 0 ? Math.round(((1 - progress) * maxScroll) / px) : 0;

  const showChrome = !playing || chrome || more;

  // ================================================================= render
  return (
    <div ref={root} className={`tp-root ${focus ? "tp-focus" : ""}`} role="dialog" aria-modal="true" aria-label="ASTON teleprompter">
      {/* ------------------------------------------------ top bar */}
      <header className={`tp-top ${showChrome ? "" : "tp-hidden"}`}>
        <button className="tp-icon" onClick={close} aria-label="Close teleprompter">×</button>
        <div className="tp-titles">
          <p className="tp-kind">{script ? script.kindLabel : "Teleprompter"}{script?.businessType ? ` · ${script.businessType}` : ""}</p>
          <h2 className="tp-title">{phase === "library" ? "Script library" : script?.title ?? "ASTON"}</h2>
        </div>
        {phase === "ready" && script && (
          <div className="tp-top-actions">
            {!script.saved ? <button className="tp-chip tp-chip-on" onClick={save} disabled={busy}>Save</button> : <span className="tp-chip">Saved</span>}
            <button className="tp-chip" onClick={() => { setPlaying(false); setPhase("library"); }}>Library</button>
          </div>
        )}
      </header>
      {phase === "ready" && (
        <div className={`tp-progress ${showChrome ? "" : "tp-progress-min"}`} aria-label={`${Math.round(progress * 100)}% read`}>
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
      )}

      {/* ------------------------------------------------ body */}
      {phase === "generating" && (
        <div className="tp-center">
          <div className="tp-pulse" aria-hidden />
          <p className="tp-big">Writing your {KIND_LABEL[detectKind(lastRequest.current || script?.request || "")].toLowerCase()} script…</p>
          <p className="tp-sub">“{(lastRequest.current || script?.request || "").slice(0, 140)}”</p>
        </div>
      )}

      {phase === "error" && (
        <div className="tp-center">
          <p className="tp-big">That didn't work.</p>
          <p className="tp-sub">{error}</p>
          <div className="tp-row">
            {(lastRequest.current || script) && <button className="tp-btn tp-btn-primary" onClick={() => (script ? generate(script.request, { id: script.id, kind: script.kind, details: script.details }) : generate(lastRequest.current))}>Try again</button>}
            {script && <button className="tp-btn" onClick={() => setPhase("ready")}>Back to the script</button>}
            <button className="tp-btn" onClick={() => setPhase("library")}>Open library</button>
          </div>
        </div>
      )}

      {phase === "ready" && script && (
        <>
          <div
            ref={scroller}
            className="tp-scroll"
            style={{ fontSize: prefs.font, lineHeight: prefs.spacing, textAlign: prefs.align }}
            onScroll={onScroll}
            onPointerDown={grab} onPointerUp={() => release()} onPointerCancel={() => release()}
            onTouchStart={grab} onTouchEnd={() => release()}
            onWheel={() => { grab(); release(700); }}
            onClick={tapReader}
          >
            <div style={{ height: `${GUIDE * 100}%` }} aria-hidden />
            {script.sections.map((s, i) => (
              <section key={i} data-sec={i} className="tp-sec">
                {s.heading && <h3 className="tp-h">{s.heading}</h3>}
                {s.lines.map((l, k) => <Line key={k} who={l.who} text={l.text} />)}
              </section>
            ))}
            <p className="tp-end">— End of script —</p>
            <div style={{ height: "70%" }} aria-hidden />
          </div>
          <div className="tp-fade-top" aria-hidden />
          <div className="tp-guide" style={{ top: `${GUIDE * 100}%` }} aria-hidden />
          <div className="tp-fade-bottom" aria-hidden />
          {(heard || toast) && <div className="tp-toast" role="status">{heard ? `“${heard}”` : toast}</div>}

          {/* ------------------------------------------------ controls */}
          <footer className={`tp-controls ${showChrome ? "" : "tp-hidden"}`}>
            <div className="tp-meta">
              <span>{Math.round(progress * 100)}%</span>
              <span>~{Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, "0")} left</span>
              <span>{words} words</span>
              <button className={`tp-voice tp-voice-${voice}`} onClick={() => (voice === "on" ? setVoiceOn(false) : (setVoiceOn(true), retryVoice()))}
                title="Voice commands start with “ASTON”">
                {voice === "on" ? "● Listening for “ASTON…”" : voice === "unsupported" ? "Voice not supported here" : voice === "denied" ? "Mic blocked — tap to retry" : voice === "needs-tap" ? "Tap to enable voice" : "Voice off"}
              </button>
            </div>
            <div className="tp-bar">
              <button className="tp-ctl" onClick={() => act("restart")} aria-label="Restart">⟲</button>
              <button className="tp-ctl" onClick={() => act("repeat")} aria-label="Previous section">⏮</button>
              <button className="tp-play" onClick={() => act(playing ? "pause" : "start")} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
              <button className="tp-ctl" onClick={() => act("next")} aria-label="Next section">⏭</button>
              <button className={`tp-ctl ${more ? "tp-ctl-on" : ""}`} onClick={() => setMore((m) => !m)} aria-label="More options" aria-expanded={more}>⋯</button>
            </div>
            <div className="tp-bar tp-bar-2">
              <div className="tp-grp" role="group" aria-label="Scroll speed">
                <button className="tp-ctl" onClick={() => act("slower")} aria-label="Slower">−</button>
                <span className="tp-val" aria-label="Speed">{prefs.speed}<small>speed</small></span>
                <button className="tp-ctl" onClick={() => act("faster")} aria-label="Faster">+</button>
              </div>
              <div className="tp-grp" role="group" aria-label="Text size">
                <button className="tp-ctl" onClick={() => act("smaller")} aria-label="Smaller text">A−</button>
                <span className="tp-val" aria-label="Text size">{prefs.font}<small>size</small></span>
                <button className="tp-ctl" onClick={() => act("bigger")} aria-label="Bigger text">A+</button>
              </div>
            </div>
            {more && (
              <div className="tp-more">
                <div className="tp-row">
                  <span className="tp-label">Align</span>
                  <button className={`tp-chip ${prefs.align === "left" ? "tp-chip-on" : ""}`} onClick={() => setPref("align", "left")}>Left</button>
                  <button className={`tp-chip ${prefs.align === "center" ? "tp-chip-on" : ""}`} onClick={() => setPref("align", "center")}>Centre</button>
                  <span className="tp-label">Spacing</span>
                  <input type="range" min={1.2} max={2.2} step={0.1} value={prefs.spacing} onChange={(e) => setPref("spacing", Number(e.target.value))} aria-label="Line spacing" />
                </div>
                <div className="tp-row">
                  <button className="tp-btn" onClick={() => act("stop")}>Stop</button>
                  <button className="tp-btn" onClick={toggleFocus}>{focus ? "Exit full screen" : "Full screen"}</button>
                  <button className="tp-btn" onClick={() => act("edit")}>Edit</button>
                  <button className="tp-btn" onClick={() => { setPlaying(false); setPhase("customize"); }}>Customise</button>
                  <button className="tp-btn" onClick={regenerate}>Regenerate</button>
                  <button className="tp-btn" onClick={rename}>Rename</button>
                </div>
              </div>
            )}
          </footer>
        </>
      )}

      {phase === "edit" && script && (
        <Editor script={script} busy={busy} onCancel={() => setPhase("ready")} onSave={async (sections) => { const s = await patch({ sections }, "Edits saved"); if (s) setPhase("ready"); }} />
      )}

      {phase === "customize" && script && (
        <Customize script={script} onCancel={() => setPhase("ready")} onGenerate={(kind, details) => generate(script.request, { id: script.id, kind, details })} />
      )}

      {phase === "library" && (
        <Library onOpen={open} onClose={() => (script ? setPhase("ready") : close())} onNew={(req) => { lastRequest.current = req; generate(req); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

function Editor({ script, busy, onCancel, onSave }: { script: Script; busy: boolean; onCancel: () => void; onSave: (s: ScriptSection[]) => void }) {
  const [text, setText] = useState(() => toEditText(script.sections));
  const parsed = useMemo(() => fromEditText(text), [text]);
  return (
    <div className="tp-panel">
      <p className="tp-hint">“## Heading” starts a section · “&gt; Client: …” is the client · a line in [brackets] is a direction (not read aloud).</p>
      <textarea className="tp-editor" value={text} onChange={(e) => setText(e.target.value)} spellCheck aria-label="Script text" />
      <div className="tp-row tp-row-end">
        <span className="tp-label">{parsed.length} sections</span>
        <button className="tp-btn" onClick={onCancel}>Cancel</button>
        <button className="tp-btn tp-btn-primary" disabled={busy || !parsed.length} onClick={() => onSave(parsed)}>Save edits</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ customise before starting */

function Customize({ script, onCancel, onGenerate }: { script: Script; onCancel: () => void; onGenerate: (k: ScriptKind, d: ScriptDetails) => void }) {
  const [kind, setKind] = useState<ScriptKind>(script.kind);
  const [d, setD] = useState<ScriptDetails>(script.details ?? {});
  const field = (k: keyof ScriptDetails, label: string, ph: string) => (
    <label className="tp-field"><span>{label}</span><input value={d[k] ?? ""} placeholder={ph} maxLength={k === "notes" ? 600 : 160} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></label>
  );
  return (
    <div className="tp-panel">
      <p className="tp-hint">Change the details and ASTON rewrites the script. Empty fields use your defaults; nothing is invented.</p>
      <label className="tp-field"><span>Script type</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as ScriptKind)}>{SCRIPT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
      </label>
      <div className="tp-grid">
        {field("businessName", "Business name", "e.g. Brew Lab")}
        {field("industry", "Industry", "e.g. Café")}
        {field("service", "Service", "e.g. Website development")}
        {field("price", "Price", "e.g. ₹4,999")}
        {field("offer", "Offer", "Only a real offer — or leave empty")}
        {field("notes", "Notes", "Anything ASTON should know")}
      </div>
      <div className="tp-row tp-row-end">
        <button className="tp-btn" onClick={onCancel}>Cancel</button>
        <button className="tp-btn tp-btn-primary" onClick={() => onGenerate(kind, d)}>Regenerate script</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ library */

function Library({ onOpen, onClose, onNew }: { onOpen: (id: string) => void; onClose: () => void; onNew: (req: string) => void }) {
  const [scope, setScope] = useState<"saved" | "recent">("saved");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [type, setType] = useState("");
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState("");

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ scope, ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(type ? { type } : {}) });
      const r = await api<{ scripts: ListRow[]; businessTypes: string[] }>(`/api/aston/scripts?${p}`);
      setRows(r.scripts); setTypes(r.businessTypes); setErr(null);
    } catch (e: any) { setErr(e?.message ?? "Couldn't load your scripts."); setRows([]); }
  }, [scope, q, kind, type]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const rename = async (r: ListRow) => { const t = window.prompt("Script name", r.title); if (t?.trim()) { await api(`/api/aston/scripts/${r.id}`, { method: "PATCH", body: JSON.stringify({ title: t.trim() }) }).catch((e) => setErr(e.message)); load(); } };
  const dup = async (r: ListRow) => { await api(`/api/aston/scripts/${r.id}/duplicate`, { method: "POST" }).catch((e) => setErr(e.message)); setScope("saved"); load(); };
  const del = async (r: ListRow) => { if (window.confirm(`Delete “${r.title}”? This can't be undone.`)) { await api(`/api/aston/scripts/${r.id}`, { method: "DELETE" }).catch((e) => setErr(e.message)); load(); } };
  const keep = async (r: ListRow) => { await api(`/api/aston/scripts/${r.id}`, { method: "PATCH", body: JSON.stringify({ saved: true }) }).catch((e) => setErr(e.message)); load(); };

  return (
    <div className="tp-panel tp-library">
      <form className="tp-new" onSubmit={(e) => { e.preventDefault(); if (ask.trim().length >= 3) onNew(ask.trim()); }}>
        <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="New script — e.g. “cold call for a gym that needs a website”" maxLength={1500} />
        <button className="tp-btn tp-btn-primary" type="submit">Write</button>
      </form>
      <div className="tp-row">
        <button className={`tp-chip ${scope === "saved" ? "tp-chip-on" : ""}`} onClick={() => setScope("saved")}>Saved</button>
        <button className={`tp-chip ${scope === "recent" ? "tp-chip-on" : ""}`} onClick={() => setScope("recent")}>Recent</button>
        <input className="tp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search scripts" />
      </div>
      <div className="tp-row tp-wrap">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Pitching method">
          <option value="">All methods</option>{SCRIPT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Business type">
          <option value="">All businesses</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="tp-btn" onClick={onClose}>Close</button>
      </div>
      {err && <p className="tp-err">{err}</p>}
      {!rows ? <p className="tp-sub">Loading…</p> : !rows.length ? (
        <p className="tp-sub">{scope === "saved" ? "No saved scripts yet. Write one above, then press Save." : "Nothing yet."}</p>
      ) : (
        <ul className="tp-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button className="tp-open" onClick={() => onOpen(r.id)}>
                <strong>{r.title}</strong>
                <span>{r.kindLabel}{r.businessType ? ` · ${r.businessType}` : ""} · {new Date(r.updatedAt).toLocaleDateString()}{r.saved ? "" : " · draft"}</span>
              </button>
              <div className="tp-row-actions">
                {!r.saved && <button onClick={() => keep(r)}>Save</button>}
                <button onClick={() => rename(r)}>Rename</button>
                <button onClick={() => dup(r)}>Duplicate</button>
                <button onClick={() => del(r)} className="tp-danger">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
