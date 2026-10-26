"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Settings2, Minus, X, Square, LayoutGrid, Pause, Play, Plus, Trash2 } from "lucide-react";
import { Hologram, type OrbState } from "./hologram";
import { useOrbVoice, type VoiceMode } from "./voice";

/**
 * JARVIS 2.0 — the floating assistant (shown by the desktop app at /orb).
 *
 * Words (spoken or typed) go first to the desktop planner in the app's main
 * process: if they're a desktop command it plans, asks you where it must, acts
 * and reports. Anything else goes to JARVIS's brain (/api/agent) — the same
 * conversation, tools and keys as the main JARVIS. In a normal browser (no
 * desktop app) everything goes to the brain.
 */
type Desktop = {
  run: (text: string, ctx?: { pending?: string | null }) => Promise<RunResult>;
  apps: () => Promise<string[]>; openApp: (name: string) => Promise<{ ok: boolean; say?: string }>;
  stop: () => void; pause: (on: boolean) => void; state: () => Promise<{ paused: boolean; control: boolean; platform: string; floating: boolean; shortcuts: Record<string, string> } | null>;
  getSettings: () => Promise<OrbSettings | null>; setSettings: (p: Partial<OrbSettings>) => Promise<boolean>;
  setMode: (m: "orb" | "popup") => void; setInteractive: (on: boolean) => void; dragStart: () => void; dragEnd: () => void; hide: () => void; quit: () => void;
  onEvent: (cb: (e: { type: string; [k: string]: unknown }) => void) => () => void;
};
type RunResult = { handled: boolean; reply?: string; clarify?: string; pending?: string | null; wake?: boolean; ok?: boolean; launcher?: string[]; control?: string; results?: { ok: boolean; say?: string; verified?: boolean | null }[] };
type OrbSettings = { projects: { name: string; path: string }[]; sites: { name: string; url: string }[]; searchRoots: string[]; projectsRoot: string; wakePhrase: string; voiceMode: VoiceMode; volume: number; rate: number; micId: string; language: string; floating: boolean };
type Msg = { id: number; who: "you" | "jarvis"; text: string; tone?: "ok" | "err" | "info"; action?: { label: string; href: string } };

const desktop = (): Desktop | null => (typeof window !== "undefined" ? ((window as unknown as { jarvisDesktop?: Desktop }).jarvisDesktop ?? null) : null);
const DEFAULTS: OrbSettings = { projects: [], sites: [], searchRoots: [], projectsRoot: "", wakePhrase: "jarvis", voiceMode: "push", volume: 1, rate: 1, micId: "", language: "en", floating: true };
let seq = 0;

export function OrbApp() {
  const D = useRef<Desktop | null>(null);
  const [hasDesktop, setHasDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"thinking" | "executing" | null>(null);
  const [flash, setFlash] = useState<"success" | "error" | null>(null);
  const [progress, setProgress] = useState<{ index: number; total: number; text: string } | null>(null);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<"chat" | "apps" | "settings">("chat");
  const [apps, setApps] = useState<string[] | null>(null);
  const [appQ, setAppQ] = useState("");
  const [settings, setSettings] = useState<OrbSettings>(DEFAULTS);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const pending = useRef<string | null>(null);
  const convo = useRef<string | null>(null);
  const brainAbort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const flashT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const add = useCallback((m: Omit<Msg, "id">) => setMsgs((l) => [...l.slice(-40), { ...m, id: ++seq }]), []);
  const flashState = (s: "success" | "error") => { if (flashT.current) clearTimeout(flashT.current); setFlash(s); flashT.current = setTimeout(() => setFlash(null), 1400); };

  const voice = useOrbVoice({
    mode: settings.voiceMode, wakePhrase: settings.wakePhrase, micId: settings.micId, volume: settings.volume, rate: settings.rate,
    onCommand: (t) => { if (!open) openPopup(true); void handle(t, true); },
    onWake: () => { if (!open) openPopup(true); add({ who: "jarvis", text: "Yes? I'm listening.", tone: "info" }); },
    onError: (m) => { add({ who: "jarvis", text: m, tone: "err" }); flashState("error"); },
  });
  const voiceRef = useRef(voice); voiceRef.current = voice;

  // ---------- the desktop app (if this page is inside it) ----------
  useEffect(() => {
    D.current = desktop(); setHasDesktop(!!D.current);
    try { convo.current = localStorage.getItem("jarvis-orb-conversation"); } catch { /* storage blocked */ }
    const d = D.current;
    if (!d) return;
    d.setMode("orb"); // after a reload (e.g. signing in) the window matches the page again
    void d.getSettings().then((s) => s && setSettings({ ...DEFAULTS, ...s }));
    void d.state().then((s) => s && setPaused(s.paused));
    return d.onEvent((e) => {
      if (e.type === "open") openPopup(true);
      else if (e.type === "close") openPopup(false);
      else if (e.type === "ptt") { openPopup(true); if (voiceRef.current.pushToTalk()) add({ who: "jarvis", text: "Listening…", tone: "info" }); }
      else if (e.type === "stop") stopAll("Emergency stop — everything halted.");
      else if (e.type === "paused") setPaused(!!e.paused);
      else if (e.type === "progress") {
        const total = Number(e.total) || 1, index = Number(e.index) || 0;
        if (e.state === "running") setProgress({ index, total, text: `${String(e.kind).replace("_", " ")}${e.target ? ` · ${e.target}` : ""}` });
        else setProgress((p) => (p ? { ...p, text: String(e.say ?? p.text) } : p));
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, progress]);

  function openPopup(on: boolean) {
    setOpen(on);
    D.current?.setMode(on ? "popup" : "orb");
  }

  const stopAll = useCallback((note = "Stop requested — steps that haven't started won't run (an app that already started keeps running).") => {
    D.current?.stop();
    brainAbort.current?.abort();
    voiceRef.current.stopSpeaking();
    setBusy(null); setProgress(null);
    add({ who: "jarvis", text: note, tone: "info" });
  }, [add]);

  // ---------- JARVIS's brain for everything that isn't a desktop command ----------
  async function askBrain(text: string, speak: boolean) {
    setBusy("thinking");
    const ac = new AbortController(); brainAbort.current = ac;
    const id = ++seq;
    setMsgs((l) => [...l.slice(-40), { id, who: "jarvis", text: "" }]);
    let full = "";
    try {
      const r = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, conversationId: convo.current || undefined }), signal: ac.signal });
      if (r.status === 401) { setMsgs((l) => l.map((m) => (m.id === id ? { ...m, text: "Sign in to JARVIS first.", tone: "err", action: { label: "Sign in", href: "/login?next=/orb" } } : m))); flashState("error"); return; }
      if (r.status === 423) { setMsgs((l) => l.map((m) => (m.id === id ? { ...m, text: "JARVIS is locked.", tone: "err", action: { label: "Unlock", href: "/unlock?next=/orb" } } : m))); flashState("error"); return; }
      if (!r.ok || !r.body) { const j = await r.json().catch(() => null); throw new Error(j?.error ?? `HTTP ${r.status}`); }
      const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { type: string; delta?: string; text?: string; message?: string; conversationId?: string; names?: string[] };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === "meta" && ev.conversationId) { convo.current = ev.conversationId; try { localStorage.setItem("jarvis-orb-conversation", ev.conversationId); } catch { /* ignore */ } }
          else if (ev.type === "text" && ev.delta) { full += ev.delta; setMsgs((l) => l.map((m) => (m.id === id ? { ...m, text: full } : m))); }
          else if (ev.type === "done" && typeof ev.text === "string" && ev.text) { full = ev.text; setMsgs((l) => l.map((m) => (m.id === id ? { ...m, text: full } : m))); }
          else if (ev.type === "error") throw new Error(ev.message ?? "JARVIS hit an error");
          else if (ev.type === "open_app" && ev.names?.length && D.current) for (const n of ev.names.slice(0, 4)) { const o = await D.current.openApp(n); add({ who: "jarvis", text: o.say ?? (o.ok ? `Opened ${n}.` : `Couldn't open ${n}.`), tone: o.ok ? "ok" : "err" }); }
        }
      }
      if (!full) setMsgs((l) => l.map((m) => (m.id === id ? { ...m, text: "(no answer)" } : m)));
      if (speak && full) void voiceRef.current.speak(full);
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setMsgs((l) => l.map((m) => (m.id === id ? { ...m, text: `JARVIS couldn't answer: ${(e as Error).message}`, tone: "err" } : m))); flashState("error");
    } finally { setBusy(null); brainAbort.current = null; }
  }

  // ---------- one command: desktop first, else the brain ----------
  async function handle(raw: string, spoken = false) {
    const text = raw.trim();
    if (!text) return;
    voiceRef.current.stopSpeaking(); // a new command interrupts JARVIS
    add({ who: "you", text });
    const d = D.current;
    if (d) {
      setBusy("executing");
      let r: RunResult;
      try { r = await d.run(text, { pending: pending.current }); } catch (e) { r = { handled: true, reply: `Desktop control hit an error: ${(e as Error).message}`, ok: false }; }
      setBusy(null); setProgress(null);
      if (r.handled) {
        pending.current = r.pending ?? null;
        if (r.control === "stop") { brainAbort.current?.abort(); }
        if (r.control) setPaused(r.control === "pause" ? true : r.control === "resume" ? false : paused);
        if (r.launcher) { setApps(r.launcher); setView("apps"); }
        const failed = r.results?.some((x) => !x.ok);
        const reply = r.reply || r.clarify || "Done.";
        add({ who: "jarvis", text: reply, tone: r.clarify ? "info" : failed ? "err" : "ok" });
        if (!r.clarify && r.results?.length) flashState(failed ? "error" : "success");
        if (spoken || r.clarify) void voiceRef.current.speak(reply);
        return;
      }
      pending.current = null;
    }
    await askBrain(text, spoken);
  }

  const send = (e?: React.FormEvent) => { e?.preventDefault(); const t = input; setInput(""); void handle(t); };

  // ---------- launcher & settings ----------
  async function showApps() {
    setView("apps");
    if (!D.current) { setApps([]); return; }
    setApps(null); setApps(await D.current.apps());
  }
  async function launch(name: string) {
    if (!D.current) return;
    setView("chat"); add({ who: "you", text: `Open ${name}` }); setBusy("executing");
    const r = await D.current.openApp(name);
    setBusy(null); add({ who: "jarvis", text: r.say ?? (r.ok ? `Opened ${name}.` : `Couldn't open ${name}.`), tone: r.ok ? "ok" : "err" }); flashState(r.ok ? "success" : "error");
  }
  async function saveSettings(p: Partial<OrbSettings>) {
    const next = { ...settings, ...p }; setSettings(next);
    await D.current?.setSettings(p);
  }
  useEffect(() => {
    if (view !== "settings" || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices.enumerateDevices().then((l) => setMics(l.filter((d) => d.kind === "audioinput"))).catch(() => {});
  }, [view]);

  // ---------- the orb: click opens the chat, drag moves it ----------
  const down = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const onOrbDown = (e: React.PointerEvent) => { down.current = { x: e.screenX, y: e.screenY, dragging: false }; (e.target as Element).setPointerCapture?.(e.pointerId); };
  const onOrbMove = (e: React.PointerEvent) => {
    const d = down.current; if (!d || d.dragging) return;
    if (Math.hypot(e.screenX - d.x, e.screenY - d.y) > 5) { d.dragging = true; D.current?.dragStart(); }
  };
  const onOrbUp = () => { const d = down.current; down.current = null; if (!d) return; if (d.dragging) D.current?.dragEnd(); else openPopup(!open); };
  const hover = (on: boolean) => D.current?.setInteractive(on);

  const state: OrbState = flash ?? (voice.ear === "recording" ? "listening" : voice.ear === "transcribing" || busy === "thinking" ? "processing" : busy === "executing" ? "executing" : voice.speaking ? "speaking" : "idle");
  const STATUS: Record<OrbState, string> = { idle: paused ? "AUTOMATION PAUSED" : "IDLE", listening: "LISTENING", processing: "PROCESSING", executing: "EXECUTING", speaking: "SPEAKING", success: "DONE", error: "ATTENTION" };
  const filtered = (apps ?? []).filter((a) => a.toLowerCase().includes(appQ.toLowerCase())).slice(0, 80);

  return (
    <div className="orb-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {open && (
        <section className="orb-pop" aria-label="JARVIS chat" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
          <header className="orb-h">
            <i className={`orb-dot ${state}`} />
            <b>JARVIS 2.0</b><span>· Floating Assistant</span>
            <em className={`orb-st ${state}`}>{STATUS[state]}</em>
            <button onClick={() => (view === "settings" ? setView("chat") : setView("settings"))} aria-label="Settings" title="Settings"><Settings2 className="h-3.5 w-3.5" /></button>
            <button onClick={() => openPopup(false)} aria-label="Minimize" title="Minimize"><Minus className="h-3.5 w-3.5" /></button>
            <button onClick={() => { openPopup(false); D.current?.hide(); }} aria-label="Hide JARVIS" title="Hide (tray icon brings it back)"><X className="h-3.5 w-3.5" /></button>
          </header>

          {(busy || progress) && (
            <div className="orb-task" role="status">
              <span>{busy === "thinking" ? "Thinking…" : progress ? `Step ${progress.index + 1} of ${progress.total} · ${progress.text}` : "Working…"}</span>
              <button onClick={() => stopAll()} className="orb-stop"><Square className="h-3 w-3" />Stop</button>
            </div>
          )}

          {view === "chat" && (
            <div className="orb-list" ref={listRef}>
              {!msgs.length && (
                <div className="orb-empty">
                  <p>Say <b>“{settings.wakePhrase === "jarvis" ? "JARVIS" : settings.wakePhrase}, open Chrome”</b>{settings.voiceMode === "push" ? " after tapping the mic" : ""}, or type below.</p>
                  <p className="dim">Try: “open apps”, “switch to VS Code”, “find my JARVIS project”, “open my Downloads folder”, “put Chrome and VS Code side by side”.</p>
                  {!hasDesktop && <p className="warn">Desktop control needs the JARVIS desktop app (<code>npm run orb</code>). Here, I can chat and answer.</p>}
                </div>
              )}
              {msgs.map((m) => (
                <div key={m.id} className={`orb-m ${m.who} ${m.tone ?? ""}`}>
                  <b>{m.who === "you" ? "You:" : "JARVIS:"}</b> {m.text || <span className="orb-typing">…</span>}
                  {m.action && <a className="orb-act" href={m.action.href} target="_blank" rel="noreferrer">{m.action.label}</a>}
                </div>
              ))}
            </div>
          )}

          {view === "apps" && (
            <div className="orb-apps">
              <input autoFocus value={appQ} onChange={(e) => setAppQ(e.target.value)} placeholder="Search your apps…" aria-label="Search apps" />
              {apps === null ? <p className="dim">Reading your installed apps…</p> : !hasDesktop ? <p className="warn">The app launcher needs the JARVIS desktop app.</p> : !filtered.length ? <p className="dim">No app matches.</p> : (
                <ul>{filtered.map((a) => <li key={a}><button onClick={() => void launch(a)}>{a}</button></li>)}</ul>
              )}
              <button className="orb-back" onClick={() => setView("chat")}>Back to chat</button>
            </div>
          )}

          {view === "settings" && (
            <div className="orb-set">
              <label>Voice<select value={settings.voiceMode} onChange={(e) => void saveSettings({ voiceMode: e.target.value as VoiceMode })}>
                <option value="push">Push to talk (mic button / Ctrl+Alt+Space)</option><option value="wake">Always listen for the wake phrase</option><option value="off">Off — typing only</option></select></label>
              <label>Wake phrase<input value={settings.wakePhrase} onChange={(e) => setSettings({ ...settings, wakePhrase: e.target.value })} onBlur={() => void saveSettings({ wakePhrase: settings.wakePhrase })} /></label>
              <label>Microphone<select value={settings.micId} onChange={(e) => void saveSettings({ micId: e.target.value })}><option value="">System default</option>{mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || "Microphone"}</option>)}</select></label>
              <label>Volume<input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => void saveSettings({ volume: Number(e.target.value) })} /></label>
              <label>Speech speed<input type="range" min={0.7} max={1.6} step={0.05} value={settings.rate} onChange={(e) => void saveSettings({ rate: Number(e.target.value) })} /></label>
              <label className="row"><input type="checkbox" checked={settings.floating} onChange={(e) => void saveSettings({ floating: e.target.checked })} />Keep the orb above other windows</label>
              <Pairs title="Projects (“switch to my … project”)" a="name" b="path" bHint="C:\Users\you\Documents\infinity-web" items={settings.projects} onChange={(projects) => void saveSettings({ projects })} />
              <Pairs title="Websites (“open my … website”)" a="name" b="url" bHint="https://…" items={settings.sites} onChange={(sites) => void saveSettings({ sites })} />
              <p className="dim">Shortcuts: Ctrl+Alt+J chat · Ctrl+Alt+Space talk · Ctrl+Alt+Backspace stop · Ctrl+Alt+P pause all automation.</p>
              <div className="orb-set-b">
                <button onClick={() => { D.current?.pause(!paused); setPaused(!paused); }}>{paused ? <><Play className="h-3 w-3" />Resume automation</> : <><Pause className="h-3 w-3" />Pause automation</>}</button>
                <button onClick={() => D.current?.quit()} className="danger">Exit JARVIS orb</button>
              </div>
            </div>
          )}

          <form className="orb-in" onSubmit={send}>
            <button type="button" className={`orb-mic${voice.ear === "recording" ? " on" : ""}`} onClick={() => { if (voice.ear === "recording") return; if (voice.pushToTalk()) add({ who: "jarvis", text: "Listening…", tone: "info" }); }}
              aria-label={voice.live ? "Talk" : "Microphone off"} title={voice.live ? "Talk (Ctrl+Alt+Space)" : settings.voiceMode === "off" ? "Voice is off — turn it on in settings" : "Microphone not available"}>
              {voice.live ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={voice.ear === "recording" ? "Listening…" : "Ask JARVIS or give a command…"} aria-label="Message JARVIS" />
            <button type="button" onClick={() => void showApps()} aria-label="Apps" title="Your apps"><LayoutGrid className="h-4 w-4" /></button>
            {busy ? <button type="button" className="orb-stop big" onClick={() => stopAll()}>Stop</button> : <button type="submit" aria-label="Send" disabled={!input.trim()}><Send className="h-4 w-4" /></button>}
          </form>
          {!voice.live && voice.micError && settings.voiceMode !== "off" && <div className="orb-live warn">{voice.micError}</div>}
          {voice.live && <div className="orb-live"><i />{settings.voiceMode === "wake" ? `Microphone on · listening for “${settings.wakePhrase}”` : voice.armed() || voice.ear === "recording" ? "Microphone on · listening" : "Microphone ready · push to talk"}</div>}
        </section>
      )}

      <div className="orb-core" onMouseEnter={() => hover(true)} onMouseLeave={() => { if (!open) hover(false); }}
        onPointerDown={onOrbDown} onPointerMove={onOrbMove} onPointerUp={onOrbUp} role="button" aria-label={open ? "Close JARVIS chat" : "Open JARVIS chat"} title="JARVIS — click to chat, drag to move">
        <Hologram state={state} micLevel={voice.micLevel} outLevel={() => voice.outLevel()} progress={progress ? (progress.index + 0.5) / progress.total : null} />
        {voice.live && <span className="orb-mic-ind" title="Microphone is on" />}
        {paused && <span className="orb-paused" title="Automation paused">II</span>}
      </div>
    </div>
  );
}

function Pairs<A extends string, B extends string>({ title, a, b, bHint, items, onChange }: { title: string; a: A; b: B; bHint: string; items: Record<A | B, string>[]; onChange: (v: Record<A | B, string>[]) => void }) {
  const [x, setX] = useState(""); const [y, setY] = useState("");
  return (
    <div className="orb-pairs">
      <span>{title}</span>
      {items.map((it, i) => <div key={i} className="orb-pair"><b>{it[a]}</b><code>{it[b]}</code><button onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label="Remove"><Trash2 className="h-3 w-3" /></button></div>)}
      <div className="orb-pair add"><input value={x} onChange={(e) => setX(e.target.value)} placeholder="name" /><input value={y} onChange={(e) => setY(e.target.value)} placeholder={bHint} />
        <button onClick={() => { if (x.trim() && y.trim()) { onChange([...items, { [a]: x.trim(), [b]: y.trim() } as Record<A | B, string>]); setX(""); setY(""); } }} aria-label="Add"><Plus className="h-3 w-3" /></button></div>
    </div>
  );
}

const CSS = `
html,body{background:transparent!important;overflow:hidden}
body.jarvis-bg{background:transparent!important}
.orb-root{position:fixed;inset:0;font-family:Barlow,system-ui,sans-serif;color:#e8f3ff;user-select:none}
.orb-core{position:absolute;right:16px;bottom:16px;width:136px;height:136px;border-radius:50%;cursor:pointer;touch-action:none}
.orb-mic-ind{position:absolute;right:18px;top:18px;width:9px;height:9px;border-radius:50%;background:#ff4d6a;box-shadow:0 0 8px #ff4d6a;animation:orb-b 1.4s infinite}
.orb-paused{position:absolute;left:14px;top:14px;font:700 10px Barlow;color:#f4c35a;background:rgba(20,14,0,.8);border:1px solid #f4c35a;border-radius:6px;padding:0 4px}
@keyframes orb-b{50%{opacity:.35}}
.orb-pop{position:absolute;right:16px;bottom:150px;width:min(388px,calc(100vw - 32px));height:min(460px,calc(100vh - 170px));display:flex;flex-direction:column;border-radius:16px;overflow:hidden;
  background:linear-gradient(160deg,rgba(14,30,54,.82),rgba(4,10,22,.88));border:1px solid rgba(120,210,255,.28);box-shadow:0 20px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08),0 0 30px rgba(95,225,255,.12);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);
  animation:orb-in .28s cubic-bezier(.2,.8,.2,1) both;user-select:text}
.orb-pop::after{content:"";position:absolute;right:58px;bottom:-7px;width:14px;height:14px;transform:rotate(45deg);background:rgba(4,10,22,.88);border-right:1px solid rgba(120,210,255,.28);border-bottom:1px solid rgba(120,210,255,.28)}
@keyframes orb-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
.orb-h{display:flex;align-items:center;gap:6px;padding:9px 10px;border-bottom:1px solid rgba(120,210,255,.14);font-size:12.5px}
.orb-h b{font-weight:600;letter-spacing:.04em}.orb-h span{color:#9fb7d0}
.orb-h button{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;color:#9fb7d0}.orb-h button:hover{background:rgba(255,255,255,.08);color:#fff}
.orb-dot{width:9px;height:9px;border-radius:50%;background:#5fe1ff;box-shadow:0 0 8px #5fe1ff}
.orb-dot.error{background:#ff786e;box-shadow:0 0 8px #ff786e}.orb-dot.success{background:#4ce0a6;box-shadow:0 0 8px #4ce0a6}
.orb-st{margin-left:auto;font:600 9px "Barlow Condensed",sans-serif;letter-spacing:.2em;font-style:normal;color:#5fe1ff;border:1px solid rgba(95,225,255,.4);border-radius:99px;padding:1px 7px}
.orb-st.error{color:#ff9a90;border-color:#ff9a9077}.orb-st.success{color:#4ce0a6;border-color:#4ce0a677}.orb-st.idle{color:#9fb7d0;border-color:rgba(159,183,208,.35)}
.orb-task{display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(95,225,255,.07);border-bottom:1px solid rgba(120,210,255,.12);font-size:11.5px;color:#cfe8ff}
.orb-task span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.orb-stop{display:flex;align-items:center;gap:4px;font-size:11px;padding:3px 9px;border-radius:8px;background:rgba(255,110,90,.18);border:1px solid rgba(255,140,120,.5);color:#ffd2cc}
.orb-stop.big{padding:0 12px;border-radius:10px;background:#c2563f;color:#fff;border:0;font-weight:600}
.orb-list{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.45}
.orb-m b{font-weight:700;color:#fff}.orb-m.jarvis b{color:#5fe1ff}
.orb-m.err{color:#ffb4ab}.orb-m.ok{color:#d6ffef}.orb-m.info{color:#cfe8ff}
.orb-act{display:inline-block;margin-left:6px;font-size:11px;padding:1px 8px;border-radius:99px;border:1px solid #5fe1ff;color:#5fe1ff}
.orb-typing{animation:orb-b 1s infinite}
.orb-empty p{margin:0 0 8px;font-size:12.5px;color:#cfe2f5}.dim{color:#7f97b2!important;font-size:11.5px}.warn{color:#f4c35a!important;font-size:11.5px}
.orb-apps{flex:1;display:flex;flex-direction:column;gap:6px;padding:10px;min-height:0}
.orb-apps input,.orb-set input,.orb-set select{width:100%;font-size:12px;padding:6px 9px;border-radius:9px;border:1px solid rgba(120,210,255,.22);background:rgba(0,0,0,.3);color:#fff;outline:none}
.orb-apps ul{list-style:none;margin:0;padding:0;overflow-y:auto;flex:1;display:grid;grid-template-columns:1fr 1fr;gap:4px;align-content:start}
.orb-apps li button{width:100%;text-align:left;font-size:12px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(120,210,255,.12);color:#e8f3ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.orb-apps li button:hover{border-color:#5fe1ff}
.orb-back{font-size:11.5px;color:#5fe1ff;align-self:flex-start}
.orb-set{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:9px;font-size:11.5px;color:#9fb7d0}
.orb-set label{display:flex;flex-direction:column;gap:3px}.orb-set label.row{flex-direction:row;align-items:center;gap:6px}.orb-set label.row input{width:auto}
.orb-set-b{display:flex;gap:6px;flex-wrap:wrap}.orb-set-b button{display:flex;align-items:center;gap:4px;font-size:11.5px;padding:5px 10px;border-radius:9px;border:1px solid rgba(120,210,255,.25);color:#e8f3ff}.orb-set-b .danger{border-color:#ff8a7a88;color:#ffb4ab}
.orb-pairs{display:flex;flex-direction:column;gap:4px}.orb-pairs>span{color:#cfe2f5}
.orb-pair{display:flex;align-items:center;gap:5px}.orb-pair b{color:#fff;font-weight:600;white-space:nowrap}.orb-pair code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:#5fe1ff}
.orb-pair.add input{flex:1}.orb-pair button{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;color:#9fb7d0;flex:none}
.orb-in{display:flex;gap:6px;padding:9px 10px;border-top:1px solid rgba(120,210,255,.14)}
.orb-in input{flex:1;min-width:0;font-size:13px;padding:8px 11px;border-radius:11px;border:1px solid rgba(120,210,255,.25);background:rgba(0,0,0,.3);color:#fff;outline:none}
.orb-in input:focus{border-color:#5fe1ff;box-shadow:0 0 0 3px rgba(95,225,255,.12)}
.orb-in button{display:flex;align-items:center;justify-content:center;min-width:36px;border-radius:11px;color:#cfe8ff;background:rgba(255,255,255,.05);border:1px solid rgba(120,210,255,.18)}
.orb-in button[type=submit]{background:linear-gradient(135deg,rgba(40,140,230,.7),rgba(120,90,240,.6));border:0;color:#fff}.orb-in button:disabled{opacity:.4}
.orb-mic.on{background:rgba(95,225,255,.25);border-color:#5fe1ff;color:#fff;box-shadow:0 0 12px rgba(95,225,255,.5)}
.orb-live{display:flex;align-items:center;gap:6px;font-size:10.5px;color:#9fb7d0;padding:0 12px 8px}.orb-live i{width:6px;height:6px;border-radius:50%;background:#ff4d6a;animation:orb-b 1.4s infinite}
@media (prefers-reduced-motion:reduce){.orb-pop{animation:none}.orb-mic-ind,.orb-live i{animation:none}}
`;
