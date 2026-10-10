"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseCommand, type TeleAction } from "@/lib/aston/scripts/commands";
import { isSelfSpeaking } from "@/lib/aston/voice";

export type VoiceState = "off" | "on" | "unsupported" | "denied" | "needs-tap";
/* ------------------------------------------------------------------ voice */

/**
 * Continuous listening for "ASTON, …" commands while the teleprompter is open.
 * Browsers stop recognition after silence, so it restarts itself. Only
 * commands act (see parseCommand); everything else you say is ignored, and so
 * is anything heard while ASTON itself is speaking.
 */
export function useVoiceCommands(enabled: boolean, onAction: (a: TeleAction, heard: string) => void): [VoiceState, () => void] {
  const [state, setState] = useState<VoiceState>("off");
  const rec = useRef<any>(null);
  const want = useRef(enabled);
  const cb = useRef(onAction);
  cb.current = onAction;

  const start = useCallback(() => {
    const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
    if (!SR) { setState("unsupported"); return; }
    if (rec.current) return;
    const r = new SR();
    r.lang = "en-IN";
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 3;
    r.onstart = () => setState("on");
    r.onresult = (ev: any) => {
      if (isSelfSpeaking()) return; // that's ASTON's own voice
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) continue;
        for (let k = 0; k < ev.results[i].length; k++) {
          const heard = String(ev.results[i][k].transcript ?? "");
          const a = parseCommand(heard);
          if (a) { cb.current(a, heard.trim()); break; }
        }
      }
    };
    r.onerror = (ev: any) => {
      if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed") { want.current = false; setState("denied"); }
      else if (ev?.error === "audio-capture") { want.current = false; setState("denied"); }
    };
    r.onend = () => {
      rec.current = null;
      if (want.current) setTimeout(() => { if (want.current && !rec.current) start(); }, 250);
      else setState((s) => (s === "denied" || s === "unsupported" ? s : "off"));
    };
    rec.current = r;
    try { r.start(); } catch { rec.current = null; setState("needs-tap"); }
  }, []);

  useEffect(() => {
    want.current = enabled;
    if (enabled) start();
    else { try { rec.current?.stop(); } catch { /* not running */ } rec.current = null; setState((s) => (s === "unsupported" || s === "denied" ? s : "off")); }
    return () => { want.current = false; try { rec.current?.abort(); } catch { /* gone */ } rec.current = null; };
  }, [enabled, start]);

  // A user tap re-tries (Android needs a gesture before the mic can start)
  const retry = useCallback(() => { want.current = true; setState("off"); start(); }, [start]);
  return [state, retry];
}

/* ------------------------------------------------------------------ screen wake lock */

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: any = null, gone = false;
    const take = async () => { try { lock = await (navigator as any).wakeLock.request("screen"); } catch { /* not allowed — the screen may dim */ } };
    const onVis = () => { if (document.visibilityState === "visible" && !gone) take(); };
    take();
    document.addEventListener("visibilitychange", onVis);
    return () => { gone = true; document.removeEventListener("visibilitychange", onVis); try { lock?.release(); } catch { /* released */ } };
  }, [active]);
}
