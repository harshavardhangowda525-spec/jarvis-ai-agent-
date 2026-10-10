"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AstonOrb, type AstonState } from "./aston-orb";
import { SiteBuilder, SiteList } from "./site-builder";
import { WEBSITE_INTENT } from "@/lib/aston/site/assemble";
import { markSelfSpeech, pickVoice } from "@/lib/aston/voice";
import { Teleprompter } from "./teleprompter";
import { isOpenOnly, SCRIPT_INTENT, stripWake } from "@/lib/aston/scripts/format";
import type { IncidentDTO } from "@/lib/aston/types";

interface AiStatus { configured: boolean; model: string; status: string; blockedUntil: string | null; requestsToday: number; dailyCap: number; lastError: string | null }
interface BrowserAlert { id: string; incidentId: string; priority: string; title: string; summary: string; project: string | null }
interface StateData { incidents: IncidentDTO[]; browserAlerts: BrowserAlert[]; ai: AiStatus }
interface Turn { role: "user" | "assistant"; content: string }

const POLL_MS = 15_000;

const TICK_MS = 2 * 60_000;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  return j.data as T;
}

const STATUS_WORD: Record<AstonState, string> = { idle: "IDLE", listening: "LISTENING", processing: "PROCESSING", speaking: "SPEAKING", attention: "ATTENTION REQUIRED" };

const aiLine = (ai: AiStatus | null) => {
  if (!ai) return "";
  if (!ai.configured) return "AI offline — GROQ_API_KEY not set";
  const until = ai.blockedUntil ? ` until ${new Date(ai.blockedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
  const label: Record<string, string> = { ok: "Groq online", rate_limited: "Groq rate-limited", quota_exhausted: "Groq free quota used up", outage: "Groq unreachable", auth_error: "Groq key rejected" };
  return `${label[ai.status] ?? ai.status}${until} · ${ai.requestsToday}/${ai.dailyCap} today`;
};



export function AstonConsole() {
  const [data, setData] = useState<StateData | null>(null);
  const [mode, setMode] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [caption, setCaption] = useState("Standing by.");
  const [sub, setSub] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(0);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [speechOk, setSpeechOk] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [builder, setBuilder] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [showSites, setShowSites] = useState(false);
  const [tele, setTele] = useState<{ key: number; request?: string; library?: boolean; min?: boolean } | null>(null);
  // While the teleprompter is open you're talking to a client: ASTON stays quiet
  const teleRef = useRef(false);
  teleRef.current = !!tele && !tele.min;
  const history = useRef<Turn[]>([]);
  const recog = useRef<any>(null);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;

  const open = (data?.incidents ?? []).filter((i) => i.status === "open" && (i.priority === "critical" || i.priority === "high"));
  const current = open[focus % Math.max(1, open.length)] ?? null;
  const state: AstonState = mode !== "idle" ? mode : building ? "processing" : open.length ? "attention" : "idle";

  // ------------------------------------------------------------ speech out
  const speak = useCallback((line: string) => {
    if (!voiceOnRef.current || typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.02;
    u.pitch = 0.95;
    u.onstart = () => { markSelfSpeech(true); setMode("speaking"); };
    u.onend = u.onerror = () => { markSelfSpeech(false); setMode((m) => (m === "speaking" ? "idle" : m)); };
    speechSynthesis.speak(u);
  }, []);

  // ------------------------------------------------------------ state + alerts
  const load = useCallback(async () => {
    try {
      const d = await api<StateData>("/api/aston/state");
      setData(d);
      setError(null);
      for (const a of d.browserAlerts) {
        // Claim the alert first, so two open tabs never both announce it.
        const ok = await api<{ delivered: boolean }>(`/api/aston/alerts/${a.id}`, { method: "POST" }).then(() => true, () => false);
        if (!ok) continue;
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
          try { new Notification(`ASTON · ${a.priority.toUpperCase()}${a.project ? ` · ${a.project}` : ""}`, { body: a.summary, tag: a.incidentId, requireInteraction: a.priority === "critical" }); } catch { /* notifications blocked */ }
        }
        if (!teleRef.current) speak(a.summary);
      }
    } catch (e: any) {
      setError(e?.status === 403 ? "This account is not the ASTON owner." : e?.status === 401 ? "Signed out." : "Can't reach ASTON's server — retrying.");
    }
  }, [speak]);

  useEffect(() => {
    load();
    const tick = () => fetch("/api/aston/tick", { method: "POST" }).then(() => load()).catch(() => {});
    tick();
    const a = setInterval(load, POLL_MS);
    const b = setInterval(tick, TICK_MS);
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechOk(!!SR);
    if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();
    return () => { clearInterval(a); clearInterval(b); recog.current?.abort?.(); if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); };
  }, [load]);

  // ------------------------------------------------------------ talking
  const send = useCallback(async (content: string) => {
    const msg = content.trim();
    if (!msg) return;
    history.current = [...history.current, { role: "user" as const, content: msg }].slice(-20);
    setSub(`“${msg}”`);
    setCaption("Processing request… connected to context…");
    setMode("processing");
    // Scripts / pitches → the teleprompter (checked before websites: "a script for a café that needs a website")
    const bare = stripWake(msg).text;
    if (SCRIPT_INTENT.test(bare)) {
      const line = isOpenOnly(msg) ? "Opening the teleprompter." : "Writing your script now — the teleprompter will open with it.";
      history.current = [...history.current, { role: "assistant" as const, content: line }].slice(-20);
      setCaption(line);
      setSub(null);
      setMode("idle");
      // "open teleprompter" brings back a minimised one exactly where you left it
      if (isOpenOnly(msg) && tele?.min) setTele({ ...tele, min: false });
      else setTele(isOpenOnly(msg) ? { key: Date.now() } : { key: Date.now(), request: bare });
      return;
    }
    // Website requests go straight to the builder (no extra AI round-trip).
    if (WEBSITE_INTENT.test(msg)) {
      try {
        const site = await api<{ id: string }>("/api/aston/sites", { method: "POST", body: JSON.stringify({ brief: msg }) });
        const line = "On it. I'm building the website now — watch the code as I write it.";
        history.current = [...history.current, { role: "assistant" as const, content: line }].slice(-20);
        setCaption(line);
        setSub(null);
        setMode("idle");
        setBuilder(site.id);
        speak(line);
      } catch (e: any) {
        setCaption(e?.message ?? "I couldn't start the website.");
        setMode("idle");
      }
      return;
    }
    try {
      const r = await api<{ reply: string; ai: boolean; aiNote: string | null; changed: boolean; site?: string | null }>("/api/aston/chat", { method: "POST", body: JSON.stringify({ messages: history.current }) });
      if (r.site) setBuilder(r.site);
      history.current = [...history.current, { role: "assistant" as const, content: r.reply }].slice(-20);
      setCaption(r.reply);
      setSub(r.ai ? null : "AI unavailable — answered from stored incidents");
      setMode("idle");
      speak(r.reply);
      if (r.changed) load();
    } catch (e: any) {
      setCaption(e?.message ?? "Something went wrong.");
      setMode("idle");
    }
  }, [load, speak, tele]);

  const listen = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (mode === "listening") { recog.current?.stop(); return; }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    const r = new SR();
    r.lang = "en-IN";
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onstart = () => { setMode("listening"); setCaption("Listening…"); setSub(null); };
    r.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t; else interim += t;
      }
      setSub(`“${(finalText + interim).trim()}”`);
    };
    r.onerror = (ev: any) => { setMode("idle"); setCaption(ev?.error === "not-allowed" ? "Microphone access was blocked — type instead." : "I didn't catch that."); };
    r.onend = () => { setMode((m) => (m === "listening" ? "idle" : m)); if (finalText.trim()) send(finalText); };
    recog.current = r;
    r.start();
  }, [mode, send]);

  // ------------------------------------------------------------ decisions
  const act = async (action: string) => {
    if (!current || busy) return;
    if (action === "approve" && !window.confirm(`Approve: ${current.pendingAction?.type}?\n\n${current.pendingAction?.reason ?? ""}\n\nThis action has real consequences.`)) return;
    setBusy(true);
    try {
      const r = await api<{ result: string }>(`/api/aston/incidents/${current.id}`, { method: "POST", body: JSON.stringify({ action, ...(action === "approve" ? { confirm: true } : {}) }) });
      setCaption(r.result);
      speak(r.result);
      await load();
    } catch (e: any) {
      setCaption(e?.message ?? "That didn't work.");
    } finally { setBusy(false); }
  };

  const enableAlerts = async () => {
    if (typeof Notification === "undefined") return;
    setPerm(await Notification.requestPermission());
  };

  const shown = mode === "idle" && current && !sub ? (current.summary ?? current.title) : caption;

  return (
    <main className="aston-bg relative flex min-h-[100dvh] flex-col items-center overflow-hidden px-4 text-slate-200">
      <div className="aston-waves pointer-events-none absolute inset-0" aria-hidden />
      <header className="relative z-10 flex w-full max-w-6xl items-center justify-between pt-6">
        <span className="aston-word">ASTON</span>
        <span className="text-[11px] tracking-wide text-slate-500">{aiLine(data?.ai ?? null)}</span>
      </header>

      <section className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 pb-8">
        <button
          type="button"
          onClick={() => (speechOk ? listen() : document.getElementById("aston-input")?.focus())}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
          aria-label={speechOk ? (mode === "listening" ? "Stop listening" : "Talk to ASTON") : "Type to ASTON"}
        >
          <AstonOrb state={state} size={400} paused={!!builder || showSites || (!!tele && !tele.min)} />
        </button>

        <div className="max-w-2xl text-center" aria-live="polite">
          <p className="text-lg font-light leading-relaxed text-slate-300 sm:text-xl">{shown}</p>
          {sub && <p className="mt-2 text-sm text-slate-500">{sub}</p>}
          <p className="mt-4 text-[12px] tracking-wide text-slate-500">
            Status: <span className={state === "attention" ? "font-semibold text-amber-300" : "font-semibold text-slate-200"}>{STATUS_WORD[state]}</span>
            {open.length > 1 && <> · {focus % open.length + 1} of {open.length}</>}
          </p>
        </div>

        {current && mode === "idle" && (
          <div className="flex max-w-2xl flex-col items-center gap-3 text-[13px]">
            {details && (
              <div className="space-y-1 text-left text-slate-400">
                {current.project && <p><span className="text-slate-500">Project</span> · {current.project}</p>}
                <p><span className="text-slate-500">Problem</span> · {current.title}</p>
                {current.detail && <p className="whitespace-pre-line"><span className="text-slate-500">Details</span> · {current.detail}</p>}
                <p><span className="text-slate-500">Tried</span> · {current.recovery.length ? current.recovery.map((s) => `${s.action} (${s.ok ? "ok" : "failed"})`).join("; ") : "nothing automatic — needs you"}</p>
                {current.recommendation && <p><span className="text-slate-500">Next</span> · {current.recommendation}</p>}
                {current.verifyNote && <p className="text-slate-500">{current.verifyNote}</p>}
              </div>
            )}
            <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-slate-400">
              <button className="aston-link" onClick={() => setDetails((v) => !v)}>{details ? "Hide details" : "Details"}</button>
              <button className="aston-link" disabled={busy} onClick={() => act("acknowledge")}>Acknowledge</button>
              <button className="aston-link" disabled={busy} onClick={() => act("resolve")}>Resolve</button>
              {current.pendingAction && <>
                <button className="aston-link text-amber-300" disabled={busy} onClick={() => act("approve")}>Approve {current.pendingAction.type}</button>
                <button className="aston-link" disabled={busy} onClick={() => act("reject")}>Decline</button>
              </>}
              {open.length > 1 && <button className="aston-link" onClick={() => { setFocus((f) => f + 1); setDetails(false); }}>Next</button>}
            </nav>
          </div>
        )}
      </section>

      <footer className="relative z-10 w-full max-w-xl pb-6">
        <form onSubmit={(e) => { e.preventDefault(); const t = text; setText(""); send(t); }}>
          <input
            id="aston-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={speechOk ? "Tap the orb to talk, or type…" : "Type to ASTON…"}
            className="w-full border-0 border-b border-slate-700/60 bg-transparent px-1 py-2 text-center text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-400/60 focus:outline-none"
            maxLength={2000}
            autoComplete="off"
          />
        </form>
        <div className="mt-3 flex justify-center gap-5 text-[11px] text-slate-600">
          {perm === "default" && <button className="aston-link" onClick={enableAlerts}>Enable desktop alerts</button>}
          {perm === "denied" && <span>Desktop alerts blocked in this browser</span>}
          <button className="aston-link" onClick={() => { setVoiceOn((v) => !v); if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }}>{voiceOn ? "Voice on" : "Voice off"}</button>
          <button className="aston-link" onClick={() => setTele(tele?.min ? { ...tele, min: false } : { key: Date.now(), library: true })}>Scripts</button>
          <button className="aston-link" onClick={() => setShowSites(true)}>Websites</button>
          {error && <span className="text-amber-400/80">{error}</span>}
        </div>
      </footer>
      {builder && <SiteBuilder key={builder} siteId={builder} onClose={() => { setBuilder(null); setBuilding(false); }} onSpeak={speak} onBusy={setBuilding} />}
      {tele && (
        <Teleprompter key={tele.key} request={tele.request} library={tele.library} hidden={!!tele.min}
          onClose={() => setTele(null)} onMinimize={() => setTele((t) => (t ? { ...t, min: true } : t))} onSpeak={speak} />
      )}
      {tele?.min && (
        <button className="tpg-restore" onClick={() => setTele((t) => (t ? { ...t, min: false } : t))} aria-label="Reopen the teleprompter">
          <span aria-hidden>▤</span> Teleprompter
        </button>
      )}
      {showSites && !builder && <SiteList onOpen={(id) => { setShowSites(false); setBuilder(id); }} onClose={() => setShowSites(false)} />}
    </main>
  );
}
