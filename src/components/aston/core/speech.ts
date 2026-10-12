"use client";

import { pickVoice } from "@/lib/aston/voice";

/**
 * ASTON's voice, hardened against the browser speech engine's quiet failures:
 * - Chrome can garbage-collect an utterance mid-sentence (its events never
 *   fire), so every live utterance is kept referenced until it ends.
 * - speak() straight after cancel() is sometimes dropped, so a short gap is left.
 * - A paused engine is resumed; Chrome's online "Google" voices stop after
 *   about 15 s, so long lines get a pause/resume keep-alive.
 * - If speech never starts (blocked until the page is clicked, no audio
 *   device, a broken voice), a watchdog reports it instead of staying silent.
 */

export type SpeechFailure = "not-allowed" | "no-start" | "failed";

export interface SayOptions {
  rate?: number;
  pitch?: number;
  /** Wait before speaking (lets a phone's microphone let go of the audio first). */
  delayMs?: number;
  onStart?: () => void;
  onWord?: () => void;
  /** Always called once: no argument when the line was spoken, or why it wasn't. "cut" = replaced by another line. */
  onDone?: (failure?: SpeechFailure | "cut") => void;
}

const live = new Set<SpeechSynthesisUtterance>();

export const speechAvailable = () => typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";

/** Speak a line. Returns false when this browser can't speak at all. */
export function sayLine(line: string, o: SayOptions = {}): boolean {
  if (!speechAvailable()) return false;
  const synth = window.speechSynthesis;
  const busy = synth.speaking || synth.pending;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(line);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = o.rate ?? 1.02;
  u.pitch = o.pitch ?? 0.95;
  live.add(u);

  let started = false, finished = false;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const finish = (f?: SpeechFailure | "cut") => {
    if (finished) return;
    finished = true;
    live.delete(u);
    clearTimeout(watchdog);
    if (keepAlive) clearInterval(keepAlive);
    o.onDone?.(f);
  };
  // nothing within 5 s (longer if we waited first): the engine never started
  const watchdog = setTimeout(() => { if (!started) { synth.cancel(); finish("no-start"); } }, 5000 + (o.delayMs ?? 0));

  u.onstart = () => {
    started = true;
    clearTimeout(watchdog);
    o.onStart?.();
    if (v && /google/i.test(v.name) && !v.localService) {
      keepAlive = setInterval(() => { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } }, 10_000);
    }
  };
  u.onboundary = (e: SpeechSynthesisEvent) => { if (!e.name || e.name === "word") o.onWord?.(); };
  u.onend = () => finish();
  u.onerror = (e: SpeechSynthesisErrorEvent) => {
    const err = e?.error;
    finish(err === "interrupted" || err === "canceled" ? "cut" : err === "not-allowed" ? "not-allowed" : started ? undefined : "failed");
  };

  const go = () => {
    if (finished) return;
    if (synth.paused) synth.resume();
    synth.speak(u);
  };
  const wait = Math.max(busy ? 60 : 0, o.delayMs ?? 0);
  if (wait) setTimeout(go, wait); else go();
  return true;
}

export const stopSpeaking = () => { if (speechAvailable()) window.speechSynthesis.cancel(); };
