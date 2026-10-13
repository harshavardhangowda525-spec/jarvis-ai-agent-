"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Mic, Send, Sparkles, Square } from "lucide-react";
import { AstonCore, type RenderInfo } from "./core/aston-core";
import { coreGeometry, newSignal, type CoreGeometry } from "./core/geometry";
import { HoloWindow, RadialMenu, type MenuId, type WindowId } from "./core/holo";
import { useMicLevel, useWakeWord } from "./core/voice-hooks";
import {
  ActivityBody, AiBody, AlertsBody, ConversationBody, DEFAULT_PREFS, DiagnosticsBody, loadPrefs, PrefsBody, savePrefs, VoiceBody,
  type AiStatus, type Diag, type Prefs, type Turn,
} from "./core/windows";
import { SiteBuilder, SiteList } from "./site-builder";
import { Teleprompter } from "./teleprompter";
import { WEBSITE_INTENT } from "@/lib/aston/site/assemble";
import { CONVERSATION_LISTEN_MS, coreState, defaultLine, isCallMeRequest, isConversationEnd, navIntent, phraseSilenceMs, STATE_WORD } from "@/lib/aston/core-state";
import { useRouter } from "next/navigation";
import { markSelfSpeech, rememberSpoken, setPreferredVoiceName } from "@/lib/aston/voice";
import { sayLine, stopSpeaking } from "./core/speech";
import { isOpenOnly, SCRIPT_INTENT, stripWake } from "@/lib/aston/scripts/format";
import type { IncidentDTO } from "@/lib/aston/types";

interface BrowserAlert { id: string; incidentId: string; priority: string; title: string; summary: string; project: string | null }
interface StateData { incidents: IncidentDTO[]; browserAlerts: BrowserAlert[]; ai: AiStatus }
interface Fault { kind: "server" | "mic" | "chat" | "action" | "voice"; msg: string; action?: { label: string; run: () => void } }

const POLL_MS = 15_000;
const TICK_MS = 2 * 60_000;
const REPLY_MS = 25_000;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  return j.data as T;
}

const TITLES: Record<WindowId, [string, string]> = {
  alerts: ["Alerts", "Builds, deploys, sites and agents"],
  ai: ["AI provider", "Groq — the only AI ASTON uses"],
  voice: ["Voice", "How ASTON speaks and listens"],
  conversation: ["Conversation", "This visit"],
  activity: ["Agent activity", "JARVIS, ULTRON, DARWIN, ROBIN and ASTON — since yesterday"],
  diagnostics: ["Diagnostics", "Live system check"],
  preferences: ["Preferences", "Saved in this browser"],
};

/**
 * ASTON — Project AETHER. One living holographic core, one line of status and
 * one command bar. Everything else (alerts, AI status, voice, conversation,
 * activity, diagnostics, preferences, websites, scripts) unfolds out of the
 * core from the radial menu, only when asked for.
 */
export function AstonConsole() {
  const router = useRouter();
  const [data, setData] = useState<StateData | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [mode, setMode] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [caption, setCaption] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [speechOk, setSpeechOk] = useState(false);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [fault, setFault] = useState<Fault | null>(null);
  const [builder, setBuilder] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [showSites, setShowSites] = useState(false);
  const [tele, setTele] = useState<{ key: number; request?: string; library?: boolean; min?: boolean } | null>(null);
  const [menu, setMenu] = useState(false);
  const [win, setWin] = useState<WindowId | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [render, setRender] = useState<RenderInfo | null>(null);
  const [micPerm, setMicPerm] = useState("Not asked yet");
  const [wordSync, setWordSync] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(true);
  const [geo, setGeo] = useState<CoreGeometry>({ cx: 0, cy: 0, u: 0 });
  const [hour, setHour] = useState(12);
  const [reduced, setReduced] = useState(false);
  const [voices, setVoices] = useState(0);
  const [oneShot, setOneShot] = useState(false);
  // the wake listener pauses while ASTON speaks, so it never hears ASTON's own voice
  const [ttsBusy, setTtsBusy] = useState(false);
  const mobileRef = useRef(false);
  const [lastSpeech, setLastSpeech] = useState<"ok" | "blocked" | "failed" | "unsupported" | null>(null);
  // hands-free conversation: after each answer ASTON listens again, no wake word needed
  const [convoOn, setConvoOn] = useState(false);
  const convo = useRef(false);
  const continueRef = useRef<() => void>(() => {});
  const endConvoRef = useRef<(line?: string | null) => void>(() => {});
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const signal = useRef(newSignal());
  const history = useRef<Turn[]>([]);
  const recog = useRef<any>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  // While the teleprompter is open you're talking to a client: ASTON stays quiet
  const teleRef = useRef(false);
  teleRef.current = !!tele && !tele.min;
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMsg = useRef("");
  const wasBuilding = useRef(false);

  const open = (data?.incidents ?? []).filter((i) => i.status === "open" && (i.priority === "critical" || i.priority === "high"));
  const current = open[focus % Math.max(1, open.length)] ?? null;
  const alertCount = (data?.incidents ?? []).filter((i) => i.status === "open" || i.status === "acknowledged").length;
  const state = coreState({ mode, executing: building || approving, fault: !!fault, attention: open.length > 0 });

  // ------------------------------------------------------------ layout + preferences
  useEffect(() => {
    const p = loadPrefs();
    setPrefsState(p);
    setHour(new Date().getHours());
    mobileRef.current = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const fit = () => setGeo(coreGeometry(window.innerWidth, window.innerHeight));
    fit();
    window.addEventListener("resize", fit);
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    setReduced(!!mq?.matches);
    const onMq = () => setReduced(!!mq?.matches);
    mq?.addEventListener?.("change", onMq);
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    const clock = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => { window.removeEventListener("resize", fit); mq?.removeEventListener?.("change", onMq); document.removeEventListener("visibilitychange", onVis); clearInterval(clock); };
  }, []);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((cur) => { const next = { ...cur, ...p }; savePrefs(next); return next; });
    if (p.voice === false) stopSpeaking();
  }, []);

  /** The line under the core. Replies stay for a while, then the greeting returns. */
  const say = useCallback((line: string | null, ms = REPLY_MS) => {
    setCaption(line);
    if (captionTimer.current) clearTimeout(captionTimer.current);
    captionTimer.current = line ? setTimeout(() => { setCaption(null); setSub(null); }, ms) : null;
  }, []);

  const remember = useCallback((role: Turn["role"], content: string) => {
    history.current = [...history.current, { role, content }].slice(-20);
    setTurns((t) => [...t, { role, content, at: Date.now() }].slice(-60));
  }, []);

  // ------------------------------------------------------------ speech out
  /** Say a line. `then` runs when it has been spoken (not when it's cut off). Returns false if nothing will be spoken. */
  const speak = useCallback((line: string, force = false, then?: () => void): boolean => {
    if (!prefsRef.current.voice && !force) return false;
    let words = false;
    signal.current.wordSync = false;
    // the listener pauses while ASTON talks (every device): it can't hear ASTON's own voice,
    // and phones need the microphone to let go of the audio before ASTON can be heard
    setTtsBusy(true);
    rememberSpoken(line);
    const ok = sayLine(line, {
      delayMs: mobileRef.current ? 350 : 120,
      // the online voice is blocked here: remember the on-device one so the next line starts straight away
      onFallback: (local) => { setPreferredVoiceName(local.name); },
      onStart: () => { markSelfSpeech(true); setMode("speaking"); setLastSpeech("ok"); },
      // each spoken word pulses the core (when the voice reports word timings)
      onWord: () => { words = true; signal.current.wordSync = true; signal.current.pulse = 1; },
      onDone: (f) => {
        markSelfSpeech(false);
        signal.current.wordSync = false;
        setTtsBusy(false);
        setMode((m) => (m === "speaking" ? "idle" : m));
        if (f === "cut") return; // replaced by another line: nothing else to do
        if (!f) { setWordSync(words); then?.(); return; }
        // never stay silent without saying why
        setLastSpeech(f === "not-allowed" ? "blocked" : "failed");
        const retry = () => { setFault(null); speak(line, true, then); };
        setFault(f === "not-allowed"
          ? { kind: "voice", msg: "The browser blocked ASTON's voice until you click on the page once.", action: { label: "Turn on voice", run: retry } }
          : { kind: "voice", msg: "ASTON's voice didn't play. Check the PC's volume and sound output (taskbar speaker icon), or pick a \"Microsoft\" voice in ✦ → Voice.", action: { label: "Try again", run: retry } });
        then?.();
      },
    });
    if (!ok) { setTtsBusy(false); setLastSpeech("unsupported"); }
    return ok;
  }, []);

  // ------------------------------------------------------------ state + alerts
  const load = useCallback(async () => {
    try {
      const d = await api<StateData>("/api/aston/state");
      setData(d);
      setServerOk(true);
      setLastSync(Date.now());
      setFault((f) => (f?.kind === "server" ? null : f));
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
      setServerOk(false);
      const msg = e?.status === 403 ? "This account is not the ASTON owner." : e?.status === 401 ? "You've been signed out — sign in again to reach ASTON." : "Can't reach ASTON's server. Retrying every 15 seconds.";
      setFault({ kind: "server", msg, action: e?.status === 401 ? { label: "Sign in", run: () => { location.href = "/login?next=/aston"; } } : { label: "Retry now", run: () => { load(); } } });
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
    let onVoices: (() => void) | null = null;
    if (typeof speechSynthesis !== "undefined") {
      onVoices = () => setVoices(speechSynthesis.getVoices().length);
      onVoices();
      speechSynthesis.addEventListener?.("voiceschanged", onVoices);
    }
    // microphone permission, where the browser can report it
    let status: PermissionStatus | null = null;
    const label = (s: string) => (s === "granted" ? "Allowed" : s === "denied" ? "Blocked" : "Not asked yet");
    navigator.permissions?.query({ name: "microphone" as PermissionName }).then((s) => { status = s; setMicPerm(label(s.state)); s.onchange = () => setMicPerm(label(s.state)); }).catch(() => setMicPerm("Unknown (browser doesn't say)"));
    return () => {
      clearInterval(a); clearInterval(b);
      recog.current?.abort?.();
      if (status) status.onchange = null;
      if (typeof speechSynthesis !== "undefined") { speechSynthesis.cancel(); if (onVoices) speechSynthesis.removeEventListener?.("voiceschanged", onVoices); }
    };
  }, [load]);

  // A new alert takes over the line under the core (an old reply shouldn't hide it)
  const seen = useRef<Set<string> | null>(null);
  const openIds = open.map((i) => i.id).join(",");
  useEffect(() => {
    if (!data) return;
    const ids = openIds ? openIds.split(",") : [];
    const fresh = seen.current ? ids.filter((id) => !seen.current!.has(id)) : [];
    seen.current = new Set(ids);
    if (fresh.length && mode === "idle") { say(null); setSub(null); setFocus(Math.max(0, ids.indexOf(fresh[0]))); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIds, data]);

  // ------------------------------------------------------------ tasks
  const onBuildProgress = useCallback((pct: number, done: boolean) => { signal.current.progress = done ? 1 : pct; }, []);
  useEffect(() => {
    if (building) { wasBuilding.current = true; if (signal.current.progress == null) signal.current.progress = 0; return; }
    if (wasBuilding.current) {
      wasBuilding.current = false;
      if ((signal.current.progress ?? 0) >= 1) { signal.current.flash = 1; say("Task completed successfully.", 6000); }
      signal.current.progress = null;
    }
  }, [building, say]);

  // ------------------------------------------------------------ talking
  const send = useCallback(async (content: string) => {
    const msg = content.trim();
    if (!msg) return;
    lastMsg.current = msg;
    setFault((f) => (f?.kind === "chat" || f?.kind === "mic" ? null : f));
    remember("user", msg);
    setSub(`“${msg}”`);
    say("Analyzing your request…");
    setMode("processing");
    // Scripts / pitches → the teleprompter (checked before websites: "a script for a café that needs a website")
    const bare = stripWake(msg).text;
    if (SCRIPT_INTENT.test(bare)) {
      endConvoRef.current(null); // the teleprompter takes over the microphone
      const line = isOpenOnly(msg) ? "Opening the teleprompter." : "Writing your script now — the teleprompter will open with it.";
      remember("assistant", line);
      say(line);
      setSub(null);
      setMode("idle");
      // "open teleprompter" brings back a minimised one exactly where you left it
      if (isOpenOnly(msg) && tele?.min) setTele({ ...tele, min: false });
      else setTele(isOpenOnly(msg) ? { key: Date.now() } : { key: Date.now(), request: bare });
      return;
    }
    // "Call me" / "give me a sample call": one real call to the owner's phone
    if (isCallMeRequest(msg)) {
      try {
        const r = await api<{ to: string }>("/api/aston/phone/call", { method: "POST" });
        const line = `Calling you now on ${r.to}. Pick up to hear your sample alert.`;
        remember("assistant", line);
        say(line, 15000);
        setSub(null);
        setMode("idle");
        speak(line);
      } catch (e: any) {
        setMode("idle");
        say(null);
        setSub(null);
        endConvoRef.current(null);
        setFault({ kind: "action", msg: e?.message ?? "The sample call didn't go through.", action: { label: "Open Diagnostics", run: () => { setFault(null); setWin("diagnostics"); } } });
      }
      return;
    }
    // "Open JARVIS", "go to DARWIN", "show my tasks": switch to that page.
    const page = navIntent(msg);
    if (page) {
      const line = `Opening ${page.label}.`;
      remember("assistant", line);
      say(line);
      setSub(null);
      setMode("idle");
      endConvoRef.current(null);
      speak(line);
      // let the first words play, then go (the voice carries on over the page change)
      setTimeout(() => router.push(page.href), 450);
      return;
    }
    // Website requests go straight to the builder (no extra AI round-trip).
    if (WEBSITE_INTENT.test(msg)) {
      const start = async (engine: Prefs["siteEngine"]) => {
        const site = await api<{ id: string; engineLabel?: string }>("/api/aston/sites", { method: "POST", body: JSON.stringify({ brief: msg, engine, model: prefsRef.current.claudeModel }) });
        const line = `On it. I'm building the website now${site.engineLabel ? ` with ${site.engineLabel.replace(" · your Claude Code", " on your Claude Code")}` : ""} — watch the code as I write it.`;
        remember("assistant", line);
        say(line);
        setSub(null);
        setMode("idle");
        signal.current.progress = 0;
        endConvoRef.current(null); // the builder window takes over the screen
        setBuilder(site.id);
        speak(line);
      };
      try {
        await start(prefsRef.current.siteEngine);
      } catch (e: any) {
        setMode("idle");
        say(null);
        endConvoRef.current(null);
        // Claude Code was asked for but isn't usable here: say why, and only use Groq if the owner taps it
        const viaGroq = e?.status === 409 ? { label: "Build with Groq instead", run: () => { setFault(null); setMode("processing"); start("groq").catch((x: any) => { setMode("idle"); setFault({ kind: "chat", msg: x?.message ?? "I couldn't start the website." }); }); } } : null;
        setFault({ kind: "chat", msg: e?.message ?? "I couldn't start the website.", action: viaGroq ?? { label: "Try again", run: () => send(msg) } });
      }
      return;
    }
    try {
      const r = await api<{ reply: string; ai: boolean; aiNote: string | null; changed: boolean; site?: string | null }>("/api/aston/chat", { method: "POST", body: JSON.stringify({ messages: history.current.map(({ role, content }) => ({ role, content })), site: { engine: prefsRef.current.siteEngine, model: prefsRef.current.claudeModel } }) });
      if (r.site) { signal.current.progress = 0; endConvoRef.current(null); setBuilder(r.site); }
      remember("assistant", r.reply);
      say(r.reply);
      setSub(r.ai ? null : "AI unavailable — answered from stored incidents");
      setMode("idle");
      // in a hands-free conversation, listen again once the answer has been spoken
      const next = () => continueRef.current();
      if (!speak(r.reply, false, next)) next();
      if (r.changed) load();
    } catch (e: any) {
      setMode("idle");
      say(null);
      setSub(null);
      endConvoRef.current(null);
      setFault({ kind: "chat", msg: e?.message ?? "Something went wrong.", action: { label: "Try again", run: () => send(msg) } });
    }
  }, [load, speak, tele, say, remember, router]);

  // ------------------------------------------------------------ listening
  const mic = useMicLevel(mode === "listening", signal);

  const wakeActive = prefs.wake && visible && !oneShot && !ttsBusy && !teleRef.current && !builder;
  const startConvo = () => { if (prefsRef.current.conversation) { convo.current = true; setConvoOn(true); } };
  const wake = useWakeWord(wakeActive, {
    onCommand: (t) => {
      if (modeRef.current === "processing") return; // one thing at a time
      if (convo.current && isConversationEnd(t)) { endConvoRef.current("Okay. Say “ASTON” when you need me."); speak("Okay."); return; }
      startConvo();
      setSub(null);
      send(t);
    },
    onWake: () => { startConvo(); stopSpeaking(); setMode("listening"); say(convo.current ? "I'm listening…" : "Listening for your command…", CONVERSATION_LISTEN_MS + 2000); setSub(null); },
    onInterim: (t) => { setSub(`“${t}”`); mic.bump(); },
    onTimeout: () => {
      if (convo.current) { endConvoRef.current("Conversation ended — say “ASTON” when you need me."); return; }
      setMode((m) => (m === "listening" ? "idle" : m)); say(null); setSub(null);
    },
  }, { captureMs: CONVERSATION_LISTEN_MS });

  /** End a hands-free conversation (optionally with a line under the core). */
  endConvoRef.current = (line?: string | null) => {
    const was = convo.current;
    convo.current = false;
    setConvoOn(false);
    if (!was) return;
    wake.cancel();
    setMode((m) => (m === "listening" ? "idle" : m));
    setSub(null);
    if (line) say(line, 6000);
  };
  /** After ASTON answers in a conversation: listen for the next phrase straight away. */
  continueRef.current = () => {
    if (!convo.current) return;
    if (modeRef.current === "processing") return;
    // on phones the listener was paused while ASTON spoke; it resumes and takes this phrase
    // the listener was paused while ASTON spoke; it resumes and takes this phrase
    if (wake.capture(prefsRef.current.wake)) { setMode("listening"); setSub(null); }
    else endConvoRef.current(null);
  };
  // the wake word stopped (teleprompter, builder, hidden tab, turned off): so does the conversation
  const wakeStopped = !(prefs.wake && visible && !oneShot && !teleRef.current && !builder);
  useEffect(() => { if (wakeStopped) endConvoRef.current(null); }, [wakeStopped]);
  useEffect(() => { if (wake.state === "denied") { setMicPerm("Blocked"); setFault({ kind: "mic", msg: "Microphone access is blocked, so ASTON can't listen. Allow it in the browser's site settings, or type your command.", action: { label: "Type instead", run: () => { setFault(null); document.getElementById("aston-input")?.focus(); } } }); } }, [wake.state]);

  const listen = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { document.getElementById("aston-input")?.focus(); return; }
    if (mode === "listening") {
      if (wake.state === "capturing") { wake.cancel(); setMode("idle"); say(null); setSub(null); endConvoRef.current(null); }
      else recog.current?.stop();
      return;
    }
    stopSpeaking();
    setFault((f) => (f?.kind === "mic" ? null : f));
    // the wake-word listener is already running: take its next phrase
    if (wake.capture()) { startConvo(); setMode("listening"); say(convo.current ? "I'm listening…" : "Listening for your command…", CONVERSATION_LISTEN_MS + 2000); setSub(null); return; }
    const r = new SR();
    r.lang = "en-IN";
    r.interimResults = true;
    // continuous + our own end-of-speech detection: Chrome's single-shot mode stops at the first short pause
    r.continuous = true;
    let finalText = "";
    let quiet: ReturnType<typeof setTimeout> | null = null;
    const stopAfter = (ms: number) => { if (quiet) clearTimeout(quiet); quiet = setTimeout(() => { try { r.stop(); } catch { /* ended */ } }, ms); };
    r.onstart = () => { setMode("listening"); say("Listening for your command…"); setSub(null); stopAfter(8000); /* nothing said at all */ };
    r.onsoundstart = () => mic.bump(0.35);
    r.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += " " + t; else interim += " " + t;
      }
      mic.bump();
      const soFar = (finalText + interim).trim();
      setSub(`“${soFar}”`);
      // finished once you pause properly (longer after "for", "and", "with"…)
      stopAfter(phraseSilenceMs(soFar));
    };
    r.onerror = (ev: any) => {
      setOneShot(false);
      setMode("idle");
      const e = ev?.error;
      if (e === "not-allowed" || e === "service-not-allowed" || e === "audio-capture") {
        setMicPerm("Blocked");
        setFault({ kind: "mic", msg: e === "audio-capture" ? "No microphone was found. Connect one, or type your command." : "Microphone access is blocked, so ASTON can't listen. Allow it in the browser's site settings, or type your command.", action: { label: "Type instead", run: () => { setFault(null); document.getElementById("aston-input")?.focus(); } } });
      } else if (e === "network") {
        setFault({ kind: "mic", msg: "Speech recognition needs an internet connection.", action: { label: "Try again", run: () => { setFault(null); listen(); } } });
      } else say(e === "no-speech" ? "I didn't hear anything. Tap the core and try again." : "I didn't catch that.", 6000);
    };
    r.onend = () => { if (quiet) clearTimeout(quiet); setOneShot(false); setMode((m) => (m === "listening" ? "idle" : m)); if (finalText.trim()) send(finalText); else say(null); };
    recog.current = r;
    setOneShot(true);
    try { r.start(); } catch { setOneShot(false); setMode("idle"); }
  }, [mode, send, wake, mic, say]);

  // ------------------------------------------------------------ decisions
  const act = useCallback(async (inc: IncidentDTO, action: string) => {
    if (busyId) return;
    if (action === "approve" && !window.confirm(`Approve: ${inc.pendingAction?.type}?\n\n${inc.pendingAction?.reason ?? ""}\n\nThis action has real consequences.`)) return;
    setBusyId(inc.id);
    if (action === "approve") { setApproving(true); signal.current.progress = null; say("Executing workflow…"); }
    try {
      const r = await api<{ result: string }>(`/api/aston/incidents/${inc.id}`, { method: "POST", body: JSON.stringify({ action, ...(action === "approve" ? { confirm: true } : {}) }) });
      if (action === "approve") signal.current.flash = 1;
      say(r.result);
      speak(r.result);
      setFault((f) => (f?.kind === "action" ? null : f));
      await load();
    } catch (e: any) {
      say(null);
      setFault({ kind: "action", msg: e?.message ?? "That didn't work.", action: { label: "Try again", run: () => { setFault(null); act(inc, action); } } });
    } finally { setBusyId(null); setApproving(false); }
  }, [busyId, load, say, speak]);

  const enableAlerts = async () => {
    if (typeof Notification === "undefined") return;
    setPerm(await Notification.requestPermission());
  };

  // ------------------------------------------------------------ menu + windows
  const pick = (id: MenuId) => {
    setMenu(false);
    if (id === "websites") { setWin(null); setShowSites(true); return; }
    if (id === "scripts") { setWin(null); setTele(tele?.min ? { ...tele, min: false } : { key: Date.now(), library: true }); return; }
    setWin(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || builder || showSites || (tele && !tele.min)) return;
      if (menu) setMenu(false); else if (win) setWin(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, win, builder, showSites, tele]);

  const diag: Diag = {
    serverOk, lastSync, serverError: fault?.kind === "server" ? fault.msg : null, ai: data?.ai ?? null, render,
    wake: wake.state, level: mic.source, micPerm, notif: perm === "granted" ? "On" : perm === "denied" ? "Blocked" : perm === "unsupported" ? "Not supported" : "Off",
    recognition: speechOk, synthesis: typeof window !== "undefined" && typeof speechSynthesis !== "undefined", voices, reduced: reduced || prefs.motion === "reduced", wordSync, speech: lastSpeech,
  };

  const cover = !!builder || showSites || (!!tele && !tele.min);
  const idleLine = mode === "idle" && !caption && current ? (current.summary ?? current.title) : null;
  const shown = fault && mode === "idle" ? fault.msg : caption ?? idleLine ?? defaultLine(state, hour);
  const aiDot = !data ? "dim" : !data.ai.configured || data.ai.status !== "ok" ? "warn" : "ok";
  const dot = state === "error" ? "bad" : state === "attention" ? "warn" : serverOk === false ? "bad" : aiDot;
  const vars = useMemo(() => ({ ["--cx" as string]: `${geo.cx}px`, ["--cy" as string]: `${geo.cy}px`, ["--u" as string]: `${geo.u}px` }), [geo]);
  const wakeOn = wake.state === "on" || wake.state === "capturing";
  const radius = Math.max(96, Math.min(geo.u * 1.28, geo.cx - 46, geo.cy - 112));

  return (
    <main className={`ax-root ax-s-${state}${render?.quality === "lite" ? " ax-lite" : ""}${prefs.motion === "reduced" ? " ax-reduced" : ""}`} style={vars}>
      <div className="ax-atmos" aria-hidden />
      <AstonCore
        state={state}
        signal={signal}
        paused={cover || !visible}
        quality={prefs.quality}
        parallax={prefs.parallax}
        reduceMotion={prefs.motion === "reduced"}
        onInfo={setRender}
      />
      <div className="ax-scan" aria-hidden />

      <header className={`ax-top${menu ? " ax-hide" : ""}`}>
        <span className="ax-word">ASTON AI</span>
        <span className="ax-state" role="status">
          <i className={`ax-dot ax-dot-${dot}`} aria-hidden />
          {STATE_WORD[state]}
          {data && (!data.ai.configured || data.ai.status !== "ok") && <span className="ax-state-note"> · AI {data.ai.configured ? "limited" : "offline"}</span>}
        </span>
      </header>

      {geo.u > 0 && (
        <button
          type="button"
          className="ax-core-hit"
          onClick={listen}
          aria-label={speechOk ? (mode === "listening" ? "Stop listening" : "Talk to ASTON") : "Type to ASTON"}
          title={speechOk ? (mode === "listening" ? "Stop listening" : "Tap to talk") : "Voice input isn't supported in this browser — type below"}
        />
      )}

      <div className={`ax-line${menu ? " ax-hide" : ""}`} aria-live="polite">
        <p className={`ax-caption${fault && mode === "idle" ? " ax-caption-fault" : ""}`}>{shown}</p>
        {sub && <p className="ax-sub">{sub}</p>}
        {convoOn && !fault && (
          <div className="ax-line-actions">
            <span className="ax-convo-tag"><i aria-hidden /> Conversation on — just keep talking</span>
            <button className="ax-chip" onClick={() => { endConvoRef.current(null); setMode("idle"); say(null); }}>End</button>
          </div>
        )}
        {fault?.action && mode === "idle" && (
          <div className="ax-line-actions"><button className="ax-chip ax-chip-on" onClick={fault.action.run}>{fault.action.label}</button></div>
        )}
        {!fault && idleLine && current && (
          <div className="ax-line-actions">
            <button className="ax-chip ax-chip-on" onClick={() => setWin("alerts")}>Review{open.length > 1 ? ` (${open.length})` : ""}</button>
            {current.status === "open" && <button className="ax-chip" disabled={!!busyId} onClick={() => act(current, "acknowledge")}>Acknowledge</button>}
            {open.length > 1 && <button className="ax-chip" onClick={() => setFocus((f) => f + 1)}>Next</button>}
          </div>
        )}
      </div>

      <footer className="ax-dock">
        <button className={`ax-orbit-btn${menu ? " ax-on" : ""}`} onClick={() => { setWin(null); setMenu((m) => !m); }} aria-label="Open ASTON systems menu" aria-expanded={menu}>
          <Sparkles size={18} strokeWidth={1.6} aria-hidden />
          {alertCount > 0 && <b className="ax-badge">{alertCount}</b>}
        </button>
        <form className="ax-bar" onSubmit={(e) => { e.preventDefault(); const t = text; setText(""); send(t); }}>
          <button
            type="button"
            className={`ax-wake${wakeOn ? " ax-on" : ""}${convoOn ? " ax-convo" : ""}${wake.state === "denied" ? " ax-bad" : ""}`}
            onClick={() => (wake.state === "denied" || wake.state === "needs-tap" ? wake.retry() : setPrefs({ wake: !prefs.wake }))}
            disabled={!speechOk}
            aria-pressed={prefs.wake}
            aria-label={`Hands-free: ${convoOn ? "in a conversation" : wakeOn ? "listening for ASTON" : wake.state === "denied" ? "microphone blocked" : "off"}`}
            title={!speechOk ? "Voice isn't supported in this browser" : wakeOn ? "Hands-free on — say “ASTON”, then just keep talking. Click to turn off." : wake.state === "denied" ? "Microphone blocked — click to try again" : "Hands-free off — click to talk without touching anything"}
          >
            <AudioLines size={16} strokeWidth={1.7} aria-hidden />
          </button>
          <input
            id="aston-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === "processing" ? "Processing command…" : wakeOn ? "Say “ASTON…” or type" : "Type a command…"}
            maxLength={2000}
            autoComplete="off"
            aria-label="Command"
          />
          <button type="button" className={`ax-icon-btn${mode === "listening" ? " ax-live" : ""}`} onClick={listen} disabled={!speechOk} aria-label={mode === "listening" ? "Stop listening" : "Speak a command"} title={speechOk ? undefined : "Voice input isn't supported in this browser"}>
            {mode === "listening" ? <Square size={14} aria-hidden /> : <Mic size={16} aria-hidden />}
          </button>
          <button type="submit" className="ax-icon-btn ax-send" disabled={!text.trim()} aria-label="Send command"><Send size={15} aria-hidden /></button>
        </form>
      </footer>

      <RadialMenu open={menu} cx={geo.cx} cy={geo.cy} radius={radius} badges={{ alerts: alertCount }} onPick={pick} onClose={() => setMenu(false)} />

      {win && (
        <HoloWindow title={TITLES[win][0]} sub={TITLES[win][1]} origin={{ x: geo.cx, y: geo.cy }} onClose={() => setWin(null)}>
          {win === "alerts" && <AlertsBody incidents={data?.incidents ?? null} busy={busyId} onAct={act} perm={perm} onEnableAlerts={enableAlerts} />}
          {win === "ai" && <AiBody ai={data?.ai ?? null} />}
          {win === "voice" && <VoiceBody prefs={prefs} setPrefs={setPrefs} wake={wake.state} onWakeRetry={wake.retry} micPerm={micPerm} onPreview={() => speak("Good evening. I'm ASTON. All systems are running normally, and I'll let you know the moment anything needs your attention.", true)} />}
          {win === "conversation" && <ConversationBody turns={turns} onReplay={(t) => speak(t, true)} onClear={() => { history.current = []; setTurns([]); }} />}
          {win === "activity" && <ActivityBody />}
          {win === "diagnostics" && <DiagnosticsBody d={diag} onRefresh={() => { load(); }} />}
          {win === "preferences" && <PrefsBody prefs={prefs} setPrefs={setPrefs} perm={perm} onEnableAlerts={enableAlerts} />}
        </HoloWindow>
      )}

      {builder && <SiteBuilder key={builder} siteId={builder} onClose={() => { setBuilder(null); setBuilding(false); }} onSpeak={speak} onBusy={setBuilding} onProgress={onBuildProgress} />}
      {tele && (
        <Teleprompter key={tele.key} request={tele.request} library={tele.library} hidden={!!tele.min}
          onClose={() => setTele(null)} onMinimize={() => setTele((t) => (t ? { ...t, min: true } : t))} onSpeak={speak} />
      )}
      {tele?.min && (
        <button className="tpg-restore" onClick={() => setTele((t) => (t ? { ...t, min: false } : t))} aria-label="Reopen the teleprompter">
          <span aria-hidden>▤</span> Teleprompter
        </button>
      )}
      {showSites && !builder && <SiteList onOpen={(id) => { setShowSites(false); signal.current.progress = 0; setBuilder(id); }} onClose={() => setShowSites(false)} />}
    </main>
  );
}
