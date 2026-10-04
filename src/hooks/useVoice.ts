"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { takeSentences } from "@/lib/voice/sentences";
import { ULTRON_FX, buildUltronFx, type UltronFxChain } from "@/lib/voice/ultron-fx";
import { isVoiceSilent, muteIntent, onVoiceSilent, setVoiceSilent, takeWakeGreeting } from "@/lib/voice/silence";
import { claimRecognizer, onRecognizerFree, recognizerFreeFor, recognizerHolder, releaseRecognizer, type Holder } from "@/lib/voice/mic-lock";

/** ULTRON's voice effect is on unless turned off in this browser (localStorage "jarvis.ultron.voicefx" = "off"). */
function ultronFxOn(): boolean {
  try { return localStorage.getItem("jarvis.ultron.voicefx") !== "off"; } catch { return true; }
}

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

// Voice stays ON when you switch between agents (JARVIS → DARWIN → ULTRON …):
// each agent screen has its own voice engine, so the "on" choice is remembered
// for this browser tab and every screen switches its mic back on when it opens.
// Muting or stopping voice clears it.
const VOICE_ON_KEY = "jarvis.voice.on";
export function voiceWasOn(): boolean {
  try { return sessionStorage.getItem(VOICE_ON_KEY) === "1"; } catch { return false; }
}
function rememberVoiceOn(on: boolean) {
  try { if (on) sessionStorage.setItem(VOICE_ON_KEY, "1"); else sessionStorage.removeItem(VOICE_ON_KEY); } catch { /* storage blocked */ }
}

/**
 * Call once in an agent screen: if voice was on in the previous screen, turn it
 * on here too (after the previous screen has released the microphone). Returns
 * true while that's in progress, so a wake-word listener can stay out of the way.
 */
export function useResumeVoice(start: () => unknown, delayMs = 350): boolean {
  const startRef = useRef(start);
  startRef.current = start;
  const [resuming, setResuming] = useState(() => typeof window !== "undefined" && voiceWasOn());
  useEffect(() => {
    if (!voiceWasOn()) { setResuming(false); return; }
    setResuming(true);
    const t = setTimeout(async () => {
      try { await startRef.current(); } finally { setResuming(false); }
    }, delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  return resuming;
}

/** A reply being spoken while it's still streaming in (see speakStream). */
export interface SpeechStream {
  /** Add newly-arrived reply text; finished sentences start playing right away. */
  push: (delta: string) => void;
  /** The reply is complete — speak what's left, then go back to listening. */
  end: () => void;
}

/** Which agent's voice this hook speaks with — selects a distinct timbre. */
export type VoiceProfile = "jarvis" | "ev" | "darwin" | "ultron" | "mike" | "robin";

interface UseVoiceOptions {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  autoListen?: boolean;
  /** Agent persona whose voice to use (server TTS voice + free browser voice). */
  voiceProfile?: VoiceProfile;
}

// Free browser-voice tuning per agent, so each one sounds distinct even with no
// ElevenLabs key. rate/pitch shape the delivery; `match` picks a fitting system
// voice, `female` biases the fallback search.
const BROWSER_VOICE: Record<VoiceProfile, { rate: number; pitch: number; match: RegExp; female: boolean }> = {
  // Calm, authoritative British male.
  jarvis: { rate: 1.0, pitch: 0.9, match: /daniel|arthur|google uk english male|ryan|george/i, female: false },
  // Bright, energetic — a lively female voice for the marketing agent.
  ev: { rate: 1.08, pitch: 1.12, match: /aria|jenny|samantha|google us english|libby|sonia|zira/i, female: true },
  // Warm, friendly male — like a sharp buddy. Natural pace, a touch lower than
  // JARVIS so the two are still easy to tell apart.
  darwin: { rate: 1.0, pitch: 0.82, match: /guy|david|alex|aaron|google uk english male|rishi/i, female: false },
  // Deep, cold and deliberate for ULTRON — slow and as low as the browser voice goes.
  // Calm, measured analyst — steady pace, mid-low pitch.
  mike: { rate: 1.02, pitch: 0.95, match: /brian|christopher|guy|google us english|tom|alex/i, female: false },
  // Friendly, organised, professional male — a touch brisk.
  robin: { rate: 1.04, pitch: 0.98, match: /eric|andrew|ryan|mark|guy|google us english|david/i, female: false },
  ultron: { rate: 0.86, pitch: 0.4, match: /george|thomas|fred|google uk english male|rishi|daniel/i, female: false },
};

// VAD tuning (normalized RMS 0..1)
const SPEECH_START = 0.05;
const SPEECH_START_WHILE_SPEAKING = 0.14; // higher bar for barge-in
const SILENCE_HANG_MS = 850;
const MIN_UTTERANCE_MS = 260; // a quick "hi" is real speech
// Never stay deaf: a reply that isn't actually playing, or a transcription that
// never comes back, hands the mic back after this long.
const STUCK_SPEAKING_MS = 15_000;
const STUCK_PROCESSING_MS = 35_000;
const TTS_TIMEOUT_MS = 20_000;
const STT_TIMEOUT_MS = 30_000;
const timeout = (ms: number): AbortSignal | undefined => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(ms) : undefined);

export function useVoice({ onTranscript, onError, autoListen = true, voiceProfile = "jarvis" }: UseVoiceOptions) {
  const profileRef = useRef<VoiceProfile>(voiceProfile);
  profileRef.current = voiceProfile;

  const [status, setStatus] = useState<VoiceStatus>("uninitialized");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [enabled, setEnabledState] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState(""); // live interim words being heard
  // "mute": the agent stays quiet (replies on screen only) but keeps listening — one setting for every agent
  const silentRef = useRef(false);
  const [silent, setSilent] = useState(false);

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
  // Bumped whenever speech is stopped (barge-in, a new reply…) so queued
  // sentences from an older reply know not to play.
  const speechGenRef = useRef(0);
  const cancelPlaybackRef = useRef<(() => void) | null>(null); // ends the current streamed clip
  // Loudness envelope of each spoken clip (decoded separately — playback itself is
  // untouched), so visuals can follow the rhythm of JARVIS's own voice.
  const envelopesRef = useRef(new Map<string, Float32Array>());
  // ULTRON's voice effect: the audio element is routed through Web Audio once
  // ULTRON first speaks (other agents on this element then pass straight through).
  const fxRef = useRef<{ ctx: AudioContext; source: MediaElementAudioSourceNode; chain: UltronFxChain | null; wired: "fx" | "dry" | null } | null>(null);

  // Free browser speech-to-text (Web Speech API) — used when ElevenLabs STT
  // isn't configured, so voice input works with no key and no cost.
  const recognitionRef = useRef<any>(null);
  const browserSTTRef = useRef(false); // true = transcribe with the browser
  const wantRecogRef = useRef(false); // whether recognition should be running
  const recogActiveRef = useRef(false);
  const startRecognitionRef = useRef<(force?: boolean) => void>(() => {}); // latest startRecognition
  // This screen has closed: nothing it left running (a reply finishing, a timer,
  // a slow microphone request) may start the mic again — the new screen owns it.
  const disposedRef = useRef(false);
  // Who this engine is to the one-recognizer-at-a-time referee (see mic-lock).
  const ownerRef = useRef<Holder | null>(null);
  const recogErrorsRef = useRef(0);
  const statusSinceRef = useRef(0);
  const lastAudibleRef = useRef(0);
  const initRef = useRef<Promise<boolean> | null>(null);
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
    if (disposedRef.current) return;
    if (statusRef.current !== s) statusSinceRef.current = Date.now();
    if (s === "speaking") lastAudibleRef.current = Date.now();
    statusRef.current = s;
    setStatus(s);
  }, []);

  /**
   * Hand what you said to the agent — except "mute" / "unmute", which every agent
   * handles the same way, right here. Returns true when it was one of those.
   */
  const muteCmdRef = useRef<(text: string) => boolean>(() => false);
  const deliver = (text: string) => { if (muteCmdRef.current(text)) return; onTranscriptRef.current(text); };
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

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
    if (mutedRef.current) { chunksRef.current = []; return; } // muted: nothing you said is used
    const duration = Date.now() - speechStartedAtRef.current;
    const blob = new Blob(chunksRef.current, {
      type: recorderRef.current?.mimeType || "audio/webm",
    });
    chunksRef.current = [];

    if (duration < MIN_UTTERANCE_MS || blob.size < 900) {
      // Too short — likely a noise blip. Resume listening.
      if (enabledRef.current && !mutedRef.current) setStatusBoth("listening");
      return;
    }

    setStatusBoth("processing");
    try {
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      const res = await fetch("/api/voice/stt", { method: "POST", body: form, signal: timeout(STT_TIMEOUT_MS) });
      const json = await res.json();
      if (!res.ok) {
        const msg: string = json.error || "Transcription failed.";
        // ElevenLabs key missing/invalid → switch to the FREE browser recognizer
        // for the rest of the session (releasing the mic so it can capture).
        if (recognitionSupported && (res.status === 401 || res.status === 403 || res.status === 503 || /invalid|unauthor|api key|not configured/i.test(msg))) {
          browserSTTRef.current = true;
          if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          audioCtxRef.current?.close().catch(() => {});
          audioCtxRef.current = null;
          analyserRef.current = null;
          setError(null);
          if (enabledRef.current && !mutedRef.current) startRecognitionRef.current(true);
          return;
        }
        fail(msg, "error");
        // Recover to listening after surfacing the error.
        setTimeout(() => enabledRef.current && !mutedRef.current && setStatusBoth("listening"), 1200);
        return;
      }
      const text: string = (json.data?.text ?? "").trim();
      if (text) {
        deliver(text);
        // Fallback re-arm: if the consumer doesn't move the mic to "speaking"
        // itself (e.g. ULTRON speaks via its own TTS, not voice.speak), resume
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
  }, [fail, setStatusBoth, recognitionSupported]);

  const stopCapture = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  // --- Free browser speech recognition (STT) -----------------------------
  /** This engine's identity for the one-recognizer referee: standing down stops our recognizer without restarting it. */
  const owner = (): Holder => {
    if (!ownerRef.current) {
      ownerRef.current = {
        id: Symbol(profileRef.current),
        name: profileRef.current,
        standDown: () => {
          const r = recognitionRef.current;
          if (r && recogActiveRef.current) { try { r.abort(); } catch { /* ignore */ } }
          recogActiveRef.current = false;
        },
      };
    }
    return ownerRef.current;
  };
  const mine = () => recognizerHolder() === owner().id;

  /**
   * Start (or keep) the free browser recognizer. `force` = the user turned voice
   * on here: take the recognizer from whoever has it. Without it (restarts after
   * speaking, Chrome ending a session) it never steals — it waits until it's free.
   */
  const startRecognition = useCallback((force = false) => {
    if (!recognitionSupported || disposedRef.current) return;
    wantRecogRef.current = true;
    if (!claimRecognizer(owner(), force)) return; // someone else is listening — we'll take over when they're done
    if (recogActiveRef.current) return;
    let r = recognitionRef.current;
    if (!r) {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      r = new SR();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = true; // live words for the caption
      r.maxAlternatives = 1;
      r.onstart = () => {
        if (disposedRef.current) { try { r.abort(); } catch { /* ignore */ } return; }
        recogActiveRef.current = true; recogErrorsRef.current = 0;
        if (statusRef.current !== "speaking") setStatusBoth("listening");
      };
      r.onaudiostart = () => { if (statusRef.current === "listening" && mine()) setStatusBoth("recording"); };
      r.onspeechstart = () => { if (statusRef.current === "listening" && mine()) setStatusBoth("recording"); };
      r.onresult = (ev: any) => {
        // a closed screen, or one that was stood down, never acts on what it heard
        if (disposedRef.current || !mine() || mutedRef.current) return;
        // Build the full live text (interim + final) so the caption always shows
        // what's being heard, and detect when a segment is finalized.
        let live = "", hasFinal = false;
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          live += ev.results[i][0]?.transcript ?? "";
          if (ev.results[i].isFinal) hasFinal = true;
        }
        live = live.trim();
        if (statusRef.current === "speaking") return;
        if (live) { setTranscript(live); if (statusRef.current === "listening") setStatusBoth("recording"); }
        if (!hasFinal || !live) return;
        // Finalized → dispatch the command, keep the words visible briefly.
        setStatusBoth("processing");
        deliver(live);
        setTimeout(() => {
          if (enabledRef.current && !mutedRef.current && statusRef.current === "processing") {
            setTranscript("");
            setStatusBoth("listening");
          }
        }, 2500);
      };
      r.onerror = (e: any) => {
        const err = e?.error;
        if (err !== "no-speech" && err !== "aborted") recogErrorsRef.current++;
        if (err === "not-allowed" || err === "service-not-allowed") {
          wantRecogRef.current = false;
          rememberVoiceOn(false);
          releaseRecognizer(owner().id);
          fail("Microphone permission denied for speech recognition.", "denied");
        } else if (err === "network") {
          // Chrome's recognizer needs internet; surface it briefly.
          setTranscript("");
          setError("Speech recognition needs an internet connection.");
        } else if (err === "audio-capture") {
          setError("The microphone is busy or unplugged — retrying…");
        } else if (err === "language-not-supported") {
          setError("This browser can't recognize the selected language.");
        }
        // "no-speech" / "aborted" → onend restarts if still wanted.
      };
      r.onend = () => {
        recogActiveRef.current = false;
        // Restart automatically (browser ends recognition after each utterance /
        // silence even in continuous mode) so we keep hearing every command —
        // only while this screen is open and still holds the recognizer. Repeated
        // errors back off a little instead of spinning.
        const again = () => !disposedRef.current && wantRecogRef.current && enabledRef.current && !mutedRef.current && statusRef.current !== "speaking" && mine() && !recogActiveRef.current;
        if (!again()) return;
        const wait = recogErrorsRef.current ? Math.min(4000, 300 * 2 ** Math.min(recogErrorsRef.current, 4)) : 120;
        setTimeout(() => { if (again()) { try { r.start(); } catch { /* already starting */ } } }, wait);
      };
      recognitionRef.current = r;
    }
    try { r.start(); } catch { /* start throws if already running */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recognitionSupported, onTranscript, setStatusBoth, fail]);

  /** Pause the recognizer while we speak — but keep holding it, so no other screen grabs the mic mid-reply. */
  const pauseRecognition = useCallback(() => {
    wantRecogRef.current = false;
    const r = recognitionRef.current;
    if (r && recogActiveRef.current) { try { r.abort(); } catch { /* ignore */ } }
  }, []);
  /** Stop listening and give the recognizer back (mute, stop, voice off). */
  const stopRecognition = useCallback(() => {
    pauseRecognition();
    if (ownerRef.current) releaseRecognizer(ownerRef.current.id);
  }, [pauseRecognition]);
  // Keep a ref so callbacks defined earlier (finalizeCapture) can trigger it.
  startRecognitionRef.current = startRecognition;

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
  const init = useCallback(async (): Promise<boolean> => {
    // turning voice on twice at once (a click while it's resuming) shares one start
    if (initRef.current) return initRef.current;
    const p = initOnceRef.current().finally(() => { initRef.current = null; });
    initRef.current = p;
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoListen, fail, setStatusBoth, supported, recognitionSupported]);

  const initOnceRef = useRef<() => Promise<boolean>>(async () => false);
  initOnceRef.current = async (): Promise<boolean> => {
    if (disposedRef.current) return false;
    if (!supported && !recognitionSupported) {
      fail("Your browser doesn't support the microphone API.", "unconfigured");
      return false;
    }
    setStatusBoth("requesting");
    setError(null);

    // Prepare the playback element (created once).
    if (!audioElRef.current) {
      const el = new Audio();
      el.autoplay = false;
      audioElRef.current = el;
    }

    // Decide STT engine: use the free browser recognizer when server STT
    // (ElevenLabs) isn't configured — so voice input works with no key.
    const cfg = await fetch("/api/voice/config", { signal: timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (disposedRef.current) return false; // the screen closed while we asked
    const serverStt = !!cfg?.data?.configured;
    browserSTTRef.current = !serverStt && recognitionSupported;

    // Muted (in this agent or another): voice is on, but the microphone stays closed until you unmute.
    if (isVoiceSilent()) {
      enabledRef.current = true; setEnabledState(true); rememberVoiceOn(true);
      mutedRef.current = true; setMuted(true); silentRef.current = true; setSilent(true);
      setStatusBoth("idle");
      return true;
    }

    // Browser-STT mode: let SpeechRecognition OWN the microphone. Holding a
    // getUserMedia stream (for the level meter) blocks the recognizer from
    // hearing anything, so we don't open one here — recognition prompts for the
    // mic itself.
    if (browserSTTRef.current) {
      enabledRef.current = true;
      setEnabledState(true);
      rememberVoiceOn(true);
      mutedRef.current = false; setMuted(false);
      setStatusBoth(autoListen ? "listening" : "idle");
      if (autoListen) startRecognition(true); // the user is talking to THIS screen now
      return true;
    }

    // Already listening (voice turned on twice) → keep the open microphone.
    if (streamRef.current?.getAudioTracks().some((t) => t.readyState === "live")) {
      enabledRef.current = true; setEnabledState(true); rememberVoiceOn(true);
      if (statusRef.current === "uninitialized" || statusRef.current === "requesting" || statusRef.current === "error") setStatusBoth(autoListen ? "listening" : "idle");
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
      return true;
    }

    // ElevenLabs mode: open the mic + analyser for VAD/metering + MediaRecorder.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (disposedRef.current) { stream.getTracks().forEach((t) => t.stop()); return false; } // closed meanwhile — let the mic go
      streamRef.current = stream;

      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      // Started without a click (e.g. voice resumed after switching agents or a
      // reload) the browser may keep audio paused until the next interaction.
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
        const wake = () => {
          ctx.resume().catch(() => {});
          window.removeEventListener("pointerdown", wake);
          window.removeEventListener("keydown", wake);
        };
        window.addEventListener("pointerdown", wake);
        window.addEventListener("keydown", wake);
      }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      enabledRef.current = true;
      setEnabledState(true);
      rememberVoiceOn(true);
      setStatusBoth(autoListen ? "listening" : "idle");
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
      return true;
    } catch (e: any) {
      rememberVoiceOn(false);
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        fail("Microphone permission was denied.", "denied");
      } else if (e?.name === "NotFoundError") {
        fail("No microphone was found.", "error");
      } else {
        fail("Could not access the microphone.", "error");
      }
      return false;
    }
  };

  // --- Public: speak (streaming TTS) -------------------------------------
  const stopSpeaking = useCallback(() => {
    speechGenRef.current++;
    cancelPlaybackRef.current?.();
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
        const prof = BROWSER_VOICE[profileRef.current] ?? BROWSER_VOICE.jarvis;
        const femaleRe = /female|aria|jenny|samantha|libby|sonia|zira|alice|kate|serena|hazel|victoria|karen|moira|tessa/i;
        const maleRe = /male|daniel|arthur|guy|david|alex|fred|george|ryan|rishi|thomas/i;
        const biasRe = prof.female ? femaleRe : maleRe;
        const pick =
          // 1) exact voice this agent prefers
          voices.find((v) => prof.match.test(v.name)) ||
          // 2) any English voice matching the desired gender bias
          voices.find((v) => /^en(-|_)/i.test(v.lang) && biasRe.test(v.name)) ||
          // 3) any English voice at all
          voices.find((v) => /^en(-|_)/i.test(v.lang)) ||
          voices[0];
        const u = new SpeechSynthesisUtterance(text);
        if (pick) { u.voice = pick; u.lang = pick.lang; }
        u.rate = prof.rate;
        u.pitch = prof.pitch;
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

  // In browser-STT mode there's no analyser, so give the level meter a gentle
  // pulse while actively hearing speech (visual feedback for the orb/EQ).
  useEffect(() => {
    if (!browserSTTRef.current) return;
    if (status !== "recording") { setLevel(0); return; }
    const id = setInterval(() => setLevel(0.22 + Math.random() * 0.5), 120);
    return () => clearInterval(id);
  }, [status]);

  // Watchdog — keeps the free browser recognizer alive so it hears EVERY command,
  // not just the first. Chrome quietly ends recognition after an utterance or a
  // little silence and the onend restart can be missed during the speak→listen
  // handoff; this re-arms it. (It never blocks listening — only revives it.)
  useEffect(() => {
    const id = setInterval(() => {
      if (disposedRef.current) return;
      const s = statusRef.current;
      const on = enabledRef.current && !mutedRef.current && s !== "uninitialized" && s !== "denied" && s !== "unconfigured";
      const now = Date.now();
      // 1) "speaking" but nothing is actually playing (a reply that never arrived,
      //    audio that got stuck) → hand the mic back instead of staying deaf
      if (s === "speaking") {
        const el = audioElRef.current;
        const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
        const audible = (!!el && !el.paused && !el.ended && !!el.src) || !!synth?.speaking || !!synth?.pending;
        if (audible) lastAudibleRef.current = now;
        else if (now - lastAudibleRef.current > STUCK_SPEAKING_MS) {
          stopSpeaking();
          setStatusBoth(on ? "listening" : "idle");
          if (on && browserSTTRef.current) startRecognitionRef.current();
        }
        return;
      }
      // 2) a transcription that never came back
      if (s === "processing" && now - statusSinceRef.current > STUCK_PROCESSING_MS) {
        setTranscript("");
        if (on) setStatusBoth("listening");
      }
      // 3) the free recognizer silently died → restart it (when nobody else is using it)
      if (!browserSTTRef.current || !on) return;
      if (!wantRecogRef.current && !recogActiveRef.current && s !== "processing") wantRecogRef.current = true;
      if (wantRecogRef.current && !recogActiveRef.current && recognizerFreeFor(ownerRef.current?.id ?? Symbol())) startRecognitionRef.current();
    }, 1400);
    // the moment another screen gives the recognizer back, take it again (if we want it)
    const off = onRecognizerFree(() => {
      if (disposedRef.current || !browserSTTRef.current) return;
      if (wantRecogRef.current && enabledRef.current && !mutedRef.current && statusRef.current !== "speaking") setTimeout(() => startRecognitionRef.current(), 200);
    });
    return () => { clearInterval(id); off(); };
  }, [setStatusBoth, stopSpeaking]);

  // Each speak() takes a number; only the LATEST one may hand the mic back
  // when it finishes — otherwise an earlier reply ending would re-open the mic
  // while a newer one is still playing, and the mic would hear it.
  const speakSeqRef = useRef(0);
  /** Decode a TTS clip and store its loudness every 30ms (best-effort, async). */
  const trackEnvelope = useCallback((blob: Blob, url: string) => {
    const Offline = typeof window !== "undefined" ? (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext) : null;
    if (!Offline) return;
    blob.arrayBuffer().then((buf) => new Offline(1, 1, 44100).decodeAudioData(buf)).then((audio: AudioBuffer) => {
      const data = audio.getChannelData(0);
      const win = Math.max(1, Math.round(audio.sampleRate * 0.03));
      const env = new Float32Array(Math.ceil(data.length / win));
      let peak = 0.0001;
      for (let i = 0; i < env.length; i++) {
        let sum = 0; const start = i * win; const end = Math.min(data.length, start + win);
        for (let j = start; j < end; j++) sum += data[j] * data[j];
        env[i] = Math.sqrt(sum / Math.max(1, end - start));
        if (env[i] > peak) peak = env[i];
      }
      for (let i = 0; i < env.length; i++) env[i] = Math.min(1, env[i] / peak);
      const map = envelopesRef.current;
      map.set(url, env);
      if (map.size > 6) map.delete(map.keys().next().value as string);
    }).catch(() => { /* visuals fall back to a gentle rhythm */ });
  }, []);

  /**
   * How loud JARVIS's voice is right now (0..1) — read on demand by animations
   * (no re-renders). Follows the real clip when known, else a soft speech rhythm.
   */
  const getOutputLevel = useCallback((): number => {
    if (statusRef.current !== "speaking") return 0;
    const el = audioElRef.current;
    const env = el && !el.paused ? envelopesRef.current.get(el.src) : undefined;
    if (env && el) return env[Math.min(env.length - 1, Math.floor(el.currentTime / 0.03))] ?? 0;
    const t = performance.now() / 1000;
    return Math.max(0, 0.35 + 0.3 * Math.sin(t * 9.3) * Math.sin(t * 2.1) + 0.15 * Math.sin(t * 23));
  }, []);

  /** Route the next clip: ULTRON through its effect (deeper, darker), everyone else untouched. */
  const prepareOutput = useCallback(async () => {
    const el = audioElRef.current;
    if (!el) return;
    const wantFx = profileRef.current === "ultron" && ultronFxOn();
    const rate = wantFx ? ULTRON_FX.playbackRate : 1;
    el.defaultPlaybackRate = rate; el.playbackRate = rate;
    // let the pitch fall with the speed (deeper voice) only for ULTRON
    const m = el as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
    m.preservesPitch = !wantFx; m.webkitPreservesPitch = !wantFx; m.mozPreservesPitch = !wantFx;
    if (!wantFx && !fxRef.current) return; // plain element output, no Web Audio at all
    try {
      if (!fxRef.current) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        fxRef.current = { ctx, source: ctx.createMediaElementSource(el), chain: null, wired: null };
      }
      const f = fxRef.current;
      if (f.ctx.state === "suspended") await f.ctx.resume().catch(() => {});
      const want = wantFx ? "fx" : "dry";
      if (f.wired === want) return;
      f.source.disconnect();
      if (wantFx) {
        if (!f.chain) { f.chain = buildUltronFx(f.ctx); f.chain.output.connect(f.ctx.destination); }
        f.source.connect(f.chain.input);
      } else f.source.connect(f.ctx.destination);
      f.wired = want;
    } catch { /* no Web Audio: the voice still plays, just without the effect */ }
  }, []);
  useEffect(() => () => { const f = fxRef.current; fxRef.current = null; f?.chain?.stop(); void f?.ctx.close().catch(() => {}); }, []);

  const speak = useCallback(
    async (text: string): Promise<void> => {
      if (!enabledRef.current || mutedRef.current || silentRef.current) return; // muted: reply on screen only
      const el = audioElRef.current;
      if (!el || !text.trim()) return;
      const seq = ++speakSeqRef.current;
      const latest = () => seq === speakSeqRef.current;
      // Pause the recognizer while JARVIS speaks so it doesn't hear its own voice.
      setTranscript("");
      if (browserSTTRef.current) pauseRecognition();
      try {
        setStatusBoth("speaking");
        const res = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, agent: profileRef.current }),
          signal: timeout(TTS_TIMEOUT_MS),
        }).catch(() => null);
        // No server voice configured (or the request failed) → speak with the
        // free built-in browser voice instead of going silent.
        if (!res || !res.ok) {
          await speakBrowser(text);
          if (!latest()) return;
          if (enabledRef.current && !mutedRef.current && statusRef.current === "speaking") setStatusBoth("listening");
          if (browserSTTRef.current && enabledRef.current && !mutedRef.current) startRecognition();
          return;
        }
        if (!latest()) return; // a newer reply took over while this one loaded
        const blob = await res.blob();
        stopSpeaking();
        const url = URL.createObjectURL(blob);
        trackEnvelope(blob, url);
        el.src = url;
        await prepareOutput();
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
        if (latest()) {
          if (enabledRef.current && !mutedRef.current && statusRef.current === "speaking") {
            setStatusBoth("listening");
          }
          // Resume the free recognizer once JARVIS has finished speaking.
          if (browserSTTRef.current && enabledRef.current && !mutedRef.current) startRecognition();
        }
      }
    },
    [fail, setStatusBoth, stopSpeaking, speakBrowser, pauseRecognition, startRecognition, trackEnvelope, prepareOutput],
  );

  /**
   * Speak a reply WHILE it streams in: each finished sentence is sent to TTS
   * immediately (the next one is fetched while the current one plays), so the
   * voice starts after the first sentence instead of after the whole answer.
   */
  const speakStream = useCallback((): SpeechStream => {
    const noop: SpeechStream = { push: () => {}, end: () => {} };
    if (!enabledRef.current || mutedRef.current || silentRef.current || !audioElRef.current) return noop;
    stopSpeaking(); // a new reply replaces anything still playing
    const gen = speechGenRef.current;
    const live = () => gen === speechGenRef.current && enabledRef.current && !mutedRef.current && !silentRef.current;

    let buf = "";
    let first = true;
    let started = false;
    let ended = false;
    let serverTts = true;
    let chain: Promise<void> = Promise.resolve();

    const playBlob = (blob: Blob) => new Promise<void>((resolve) => {
      const el = audioElRef.current;
      if (!el) { resolve(); return; }
      if (el.src) URL.revokeObjectURL(el.src);
      const url = URL.createObjectURL(blob);
      trackEnvelope(blob, url);
      el.src = url;
      const done = () => {
        el.removeEventListener("ended", done);
        el.removeEventListener("error", done);
        if (cancelPlaybackRef.current === done) cancelPlaybackRef.current = null;
        resolve();
      };
      cancelPlaybackRef.current = done; // stopSpeaking (barge-in) ends it
      el.addEventListener("ended", done);
      el.addEventListener("error", done);
      void prepareOutput().then(() => el.play()).catch(() => done());
    });

    const enqueue = (text: string) => {
      if (!started) {
        started = true;
        setTranscript("");
        if (browserSTTRef.current) pauseRecognition(); // don't hear our own voice
        setStatusBoth("speaking");
      }
      // Start fetching this sentence's audio now, in parallel with playback.
      const audio: Promise<Blob | null> = serverTts
        ? fetch("/api/voice/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, agent: profileRef.current }),
            signal: timeout(TTS_TIMEOUT_MS),
          }).then((r) => (r.ok ? r.blob() : null)).catch(() => null)
        : Promise.resolve(null);
      chain = chain.then(async () => {
        if (!live()) return;
        const blob = await audio;
        if (!live()) return;
        if (blob) await playBlob(blob);
        else { serverTts = false; await speakBrowser(text); } // free browser voice
      });
    };

    return {
      push(delta) {
        if (ended || !live()) return;
        buf += delta;
        const r = takeSentences(buf, first);
        buf = r.rest;
        for (const piece of r.pieces) { first = false; enqueue(piece); }
      },
      end() {
        if (ended) return;
        ended = true;
        if (!live()) return;
        for (const piece of takeSentences(buf, first, true).pieces) enqueue(piece);
        buf = "";
        chain.then(() => {
          if (!started || !live()) return;
          if (statusRef.current === "speaking") setStatusBoth("listening");
          if (browserSTTRef.current) startRecognition();
        });
      },
    };
  }, [setStatusBoth, speakBrowser, startRecognition, pauseRecognition, stopSpeaking, trackEnvelope, prepareOutput]);

  // ---- "mute" / "unmute" — the same in every agent, and shared between them
  useEffect(() => {
    const apply = (on: boolean, via?: "wake") => {
      silentRef.current = on; setSilent(on);
      if (on) {
        // muted: stop talking AND stop listening — the microphone is released completely
        stopSpeaking();
        mutedRef.current = true; setMuted(true);
        stopCapture();
        stopRecognition();
        if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null; analyserRef.current = null;
        capturingRef.current = false; chunksRef.current = [];
        setLevel(0); setTranscript("");
        if (statusRef.current !== "uninitialized" && statusRef.current !== "denied" && statusRef.current !== "unconfigured") setStatusBoth("idle");
      } else if (mutedRef.current) {
        mutedRef.current = false; setMuted(false);
        const s = statusRef.current;
        if (s === "uninitialized" || s === "requesting" || s === "denied" || s === "unconfigured") return; // voice isn't on here
        // unmuted: open the microphone again and listen
        if (browserSTTRef.current) { setStatusBoth("listening"); startRecognitionRef.current(true); }
        else void initOnceRef.current();
        // woken by "Hey JARVIS": the agent you're on answers (just one, even if two screens are open)
        if (via === "wake") setTimeout(() => {
          const h = recognizerHolder();
          if (h ? h === ownerRef.current?.id : takeWakeGreeting()) void speakRef.current("I'm back.");
        }, 60);
      }
    };
    apply(isVoiceSilent());
    return onVoiceSilent(apply);
  }, [setStatusBoth, stopSpeaking, stopCapture, stopRecognition]);
  muteCmdRef.current = (text: string) => {
    const m = muteIntent(text);
    if (!m) return false;
    setTranscript("");
    setVoiceSilent(m === "mute");
    if (m === "unmute") void speakRef.current("I'm back.");
    return true;
  };
  const speakRef = useRef<(t: string) => Promise<void>>(async () => {});

  /** The mic button: the same mute as saying "mute" — shared by every agent. */
  const toggleMute = useCallback(() => { setVoiceSilent(!mutedRef.current); }, []);

  const setEnabled = useCallback(
    (on: boolean) => {
      enabledRef.current = on;
      setEnabledState(on);
      if (!on) {
        stopCapture();
        stopRecognition();
        stopSpeaking();
        setStatusBoth("idle");
      } else if (streamRef.current || browserSTTRef.current) {
        setStatusBoth("listening");
        if (browserSTTRef.current) startRecognition(true);
      }
    },
    [setStatusBoth, stopCapture, stopSpeaking, startRecognition, stopRecognition],
  );

  // --- Public: stop (put JARVIS to sleep, release the mic) ---------------
  const stop = useCallback(() => {
    rememberVoiceOn(false);
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

  // Cleanup on unmount — stop the recognizer/mic so the next console starts clean.
  useEffect(() => {
    disposedRef.current = false; // (React dev re-mounts effects once)
    return () => {
      // this screen is closing: nothing it started may keep — or later grab — the mic
      disposedRef.current = true;
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      wantRecogRef.current = false;
      const r = recognitionRef.current;
      if (r) {
        r.onresult = null; r.onend = null; r.onstart = null; r.onerror = null;
        try { r.abort(); } catch { /* ignore */ }
      }
      recognitionRef.current = null;
      recogActiveRef.current = false;
      if (ownerRef.current) releaseRecognizer(ownerRef.current.id);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      analyserRef.current = null;
      stopSpeaking();
    };
  }, [stopSpeaking]);

  speakRef.current = speak;

  return {
    status,
    level,
    getOutputLevel,
    muted,
    enabled,
    error,
    transcript,
    /** True when JARVIS is transcribing locally with the free browser recognizer. */
    browserSTT: browserSTTRef.current,
    supported,
    init,
    speak,
    speakStream,
    stopSpeaking,
    stop,
    toggleMute,
    setEnabled,
    /** "Mute" is on: the agent stays quiet (replies on screen only) but keeps listening. */
    silent,
    /** Turn the voice off/on for every agent. */
    setSilent: setVoiceSilent,
    /** Typed text: handles "mute" / "unmute" like the spoken words. True = it was one. */
    command: (text: string) => muteCmdRef.current(text),
  };
}
