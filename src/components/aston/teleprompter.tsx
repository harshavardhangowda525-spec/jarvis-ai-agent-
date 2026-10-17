"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptSection } from "@/lib/plans/schema";

/**
 * ASTON's teleprompter: big readable text for recording, adjustable size and
 * speed, play/pause auto-scroll, section jumps, mirror mode and a reading
 * line. Keyboard: space = play/pause, ↑/↓ = speed, +/− = size, ←/→ = section.
 * Your size/speed are remembered on this device only.
 */

const PREF_KEY = "aston.tp.prefs";
type Prefs = { size: number; speed: number; mirror: boolean };
const DEFAULTS: Prefs = { size: 34, speed: 40, mirror: false };

function loadPrefs(): Prefs {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Partial<Prefs>) }; } catch { return DEFAULTS; }
}

export function Teleprompter({ sections, heading, sub, toolbar }: { sections: PromptSection[]; heading: string; sub?: string; toolbar?: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const scroller = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const carry = useRef(0);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => { setPrefs(loadPrefs()); }, []);
  const update = useCallback((p: Partial<Prefs>) => setPrefs((cur) => {
    const next = { ...cur, ...p, size: Math.min(80, Math.max(18, p.size ?? cur.size)), speed: Math.min(200, Math.max(5, p.speed ?? cur.speed)) };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  }), []);

  // auto-scroll at `speed` px/s
  useEffect(() => {
    if (!playing) { if (raf.current) cancelAnimationFrame(raf.current); raf.current = null; last.current = null; return; }
    const tick = (t: number) => {
      const el = scroller.current;
      if (!el) return;
      if (last.current != null) {
        carry.current += ((t - last.current) / 1000) * prefs.speed;
        const step = Math.floor(carry.current);
        if (step) { el.scrollTop += step; carry.current -= step; }
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) { setPlaying(false); return; }
      }
      last.current = t;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, prefs.speed]);

  // keep the screen on while it scrolls
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (playing && nav.wakeLock) nav.wakeLock.request("screen").then((w) => { wake.current = w; }).catch(() => {});
    if (!playing && wake.current) { void wake.current.release().catch(() => {}); wake.current = null; }
  }, [playing]);

  // which section is at the reading line
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => {
      const line = el.getBoundingClientRect().top + el.clientHeight * 0.3;
      let cur = sections[0]?.id ?? "";
      for (const s of sections) {
        const h = document.getElementById(`tp-${s.id}`);
        if (h && h.getBoundingClientRect().top <= line) cur = s.id;
      }
      setActive(cur);
    };
    el.addEventListener("scroll", on, { passive: true });
    on();
    return () => el.removeEventListener("scroll", on);
  }, [sections]);

  const jump = useCallback((id: string) => {
    const el = scroller.current, h = document.getElementById(`tp-${id}`);
    if (el && h) el.scrollTo({ top: el.scrollTop + h.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight * 0.18, behavior: "smooth" });
  }, []);
  const go = useCallback((dir: 1 | -1) => {
    const i = sections.findIndex((s) => s.id === active);
    const n = sections[Math.min(sections.length - 1, Math.max(0, i + dir))];
    if (n) jump(n.id);
  }, [active, jump, sections]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "ArrowUp") { e.preventDefault(); update({ speed: prefs.speed + 5 }); }
      else if (e.key === "ArrowDown") { e.preventDefault(); update({ speed: prefs.speed - 5 }); }
      else if (e.key === "+" || e.key === "=") update({ size: prefs.size + 2 });
      else if (e.key === "-") update({ size: prefs.size - 2 });
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [go, prefs.size, prefs.speed, update]);

  const fullscreen = () => { const d = document.documentElement; if (document.fullscreenElement) void document.exitFullscreen(); else void d.requestFullscreen?.().catch(() => {}); };

  return (
    <div className="tp">
      <style dangerouslySetInnerHTML={{ __html: TP_CSS }} />
      <header className="tp-top">
        <div className="tp-title"><strong>{heading}</strong>{sub ? <small>{sub}</small> : null}</div>
        {toolbar}
      </header>
      <nav className="tp-sections" aria-label="Sections">
        {sections.map((s) => (
          <button key={s.id} type="button" className={s.id === active ? "on" : ""} aria-current={s.id === active ? "true" : undefined} onClick={() => jump(s.id)}>{s.title.replace(/^Today's niche — /, "Niche: ")}</button>
        ))}
      </nav>
      <div className="tp-stage">
        <div className="tp-line" aria-hidden="true" />
        <div ref={scroller} className={`tp-scroll${prefs.mirror ? " mirror" : ""}`} style={{ fontSize: prefs.size }} tabIndex={0} aria-label="Script">
          <div className="tp-pad" />
          {sections.map((s) => (
            <section key={s.id} className="tp-sec">
              <h2 id={`tp-${s.id}`}>{s.title}</h2>
              {s.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para.split("\n").map((ln, j) => <span key={j}>{j ? <br /> : null}{ln}</span>)}</p>)}
            </section>
          ))}
          <div className="tp-pad end"><p>— End of today&apos;s plan —</p></div>
        </div>
      </div>
      <footer className="tp-ctl" aria-label="Teleprompter controls">
        <button type="button" className="tp-play" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
        <button type="button" onClick={() => go(-1)} aria-label="Previous section">⟨</button>
        <button type="button" onClick={() => go(1)} aria-label="Next section">⟩</button>
        <label className="tp-range"><span>Speed</span><input type="range" min={5} max={200} step={5} value={prefs.speed} onChange={(e) => update({ speed: Number(e.target.value) })} aria-label="Scroll speed" /></label>
        <div className="tp-size" role="group" aria-label="Text size">
          <button type="button" onClick={() => update({ size: prefs.size - 2 })} aria-label="Smaller text">A−</button>
          <span>{prefs.size}</span>
          <button type="button" onClick={() => update({ size: prefs.size + 2 })} aria-label="Larger text">A+</button>
        </div>
        <button type="button" onClick={() => update({ mirror: !prefs.mirror })} aria-pressed={prefs.mirror} title="Mirror for a teleprompter glass">⇋ Mirror</button>
        <button type="button" onClick={() => { scroller.current?.scrollTo({ top: 0, behavior: "smooth" }); setPlaying(false); }}>⤒ Top</button>
        <button type="button" onClick={fullscreen} className="tp-fs">⛶</button>
      </footer>
    </div>
  );
}

const TP_CSS = `
.tp { --bg:#05070c; --ink:#f8fafc; --mute:#94a3b8; --line:rgba(255,255,255,.1); --acc:#f59e0b;
  position: relative; display:flex; flex-direction:column; height: calc(100dvh - var(--tp-offset, 0px)); min-height: 420px; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; overflow: hidden; }
.tp *{box-sizing:border-box}
.tp button{font:inherit;color:inherit;cursor:pointer}
.tp-top{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.tp-title{display:flex;flex-direction:column;min-width:0;margin-right:auto}.tp-title strong{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-title small{color:var(--mute)}
.tp-sections{display:flex;gap:6px;overflow-x:auto;padding:8px 12px;border-bottom:1px solid var(--line);scrollbar-width:none}.tp-sections::-webkit-scrollbar{display:none}
.tp-sections button{flex:none;border:1px solid var(--line);background:#0d1220;border-radius:999px;padding:6px 12px;font-size:13px;min-height:36px;color:var(--mute)}
.tp-sections button.on{background:var(--acc);border-color:var(--acc);color:#111;font-weight:700}
.tp-stage{position:relative;flex:1;min-height:0}
.tp-line{position:absolute;left:0;right:0;top:30%;height:2px;background:linear-gradient(90deg,transparent,rgba(245,158,11,.55),transparent);pointer-events:none;z-index:2}
.tp-scroll{position:absolute;inset:0;overflow-y:auto;padding:0 max(18px,6vw);line-height:1.5;scroll-behavior:auto;outline:none}
.tp-scroll.mirror{transform:scaleX(-1)}
.tp-pad{height:30%}.tp-pad.end{height:70%;color:var(--mute);text-align:center;font-size:.6em}
.tp-sec{max-width:1100px;margin:0 auto 1.6em}
.tp-sec h2{font-size:.62em;letter-spacing:.08em;text-transform:uppercase;color:var(--acc);margin:0 0 .6em;scroll-margin-top:30%}
.tp-sec p{margin:0 0 .8em;font-weight:600;letter-spacing:.005em}
.tp-ctl{display:flex;align-items:center;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--line);background:#0a0e18;flex-wrap:wrap}
.tp-ctl > button,.tp-size button{min-height:44px;min-width:44px;padding:0 12px;border-radius:12px;border:1px solid var(--line);background:#121a2b}
.tp-ctl > button[aria-pressed=true]{border-color:var(--acc);color:var(--acc)}
.tp-play{background:var(--acc)!important;color:#111!important;font-weight:800;border-color:var(--acc)!important;min-width:104px!important}
.tp-range{display:flex;align-items:center;gap:8px;flex:1 1 140px;min-width:120px;color:var(--mute);font-size:13px}.tp-range input{flex:1;accent-color:var(--acc);min-width:0}
.tp-size{display:flex;align-items:center;gap:6px}.tp-size span{min-width:28px;text-align:center;color:var(--mute);font-size:13px}
@media (max-width:640px){.tp-ctl{gap:6px}.tp-fs{display:none}.tp-range{order:5;flex-basis:100%}}
`;
