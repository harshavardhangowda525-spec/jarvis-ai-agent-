"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, CheckCircle2, XCircle, Loader2, Play, Square } from "lucide-react";
import { runCaller, type CallerIO } from "@/lib/calls/loop";
import { splitSentences, normLang, type Lang } from "@/lib/calls/rules";

/**
 * JARVIS — Calls. JARVIS's own helper on your Windows laptop (started with
 * JARVIS, no orb needed) opens this window by itself and starts calling.
 * JARVIS dials through Phone Link (your own number), speaks into the call
 * through the VB-Audio virtual cable, and hears the other side from the
 * speakers.
 */
interface Phone {
  check: () => Promise<{ ok: boolean; installed?: boolean; running?: boolean; cable?: boolean; simulated?: boolean; error?: string }>;
  dial: (to: string) => Promise<{ ok: boolean; error?: string }>;
  hangup: () => Promise<unknown>;
  state: () => Promise<{ ok: boolean; inCall?: boolean }>;
  working: (text: string | null) => void;
}
type PhoneOp = (op: string, arg?: string | null) => Promise<Record<string, unknown>>;
declare global { interface Window { jarvisDesktop?: { phone?: Phone; onEvent?: (cb: (e: { type: string }) => void) => () => void }; __jarvisPhone?: PhoneOp } }

/** The phone controls: from JARVIS's helper on the laptop (or, on older setups, the desktop orb). */
function getPhone(): Phone | undefined {
  if (typeof window === "undefined") return undefined;
  const op = window.__jarvisPhone;
  if (op) {
    return {
      check: () => op("check") as ReturnType<Phone["check"]>,
      dial: (to) => op("dial", to) as ReturnType<Phone["dial"]>,
      hangup: () => op("hangup"),
      state: () => op("state") as ReturnType<Phone["state"]>,
      working: (text) => { void op("working", text).catch(() => {}); },
    };
  }
  return window.jarvisDesktop?.phone;
}

type Check = { label: string; ok: boolean | null; detail?: string };
type Line = { who: "jarvis" | "them" | "info"; text: string; at: number };

const LS = "jarvis-caller-sink";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/prospects/calls/caller", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (r.status === 401) throw new Error("Sign in to JARVIS in this window first.");
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `JARVIS answered ${r.status}`);
  return j.data as Record<string, unknown>;
}

/** Voice-activity detection on the call audio → one utterance → speech-to-text. */
function makeEars(stream: MediaStream) {
  const ctx = new AudioContext();
  const an = ctx.createAnalyser(); an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  let floor = 0.004;
  const level = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); };
  const listen = async (maxWaitMs: number, stopped: () => boolean): Promise<string | null> => {
    const t0 = performance.now();
    let speech = 0, last = performance.now();
    // wait for speech to start
    for (;;) {
      if (stopped()) return null;
      await sleep(30);
      const now = performance.now(), dt = now - last; last = now;
      const rms = level();
      const thr = Math.max(0.012, floor * 3);
      if (rms > thr) { speech += dt; if (speech > 150) break; } else { speech = 0; floor = floor * 0.98 + Math.min(rms, 0.03) * 0.02; }
      if (now - t0 > maxWaitMs) return null;
    }
    // record until ~0.9 s of silence (max 15 s)
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    rec.start(200);
    const start = performance.now(); let silent = 0; last = performance.now();
    while (performance.now() - start < 15_000 && !stopped()) {
      await sleep(30);
      const now = performance.now(), dt = now - last; last = now;
      if (level() > Math.max(0.009, floor * 2.2)) silent = 0; else silent += dt;
      if (silent > 650) break; // a short pause ends their turn — quicker replies
    }
    rec.stop(); await done;
    if (performance.now() - start < 350) return "";
    const f = new FormData(); f.append("audio", new Blob(chunks, { type: rec.mimeType || "audio/webm" }), "call.webm");
    const r = await fetch("/api/voice/stt", { method: "POST", body: f }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    const text = String(j?.data?.text ?? "").replace(/\[[^\]]*\]|\([^)]*\)|♪/g, " ").replace(/\s+/g, " ").trim();
    lastLang = normLang(j?.data?.language);
    return text;
  };
  let lastLang: Lang | null = null;
  // talking over JARVIS: louder than the room for a moment (JARVIS's own voice goes into the cable, not the speakers)
  const bargeThr = () => Math.max(0.025, floor * 4);
  return { listen, level, bargeThr, heardLang: () => lastLang, close: () => void ctx.close().catch(() => {}) };
}

export function CallerApp() {
  const [phone] = useState(getPhone);
  const [checks, setChecks] = useState<Check[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [sink, setSink] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [wait, setWait] = useState<string>("");
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [hear, setHear] = useState(0);
  const stop = useRef(false);
  const stream = useRef<MediaStream | null>(null);
  const ears = useRef<ReturnType<typeof makeEars> | null>(null);

  useEffect(() => { try { setSink(localStorage.getItem(LS) ?? ""); } catch { /* none */ } }, []);
  useEffect(() => window.jarvisDesktop?.onEvent?.((e) => { if (e.type === "stop") { stop.current = true; void phone?.hangup(); } }), [phone]);

  const devices = useCallback(async () => {
    // labels need one microphone grant (audio only); the track is closed straight away
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); } catch { /* labels may be blank */ }
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
    setOutputs(all);
    const cable = all.find((d) => /CABLE Input/i.test(d.label));
    setSink((cur) => cur || cable?.deviceId || "");
    return { all, cable };
  }, []);

  const ensureEars = useCallback(async () => {
    if (ears.current && stream.current?.getAudioTracks().some((t) => t.readyState === "live")) return ears.current;
    let s: MediaStream | null = null;
    try {
      s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: "include" } as DisplayMediaStreamOptions);
      s.getVideoTracks().forEach((t) => t.stop());
      if (!s.getAudioTracks().length) s = null;
    } catch { s = null; }
    if (!s) {
      // backup: the laptop's own "Stereo Mix" recording device (the speakers' sound), if Windows has it switched on
      const mix = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === "audioinput" && /stereo mix|what u hear|wave out|loopback/i.test(d.label));
      if (mix) s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: mix.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).catch(() => null);
    }
    if (!s || !s.getAudioTracks().length) throw new Error("JARVIS couldn't hear the computer's sound. In Windows Sound settings → Recording, right-click → Show disabled devices → enable \"Stereo Mix\", then restart JARVIS.");
    stream.current = s; ears.current = makeEars(s);
    return ears.current;
  }, []);

  /** JARVIS's own voice into the call, sentence by sentence (the next one is made while this one plays); stops if they talk over it. */
  const speak = useCallback(async (text: string, lang: Lang): Promise<{ interrupted: boolean }> => {
    const make = async (part: string) => {
      const r = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: part, agent: "jarvis", lang }) });
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.error ?? `JARVIS's voice failed (${r.status}).`); }
      return URL.createObjectURL(await r.blob());
    };
    const parts = splitSentences(text);
    const ear = ears.current;
    let next: Promise<string> | null = parts.length ? make(parts[0]) : null;
    try {
      for (let i = 0; i < parts.length; i++) {
        const url = await next!;
        next = i + 1 < parts.length ? make(parts[i + 1]) : null;
        const el = new Audio(url) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (sink && el.setSinkId) await el.setSinkId(sink);
        const cut = await new Promise<boolean>((res) => {
          let talk = 0, last = performance.now(), done = false;
          const end = (v: boolean) => { if (done) return; done = true; clearInterval(iv); res(v); };
          const iv = setInterval(() => {
            const now = performance.now(), dt = now - last; last = now;
            if (stop.current) { el.pause(); end(true); return; }
            if (!ear) return;
            if (ear.level() > ear.bargeThr()) { talk += dt; if (talk > 300) { el.pause(); end(true); } } else talk = Math.max(0, talk - dt / 2);
          }, 30);
          el.onended = () => end(false); el.onerror = () => end(false); el.play().catch(() => end(false));
        });
        URL.revokeObjectURL(url);
        if (cut) { next?.then((u) => URL.revokeObjectURL(u)).catch(() => {}); return { interrupted: !stop.current }; }
      }
      return { interrupted: false };
    } catch (e) {
      // no voice = JARVIS can't talk on the call: stop calling and say why
      setErr((e as Error).message); stop.current = true;
      return { interrupted: false };
    }
  }, [sink]);

  const runChecks = useCallback(async (): Promise<boolean> => {
    setErr(null);
    const list: Check[] = [];
    const set = (c: Check) => { list.push(c); setChecks([...list]); };
    if (!phone) { set({ label: "JARVIS on your laptop", ok: false, detail: "JARVIS opens this window by itself on your Windows laptop when calling is switched on (start JARVIS with npm run local)." }); return false; }
    const pc: Awaited<ReturnType<Phone["check"]>> = await phone.check().catch((e) => ({ ok: false, error: (e as Error).message }));
    set({ label: "Phone Link installed", ok: !!pc.installed, detail: pc.installed ? undefined : pc.error ?? "Install Phone Link from the Microsoft Store." });
    set({ label: "Phone Link running, phone connected", ok: !!pc.running, detail: pc.running ? "Make sure Calls are set up in Phone Link (Bluetooth)." : "Open Phone Link and connect your Android phone." });
    set({ label: "VB-Audio virtual cable", ok: !!pc.cable, detail: pc.cable ? undefined : "Install VB-CABLE (vb-audio.com/Cable), then restart." });
    const { cable } = await devices();
    set({ label: "JARVIS speaks into: CABLE Input", ok: !!(sink || cable), detail: sink || cable ? "In Windows Sound settings, set Phone Link's microphone (input) to \"CABLE Output\"." : "Pick the CABLE Input speaker below." });
    try { const r = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Test.", agent: "jarvis" }) }); set({ label: "JARVIS's voice", ok: r.ok, detail: r.ok ? (r.headers.get("X-Voice")?.startsWith("jarvis-local") ? "JARVIS's own voice (on this PC)" : undefined) : r.status === 503 ? "Not installed yet — restart JARVIS with npm run local (it downloads its own voice once)." : `Failed (${r.status}): ${(await r.json().catch(() => null))?.error ?? "no reason given"}` }); }
    catch { set({ label: "JARVIS's voice", ok: false, detail: "Couldn't reach JARVIS." }); }
    try { await ensureEars(); set({ label: "JARVIS hears the call (speakers)", ok: true }); } catch (e) { set({ label: "JARVIS hears the call (speakers)", ok: false, detail: (e as Error).message }); }
    return list.every((c) => c.ok);
  }, [phone, devices, sink, ensureEars]);

  // live "can it hear?" meter
  useEffect(() => { const t = setInterval(() => setHear(ears.current ? Math.min(1, ears.current.level() * 12) : 0), 150); return () => clearInterval(t); }, []);

  const start = useCallback(async () => {
    if (!(await runChecks())) { setErr("Fix the red items first — JARVIS doesn't call until the setup checks pass."); return; }
    stop.current = false; setRunning(true); setLines([]);
    const io: CallerIO = {
      api: post,
      dial: (to) => phone!.dial(to),
      hangup: async () => { await phone!.hangup(); },
      inCall: async () => { const s = await phone!.state().catch(() => null); return s?.ok ? !!s.inCall : null; },
      speak,
      listen: async (ms) => (await ensureEars()).listen(ms, () => stop.current),
      heardLang: () => ears.current?.heardLang() ?? null,
      label: (t) => phone!.working(t),
      log: (l) => setLines((x) => [...x.slice(-80), { ...l, at: Date.now() }]),
      sleep: async (ms) => { const end = Date.now() + ms; while (Date.now() < end && !stop.current) await sleep(Math.min(500, end - Date.now())); },
      now: () => Date.now(),
      stopped: () => stop.current,
    };
    try { await runCaller(io, { onWait: setWait }); } catch (e) { setErr((e as Error).message); } finally { setRunning(false); phone?.working(null); }
  }, [runChecks, phone, speak, ensureEars]);

  // opened by JARVIS (?auto=1): start by itself; if a check fails, look again every minute
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || !phone || typeof window === "undefined" || new URLSearchParams(window.location.search).get("auto") !== "1") return;
    auto.current = true;
    let alive = true;
    void (async () => { while (alive && !stop.current) { await start(); if (!alive || stop.current) break; await sleep(60_000); } })();
    return () => { alive = false; };
  }, [phone, start]);

  const halt = () => { stop.current = true; void phone?.hangup(); phone?.working(null); };

  return (
    <div className="min-h-dvh bg-[#06101a] p-4 text-sm text-white/85">
      <div className="mb-3 flex items-center gap-2">
        <Phone className="h-5 w-5 text-cyan-300" />
        <h1 className="text-base font-semibold text-white">JARVIS — Calls</h1>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${running ? "border-cyan-400/50 text-cyan-200" : "border-white/15 text-white/55"}`}>{running ? "Calling on" : "Off"}</span>
      </div>
      <p className="mb-3 text-xs text-white/55">
        JARVIS calls only the leads you approved in the CRM, through Phone Link, inside your calling hours. It always says it&apos;s an AI assistant, and stops for good if someone asks not to be called. With Settings → Phone calls → <b>Through the laptop</b>, it also calls <b>you</b> from here when work is done or needs your OK, and talks with you.
      </p>

      <div className="mb-3 rounded-xl border border-white/10 p-3">
        <div className="mb-2 flex items-center justify-between"><b className="text-white">Setup check</b><button type="button" className="text-xs text-cyan-300 hover:underline" onClick={() => void runChecks()}>Run check</button></div>
        {!checks.length && <p className="text-xs text-white/50">Run the check before calling (your manual: test Phone Link and the audio routing before each session).</p>}
        <ul className="space-y-1.5">{checks.map((c) => (
          <li key={c.label} className="flex gap-2 text-xs">
            {c.ok === null ? <Loader2 className="h-4 w-4 animate-spin" /> : c.ok ? <CheckCircle2 className="h-4 w-4 flex-none text-emerald-400" /> : <XCircle className="h-4 w-4 flex-none text-red-400" />}
            <span><span className="text-white">{c.label}</span>{c.detail ? <span className="block text-white/55">{c.detail}</span> : null}</span>
          </li>))}
        </ul>
        <label className="mt-3 block text-xs text-white/60">JARVIS&apos;s voice goes to
          <select value={sink} onChange={(e) => { setSink(e.target.value); try { localStorage.setItem(LS, e.target.value); } catch { /* ok */ } }} onFocus={() => void devices()} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5">
            <option value="">Default speaker (not into the call)</option>
            {outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Speaker"}</option>)}
          </select>
        </label>
        <div className="mt-2 flex items-center gap-2 text-xs text-white/55">Hearing the call <span className="h-1.5 flex-1 overflow-hidden rounded bg-white/10"><span className="block h-full bg-cyan-400 transition-all" style={{ width: `${Math.round(hear * 100)}%` }} /></span></div>
      </div>

      <div className="mb-3 flex gap-2">
        {!running
          ? <button type="button" onClick={() => void start()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 font-semibold text-black hover:bg-cyan-400"><Play className="h-4 w-4" /> Start calling</button>
          : <button type="button" onClick={halt} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 px-3 py-2 font-semibold text-white hover:bg-red-400"><PhoneOff className="h-4 w-4" /> Hang up &amp; stop</button>}
        {running && <button type="button" onClick={() => { stop.current = true; }} title="Finish this call, then stop" className="rounded-xl border border-white/15 px-3 py-2 text-xs"><Square className="h-4 w-4" /></button>}
      </div>
      {err && <p className="mb-2 text-xs text-red-300">{err}</p>}
      {running && wait && <p className="mb-2 text-xs text-white/55">{wait}</p>}

      <div className="rounded-xl border border-white/10 p-3">
        <b className="text-white">This session</b>
        <ul className="mt-2 max-h-[46vh] space-y-1.5 overflow-y-auto text-xs">
          {lines.map((l, i) => (
            <li key={i} className={l.who === "info" ? "text-white/45" : l.who === "jarvis" ? "text-cyan-200" : "text-white"}>
              {l.who === "jarvis" ? "JARVIS: " : l.who === "them" ? "Them: " : ""}{l.text}
            </li>))}
          {!lines.length && <li className="text-white/45">Nothing yet.</li>}
        </ul>
      </div>
    </div>
  );
}
