"use client";

import { useEffect, useState } from "react";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** "Install JARVIS" — Chrome's own install prompt when the phone offers it; otherwise how to do it by hand. */
export function InstallButton() {
  const [evt, setEvt] = useState<PromptEvent | null>(null);
  const [state, setState] = useState<"unknown" | "installed" | "ios" | "ready" | "manual" | "done">("unknown");

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
    if (standalone) { setState("installed"); return; }
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { setState("ios"); return; }
    const on = (e: Event) => { e.preventDefault(); setEvt(e as PromptEvent); setState("ready"); };
    window.addEventListener("beforeinstallprompt", on);
    window.addEventListener("appinstalled", () => setState("done"));
    const t = setTimeout(() => setState((s) => (s === "unknown" ? "manual" : s)), 2500);
    return () => { window.removeEventListener("beforeinstallprompt", on); clearTimeout(t); };
  }, []);

  const box = { borderRadius: 14, padding: "14px 16px", background: "#0f2742", border: "1px solid #2563EB" } as const;
  if (state === "installed") return <div style={box}>✓ You&apos;re using the JARVIS app.</div>;
  if (state === "done") return <div style={box}>✓ Installed — open <b>JARVIS</b> from your home screen.</div>;
  if (state === "ios") return <div style={box}>On iPhone: tap <b>Share</b> → <b>Add to Home Screen</b> (steps below).</div>;
  if (state === "ready" && evt) {
    return (
      <button type="button" onClick={async () => { await evt.prompt(); const c = await evt.userChoice; if (c.outcome === "accepted") setState("done"); }}
        style={{ ...box, background: "#2563EB", color: "#fff", font: "inherit", fontWeight: 600, fontSize: 17, cursor: "pointer", textAlign: "center" }}>
        Install JARVIS
      </button>
    );
  }
  return <div style={box}>{state === "unknown" ? "Checking whether this browser can install apps…" : <>Use your browser&apos;s menu to install: in Chrome, <b>⋮ → Install app</b> or <b>Add to Home screen</b>.</>}</div>;
}
