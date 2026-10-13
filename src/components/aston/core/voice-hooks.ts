"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { phraseSilenceMs } from "@/lib/aston/core-state";
import { stripWake } from "@/lib/aston/scripts/format";
import { isEcho, isSelfSpeaking } from "@/lib/aston/voice";
import type { CoreSignal } from "./geometry";

const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const SR = () => (typeof window === "undefined" ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null);

export type LevelSource = "microphone" | "speech-events" | null;

/**
 * Microphone loudness for the core while ASTON listens. On desktop it reads
 * the real input level (Web Audio analyser). Phones can't reliably share the
 * microphone between speech recognition and an analyser, so there the level
 * comes from the recogniser's own events (it hears sound → `bump()`).
 */
export function useMicLevel(active: boolean, signal: MutableRefObject<CoreSignal>): { source: LevelSource; bump: (v?: number) => void } {
  const [source, setSource] = useState<LevelSource>(null);
  const bump = useCallback((v = 0.65) => { signal.current.level = Math.max(signal.current.level, v); }, [signal]);

  useEffect(() => {
    const sig = signal.current;
    if (!active) { sig.level = 0; setSource(null); return; }
    let raf = 0, stopped = false;
    let stream: MediaStream | null = null, ctx: AudioContext | null = null;
    const decay = () => { signal.current.level *= 0.9; if (!stopped) raf = requestAnimationFrame(decay); };
    const fromEvents = () => { setSource("speech-events"); raf = requestAnimationFrame(decay); };
    if (isMobile() || !navigator.mediaDevices?.getUserMedia) fromEvents();
    else {
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        ctx = new AC();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(an);
        const buf = new Uint8Array(an.fftSize);
        setSource("microphone");
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length);
          const target = Math.min(1, Math.max(0, (rms - 0.01) * 6));
          const l = signal.current.level;
          signal.current.level = target > l ? l + (target - l) * 0.5 : l + (target - l) * 0.12;
          if (!stopped) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }).catch(() => { if (!stopped) fromEvents(); });
    }
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
      sig.level = 0;
    };
  }, [active, signal]);

  return { source, bump };
}

export type WakeState = "off" | "on" | "capturing" | "unsupported" | "denied" | "needs-tap";

interface WakeHandlers {
  /** "ASTON, <command>" — or whatever was said after a bare "ASTON". */
  onCommand: (text: string) => void;
  /** A bare "ASTON": the next phrase is the command. */
  onWake: () => void;
  /** Words heard while capturing a command (shown live under the core). */
  onInterim: (text: string) => void;
  /** Nothing was said after "ASTON". */
  onTimeout: () => void;
}

const CAPTURE_MS = 8000;

/**
 * The "ASTON" wake word on the main screen. Continuous recognition that only
 * reacts to phrases starting with "ASTON"; everything else said in the room is
 * ignored, and so is ASTON's own voice. Browsers only allow this while the tab
 * is open (it stops when the tab is hidden), and Chrome sends the audio to its
 * speech service to recognise it.
 */
export function useWakeWord(enabled: boolean, h: WakeHandlers, o: { captureMs?: number } = {}): { state: WakeState; retry: () => void; capture: (resuming?: boolean) => boolean; cancel: () => void } {
  const [state, setState] = useState<WakeState>("off");
  const rec = useRef<any>(null);
  const want = useRef(enabled);
  const hs = useRef(h);
  hs.current = h;
  const captureUntil = useRef(0);
  // a capture asked for while the listener was paused (e.g. a phone, while ASTON spoke): starts with it
  const pendingCapture = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureMs = useRef(o.captureMs ?? CAPTURE_MS);
  captureMs.current = o.captureMs ?? CAPTURE_MS;
  // the phrase being spoken right now: built up across pauses until you've actually finished
  const phrase = useRef<{ buf: string; inCapture: boolean } | null>(null);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropPhrase = () => { phrase.current = null; if (silence.current) clearTimeout(silence.current); silence.current = null; };

  const endCapture = useCallback(() => {
    dropPhrase();
    pendingCapture.current = false;
    captureUntil.current = 0;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setState((s) => (s === "capturing" ? "on" : s));
  }, []);

  const beginCapture = useCallback(() => {
    captureUntil.current = Date.now() + captureMs.current;
    setState("capturing");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (captureUntil.current) { endCapture(); hs.current.onTimeout(); } }, captureMs.current);
  }, [endCapture]);

  const start = useCallback(() => {
    const Rec = SR();
    if (!Rec) { setState("unsupported"); return; }
    if (rec.current) return;
    const r = new Rec();
    r.lang = "en-IN";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.onstart = () => {
      if (pendingCapture.current) { pendingCapture.current = false; beginCapture(); }
      else setState((s) => (s === "capturing" ? s : "on"));
    };
    /** You've stopped talking: act on the whole phrase. */
    const finishPhrase = () => {
      const p = phrase.current;
      dropPhrase();
      if (!p || rec.current !== r) return;
      const said = stripWake(p.buf).text.replace(/^[\s,.:!?-]+/, "").trim();
      if (!said || /^(hi|hello|hey|are you there|you there)\??$/i.test(said)) {
        // just "ASTON": wait for the command (or keep waiting, if we already were)
        beginCapture();
        return;
      }
      if (isEcho(said)) { if (p.inCapture) beginCapture(); return; }
      endCapture();
      hs.current.onCommand(said);
    };
    r.onresult = (ev: any) => {
      if (rec.current !== r) return; // a listener that was paused/replaced — what it heard is stale
      if (isSelfSpeaking()) return; // ASTON's own voice
      let finals = "", interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        let top = String(res[0]?.transcript ?? "").trim();
        if (!top || isEcho(top)) continue; // ASTON's own sentence, handed back late by the speech service
        // not mid-phrase and not waiting for a command: only "ASTON …" starts one (any alternative)
        if (!phrase.current && !captureUntil.current) {
          let woke = false;
          for (let k = 0; k < res.length; k++) {
            const alt = String(res[k]?.transcript ?? "").trim();
            if (stripWake(alt).woke) { top = alt; woke = true; break; }
          }
          if (!woke) continue; // someone else talking in the room
          phrase.current = { buf: "", inCapture: false };
          hs.current.onWake(); // react the moment it hears "ASTON"; the command is still being said
        }
        if (!phrase.current) phrase.current = { buf: "", inCapture: !!captureUntil.current };
        if (res.isFinal) finals += " " + top; else interim += " " + top;
      }
      const p = phrase.current;
      if (!p) return;
      p.buf = (p.buf + finals).replace(/\s+/g, " ").trim();
      const live = (p.buf + interim).replace(/\s+/g, " ").trim();
      const shown = stripWake(live).text;
      if (shown) hs.current.onInterim(shown);
      // still talking: the listening window mustn't close mid-sentence
      if (captureUntil.current && timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (silence.current) clearTimeout(silence.current);
      silence.current = setTimeout(finishPhrase, phraseSilenceMs(live));
    };
    r.onerror = (ev: any) => {
      if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed" || ev?.error === "audio-capture") { want.current = false; endCapture(); setState("denied"); }
    };
    r.onend = () => {
      rec.current = null;
      if (want.current) setTimeout(() => { if (want.current && !rec.current) start(); }, 300);
      else setState((s) => (s === "denied" || s === "unsupported" ? s : "off"));
    };
    rec.current = r;
    try { r.start(); } catch { rec.current = null; setState("needs-tap"); }
  }, [beginCapture, endCapture]);

  useEffect(() => {
    want.current = enabled;
    if (enabled) start();
    else {
      if (!pendingCapture.current) endCapture();
      dropPhrase();
      // abort (not stop): stop() would still deliver what it heard so far — e.g. ASTON's own voice
      try { rec.current?.abort(); } catch { /* not running */ }
      rec.current = null;
      setState((s) => (s === "unsupported" || s === "denied" ? s : "off"));
    }
    return () => { want.current = false; try { rec.current?.abort(); } catch { /* gone */ } rec.current = null; };
  }, [enabled, start, endCapture]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (silence.current) clearTimeout(silence.current); }, []);

  /** A tap on the core while the wake word is running: take the next phrase as the command. */
  /**
   * Take the next phrase as a command. `resuming`: the listener is paused for a
   * moment (a phone lets go of the mic while ASTON speaks) — start listening as
   * soon as it's back.
   */
  const capture = useCallback((resuming = false) => {
    if (state === "denied" || state === "unsupported") return false;
    if (!rec.current) {
      if (!resuming) return false;
      pendingCapture.current = true;
      setState("capturing");
      if (timer.current) clearTimeout(timer.current);
      // if it never comes back, give up like a normal silence
      timer.current = setTimeout(() => { if (pendingCapture.current) { endCapture(); hs.current.onTimeout(); } }, captureMs.current + 3000);
      return true;
    }
    beginCapture();
    return true;
  }, [beginCapture, endCapture, state]);

  const retry = useCallback(() => { want.current = true; setState("off"); start(); }, [start]);
  return { state, retry, capture, cancel: endCapture };
}
