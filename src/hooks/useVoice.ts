"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useVoice — the JARVIS realtime voice engine (client side).
 *
 * Pipeline: microphone → voice-activity detection → capture → /api/voice/stt
 * (ElevenLabs STT) → transcript callback. Replies come back as text and are
 * spoken via /api/voice/tts (ElevenLabs streaming TTS) piped into an <audio>
 * element. While JARVIS speaks, the mic keeps monitoring so the user can
 * interrupt (barge-in): sustained speech stops playback and starts capturing.
 *
 * The ElevenLabs API key never touches the browser — all provider calls go
 * through our server routes.
 */

export type VoiceStatus =
  | "uninitialized"
  | "requesting"
  | "unconfigured"
  | "denied"
  | "error"
  | "idle" // ready, not actively listening (voice disabled)
  | "listening" // waiting for speech
  | "recording" // capturing speech
  | "processing" // transcribing
  | "speaking"; // playing JARVIS reply

interface UseVoiceOptions {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  autoListen?: boolean;
}

// VAD tuning (normalized RMS 0..1)
const SPEECH_START = 0.05;
const SPEECH_START_WHILE_SPEAKING = 0.14; // higher bar for barge-in
const SILENCE_HANG_MS = 850;
const MIN_UTTERANCE_MS = 350;

export function useVoice({ onTranscript, onError, autoListen = true }: UseVoiceOptions) {
  const [status, setStatus] = useState<VoiceStatus>("uninitialized");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [enabled, setEnabledState] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechStartedAtRef = useRef<number>(0);
  const lastVoiceAtRef = useRef<number>(0);
  const capturingRef = useRef(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Free browser speech-to-text (Web Speech API) — used when ElevenLabs STT
  // isn't configured, so voice input works with no key and no cost.
  const recognitionRef = useRef<any>(null);
  const browserSTTRef = useRef(false); // true = transcribe with the browser
  const wantRecogRef = useRef(false); // whether recognition should be running
  const recogActiveRef = useRef(false);
  const recognitionSupported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Refs mirror state for use inside the rAF loop without re-subscribing.
  const statusRef = useRef<VoiceStatus>("uninitialized");
  const mutedRef = useRef(false);
  const enabledRef = useRef(true);
  const supported =
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const setStatusBoth = useCallback((s: VoiceStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const fail = useCallback(
    (message: string, s: VoiceStatus = "error") => {
      setError(message);
      setStatusBoth(s);
      onError?.(message);
    },
    [onError, setStatusBoth],
  );

  // --- Recording lifecycle ------------------------------------------------
  const startCapture = useCallback(() => {
    // In browser-STT mode the SpeechRecognition engine handles capture itself.
    if (browserSTTRef.current) return;
    if (capturingRef.current || !streamRef.current) return;
    try {
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => void finalizeCapture();
      rec.start();
      recorderRef.current = rec;
      capturingRef.current = true;
      speechStartedAtRef.current = Date.now();
      setStatusBoth("recording");
    } catch (e) {
      fail("Could not start recording.");
    }
    // finalizeCapture is referenced via rec.onstop and is intentionally read
    // lazily (defined below); adding it to deps would hit a temporal dead zone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fail, setStatusBoth]);

  const finalizeCapture = useCallback(async () => {
    capturingRef.current = false;
    const duration = Date.now() - speechStartedAtRef.current;
    const blob = new Blob(chunksRef.current, {
      type: recorderRef.current?.mimeType || "audio/webm",
    });
    chunksRef.current = [];

    if (duration < MIN_UTTERANCE_MS || blob.size < 1200) {
      // Too short — likely a noise blip. Resume listening.
      if (enabledRef.current && !mutedRef.current) setStatusBoth("listening");
      return;
    }

    setStatusBoth("processing");
    try {
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      const res = await fetch("/api/voice/stt", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        fail(json.error || "Transcription failed.", "error");
        // Recover to listening after surfacing the error.
        setTimeout(() => enabledRef.current && !mutedRef.current && setStatusBoth("listening"), 1200);
        return;
      }
      const text: string = (json.data?.text ?? "").trim();
      if (text) {
        onTranscript(text);
        // Fallback re-arm: if the consumer doesn't move the mic to "speaking"
        // itself (e.g. EDITH speaks via its own TTS, not voice.speak), resume
        // listening so the NEXT command is heard. Guarded on "processing" so it
        // never overrides a real speaking/recording transition.
        setTimeout(() => {
          if (enabledRef.current && !mutedRef.current && statusRef.current === "processing") {
            setStatusBoth("listening");
          }
        }, 2500);
      } else if (enabledRef.current && !mutedRef.current) {
        setStatusBoth("listening");
      }
    } catch {
      fail("Network error during transcription.", "error");
      setTimeout(() => enabledRef.current && !mutedRef.current && setStatusBoth("listening"), 1200);
    }
  }, [fail, onTranscript, setStatusBoth]);

  const stopCapture = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  // --- Free browser speech recognition (STT) -----------------------------
  const startRecognition = useCallback(() => {
    if (!recognitionSupported) return;
    wantRecogRef.current = true;
    if (recogActiveRef.current) return;
    let r = recognitionRef.current;
    if (!r) {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      r = new SR();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.onstart = () => { recogActiveRef.current = true; if (statusRef.current !== "speaking") setStatusBoth("listening"); };
      r.onspeechstart = () => { if (statusRef.current === "listening") setStatusBoth("recording"); };
      r.onresult = (ev: any) => {
        let text = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) text += ev.results[i][0].transcript;
        }
        text = text.trim();
        if (!text) return;
        setStatusBoth("processing");
        onTranscript(text);
        // If the consumer doesn't move us to "speaking", re-arm listening.
        setTimeout(() => {
          if (enabledRef.current && !mutedRef.current && statusRef.current === "processing") setStatusBoth("listening");
        }, 2500);
      };
      r.onerror = (e: any) => {
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
          wantRecogRef.current = false;
          fail("Microphone permission denied for speech recognition.", "denied");
        }
        // "no-speech"/"aborted"/"network" → onend will restart if still wanted.
      };
      r.onend = () => {
        recogActiveRef.current = false;
        if (wantRecogRef.current && enabledRef.current && !mutedRef.current && statusRef.current !== "speaking") {
          try { r.start(); } catch { /* already starting */ }
        }
      };
      recognitionRef.current = r;
    }
    try { r.start(); } catch { /* start throws if already running */ }
  }, [recognitionSupported, onTranscript, setStatusBoth, fail]);

  const stopRecognition = useCallback(() => {
    wantRecogRef.current = false;
    const r = recognitionRef.current;
    if (r && recogActiveRef.current) { try { r.abort(); } catch { /* ignore */ } }
  }, []);

  // --- Metering + VAD loop ------------------------------------------------
  const loop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    setLevel(rms);

    const now = Date.now();
    const s = statusRef.current;

    if (enabledRef.current && !mutedRef.current) {
      const speaking = s === "speaking";
      const threshold = speaking ? SPEECH_START_WHILE_SPEAKING : SPEECH_START;

      if (rms > threshold) {
        lastVoiceAtRef.current = now;
        if (speaking) {
          // Barge-in: user interrupts JARVIS.
          stopSpeaking();
          if (browserSTTRef.current) startRecognition();
          else startCapture();
        } else if (s === "listening" && !browserSTTRef.current) {
          startCapture();
        }
      }

      if (capturingRef.current && now - lastVoiceAtRef.current > SILENCE_HANG_MS) {
        stopCapture();
      }
    }

    rafRef.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCapture, stopCapture, startRecognition]);

  // --- Public: initialize (must be called from a user gesture) -----------
  const init = useCallback(async () => {
    if (!supported) {
      fail("Your browser doesn't support the microphone API.", "unconfigured");
      return false;
    }
    setStatusBoth("requesting");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Prepare the playback element (created once).
      if (!audioElRef.current) {
        const el = new Audio();
        el.autoplay = false;
        audioElRef.current = el;
      }

      // Decide STT engine: use the free browser recognizer when server STT
      // (ElevenLabs) isn't configured — so voice input works with no key.
      const cfg = await fetch("/api/voice/config").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const serverStt = !!cfg?.data?.configured;
      browserSTTRef.current = !serverStt && recognitionSupported;

      enabledRef.current = true;
      setEnabledState(true);
      setStatusBoth(autoListen ? "listening" : "idle");
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
      if (browserSTTRef.current && autoListen) startRecognition();
      return true;
    } catch (e: any) {
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        fail("Microphone permission was denied.", "denied");
      } else if (e?.name === "NotFoundError") {
        fail("No microphone was found.", "error");
      } else {
        fail("Could not access the microphone.", "error");
      }
      return false;
    }
  }, [autoListen, fail, loop, setStatusBoth, supported, recognitionSupported, startRecognition]);

  // --- Public: speak (streaming TTS) -------------------------------------
  const stopSpeaking = useCallback(() => {
    const el = audioElRef.current;
    if (el) {
      el.pause();
      if (el.src) {
        URL.revokeObjectURL(el.src);
        el.removeAttribute("src");
        el.load();
      }
    }
    // Also stop any browser-native speech in progress.
    try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ }
  }, []);

  /**
   * Free, built-in voice via the browser's Web Speech API — no ElevenLabs, no
   * API key, no cost. Used automatically when server TTS isn't configured. Picks
   * a calm British-leaning voice for JARVIS when one is available.
   */
  const speakBrowser = useCallback((text: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") { resolve(); return; }
      try {
        synth.cancel();
        const voices = synth.getVoices();
        const pick =
          voices.find((v) => /daniel|arthur|google uk english male|ryan|george/i.test(v.name) && /en-GB|en_GB/i.test(v.lang)) ||
          voices.find((v) => /en-GB|en_GB/i.test(v.lang) && /male/i.test(v.name)) ||
          voices.find((v) => /en-GB|en_GB/i.test(v.lang)) ||
          voices.find((v) => /^en(-|_)/i.test(v.lang)) ||
          voices[0];
        const u = new SpeechSynthesisUtterance(text);
        if (pick) { u.voice = pick; u.lang = pick.lang; }
        u.rate = 1.0;   // steady, natural pace
        u.pitch = 0.9;  // slightly lower — calm and confident
        u.onend = () => resolve();
        u.onerror = () => resolve();
        synth.speak(u);
      } catch {
        resolve();
      }
    });
  }, []);

  // Warm up the browser voice list (Chrome loads it async) so the right voice
  // is picked on the very first spoken reply.
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    const warm = () => { try { synth.getVoices(); } catch { /* ignore */ } };
    warm();
    synth.addEventListener?.("voiceschanged", warm);
    return () => synth.removeEventListener?.("voiceschanged", warm);
  }, []);

  const speak = useCallback(
    async (text: string): Promise<void> => {
      if (!enabledRef.current || mutedRef.current) return;
      const el = audioElRef.current;
      if (!el || !text.trim()) return;
      // Pause the recognizer while JARVIS speaks so it doesn't hear its own voice.
      if (browserSTTRef.current) stopRecognition();
      try {
        setStatusBoth("speaking");
        const res = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }).catch(() => null);
        // No server voice configured (or the request failed) → speak with the
        // free built-in browser voice instead of going silent.
        if (!res || !res.ok) {
          await speakBrowser(text);
          if (enabledRef.current && !mutedRef.current && statusRef.current === "speaking") setStatusBoth("listening");
          if (browserSTTRef.current && enabledRef.current && !mutedRef.current) startRecognition();
          return;
        }
        const blob = await res.blob();
        stopSpeaking();
        const url = URL.createObjectURL(blob);
        el.src = url;
        await new Promise<void>((resolve) => {
          const done = () => {
            el.removeEventListener("ended", done);
            el.removeEventListener("error", done);
            resolve();
          };
          el.addEventListener("ended", done);
          el.addEventListener("error", done);
          el.play().catch(() => done());
        });
      } catch {
        fail("Could not play the reply.", "error");
      } finally {
        if (enabledRef.current && !mutedRef.current && statusRef.current === "speaking") {
          setStatusBoth("listening");
        }
        // Resume the free recognizer once JARVIS has finished speaking.
        if (browserSTTRef.current && enabledRef.current && !mutedRef.current) startRecognition();
      }
    },
    [fail, setStatusBoth, stopSpeaking, speakBrowser, stopRecognition, startRecognition],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
      if (next) {
        stopCapture();
        if (browserSTTRef.current) stopRecognition();
        if (statusRef.current === "listening") setStatusBoth("idle");
      } else if (enabledRef.current && statusRef.current === "idle") {
        setStatusBoth("listening");
        if (browserSTTRef.current) startRecognition();
      }
      return next;
    });
  }, [setStatusBoth, stopCapture, startRecognition, stopRecognition]);

  const setEnabled = useCallback(
    (on: boolean) => {
      enabledRef.current = on;
      setEnabledState(on);
      if (!on) {
        stopCapture();
        stopRecognition();
        stopSpeaking();
        setStatusBoth("idle");
      } else if (streamRef.current) {
        setStatusBoth("listening");
        if (browserSTTRef.current) startRecognition();
      }
    },
    [setStatusBoth, stopCapture, stopSpeaking, startRecognition, stopRecognition],
  );

  // --- Public: stop (put JARVIS to sleep, release the mic) ---------------
  const stop = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    stopCapture();
    stopRecognition();
    stopSpeaking();
    capturingRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    setLevel(0);
    setMuted(false); mutedRef.current = false;
    enabledRef.current = true; setEnabledState(true);
    setStatusBoth("uninitialized");
  }, [setStatusBoth, stopCapture, stopSpeaking, stopRecognition]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      wantRecogRef.current = false;
      try { recognitionRef.current?.abort(); } catch { /* ignore */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      stopSpeaking();
    };
  }, [stopSpeaking]);

  return {
    status,
    level,
    muted,
    enabled,
    error,
    supported,
    init,
    speak,
    stopSpeaking,
    stop,
    toggleMute,
    setEnabled,
  };
}
