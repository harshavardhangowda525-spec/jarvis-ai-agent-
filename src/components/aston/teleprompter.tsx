"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clamp, speedPx, type TeleAction } from "@/lib/aston/scripts/commands";
import { detectKind, KIND_LABEL, splitDirections, wordCount, type ScriptDetails, type ScriptKind } from "@/lib/aston/scripts/format";
import { markSelfSpeech, pickVoice, speakableText, voiceLabel } from "@/lib/aston/voice";
import { AstonOrb } from "./aston-orb";
import { Customize, Editor, Library } from "./script-panels";
import { useVoiceCommands, useWakeLock } from "./teleprompter-hooks";
import {
  api, DEFAULT_PREFS, lastPosition, loadPrefs, markSlowGlass, rememberPosition, savePrefs, SIZE_LABEL, SLOW_FRAME, slowGlassKnown, SPACINGS, SPEED_LABEL,
  type Align, type ListRow, type Prefs, type Script,
} from "./teleprompter-shared";

type Phase = "generating" | "ready" | "error" | "edit" | "customize" | "library";
/** idle = still · scroll = auto-scrolling · speak = ASTON reads it aloud (the speech drives the position) */
type Mode = "idle" | "scroll" | "speak";

const GUIDE = 0.3; // the reading line sits at 30% of the reader's height (eyes near the camera)
const AUTO_RESUME_MS = 3000;

function Line({ i, sec, who, text }: { i: number; sec: number; who: string; text: string }) {
  if (who === "client") return <p data-line={i} data-sec={sec} className="tp-client"><span className="tp-tag">Client</span>{text}</p>;
  if (who === "note") return <p data-line={i} data-sec={sec} className="tp-note">[{text.replace(/^\[|\]$/g, "")}]</p>;
  return (
    <p data-line={i} data-sec={sec} data-you="1" className="tp-you">
      {splitDirections(text).map((p, k) => (p.dir ? <span key={k} className="tp-dir">{p.t}</span> : p.slot ? <span key={k} className="tp-slot">{p.t}</span> : p.t))}
    </p>
  );
}

/**
 * ASTON's teleprompter — a floating liquid-glass pop-up over ASTON. Generate
 * → read → control by voice, touch or keyboard; optionally ASTON reads the
 * script aloud with the spoken line highlighted. Playback never changes the
 * stored script; edits are saved explicitly.
 */
export function Teleprompter({ request, scriptId, library, hidden = false, onClose, onMinimize, onSpeak }: {
  request?: string; scriptId?: string; library?: boolean; hidden?: boolean;
  onClose: () => void; onMinimize?: () => void; onSpeak?: (t: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>(library ? "library" : request ? "generating" : "ready");
  const [script, setScript] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [mode, setModeState] = useState<Mode>("idle");
  const [manual, setManual] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [section, setSection] = useState(0);
  const [menu, setMenu] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [heard, setHeard] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ttsVoice, setTtsVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [ttsOk, setTtsOk] = useState(false);
  const [showCards, setShowCards] = useState(false); // phones: the display controls fold away behind "Aa"
  const [slowDevice, setSlowDevice] = useState(false);
  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-transparency: reduce)").matches;
    setSlowDevice(slowGlassKnown() || reduce);
  }, []);
  const lite = prefs.glass === "lite" || (prefs.glass === "auto" && slowDevice);
  const frameTimes = useRef<number[]>([]);

  const panel = useRef<HTMLDivElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const pos = useRef(0);
  const target = useRef<number | null>(null); // a smooth glide goes here (section jumps, restart, speech)
  const modeRef = useRef<Mode>("idle");
  const lastPlay = useRef<Mode>("scroll");
  const curLine = useRef(-1);
  const lines = useRef<{ el: HTMLElement; top: number; sec: number; you: boolean }[]>([]);
  const resumeTimer = useRef<ReturnType<typeof setTimeout>>();
  const speechToken = useRef(0);
  const restoreRatio = useRef<number | null>(null);
  const lastRequest = useRef(request ?? "");

  const setMode = useCallback((m: Mode) => { modeRef.current = m; setModeState(m); if (m !== "idle") lastPlay.current = m; }, []);
  const flash = useCallback((t: string) => { setToast(t); setTimeout(() => setToast((x) => (x === t ? null : x)), 1800); }, []);

  useEffect(() => { setPrefs(loadPrefs()); }, []);
  useEffect(() => { savePrefs(prefs); }, [prefs]);

  // text-to-speech availability + the British voice (voices load asynchronously)
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const pick = () => { const v = pickVoice(); setTtsVoice(v); setTtsOk(!!v || speechSynthesis.getVoices().length > 0); };
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
    return () => speechSynthesis.removeEventListener?.("voiceschanged", pick);
  }, []);

  // ---------------------------------------------------------------- load / generate
  const show = useCallback((s: Script, ratio?: number) => {
    setScript(s); setPhase("ready"); setError(null); setProgress(0); setSection(0);
    pos.current = 0; curLine.current = -1; restoreRatio.current = ratio ?? null;
  }, []);

  const generate = useCallback(async (req: string, extra?: { kind?: ScriptKind; details?: ScriptDetails; id?: string }) => {
    stopSpeech(); setMode("idle"); setPhase("generating"); setError(null);
    try {
      const s = extra?.id
        ? await api<Script>(`/api/aston/scripts/${extra.id}/regenerate`, { method: "POST", body: JSON.stringify({ request: req, kind: extra.kind, details: extra.details }) })
        : await api<Script>("/api/aston/scripts", { method: "POST", body: JSON.stringify({ request: req, kind: extra?.kind, details: extra?.details }) });
      show(s);
      onSpeak?.("Your script is ready.");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't write the script."); setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSpeak, show]);

  const open = useCallback(async (id: string, ratio?: number) => {
    stopSpeech(); setMode("idle");
    try { show(await api<Script>(`/api/aston/scripts/${id}`), ratio); }
    catch (e: any) { setError(e?.message ?? "Couldn't open the script."); setPhase("error"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useEffect(() => {
    if (request) generate(request);
    else if (scriptId) open(scriptId);
    else if (!library) {
      // "open teleprompter": carry on with this tab's script, else the latest one, else the library
      const last = lastPosition();
      if (last) open(last.id, last.ratio);
      else api<{ scripts: ListRow[] }>("/api/aston/scripts?scope=recent").then((r) => (r.scripts[0] ? open(r.scripts[0].id) : setPhase("library"))).catch(() => setPhase("library"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- line positions + the current line
  const measure = useCallback(() => {
    const el = reader.current;
    if (!el) { lines.current = []; return; }
    lines.current = [...el.querySelectorAll<HTMLElement>("[data-line]")].map((n) => ({ el: n, top: n.offsetTop, sec: Number(n.dataset.sec), you: n.dataset.you === "1" }));
  }, []);
  const guidePx = () => (reader.current?.clientHeight ?? 0) * GUIDE;
  const maxScroll = () => { const el = reader.current; return el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0; };

  const clearHighlight = () => { reader.current?.querySelectorAll(".tp-cur").forEach((n) => n.classList.remove("tp-cur")); curLine.current = -1; };
  const highlight = useCallback((i: number) => {
    if (i === curLine.current) return;
    lines.current[curLine.current]?.el.classList.remove("tp-cur");
    curLine.current = i;
    const l = lines.current[i];
    if (l) { l.el.classList.add("tp-cur"); setSection(l.sec); }
  }, []);

  /** The line sitting on the reading line (binary search over measured tops). */
  const lineAt = (scrollTop: number) => {
    const ls = lines.current, y = scrollTop + guidePx() + 4;
    let lo = 0, hi = ls.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (ls[mid].top <= y) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  };

  const sync = useCallback((fromSpeech = false) => {
    const el = reader.current;
    if (!el) return;
    const max = maxScroll();
    const ratio = max > 0 ? el.scrollTop / max : 0;
    setProgress(ratio);
    if (!fromSpeech && modeRef.current !== "speak") highlight(lineAt(el.scrollTop));
    if (script) rememberPosition(script.id, ratio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, script]);

  // re-measure whenever the layout can change; keep the reading position
  useEffect(() => {
    const el = reader.current;
    if (phase !== "ready" || !el) return;
    const keep = restoreRatio.current ?? (maxScroll() > 0 ? el.scrollTop / maxScroll() : 0);
    restoreRatio.current = null;
    const apply = () => {
      measure();
      el.scrollTop = keep * maxScroll(); pos.current = el.scrollTop;
      clearHighlight(); sync();
    };
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { if (!el.clientHeight) return; const r = maxScroll() > 0 ? el.scrollTop / maxScroll() : 0; measure(); el.scrollTop = r * maxScroll(); pos.current = el.scrollTop; sync(); }) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, script, prefs.font, prefs.spacing, prefs.align]);

  // ---------------------------------------------------------------- the scrolling engine (one rAF loop; idle = no loop)
  const px = speedPx(prefs.speed, prefs.font, prefs.spacing);
  const pxRef = useRef(px);
  pxRef.current = px;
  const [gliding, setGliding] = useState(0); // bump to wake the loop for a glide while idle

  useEffect(() => {
    const el = reader.current;
    if (!el || hidden || (mode === "idle" && target.current === null)) return;
    let raf = 0, last = performance.now(), lastUi = 0;
    pos.current = el.scrollTop;
    const frame = (now: number) => {
      const raw = (now - last) / 1000;
      const dt = Math.min(0.1, raw);
      last = now;
      // auto glass: if live blur makes this device drop frames while the text moves, switch to lite glass
      if (prefs.glass === "auto" && !slowDevice && raw > 0) {
        const ft = frameTimes.current;
        ft.push(raw);
        // decide quickly (12 frames or 1.5 s) so a slow phone doesn't stutter for long
        if (ft.length >= 12 || (ft.length >= 4 && ft.reduce((x, y) => x + y, 0) > 1.5)) {
          const median = [...ft].sort((x, y) => x - y)[Math.floor(ft.length / 2)];
          frameTimes.current = [];
          if (median > SLOW_FRAME) { markSlowGlass(); setSlowDevice(true); }
        }
      }
      const max = maxScroll();
      if (target.current !== null) {
        const t = clamp(target.current, 0, max);
        pos.current += (t - pos.current) * Math.min(1, dt * 6);
        if (Math.abs(t - pos.current) < 0.5) { pos.current = t; if (modeRef.current !== "speak") target.current = null; }
      } else if (modeRef.current === "scroll") {
        pos.current = Math.min(max, pos.current + pxRef.current * dt);
        if (pos.current >= max - 0.5) { setMode("idle"); flash("End of script"); }
      }
      el.scrollTop = pos.current;
      if (now - lastUi > 180) { lastUi = now; sync(modeRef.current === "speak"); }
      if (modeRef.current === "idle" && target.current === null) { sync(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, gliding, hidden, sync, setMode, flash, prefs.glass, slowDevice]);

  const glideTo = (top: number) => { target.current = top; setGliding((g) => g + 1); };
  const glideToLine = (i: number) => { const l = lines.current[i]; if (l) glideTo(Math.max(0, l.top - guidePx() + 6)); };

  useWakeLock(mode !== "idle" && !hidden);

  // ---------------------------------------------------------------- read aloud (browser speech, British voice when available)
  function stopSpeech() {
    speechToken.current++;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    markSelfSpeech(false);
    setSpeaking(false);
    if (modeRef.current === "speak") target.current = null;
  }

  const speakFrom = useCallback((start: number) => {
    if (typeof speechSynthesis === "undefined" || !ttsOk) { flash("Read-aloud isn't available in this browser"); return; }
    stopSpeech();
    const token = ++speechToken.current;
    const queue = lines.current.map((l, i) => ({ ...l, i })).filter((l) => l.i >= Math.max(0, start) && l.you);
    if (!queue.length) { flash("Nothing left to read"); return; }
    setMode("speak");
    const next = (k: number) => {
      if (token !== speechToken.current) return; // stopped or restarted meanwhile
      const item = queue[k];
      if (!item) { setMode("idle"); setSpeaking(false); markSelfSpeech(false); flash("Finished reading"); return; }
      const text = speakableText(item.el.textContent ?? "");
      if (!text) { next(k + 1); return; }
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = 0.95; u.pitch = 0.95; // professional, calm
      u.onstart = () => {
        if (token !== speechToken.current) return;
        markSelfSpeech(true); setSpeaking(true);
        highlight(item.i); glideToLine(item.i); // the highlight follows the line actually being spoken
      };
      u.onend = () => { if (token === speechToken.current) { markSelfSpeech(false); next(k + 1); } };
      u.onerror = (e) => {
        if (token !== speechToken.current) return;
        markSelfSpeech(false); setSpeaking(false);
        if (e.error !== "interrupted" && e.error !== "canceled") { setMode("idle"); flash("Read-aloud stopped"); }
      };
      speechSynthesis.speak(u);
    };
    next(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsOk, highlight, flash, setMode]);

  // nothing keeps playing behind a closed/minimised pop-up
  useEffect(() => { if (hidden) { stopSpeech(); setMode("idle"); } }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopSpeech(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- sections
  /** Where each section starts reading: its first line on the reading line. */
  const secTops = () => {
    const firsts: number[] = [];
    for (const l of lines.current) if (firsts[l.sec] === undefined) firsts[l.sec] = Math.max(0, l.top - guidePx() + 6);
    return firsts.filter((t) => t !== undefined);
  };
  const toSection = (dir: 1 | -1 | 0) => {
    const tops = secTops(), cur = reader.current?.scrollTop ?? 0;
    let i = tops.findLastIndex((t) => t <= cur + 8);
    if (dir === 1) i = tops.findIndex((t) => t > cur + 8);
    else if (dir === -1 && i > 0 && cur - tops[i] < 40) i -= 1;
    if (i < 0 || i >= tops.length) { flash(dir === 1 ? "Last section" : "First section"); return; }
    if (modeRef.current === "speak") {
      const first = lines.current.findIndex((l) => l.sec === i && l.you);
      if (first >= 0) speakFrom(first);
    } else glideTo(tops[i]);
  };

  // ---------------------------------------------------------------- actions (touch, keys and voice share these)
  const play = (m: Mode) => {
    setManual(false); clearTimeout(resumeTimer.current);
    if (maxScroll() > 0 && (reader.current?.scrollTop ?? 0) >= maxScroll() - 1) { pos.current = 0; if (reader.current) reader.current.scrollTop = 0; clearHighlight(); sync(); }
    if (m === "speak") speakFrom(curLine.current < 0 ? 0 : curLine.current);
    else { stopSpeech(); setMode("scroll"); }
  };
  const pause = () => { clearTimeout(resumeTimer.current); stopSpeech(); setMode("idle"); };

  const act = useCallback((a: TeleAction) => {
    if (phase !== "ready" && a !== "close") return;
    switch (a) {
      case "start": play("scroll"); break;
      case "resume": play(lastPlay.current); break;
      case "pause": pause(); break;
      case "stop": pause(); glideTo(0); break;
      case "restart": {
        const was = modeRef.current;
        stopSpeech(); clearHighlight();
        if (was === "speak") speakFrom(0); else { glideTo(0); if (was === "scroll") setMode("scroll"); }
        break;
      }
      case "faster": setPrefs((p) => ({ ...p, speed: clamp(p.speed + 1, 1, 10) })); break;
      case "slower": setPrefs((p) => ({ ...p, speed: clamp(p.speed - 1, 1, 10) })); break;
      case "bigger": setPrefs((p) => ({ ...p, font: clamp(p.font + 4, 20, 72) })); break;
      case "smaller": setPrefs((p) => ({ ...p, font: clamp(p.font - 4, 20, 72) })); break;
      case "next": toSection(1); break;
      case "repeat": toSection(-1); break;
      case "edit": pause(); setPhase("edit"); break;
      case "fullscreen": toggleFull(); break;
      case "close": close(); break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, speakFrom]);

  const [voice, retryVoice] = useVoiceCommands(voiceOn && phase === "ready" && !hidden, (a, h) => {
    act(a); setHeard(h); setTimeout(() => setHeard((x) => (x === h ? null : x)), 1600);
  });

  // touching the script while it moves pauses it (optionally carrying on by itself)
  const userTouch = () => {
    if (modeRef.current === "idle" && target.current === null) return;
    target.current = null;
    if (modeRef.current !== "idle") {
      const was = modeRef.current;
      pause(); flash("Paused — you're scrolling");
      if (prefs.autoResume) {
        clearTimeout(resumeTimer.current);
        resumeTimer.current = setTimeout(() => play(was), AUTO_RESUME_MS);
      }
    }
  };
  const userScrolling = () => { if (prefs.autoResume && resumeTimer.current) { clearTimeout(resumeTimer.current); resumeTimer.current = setTimeout(() => play(lastPlay.current), AUTO_RESUME_MS); } };

  const toggleFull = () => {
    const el = panel.current as any;
    if (!document.fullscreenElement && el?.requestFullscreen) el.requestFullscreen().catch(() => flash("Full screen isn't available here"));
    else document.exitFullscreen?.().catch(() => {});
  };
  const close = () => { pause(); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); onClose(); };

  // ---------------------------------------------------------------- modal behaviour: scroll lock, focus, keys
  useEffect(() => {
    if (hidden) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => { document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [hidden]);

  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input,textarea,select");
      if (e.key === "Tab" && panel.current) {
        // keep keyboard focus inside the pop-up
        const f = [...panel.current.querySelectorAll<HTMLElement>("button,input,select,textarea,[href],[tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled") && x.offsetParent);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); if (menu) setMenu(false); else if (phase === "ready") close(); else if (phase !== "generating") setPhase(script ? "ready" : "library"); return; }
      if (phase !== "ready" || typing) return;
      const map: Record<string, TeleAction> = { " ": modeRef.current === "idle" ? "resume" : "pause", ArrowUp: "faster", ArrowDown: "slower", "+": "bigger", "=": "bigger", "-": "smaller", ArrowRight: "next", ArrowLeft: "repeat", f: "fullscreen", r: "restart", e: "edit" };
      const a = map[e.key];
      if (a) { e.preventDefault(); act(a); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act, phase, hidden, menu, script]);

  // ---------------------------------------------------------------- saving / editing
  const patch = async (body: Record<string, unknown>, msg: string) => {
    if (!script) return;
    setBusy(true);
    try { const s = await api<Script>(`/api/aston/scripts/${script.id}`, { method: "PATCH", body: JSON.stringify(body) }); setScript(s); flash(msg); return s; }
    catch (e: any) { flash(e?.message ?? "Couldn't save."); }
    finally { setBusy(false); }
  };
  const rename = () => { const t = window.prompt("Script name", script?.title ?? ""); if (t && t.trim()) patch({ title: t.trim() }, "Renamed"); };
  const regenerate = () => { if (script && window.confirm("Rewrite this script with Groq? Your current text will be replaced.")) generate(script.request, { id: script.id, kind: script.kind, details: script.details }); };

  const flat = useMemo(() => {
    let i = 0;
    return (script?.sections ?? []).map((s, si) => ({ ...s, si, lines: s.lines.map((l) => ({ ...l, i: i++ })) }));
  }, [script]);
  const words = useMemo(() => (script ? wordCount(script.sections) : 0), [script]);
  const secCount = script?.sections.length ?? 0;
  const status = speaking ? "SPEAKING" : mode === "scroll" ? "SCROLLING" : script && phase === "ready" ? "READY" : phase === "generating" ? "WRITING" : "IDLE";
  const chip = script ? `${script.kindLabel} script` : "Teleprompter";
  const chipSub = script ? [script.details?.businessName, script.businessType].filter(Boolean).join(" · ") || script.title : "";
  const playing = mode !== "idle";

  // ================================================================= render
  return (
    <div className={`tpg-layer ${hidden ? "tpg-hidden" : ""} ${lite ? "tpg-lite" : ""}`} aria-hidden={hidden}>
      <div className="tpg-backdrop" onClick={() => prefs.outsideCloses && close()} />
      <div ref={panel} className="tpg-panel" role="dialog" aria-modal="true" aria-labelledby="tpg-title" tabIndex={-1}>
        <div className="tpg-sheen" aria-hidden />
        {/* ------------------------------------------------ header */}
        <header className="tpg-head">
          <div className="tpg-badge" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="4" y="3" width="13" height="18" rx="2.5" /><path d="M7.5 8h6M7.5 11.5h6M7.5 15h3.5" /><circle cx="18" cy="17.5" r="3" /></svg>
          </div>
          <div className="tpg-titles">
            <h2 id="tpg-title">Teleprompter</h2>
            <p>Your script, always in focus.</p>
          </div>
          <div className="tpg-chip" title={script?.title}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>
            <span><b>{chip}</b><small>{chipSub || "—"}</small></span>
          </div>
          <div className="tpg-head-actions">
            <button className="tpg-round" onClick={() => act("edit")} disabled={phase !== "ready"} aria-label="Edit script" title="Edit">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
            </button>
            <button className="tpg-round" onClick={() => act("restart")} disabled={phase !== "ready"} aria-label="Restart script" title="Restart">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" /></svg>
            </button>
            <button className={`tpg-round ${menu ? "tpg-on" : ""}`} onClick={() => setMenu((m) => !m)} aria-label="More" aria-expanded={menu} title="More">⋯</button>
            <button className="tpg-round" onClick={close} aria-label="Close teleprompter" title="Close">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          {menu && (
            <div className="tpg-menu" role="menu">
              {phase === "ready" && script && (script.saved ? <span className="tpg-menu-note">✓ Saved in your library</span> : <button role="menuitem" onClick={() => { setMenu(false); patch({ saved: true }, "Saved to your library"); }}>Save to library</button>)}
              <button role="menuitem" onClick={() => { setMenu(false); pause(); setPhase("library"); }}>Script library</button>
              {phase === "ready" && script && <>
                <button role="menuitem" onClick={() => { setMenu(false); pause(); setPhase("customize"); }}>Customise &amp; regenerate</button>
                <button role="menuitem" onClick={() => { setMenu(false); regenerate(); }}>Regenerate</button>
                <button role="menuitem" onClick={() => { setMenu(false); rename(); }}>Rename</button>
                <button role="menuitem" onClick={() => { setMenu(false); toggleFull(); }}>Full screen</button>
              </>}
              {onMinimize && <button role="menuitem" onClick={() => { setMenu(false); pause(); onMinimize(); }}>Minimise (keeps your place)</button>}
              <label className="tpg-menu-check"><input type="checkbox" checked={prefs.autoResume} onChange={(e) => setPrefs({ ...prefs, autoResume: e.target.checked })} /> Carry on after I scroll</label>
              <label className="tpg-menu-check">Glass
                <select value={prefs.glass} onChange={(e) => setPrefs({ ...prefs, glass: e.target.value as Prefs["glass"] })} aria-label="Glass effect">
                  <option value="auto">Auto{prefs.glass === "auto" && slowDevice ? " (lite on this device)" : ""}</option><option value="full">Full blur</option><option value="lite">Lite (fastest)</option>
                </select>
              </label>
              <label className="tpg-menu-check"><input type="checkbox" checked={prefs.outsideCloses} onChange={(e) => setPrefs({ ...prefs, outsideCloses: e.target.checked })} /> Tap outside to close</label>
            </div>
          )}
        </header>

        <div className="tpg-body">
          {/* ------------------------------------------------ status column */}
          <aside className="tpg-status">
            <div className="tpg-orb"><AstonOrb state={speaking ? "speaking" : mode === "scroll" ? "processing" : "idle"} size={150} paused={hidden || !speaking} /></div>
            <div className={`tpg-state tpg-state-${status.toLowerCase()}`}>
              <span className={`tpg-eq ${speaking ? "tpg-eq-on" : ""}`} aria-hidden><i /><i /><i /><i /></span>
              {status}
            </div>
            <p className="tpg-voice-name">{ttsOk ? voiceLabel(ttsVoice) : "Read-aloud unavailable"}</p>
            <p className="tpg-voice-style">{ttsOk ? "Professional • Calm" : "The teleprompter works without it"}</p>
            {phase === "ready" && ttsOk && (
              <button className={`tpg-pill ${speaking || mode === "speak" ? "tpg-on" : ""}`} onClick={() => (mode === "speak" ? pause() : play("speak"))}>
                {mode === "speak" ? "Stop reading" : "Read aloud"}
              </button>
            )}
            {phase === "ready" && (
              <button className={`tpg-mic tpg-mic-${voice}`} onClick={() => (voice === "on" ? setVoiceOn(false) : (setVoiceOn(true), retryVoice()))} title="Voice commands">
                {voice === "on" ? "● Voice commands on" : voice === "unsupported" ? "Voice commands unavailable" : voice === "denied" ? "Mic blocked — tap to retry" : voice === "needs-tap" ? "Tap to enable voice" : "Voice commands off"}
              </button>
            )}
          </aside>

          {/* ------------------------------------------------ main area */}
          <section className="tpg-main">
            {phase === "ready" && script && (
              <div className="tpg-readerbox">
                <div className="tpg-progress">
                  <div className="tpg-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ transform: `scaleX(${progress})` }} /></div>
                  <span className="tpg-count">{secCount ? `${section + 1} / ${secCount}` : ""}</span>
                  <span className="tpg-pct">{Math.round(progress * 100)}%</span>
                </div>
                <div className="tpg-readwrap">
                <div
                  ref={reader}
                  className={`tpg-reader ${playing ? "tpg-playing" : ""}`}
                  style={{ fontSize: prefs.font, lineHeight: prefs.spacing, textAlign: prefs.align }}
                  onScroll={() => { if (modeRef.current === "idle" && target.current === null) { pos.current = reader.current?.scrollTop ?? 0; sync(); } userScrolling(); }}
                  onPointerDown={userTouch} onWheel={userTouch} onTouchStart={userTouch}
                  tabIndex={0} aria-label={`Script: ${script.title}`}
                >
                  <div style={{ height: `${GUIDE * 100}%` }} aria-hidden />
                  {flat.map((s) => (
                    <section key={s.si} className="tp-sec">
                      <h3 className="tpg-h" data-sechead={s.si}><span>{s.si + 1}.</span> {s.heading || "Section"}</h3>
                      {s.lines.map((l) => <Line key={l.i} i={l.i} sec={s.si} who={l.who} text={l.text} />)}
                    </section>
                  ))}
                  <p className="tp-end">— End of script · {words} words —</p>
                  <div style={{ height: "62%" }} aria-hidden />
                </div>
                <div className="tpg-fade-top" aria-hidden />
                <div className="tpg-fade-bottom" aria-hidden />
                {(heard || toast) && <div className="tpg-toast" role="status">{heard ? `“${heard}”` : toast}</div>}
                </div>
              </div>
            )}

            {phase === "generating" && (
              <div className="tpg-center">
                <div className="tp-pulse" aria-hidden />
                <p className="tp-big">Writing your {KIND_LABEL[detectKind(lastRequest.current || script?.request || "")].toLowerCase()} script…</p>
                <p className="tp-sub">“{(lastRequest.current || script?.request || "").slice(0, 140)}”</p>
              </div>
            )}

            {phase === "error" && (
              <div className="tpg-center">
                <p className="tp-big">That didn&apos;t work.</p>
                <p className="tp-sub">{error}</p>
                <div className="tp-row">
                  {(lastRequest.current || script) && <button className="tp-btn tp-btn-primary" onClick={() => (script ? generate(script.request, { id: script.id, kind: script.kind, details: script.details }) : generate(lastRequest.current))}>Try again</button>}
                  {script && <button className="tp-btn" onClick={() => setPhase("ready")}>Back to the script</button>}
                  <button className="tp-btn" onClick={() => setPhase("library")}>Open library</button>
                </div>
              </div>
            )}

            {phase === "edit" && script && (
              <Editor script={script} busy={busy} onCancel={() => setPhase("ready")} onSave={async (sections) => {
                const keep = progress;
                const s = await patch({ sections }, "Edits saved");
                if (s) { restoreRatio.current = keep; setPhase("ready"); }
              }} />
            )}
            {phase === "customize" && script && (
              <Customize script={script} onCancel={() => setPhase("ready")} onGenerate={(kind, details) => generate(script.request, { id: script.id, kind, details })} />
            )}
            {phase === "library" && (
              <Library onOpen={(id) => open(id)} onClose={() => (script ? setPhase("ready") : close())} onNew={(req) => { lastRequest.current = req; generate(req); }} />
            )}
          </section>
        </div>

        {/* ------------------------------------------------ controls */}
        {phase === "ready" && script && (
          <footer className="tpg-controls">
            <div className={`tpg-cards ${showCards ? "tpg-cards-open" : ""}`}>
              <label className="tpg-card">
                <span className="tpg-card-head"><span>Speed</span><em>{SPEED_LABEL(prefs.speed)}</em></span>
                <input type="range" min={1} max={10} step={1} value={prefs.speed} onChange={(e) => setPrefs({ ...prefs, speed: Number(e.target.value) })} aria-label="Scroll speed" />
              </label>
              <label className="tpg-card">
                <span className="tpg-card-head"><span>Text size</span><em>{SIZE_LABEL(prefs.font)}</em></span>
                <input type="range" min={20} max={72} step={2} value={prefs.font} onChange={(e) => setPrefs({ ...prefs, font: Number(e.target.value) })} aria-label="Text size" />
              </label>
              <label className="tpg-card">
                <span className="tpg-card-head"><span>Alignment</span></span>
                <select value={prefs.align} onChange={(e) => setPrefs({ ...prefs, align: e.target.value as Align })} aria-label="Text alignment">
                  <option value="left">Left</option><option value="center">Center</option><option value="justify">Justified</option>
                </select>
              </label>
              <label className="tpg-card">
                <span className="tpg-card-head"><span>Line spacing</span></span>
                <select value={prefs.spacing} onChange={(e) => setPrefs({ ...prefs, spacing: Number(e.target.value) })} aria-label="Line spacing">
                  {SPACINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <div className="tpg-transport">
              <button className={`tpg-btn ${manual ? "tpg-on" : ""}`} aria-pressed={manual} onClick={() => { if (manual) setManual(false); else { pause(); setManual(true); flash("Manual scroll — drag the script"); } }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-1V4.5a1.5 1.5 0 0 1 3 0V12m0-1V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 15a1.6 1.6 0 0 1 2.6-1.8L8 15" /></svg>
                <span className="tpg-label">Manual scroll</span>
              </button>
              <div className="tpg-play-group">
                <button className="tpg-skip" onClick={() => act("repeat")} aria-label="Previous section">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
                </button>
                <button className="tpg-play" onClick={() => (playing ? pause() : play(lastPlay.current === "speak" && ttsOk ? "speak" : "scroll"))} aria-label={playing ? "Pause" : "Play"}>
                  {playing
                    ? <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
                    : <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>}
                </button>
                <button className="tpg-skip" onClick={() => act("next")} aria-label="Next section">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
                </button>
              </div>
              <button className={`tpg-btn tpg-only-sm ${showCards ? "tpg-on" : ""}`} aria-expanded={showCards} onClick={() => setShowCards((v) => !v)} aria-label="Display settings">Aa</button>
              <button className="tpg-btn" onClick={() => act("restart")}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" /></svg>
                <span className="tpg-label">Restart</span>
              </button>
              <button className="tpg-btn tpg-close" onClick={close}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                Close
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
