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
          startCapture();
        } else if (s === "listening") {
          startCapture();
        }
      }

      if (capturingRef.current && now - lastVoiceAtRef.current > SILENCE_HANG_MS) {
        stopCapture();
      }
    }

    rafRef.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCapture, stopCapture]);

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

      enabledRef.current = true;
      setEnabledState(true);
      setStatusBoth(autoListen ? "listening" : "idle");
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
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
  }, [autoListen, fail, loop, setStatusBoth, supported]);

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
  }, []);

  const speak = useCallback(
    async (text: string): Promise<void> => {
      if (!enabledRef.current || mutedRef.current) return;
      const el = audioElRef.current;
      if (!el || !text.trim()) return;
      try {
        setStatusBoth("speaking");
        const res = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          fail(j.error || "Voice generation failed.", "error");
          if (enabledRef.current && !mutedRef.current) setStatusBoth("listening");
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
      }
    },
    [fail, setStatusBoth, stopSpeaking],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
      if (next) {
        stopCapture();
        if (statusRef.current === "listening") setStatusBoth("idle");
      } else if (enabledRef.current && statusRef.current === "idle") {
        setStatusBoth("listening");
      }
      return next;
    });
  }, [setStatusBoth, stopCapture]);

  const setEnabled = useCallback(
    (on: boolean) => {
      enabledRef.current = on;
      setEnabledState(on);
      if (!on) {
        stopCapture();
        stopSpeaking();
        setStatusBoth("idle");
      } else if (streamRef.current) {
        setStatusBoth("listening");
      }
    },
    [setStatusBoth, stopCapture, stopSpeaking],
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
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
    toggleMute,
    setEnabled,
  };
}
