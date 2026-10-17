"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HoloOrb, type OrbState } from "./holo-orb";
import { capturePhrase, speak, transcribe, type Capture, type Speech } from "@/components/island/voice";
import type { ChatAgent } from "@/lib/agents/catalog";

/**
 * Full-screen voice conversation with an agent. It talks to the SAME agent and
 * the SAME conversation as the chat (onAsk sends the words exactly like typing
 * them). It listens, sends what you said, speaks the answer, then listens again.
 *
 * - Tap the orb to talk, or to interrupt while it's speaking.
 * - Mute pauses listening; ✕ or Esc goes back to the chat.
 * - The microphone is asked for only when voice mode opens, and released when
 *   it closes.
 */

/** What to read aloud: the reply without Markdown, and not a whole essay. */
export function speakable(md: string, max = 600): string {
  const t = md
    .replace(/```[\s\S]*?```/g, " (code in the chat) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[*_~>]/g, "")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut) + " The rest is in the chat.";
}

interface Props {
  agent: ChatAgent;
  displayName: string | null;
  /** Send words to the agent; onDelta gets the reply as it streams. */
  onAsk: (text: string, onDelta: (soFar: string) => void) => Promise<{ text: string; error?: string }>;
  /** Stop a reply that's still coming. */
  onStop: () => void;
  onClose: () => void;
}

const LABEL: Record<OrbState, string> = { idle: "Tap the orb to talk", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking — tap to interrupt", error: "Something went wrong" };

export function VoiceMode({ agent, displayName, onAsk, onStop, onClose }: Props) {
  const [st, setSt] = useState<OrbState>("idle");
  const [you, setYou] = useState("");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [shown, setShown] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const capture = useRef<Capture | null>(null);
  const speech = useRef<Speech | null>(null);
  const alive = useRef(true);
  const looping = useRef(false);
  const mutedRef = useRef(muted); mutedRef.current = muted;

  const level = useCallback(() => (capture.current ? capture.current.level() : speech.current ? speech.current.level() : 0), []);

  const release = useCallback(() => {
    capture.current?.stop(); capture.current = null;
    speech.current?.stop(); speech.current = null;
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
  }, []);

  /** Listen → understand → answer → speak, until muted or closed. */
  const loop = useCallback(async () => {
    if (looping.current) return;
    looping.current = true;
    try {
      if (!stream.current) {
        try { stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
        catch { setSt("error"); setNote("Microphone blocked or missing — allow it in the browser, or type in the chat."); return; }
      }
      while (alive.current && !mutedRef.current) {
        setSt("listening"); setNote(null);
        const c = capturePhrase(stream.current, { waitMs: 20_000, maxMs: 30_000 });
        capture.current = c;
        const blob = await c.done;
        capture.current = null;
        if (!alive.current || mutedRef.current) break;
        if (!blob) { setSt("idle"); break; } // nobody spoke — wait for a tap (no audio is sent)
        setSt("thinking");
        const heard = await transcribe(blob);
        if (!alive.current) break;
        if ("error" in heard) { setSt("error"); setNote(heard.error); break; }
        if (!heard.text) { setNote("I didn't catch that."); continue; }
        setYou(heard.text); setReply("");
        const r = await onAsk(heard.text, (soFar) => setReply(soFar));
        if (!alive.current) break;
        if (r.error && !r.text) { setSt("error"); setNote(r.error); break; }
        setReply(r.text);
        const say = speakable(r.text);
        if (say) {
          setSt("speaking");
          const s = speak(say, agent.id);
          speech.current = s;
          await s.done;
          speech.current = null;
        }
      }
    } finally {
      looping.current = false;
      if (alive.current) setSt((s) => (s === "error" ? s : "idle"));
    }
  }, [agent.id, onAsk]);

  useEffect(() => {
    alive.current = true;
    const raf = requestAnimationFrame(() => setShown(true));
    void loop();
    return () => { alive.current = false; cancelAnimationFrame(raf); release(); };
  }, [loop, release]);

  const close = useCallback(() => { alive.current = false; onStop(); release(); setShown(false); setTimeout(onClose, 220); }, [onClose, onStop, release]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [close]);

  const tapOrb = () => {
    if (st === "speaking") { speech.current?.stop(); return; } // interrupt; the loop goes back to listening
    if (st === "listening") { capture.current?.stop(); return; } // done talking
    if (st === "thinking") return;
    if (muted) setMuted(false);
    void loop();
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (next) { capture.current?.stop(); speech.current?.stop(); }
      else setTimeout(() => void loop(), 0);
      return next;
    });
  };

  return (
    <div className={`vm ${shown ? "in" : ""}`} role="dialog" aria-label={`Voice conversation with ${agent.name}`} aria-modal="true">
      <style dangerouslySetInnerHTML={{ __html: VM_CSS }} />
      <div className="vm-bg" aria-hidden />
      <header className="vm-top">
        <span className="vm-name"><i style={{ background: agent.color }} />{agent.name}</span>
        <button type="button" className="vm-x" onClick={close} aria-label="End voice and go back to the chat">✕</button>
      </header>
      <button type="button" className="vm-orb" onClick={tapOrb} aria-label={LABEL[st]}>
        <HoloOrb state={st} level={level} color={agent.color} size={260} />
      </button>
      <div className="vm-text" aria-live="polite">
        {!you && !reply ? (
          <>
            <p className="vm-hello">Hello{displayName ? ` ${displayName}` : ""}</p>
            <h2>How can I help you today?</h2>
          </>
        ) : (
          <>
            {you && <p className="vm-you">“{you}”</p>}
            {reply && <p className="vm-reply">{speakable(reply, 420)}</p>}
          </>
        )}
        {note && <p className="vm-note" role="alert">{note}</p>}
      </div>
      <div className="vm-bar">
        <span className={`vm-state s-${st}`}><i />{muted ? "Muted — tap the mic to listen" : LABEL[st]}</span>
        <button type="button" className={`vm-mute ${muted ? "on" : ""}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <MicOff /> : <Mic />}
        </button>
        <button type="button" className="vm-end" onClick={close}>End</button>
      </div>
    </div>
  );
}

const Mic = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
const MicOff = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.8M5 11a7 7 0 0 0 11.5 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3" /></svg>;

const VM_CSS = `
.vm { position: fixed; inset: 0; z-index: 80; display: flex; flex-direction: column; align-items: center; color: #e2e8f0; background: #02040a; opacity: 0; transition: opacity .25s ease; font-family: inherit; }
.vm.in { opacity: 1; }
.vm-bg { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(60% 40% at 50% 30%, rgba(37,99,235,.18), transparent 70%), linear-gradient(180deg, #02040a 0%, #030817 52%, #0b2a6b 86%, #1d4ed8 100%); }
.vm > * { position: relative; }
.vm-top { width: 100%; max-width: 900px; display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; box-sizing: border-box; }
.vm-name { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; letter-spacing: .14em; color: #cbd5e1; }
.vm-name i { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 10px currentColor; }
.vm-x { width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(148,163,184,.3); background: rgba(15,23,42,.5); color: #e2e8f0; cursor: pointer; }
.vm-orb { margin-top: 2vh; border: 0; background: none; padding: 0; cursor: pointer; border-radius: 50%; transform: scale(.85); transition: transform .45s cubic-bezier(.2,.9,.25,1.1); }
.vm.in .vm-orb { transform: scale(1); }
.vm-orb:focus-visible { outline: 2px solid #93c5fd; outline-offset: -40px; }
.vm-text { flex: 1; width: min(640px, calc(100vw - 40px)); text-align: center; overflow: auto; }
.vm-hello { margin: 0 0 10px; font-size: 18px; color: #94a3b8; }
.vm-text h2 { margin: 0; font-size: clamp(30px, 6vw, 46px); line-height: 1.1; font-weight: 600; letter-spacing: -.02em; color: #f8fafc; }
.vm-you { margin: 0 0 12px; font-size: 16px; color: #93c5fd; }
.vm-reply { margin: 0; font-size: clamp(17px, 2.4vw, 21px); line-height: 1.5; color: #f1f5f9; }
.vm-note { margin: 14px 0 0; font-size: 14px; color: #fca5a5; }
.vm-bar { display: flex; align-items: center; gap: 10px; width: min(560px, calc(100vw - 32px)); margin: 16px 0 calc(22px + env(safe-area-inset-bottom)); padding: 8px 8px 8px 20px; box-sizing: border-box;
  border-radius: 999px; border: 1px solid rgba(191,219,254,.35); background: linear-gradient(180deg, rgba(59,130,246,.28), rgba(147,197,253,.38));
  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 10px 30px rgba(0,0,0,.3); }
.vm-state { flex: 1; display: inline-flex; align-items: center; gap: 10px; font-size: 15px; color: #f8fafc; }
.vm-state i { width: 8px; height: 8px; border-radius: 50%; background: #93c5fd; }
.vm-state.s-listening i { background: #f8fafc; animation: vm-pulse 1s ease-in-out infinite; }
.vm-state.s-error i { background: #f87171; }
@keyframes vm-pulse { 50% { transform: scale(1.8); opacity: .5; } }
.vm-mute, .vm-end { height: 40px; border-radius: 999px; border: 1px solid rgba(255,255,255,.35); background: rgba(2,6,23,.35); color: #fff; cursor: pointer; font: inherit; }
.vm-mute { width: 40px; display: grid; place-items: center; } .vm-mute.on { background: #ef4444; border-color: #ef4444; }
.vm-end { padding: 0 18px; font-size: 14px; }
@media (prefers-reduced-motion: reduce) { .vm, .vm-orb { transition: none; } .vm-state.s-listening i { animation: none; } }
`;
