"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The orb's ears and voice.
 *
 * Ears: the chosen microphone → voice-activity detection → each utterance is
 * recorded and transcribed by JARVIS (/api/voice/stt, keys stay on the server).
 * - "wake": always listening for the wake phrase ("JARVIS, open Chrome"); the
 *   wake phrase alone opens an 8-second window for the command.
 * - "push": listens only after you press the mic button or Ctrl+Alt+Space.
 * - "off": typing only.
 * The microphone is only open while a mode needs it, and `live` says so — the
 * orb never shows "listening" without a real, granted microphone.
 *
 * Voice: JARVIS's own voice (/api/voice/tts), falling back to the system voice.
 * Speaking stops the moment you start a new command (or talk over it).
 */
export type VoiceMode = "wake" | "push" | "off";
export type EarState = "off" | "armed" | "recording" | "transcribing";

const wakeRe = (phrase: string) => new RegExp(`^\\s*(?:(?:hey|ok|okay|hi)\\s+)?${phrase.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b[,.!:\\s]*`, "i");

/** "Hey JARVIS, open Chrome" → { woke: true, rest: "open Chrome" }. Pure (tested). */
export function splitWake(text: string, phrase = "jarvis"): { woke: boolean; rest: string } {
  const m = text.match(wakeRe(phrase));
  return m ? { woke: true, rest: text.slice(m[0].length).trim() } : { woke: false, rest: text.trim() };
}

export function useOrbVoice(o: {
  mode: VoiceMode; wakePhrase: string; micId: string; volume: number; rate: number;
  onCommand: (text: string) => void; onWake: () => void; onError: (msg: string) => void;
}) {
  const [ear, setEar] = useState<EarState>("off");
  const [live, setLive] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const opts = useRef(o); opts.current = o;
  const mic = useRef<{ stream: MediaStream; ctx: AudioContext; an: AnalyserNode } | null>(null);
  const level = useRef(0);
  const outLevel = useRef(0);
  const pushArmed = useRef(false);
  const wakeUntil = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const outAn = useRef<{ ctx: AudioContext; an: AnalyserNode } | null>(null);
  const speakingRef = useRef(false);
  const speakId = useRef(0);

  const stopSpeaking = useCallback(() => {
    speakId.current++;
    try { audio.current?.pause(); } catch { /* already stopped */ }
    audio.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* none */ }
    speakingRef.current = false; setSpeaking(false); outLevel.current = 0;
  }, []);

  const speak = useCallback(async (text: string) => {
    stopSpeaking();
    const t = text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim().slice(0, 600);
    if (!t) return;
    const id = ++speakId.current;
    const current = () => id === speakId.current && speakingRef.current;
    speakingRef.current = true; setSpeaking(true);
    try {
      const r = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t, agent: "jarvis" }) });
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      if (!current()) return; // interrupted while it was fetched
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      el.volume = opts.current.volume; el.playbackRate = opts.current.rate;
      audio.current = el;
      try {
        outAn.current ??= (() => { const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 512; an.connect(ctx.destination); return { ctx, an }; })();
        outAn.current.ctx.createMediaElementSource(el).connect(outAn.current.an);
      } catch { /* metering is optional */ }
      await new Promise<void>((res) => { el.onended = () => res(); el.onerror = () => res(); el.onpause = () => res(); el.play().catch(() => res()); });
      URL.revokeObjectURL(url);
    } catch {
      // no JARVIS voice configured → the system's own voice
      if (current() && "speechSynthesis" in window) await new Promise<void>((res) => {
        const u = new SpeechSynthesisUtterance(t); u.rate = opts.current.rate; u.volume = opts.current.volume;
        u.onend = () => res(); u.onerror = () => res(); window.speechSynthesis.speak(u);
      });
    } finally {
      if (id === speakId.current) { speakingRef.current = false; setSpeaking(false); outLevel.current = 0; audio.current = null; }
    }
  }, [stopSpeaking]);

  // output meter for the SPEAKING animation
  useEffect(() => {
    let raf = 0; const buf = new Uint8Array(256);
    const tick = () => { raf = requestAnimationFrame(tick); if (!speakingRef.current) { outLevel.current = 0; return; }
      if (outAn.current && audio.current) { outAn.current.an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += ((v - 128) / 128) ** 2; outLevel.current = Math.sqrt(s / buf.length); }
      else outLevel.current = 0.12 + Math.random() * 0.08; // system voice: no meter available — a gentle shimmer, never silence
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    setEar("transcribing");
    try {
      const f = new FormData(); f.append("audio", blob, "speech.webm");
      const r = await fetch("/api/voice/stt", { method: "POST", body: f });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { opts.current.onError(r.status === 401 && (!j?.error || /authentication required/i.test(j.error)) ? "Sign in to JARVIS to use voice (type any message and press Sign in)." : r.status === 423 ? "JARVIS is locked — unlock it to use voice." : j?.error ?? "Speech recognition didn't answer."); return; }
      const text = String(j.data.text || "").trim();
      if (!text) return;
      const { woke, rest } = splitWake(text, opts.current.wakePhrase);
      const viaWake = opts.current.mode === "wake";
      if (viaWake && !woke && Date.now() > wakeUntil.current) return; // not for JARVIS
      if (woke && !rest) { wakeUntil.current = Date.now() + 8000; opts.current.onWake(); return; }
      wakeUntil.current = 0;
      opts.current.onCommand(woke ? rest : text);
    } finally { setEar(mic.current ? "armed" : "off"); }
  }, []);

  // the microphone, with voice-activity detection
  useEffect(() => {
    const needMic = o.mode === "wake" || o.mode === "push";
    if (!needMic) { setLive(false); setEar("off"); return; }
    let stopped = false, raf = 0, rec: MediaRecorder | null = null, chunks: Blob[] = [], speechMs = 0, silenceMs = 0, startedAt = 0, last = performance.now(), floor = 0.01, overSpeech = 0;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: o.micId ? { exact: o.micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(an);
        mic.current = { stream, ctx, an };
        setLive(true); setEar("armed"); setMicError(null);
        const buf = new Float32Array(an.fftSize);
        const loop = (now: number) => {
          raf = requestAnimationFrame(loop);
          const dt = now - last; last = now;
          an.getFloatTimeDomainData(buf);
          let s = 0; for (const v of buf) s += v * v;
          const rms = Math.sqrt(s / buf.length);
          level.current = rms;
          if (!rec) floor = floor * 0.995 + Math.min(rms, 0.05) * 0.005;
          const thr = Math.max(0.018, floor * 3) * (speakingRef.current ? 2.2 : 1);
          const listening = opts.current.mode === "wake" || pushArmed.current;
          // talking over JARVIS interrupts it
          if (speakingRef.current) { overSpeech = rms > thr ? overSpeech + dt : 0; if (overSpeech > 280) stopSpeaking(); }
          if (!listening) return;
          if (!rec) {
            if (rms > thr) { speechMs += dt; if (speechMs > 120) start(stream); } else speechMs = 0;
            return;
          }
          if (rms > thr * 0.7) silenceMs = 0; else silenceMs += dt;
          if (silenceMs > 900 || now - startedAt > 12_000) finish();
        };
        const start = (stream: MediaStream) => {
          const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
          rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
          chunks = []; silenceMs = 0; startedAt = performance.now();
          rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
          rec.start(200); setEar("recording");
        };
        const finish = () => {
          const r = rec; rec = null; speechMs = 0;
          if (!r) return;
          const long = performance.now() - startedAt;
          r.onstop = () => { pushArmed.current = false; if (long > 450 && chunks.length) void transcribe(new Blob(chunks, { type: r.mimeType || "audio/webm" })); else setEar("armed"); };
          try { r.stop(); } catch { setEar("armed"); }
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        setLive(false); setEar("off");
        const name = (e as { name?: string })?.name;
        setMicError(name === "NotAllowedError" ? "Microphone access was blocked — allow it for JARVIS (Windows: Settings → Privacy → Microphone) and try again." : name === "NotFoundError" || name === "OverconstrainedError" ? "That microphone isn't connected — pick another one in settings." : "The microphone couldn't start.");
      }
    })();
    return () => {
      stopped = true; cancelAnimationFrame(raf);
      try { rec?.stop(); } catch { /* stopped */ }
      if (mic.current) { mic.current.stream.getTracks().forEach((t) => t.stop()); void mic.current.ctx.close().catch(() => {}); mic.current = null; }
      setLive(false); setEar("off"); level.current = 0;
    };
  }, [o.mode, o.micId, transcribe, stopSpeaking]);

  /** Push-to-talk: listen for the next thing you say. */
  const pushToTalk = useCallback(() => {
    stopSpeaking();
    if (!mic.current) { opts.current.onError(o.mode === "off" ? "Voice is off — turn it on in the orb's settings." : micError ?? "The microphone isn't ready yet."); return false; }
    pushArmed.current = true; wakeUntil.current = Date.now() + 8000;
    setTimeout(() => { if (pushArmed.current && ear !== "recording") pushArmed.current = false; }, 8000);
    return true;
  }, [stopSpeaking, o.mode, ear, micError]);

  return { ear, live, speaking, micError, speak, stopSpeaking, pushToTalk, micLevel: () => level.current, outLevel: () => outLevel.current, armed: () => pushArmed.current };
}
