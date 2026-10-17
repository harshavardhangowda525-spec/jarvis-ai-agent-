"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export type WalkStep = { id: string; title: string; say: string };
export type LiveFacts = { width: number; overflowX: boolean; errors: string[] };
export type WalkHandle = { start: () => void; stop: () => void };

/** Browser speech, as a promise that ends when the sentence does (no voice → a reading pause). */
export function speakBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    const words = text.split(/\s+/).length;
    const fallback = () => setTimeout(resolve, Math.max(2500, words * 380));
    try {
      if (!("speechSynthesis" in window)) return fallback();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      let done = false;
      const end = () => { if (!done) { done = true; resolve(); } };
      u.onend = end; u.onerror = end;
      setTimeout(end, Math.max(4000, words * 600)); // never hang on a silent engine
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { fallback(); }
  });
}

const withWalk = (url: string) => `${url}${url.includes("?") ? "&" : "?"}walk=1`;

/**
 * The preview in a sandboxed frame, plus a guided walkthrough of the REAL
 * page: the frame reports which sections exist, JARVIS scrolls to each one
 * while it explains it, then checks the layout at phone width. Forms in the
 * preview never send anything.
 */
export const Walkthrough = forwardRef<WalkHandle, {
  url: string; steps: WalkStep[]; speak?: (t: string) => Promise<void> | void;
  device?: "desktop" | "phone"; onDevice?: (d: "desktop" | "phone") => void;
  onEnd?: (facts: { phone: LiveFacts | null; errors: string[] }) => void; onLive?: (f: LiveFacts) => void;
}>(function Walkthrough({ url, steps, speak, device = "desktop", onDevice, onEnd, onLive }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [found, setFound] = useState<string[] | null>(null);
  const foundRef = useRef<string[] | null>(null); foundRef.current = found;
  const [caption, setCaption] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const waiters = useRef<((m: LiveFacts & { id?: string; found?: boolean }) => void)[]>([]);
  const errors = useRef<string[]>([]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as { type?: string; sections?: { id: string }[] } & LiveFacts;
      if (!m || typeof m !== "object") return;
      if (Array.isArray(m.errors)) errors.current = [...new Set([...errors.current, ...m.errors])].slice(0, 8);
      if (m.type === "aston:ready") { setFound((m.sections ?? []).map((s) => s.id)); onLive?.({ width: m.width, overflowX: m.overflowX, errors: m.errors }); }
      if (m.type === "aston:at" || m.type === "aston:facts") { onLive?.({ width: m.width, overflowX: m.overflowX, errors: m.errors }); waiters.current.splice(0).forEach((w) => w(m)); }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [onLive]);

  const ask = useCallback((msg: object) => new Promise<(LiveFacts & { found?: boolean }) | null>((resolve) => {
    const t = setTimeout(() => resolve(null), 3000);
    waiters.current.push((m) => { clearTimeout(t); resolve(m); });
    frame.current?.contentWindow?.postMessage(msg, "*");
  }), []);

  const say = useCallback(async (t: string) => {
    setCaption(t);
    if (speak) await speak(t); else await new Promise((r) => setTimeout(r, Math.max(2500, t.split(/\s+/).length * 380)));
  }, [speak]);

  const start = useCallback(async () => {
    if (running) return;
    stopRef.current = false; setRunning(true);
    onDevice?.("desktop");
    // wait for the page to report its real sections (up to 8 s)
    for (let i = 0; i < 40 && !foundRef.current; i++) await new Promise((r) => setTimeout(r, 200));
    const have = foundRef.current;
    const real = steps.filter((s) => !have || have.includes(s.id));
    for (const s of real) {
      if (stopRef.current) break;
      setAt(s.id);
      const r = await ask({ type: "aston:goto", id: s.id });
      if (r && r.found === false) continue; // not on the page — never describe what isn't there
      await say(s.say);
    }
    let phone: LiveFacts | null = null;
    if (!stopRef.current) {
      setAt("phone");
      onDevice?.("phone");
      await new Promise((r) => setTimeout(r, 900));
      await ask({ type: "aston:goto", id: real[0]?.id ?? "top" });
      phone = await ask({ type: "aston:facts" });
      await say(phone
        ? phone.overflowX ? `On a phone-sized screen, ${phone.width} pixels wide, the page scrolls sideways — that needs fixing before it goes to the client.` : `And on a phone-sized screen, ${phone.width} pixels wide, everything fits with no sideways scrolling.`
        : "I couldn't measure the phone layout from here.");
      if (errors.current.length) await say(`The page reported ${errors.current.length} script error${errors.current.length === 1 ? "" : "s"}.`);
      await say("Would you like me to change anything, or is this version ready for approval?");
    }
    setRunning(false); setAt(null);
    if (!stopRef.current && onEnd) { setCaption(null); onEnd({ phone, errors: errors.current }); } // the caller asks the closing question
  }, [ask, onDevice, onEnd, running, say, steps]);

  const stop = useCallback(() => { stopRef.current = true; try { window.speechSynthesis?.cancel(); } catch { /* none */ } setRunning(false); setCaption(null); setAt(null); }, []);
  useImperativeHandle(ref, () => ({ start: () => void start(), stop }), [start, stop]);

  return (
    <div className="wk">
      <style dangerouslySetInnerHTML={{ __html: WK_CSS }} />
      <div className={`wk-frame ${device}`}>
        <iframe ref={frame} key={url} src={withWalk(url)} title="Demo preview" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
      </div>
      {(running || caption) && (
        <div className="wk-cap" role="status" aria-live="polite">
          <div className="wk-steps">{[...steps.filter((s) => !found || found.includes(s.id)).map((s) => s.id), "phone"].map((id) => <span key={id} className={id === at ? "on" : ""} />)}</div>
          <p>{caption}</p>
          {running ? <button type="button" onClick={stop}>Stop</button> : <button type="button" onClick={() => setCaption(null)}>Close</button>}
        </div>
      )}
    </div>
  );
});

const WK_CSS = `
.wk{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;background:#0b1020}
.wk-frame{flex:1;min-height:0;display:flex;justify-content:center;padding:0}
.wk-frame iframe{border:0;width:100%;height:100%;background:#fff;transition:width .35s ease}
.wk-frame.phone{padding:12px 0;background:#0b1020}.wk-frame.phone iframe{width:390px;max-width:100%;border-radius:22px;box-shadow:0 20px 50px -20px rgba(0,0,0,.7)}
.wk-cap{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);width:min(640px,calc(100% - 24px));background:rgba(8,12,24,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f1f5f9;border:1px solid rgba(56,189,248,.35);border-radius:16px;padding:12px 14px;display:grid;grid-template-columns:1fr auto;gap:8px 12px;align-items:center;box-shadow:0 20px 40px -20px rgba(0,0,0,.7)}
.wk-cap p{margin:0;font-size:15px;line-height:1.45}.wk-cap button{min-height:40px;padding:0 14px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:#13203a;color:#fff;cursor:pointer}
.wk-steps{grid-column:1/-1;display:flex;gap:4px}.wk-steps span{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.15)}.wk-steps span.on{background:#38bdf8}
`;
