"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { claimRecognizer, releaseRecognizer, type Holder } from "@/lib/voice/mic-lock";

/**
 * Wake-word + double-clap detector. While JARVIS is "asleep" (voice engine not
 * started) this listens ambiently and fires onWake when it hears either:
 *   - two claps in quick succession (Web Audio amplitude transients), or
 *   - the phrase "Jarvis wake up" / "hey Jarvis" (browser SpeechRecognition).
 *
 * It only arms itself once microphone permission is already granted, so it
 * never triggers an unexpected permission prompt on page load. The first time,
 * the user enables the mic via the normal "Enable JARVIS Voice" button; after
 * that the grant persists and wake works on later visits.
 *
 * All processing is client-side. SpeechRecognition is Chrome/Edge only; where
 * it's unavailable, double-clap still works.
 */
export type WakeVia = "clap" | "voice";

interface Options {
  enabled: boolean;
  onWake: (via: WakeVia) => void;
}

interface WakeState {
  armed: boolean;
  micGranted: boolean;
  speechSupported: boolean;
  /** Request mic permission explicitly (for a "turn on wake" affordance). */
  requestPermission: () => Promise<void>;
}

const CLAP_THRESHOLD = 0.55; // peak amplitude (0..1) that counts as a clap
const CLAP_MIN_GAP = 200; // ms between the two claps (debounce one clap's frames)
const CLAP_MAX_GAP = 1200; // ms window in which the second clap must land

export function useWakeWord({ enabled, onWake }: Options): WakeState {
  const [micGranted, setMicGranted] = useState(false);
  const [armed, setArmed] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;
  const firedRef = useRef(false);

  useEffect(() => {
    setSpeechSupported(
      typeof window !== "undefined" &&
        !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    );
  }, []);

  // Track microphone permission without prompting.
  useEffect(() => {
    let perm: PermissionStatus | null = null;
    const nav = navigator as any;
    if (!nav?.permissions?.query) return;
    nav.permissions
      .query({ name: "microphone" })
      .then((p: PermissionStatus) => {
        perm = p;
        setMicGranted(p.state === "granted");
        p.onchange = () => setMicGranted(p.state === "granted");
      })
      .catch(() => {});
    return () => { if (perm) perm.onchange = null; };
  }, []);

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicGranted(true);
    } catch {
      /* denied — nothing to do */
    }
  }, []);

  useEffect(() => {
    if (!enabled || !micGranted) {
      setArmed(false);
      return;
    }
    firedRef.current = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let raf = 0;
    let rec: any = null;
    let stopped = false;

    // The "hey JARVIS" listener is the lowest priority user of the microphone: the
    // moment a voice engine takes the recognizer, it lets go of everything at once
    // (an open clap-detector mic would stop the real recognizer from hearing).
    const teardown = () => {
      stopped = true;
      setArmed(false);
      cancelAnimationFrame(raf);
      if (rec) { try { rec.onend = null; rec.onresult = null; rec.abort(); } catch { /* noop */ } rec = null; }
      if (audioCtx) { try { void audioCtx.close(); } catch { /* noop */ } audioCtx = null; }
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    };
    const holder: Holder = { id: Symbol("wake"), name: "wake", standDown: teardown };

    const wake = (via: WakeVia) => {
      if (firedRef.current || stopped) return;
      firedRef.current = true;
      // let go of the mic BEFORE the voice engine starts, so it hears from the first word
      teardown();
      releaseRecognizer(holder.id);
      onWakeRef.current(via);
    };

    // --- Double-clap detection (Web Audio) ---
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        audioCtx = new Ctx();
        const src = audioCtx!.createMediaStreamSource(stream);
        const analyser = audioCtx!.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let clapCount = 0;
        let lastClap = 0;

        const tick = () => {
          if (stopped) return;
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i++) {
            const d = Math.abs(data[i] - 128);
            if (d > peak) peak = d;
          }
          const level = peak / 128;
          const now = performance.now();
          if (level > CLAP_THRESHOLD && now - lastClap > CLAP_MIN_GAP) {
            clapCount = now - lastClap < CLAP_MAX_GAP ? clapCount + 1 : 1;
            lastClap = now;
            if (clapCount >= 2) {
              clapCount = 0;
              wake("clap");
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        setArmed(true);
      } catch {
        setArmed(false);
      }
    })();

    // --- Wake phrase (browser SpeechRecognition) ---
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    // only when no voice engine is listening (never take the recognizer from one)
    if (SR && claimRecognizer(holder)) {
      try {
        rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        rec.onresult = (e: any) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = String(e.results[i][0].transcript || "").toLowerCase();
            const hasJarvis = t.includes("jarvis") || t.includes("javis") || t.includes("jervis");
            const hasWake = t.includes("wake") || t.includes("hey ") || t.includes("hello");
            if (hasJarvis && hasWake) { wake("voice"); return; }
          }
        };
        rec.onerror = () => {};
        rec.onend = () => { if (!stopped && !firedRef.current && rec) { setTimeout(() => { if (!stopped && !firedRef.current && rec) { try { rec.start(); } catch { /* already started */ } } }, 150); } };
        rec.start();
      } catch {
        rec = null;
      }
    }

    return () => {
      teardown();
      releaseRecognizer(holder.id);
    };
  }, [enabled, micGranted]);

  return { armed, micGranted, speechSupported, requestPermission };
}
