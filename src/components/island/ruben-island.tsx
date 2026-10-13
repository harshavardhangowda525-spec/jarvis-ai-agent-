"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IslandCard, IslandLead, IslandPending, IslandReply } from "@/lib/robin/island-types";
import { capturePhrase, speak, transcribe, wakeCommand, type Capture, type Speech } from "./voice";
import { desktop, type DesktopSettings } from "./desktop-bridge";
import { CrmDashboard, CRM_CSS, type CrmHandle } from "./crm-dashboard";

/**
 * RUBEN — the Dynamic Island CRM assistant. By default only a thin blue outline;
 * click it (or say "Open CRM") and the CRM dashboard grows out of it as one
 * liquid-glass surface. Voice and typed commands drive the same dashboard.
 * Everything comes from the real CRM (/api/robin/island, /api/robin/…);
 * nothing is sent to a lead from here. Closing keeps the dashboard's state, so
 * it reopens where you left it.
 */

type Mode = "idle" | "listening" | "processing" | "speaking" | "working" | "notice";
type Access = "checking" | "ok" | "signed_out" | "locked" | "offline";
interface Notice { id: string; text: string }

const BLUE = "#2563EB";
const NOTICE_MS = 6000;
const POLL_MS = 60_000;

const DEFAULTS: DesktopSettings = { wake: true, voiceReplies: true, micId: null, launchAtLogin: false, shortcut: "Ctrl+Shift+Space", talkShortcut: "Ctrl+Shift+R" };

function loadLocal(): DesktopSettings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("ruben-island") || "{}") }; } catch { return DEFAULTS; }
}
function saveLocal(s: DesktopSettings) {
  try { localStorage.setItem("ruben-island", JSON.stringify(s)); } catch { /* storage unavailable — settings last for this session */ }
}

/** "Open CRM", "show the CRM", "Hey Rubin open my CRM" — the only words that open the dashboard. */
export function asksForCrm(text: string): boolean {
  return /\b(?:open|show|launch|start|bring up|pull up)\s+(?:the\s+|my\s+)?(?:crm|dashboard)\b/i.test(text);
}

const SIZE: Record<Mode | "away", [number, number]> = {
  idle: [176, 36], listening: [176, 40], processing: [212, 38], speaking: [204, 40], working: [224, 38], notice: [380, 44], away: [252, 36],
};

export function RubenIsland() {
  const bridge = useRef(desktop());
  const [mode, setMode] = useState<Mode>("idle");
  const [access, setAccess] = useState<Access>("checking");
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [say, setSay] = useState("");
  const [card, setCard] = useState<IslandCard | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULTS);
  const [showSettings, setShowSettings] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [typed, setTyped] = useState("");
  const [micError, setMicError] = useState<string | null>(null);

  const leadId = useRef<string | null>(null);
  const pending = useRef<IslandPending | null>(null);
  const capture = useRef<Capture | null>(null);
  const speech = useRef<Speech | null>(null);
  const busy = useRef(false);
  const since = useRef(new Date().toISOString());
  const noticeQueue = useRef<Notice[]>([]);
  const seenNotices = useRef(new Set<string>());
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const modeRef = useRef(mode); modeRef.current = mode;
  const openRef = useRef(open); openRef.current = open;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const inputRef = useRef<HTMLInputElement>(null);
  const crm = useRef<CrmHandle>(null);
  // the glass stays mounted after the first open (last state kept); "shown" drives the animation
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  // ---- settings (desktop app keeps them; a browser tab uses local storage) ----
  useEffect(() => {
    const b = bridge.current;
    if (b) void b.getSettings().then((s) => setSettings({ ...DEFAULTS, ...s })).catch(() => {});
    else setSettings(loadLocal());
  }, []);
  const updateSettings = useCallback((patch: Partial<DesktopSettings>) => {
    const b = bridge.current;
    setSettings((s) => { const n = { ...s, ...patch }; if (!b) saveLocal(n); return n; });
    if (b) void b.setSettings(patch).then((s) => setSettings({ ...DEFAULTS, ...s })).catch(() => {});
  }, []);

  // ---- window sizing / click-through (desktop only) ----
  useEffect(() => {
    if (open) {
      bridge.current?.setOpen(true); // the window grows first, then the glass expands into it
      bridge.current?.setInteractive(true);
      setMounted(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false); // the glass shrinks back into the outline, then the window follows
    const t = setTimeout(() => bridge.current?.setOpen(false), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280);
    return () => clearTimeout(t);
  }, [open]);
  const hover = (on: boolean) => () => bridge.current?.setInteractive(on);

  // ---- reaching JARVIS: signed in? unlocked? online? + notices ----
  const poll = useCallback(async () => {
    let r: Response | null = null;
    try { r = await fetch(`/api/robin/island?since=${encodeURIComponent(since.current)}`, { cache: "no-store" }); } catch { r = null; }
    if (!r) { setAccess("offline"); return false; }
    if (r.status === 401) { setAccess("signed_out"); return true; }
    if (r.status === 423) { setAccess("locked"); return true; }
    if (!r.ok) { setAccess("offline"); return false; }
    const j = await r.json().catch(() => null);
    setAccess("ok");
    if (j?.data?.now) since.current = j.data.now;
    for (const n of (j?.data?.notices ?? []) as Notice[]) {
      if (seenNotices.current.has(n.id)) continue;
      seenNotices.current.add(n.id);
      noticeQueue.current.push(n);
    }
    return true;
  }, []);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>, alive = true, fails = 0;
    const loop = async () => {
      const ok = await poll();
      fails = ok ? 0 : fails + 1;
      // offline: retry soon, backing off to the normal poll interval
      if (alive) t = setTimeout(loop, ok ? POLL_MS : Math.min(POLL_MS, 5000 * 2 ** Math.min(fails, 4)));
    };
    void loop();
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => { alive = false; clearTimeout(t); window.removeEventListener("focus", onFocus); window.removeEventListener("online", onFocus); };
  }, [poll]);

  // show queued notices one at a time while the island is quiet
  useEffect(() => {
    const iv = setInterval(() => {
      if (modeRef.current !== "idle" || openRef.current || busy.current) return;
      const n = noticeQueue.current.shift();
      if (!n) return;
      setNotice(n); setMode("notice");
      setTimeout(() => { setMode((m) => (m === "notice" ? "idle" : m)); setNotice(null); }, NOTICE_MS);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // ---- motion for listening / speaking (only runs in those states) ----
  useEffect(() => {
    if (mode !== "listening" && mode !== "speaking") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (reduced && t - last < 200) return;
      last = t;
      const lv = mode === "listening" ? capture.current?.level() ?? 0 : speech.current?.level() ?? 0;
      bars.current.forEach((el, i) => {
        if (!el) return;
        const shape = 0.55 + 0.45 * Math.sin(i * 1.7 + (reduced ? 0 : t / 140));
        el.style.transform = `scaleY(${Math.max(0.18, Math.min(1, lv * shape * 1.6))})`;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  // ---- speaking ----
  const stopSpeaking = useCallback(() => { speech.current?.stop(); speech.current = null; }, []);
  const talk = useCallback(async (text: string) => {
    if (!text || !settingsRef.current.voiceReplies) return;
    setMode("speaking");
    const s = speak(text);
    speech.current = s;
    await s.done;
    if (speech.current === s) speech.current = null;
  }, []);

  /** A short message in the outline (when the CRM is closed). */
  const flash = useCallback((text: string) => {
    setNotice({ id: `m-${Date.now()}`, text: text.length > 90 ? `${text.slice(0, 88)}…` : text });
    setMode("notice");
    setTimeout(() => { setMode((m) => (m === "notice" ? "idle" : m)); setNotice(null); }, NOTICE_MS);
  }, []);

  // ---- commands ----
  const send = useCallback(async (text: string, opts: { leadId?: string | null } = {}) => {
    const t = text.trim();
    if (!t || busy.current) return;
    busy.current = true;
    stopSpeaking();
    setTranscript(t);
    setMode("processing");
    // an app on this PC? ("open Spotify", "switch to Chrome", "type … in Notepad") — the desktop app decides
    const pc = bridge.current?.pc ? await bridge.current.pc(t).catch(() => null) : null;
    if (pc?.handled) {
      const msg = pc.say || (pc.ok ? "Done." : "That didn't work.");
      setSay(msg);
      if (openRef.current) setCard(pc.ok ? { type: "text", title: "On this PC", text: msg } : { type: "error", text: msg });
      else { setNotice({ id: `pc-${Date.now()}`, text: msg }); }
      busy.current = false;
      await talk(msg);
      if (!openRef.current) { setMode("notice"); setTimeout(() => { setMode((m) => (m === "notice" ? "idle" : m)); setNotice(null); }, 4000); }
      else setMode((m) => (m === "speaking" || m === "processing" ? "idle" : m));
      return;
    }
    const slow = setTimeout(() => setMode((m) => (m === "processing" ? "working" : m)), 1200);
    let reply: IslandReply;
    try {
      const r = await fetch("/api/robin/island", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, leadId: opts.leadId !== undefined ? opts.leadId : leadId.current, pending: pending.current }),
      });
      const j = await r.json().catch(() => null);
      if (r.status === 401) { setAccess("signed_out"); reply = { say: "Please sign in to JARVIS first.", card: { type: "error", text: "You're signed out of JARVIS." } }; }
      else if (r.status === 423) { setAccess("locked"); reply = { say: "JARVIS is locked. Unlock it first.", card: { type: "error", text: "JARVIS is locked." } }; }
      else if (!r.ok || !j?.data) reply = { say: "That didn't work.", card: { type: "error", text: j?.error || `JARVIS answered ${r.status}. Nothing was changed — try again.` } };
      else reply = j.data as IslandReply;
      // "open X": neither an installed app nor a lead — say both, not just "no lead"
      if (pc && !pc.handled && pc.app && reply.card?.type === "error") {
        reply = { ...reply, say: `I couldn't find "${pc.app}" — it isn't an app on this PC or a lead in your CRM.`, card: { type: "error", text: `Not an app on this PC (${pc.hint ?? "no match"}), and no lead matches "${pc.app}".` } };
      }
    } catch {
      setAccess("offline");
      reply = { say: "I can't reach JARVIS right now.", card: { type: "error", text: "JARVIS isn't reachable. Check that it's running — nothing was changed." } };
    } finally {
      clearTimeout(slow);
    }
    if ("leadId" in reply && reply.leadId !== undefined) leadId.current = reply.leadId;
    else if (opts.leadId) leadId.current = opts.leadId;
    pending.current = reply.pending ?? null;
    setSay(reply.say);
    // the dashboard shows the answer: lists become the list, a lead opens in the detail pane
    const c = reply.card;
    if (c?.type === "leads") crm.current?.showResults(c.title, c.leads);
    else if (c?.type === "lead") crm.current?.openLead(c.lead.id);
    else if (c?.type === "followups") crm.current?.showFollowups();
    else if (c?.type === "done") { if (c.lead) crm.current?.openLead(c.lead.id); else crm.current?.refresh(); }
    if (reply.open === false) { setCard(null); setShowSettings(false); }
    else if (reply.card || reply.open) {
      // only answers that aren't already on the dashboard stay as a banner
      setCard(c && ["confirm", "error", "text"].includes(c.type) ? c : null);
    }
    // the CRM opens only when you ask for it ("Open CRM", a click, the shortcut) — never by itself
    if (asksForCrm(t)) setOpen(true);
    busy.current = false;
    await talk(reply.say);
    if (reply.open === false) setOpen(false);
    setMode((m) => (m === "speaking" || m === "processing" || m === "working" ? "idle" : m));
    if (!openRef.current && reply.open !== false && reply.say) flash(reply.say);
  }, [stopSpeaking, talk, flash]);

  const getMic = useCallback(async () => {
    const id = settingsRef.current.micId;
    return navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true } })
      .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
  }, []);

  const listen = useCallback(async () => {
    if (busy.current) return;
    if (capture.current) { capture.current.stop(); return; } // second press ends the phrase
    stopSpeaking();
    setMicError(null);
    let stream: MediaStream;
    try { stream = await getMic(); } catch {
      setMicError("Microphone blocked or missing — type below, or allow the mic.");
      if (!openRef.current) flash("Microphone blocked or missing.");
      return;
    }
    setTranscript("");
    setMode("listening");
    const c = capturePhrase(stream);
    capture.current = c;
    const blob = await c.done;
    capture.current = null;
    stream.getTracks().forEach((tr) => tr.stop());
    if (!blob) { setMode("idle"); setTranscript(""); return; }
    setMode("processing");
    const res = await transcribe(blob);
    if ("error" in res) {
      // say it too — a silent card is easy to miss when you're talking, not looking
      setSay("I couldn't hear that — type it below instead."); setCard({ type: "error", text: res.error });
      await talk("I couldn't understand the audio. You can type the command instead.");
      setMode("idle");
      if (!openRef.current) flash(res.error);
      return;
    }
    if (!res.text) { setMode("idle"); setSay("I didn't catch that."); if (!openRef.current) flash("I didn't catch that."); return; }
    await send(res.text);
  }, [getMic, send, stopSpeaking, talk, flash]);

  // ---- wake phrase ("Open CRM" / "Hey Ruben …"): only while idle and collapsed ----
  useEffect(() => {
    if (!settings.wake || access !== "ok") return;
    let alive = true, stream: MediaStream | null = null, cur: Capture | null = null;
    (async () => {
      try { stream = await getMic(); } catch { setMicError("Wake phrase needs the microphone."); return; }
      while (alive) {
        if (busy.current || openRef.current || modeRef.current !== "idle" || capture.current) { await new Promise((r) => setTimeout(r, 500)); continue; }
        // only short phrases are checked ("Hey Rubin", "Hey Rubin, open Spotify") — longer talk around you is never sent
        cur = capturePhrase(stream, { waitMs: 60_000, maxMs: 4500, minSpeechMs: 400, silenceMs: 800, dropAtMax: true });
        const blob = await cur.done;
        cur = null;
        if (!alive || !blob || busy.current || openRef.current) continue;
        const res = await transcribe(blob);
        if (!alive || "error" in res) { if ("error" in res) await new Promise((r) => setTimeout(r, 10_000)); continue; }
        const w = wakeCommand(res.text);
        if (!w.woke) continue;
        if (/\bopen (?:the |my )?crm\b/i.test(res.text) && !w.rest.replace(/^open (?:the |my )?crm$/i, "")) { setOpen(true); setSay("CRM open. What do you need?"); await talk("CRM open."); setMode("idle"); continue; }
        if (w.rest) await send(w.rest); // "Hey Rubin, open Notepad" — done without opening the CRM
        else { await talk("Yes?"); setMode("idle"); void listen(); } // "Hey Rubin" — listening, CRM stays closed
      }
    })();
    return () => { alive = false; cur?.stop(); stream?.getTracks().forEach((t) => t.stop()); };
  }, [settings.wake, settings.micId, access, getMic, send, talk, listen]);

  // ---- desktop shortcuts / tray ----
  useEffect(() => {
    const b = bridge.current;
    if (!b) return;
    return b.onCommand((c) => {
      if (c === "toggle") setOpen((o) => !o);
      else if (c === "open") setOpen(true);
      else if (c === "close") { setOpen(false); stopSpeaking(); }
      else if (c === "listen") void listen();
      else if (c === "wake-on" || c === "wake-off") setSettings((s) => ({ ...s, wake: c === "wake-on" }));
      else if (c === "refresh") void poll();
    });
  }, [listen, poll, stopSpeaking]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); stopSpeaking(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stopSpeaking]);

  useEffect(() => {
    if (!showSettings) return;
    void navigator.mediaDevices?.enumerateDevices().then((d) => setMics(d.filter((x) => x.kind === "audioinput"))).catch(() => {});
  }, [showSettings]);

  // ---- capsule: click toggles, drag moves the window ----
  const drag = useRef<{ x: number; y: number; moving: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.screenX, y: e.screenY, moving: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.moving) return;
    if (Math.hypot(e.screenX - d.x, e.screenY - d.y) > 4) { d.moving = true; bridge.current?.dragStart(); }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moving) { bridge.current?.dragEnd(); return; }
    activate();
  };
  const activate = () => {
    if (access === "signed_out") return bridge.current ? bridge.current.openAuth("/login") : void window.open("/login?next=/island", "_blank");
    if (access === "locked") return bridge.current ? bridge.current.openAuth("/unlock") : void window.open("/unlock?next=/island", "_blank");
    if (access === "offline") { void poll(); return; }
    if (mode === "speaking") { stopSpeaking(); setMode("idle"); return; }
    if (mode === "notice") { setMode("idle"); setNotice(null); setOpen(true); void send("Which clients need follow-up today?"); return; }
    setOpen((o) => !o);
  };

  const away = access !== "ok" && access !== "checking";
  const [w, h] = SIZE[away ? "away" : mode];
  const label = away
    ? access === "signed_out" ? "Sign in to use RUBEN" : access === "locked" ? "JARVIS is locked — unlock" : "CRM offline · retrying"
    : mode === "notice" && notice ? notice.text : "";

  return (
    <div className="ri-root">
      <style dangerouslySetInnerHTML={{ __html: CSS + CRM_CSS }} />
      <div className="ri-stage">
        <button
          type="button"
          aria-label={away ? label : open ? "Close RUBEN CRM" : `RUBEN — ${mode}. Open CRM`}
          aria-expanded={open}
          className={`ri-capsule ri-${away ? "away" : mode}`}
          data-mode={away ? access : mode}
          style={{ width: w, height: h }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
          onPointerEnter={hover(true)} onPointerLeave={() => { if (!openRef.current && !drag.current) bridge.current?.setInteractive(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } }}
          onContextMenu={(e) => { e.preventDefault(); if (access === "ok") void listen(); }}
        >
          <span className="ri-ring" aria-hidden />
          <span className="ri-body">
            {(mode === "listening" || mode === "speaking") && !away && (
              <span className="ri-bars" aria-hidden>
                {Array.from({ length: mode === "speaking" ? 11 : 7 }, (_, i) => <span key={i} ref={(el) => { bars.current[i] = el; }} />)}
              </span>
            )}
            {mode === "processing" && !away && <span className="ri-dots" aria-hidden><i /><i /><i /></span>}
            {mode === "working" && !away && <span className="ri-work"><span>Working</span><span className="ri-prog" aria-hidden /></span>}
            {label && <span className="ri-label">{label}</span>}
            {mode === "idle" && !away && <span className="ri-label ri-ready"><b>RUBEN</b><i aria-hidden /> {access === "checking" ? "Connecting" : "Ready"}</span>}
          </span>
        </button>
        <span className="sr-only" aria-live="polite">{say}</span>

        {mounted && !away && (
          <>
            <button type="button" className={`ri-closechip ${shown ? "in" : "out"}`} onClick={() => { void send("close crm"); }} onPointerEnter={hover(true)} aria-hidden={!open} tabIndex={open ? 0 : -1}>
              Close CRM <span aria-hidden>✕</span>
            </button>
            <section className={`ri-pop ${shown ? "in" : "out"}`} role="dialog" aria-label="RUBEN CRM" aria-hidden={!open}
              onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
              {card && !showSettings && (
                <div className="ri-banner">
                  <CardView card={card} onLead={(id) => crm.current?.openLead(id)} onSay={(t, id) => void send(t, id ? { leadId: id } : {})} />
                  <button type="button" className="ri-x" aria-label="Dismiss" onClick={() => setCard(null)}>✕</button>
                </div>
              )}
              {showSettings && (
                <div className="ri-settings">
                  <button type="button" className="ri-x" aria-label="Close settings" onClick={() => setShowSettings(false)}>✕</button>
                  <Settings settings={settings} mics={mics} onChange={updateSettings} isDesktop={!!bridge.current} />
                </div>
              )}
              <CrmDashboard ref={crm} active={open} micOn={mode === "listening"} onMic={() => void listen()}
                onSettings={() => setShowSettings((v) => !v)} onClose={() => { void send("close crm"); }}
                onSelectLead={(id) => { leadId.current = id; }} onCommand={(t, id) => void send(t, id ? { leadId: id } : {})} />
            </section>
            {/* what RUBEN heard / is doing — and a place to type */}
            <form className={`ri-pill ${shown ? "in" : "out"}`} aria-hidden={!open} onPointerEnter={hover(true)}
              onSubmit={(e) => { e.preventDefault(); const t = typed; setTyped(""); void send(t); }}>
              {mode === "listening" || mode === "processing" || mode === "working" || (transcript && !typed && document.activeElement !== inputRef.current) ? (
                <button type="button" className="ri-pill-say" onClick={() => setTimeout(() => inputRef.current?.focus(), 0)}>
                  <span className="k">{mode === "listening" ? "Listening…" : mode === "processing" || mode === "working" ? "Working on it…" : "Heard"}</span>
                  {transcript ? <span className="q">“{transcript}”</span> : null}
                  {say && mode !== "listening" ? <span className="a">{say}</span> : null}
                </button>
              ) : null}
              {micError && !transcript && <span className="ri-pill-warn" role="status">{micError}</span>}
              <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Ask RUBEN — “Show my interested leads”" aria-label="Type a command" tabIndex={open ? 0 : -1} />
            </form>
            {!bridge.current && open && <p className="ri-note">Browser preview — the RUBEN desktop app (npm run rubin) keeps the island on top of other apps.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function CardView({ card, onLead, onSay }: { card: IslandCard; onLead: (id: string) => void; onSay: (text: string, leadId?: string) => void }) {
  if (card.type === "leads") {
    return (
      <div className="ri-card">
        <div className="ri-ct">{card.title}</div>
        {card.leads.length === 0 ? <p className="ri-empty">None right now.</p> : (
          <ul className="ri-list">{card.leads.map((l) => <LeadRow key={l.id} lead={l} onClick={() => onLead(l.id)} />)}</ul>
        )}
      </div>
    );
  }
  if (card.type === "followups") {
    return (
      <div className="ri-card">
        <div className="ri-ct">{card.title}</div>
        {card.items.length === 0 ? <p className="ri-empty">Nothing due.</p> : (
          <ul className="ri-list">{card.items.map((f) => (
            <li key={f.id}><button type="button" className="ri-row" onClick={() => onLead(f.leadId)}>
              <span className="ri-n">{f.name}</span>
              <span className={`ri-m ${f.overdue ? "late" : ""}`}>{f.overdue ? "Overdue · " : ""}{f.when} — {f.action}</span>
            </button></li>
          ))}</ul>
        )}
      </div>
    );
  }
  if (card.type === "lead") {
    const l = card.lead;
    return (
      <div className="ri-card">
        <div className="ri-ct">{l.number != null ? `#${l.number} · ` : ""}{l.name}</div>
        <div className="ri-m">{[l.category, l.city].filter(Boolean).join(" · ")} — <b>{l.stageLabel}</b></div>
        <dl className="ri-dl">
          {l.phone && <><dt>Phone</dt><dd>{l.phone}</dd></>}
          {l.email && <><dt>Email</dt><dd>{l.email}</dd></>}
          {l.instagram && <><dt>Instagram</dt><dd>{l.instagram}</dd></>}
          {l.website && <><dt>Website</dt><dd>{l.website}</dd></>}
          {l.lastContact && <><dt>Last contact</dt><dd>{l.lastContact}</dd></>}
          {l.nextFollowUp && <><dt>Next follow-up</dt><dd>{l.nextFollowUp}</dd></>}
        </dl>
        {l.notes && <p className="ri-notes">{l.notes}</p>}
        {l.recent.length > 0 && <ul className="ri-recent">{l.recent.slice(0, 3).map((r, i) => <li key={i}><span>{r.when}</span> {r.text}</li>)}</ul>}
        <div className="ri-acts">
          <button type="button" onClick={() => onSay("mark this lead as interested", l.id)}>Interested</button>
          <button type="button" onClick={() => onSay("mark this lead as ready to purchase", l.id)}>Ready to purchase</button>
          <button type="button" onClick={() => onSay("mark this lead as rejected", l.id)}>Rejected</button>
          <button type="button" onClick={() => onSay("schedule a follow-up for tomorrow", l.id)}>Follow up tomorrow</button>
          <button type="button" onClick={() => onSay("prepare a pitch for this business", l.id)}>Prepare pitch</button>
        </div>
      </div>
    );
  }
  if (card.type === "confirm") {
    return (
      <div className="ri-card ri-confirm" role="alertdialog" aria-label="Confirm">
        <p>{card.question}</p>
        <div className="ri-acts"><button type="button" className="yes" onClick={() => onSay("yes")}>Yes, do it</button><button type="button" onClick={() => onSay("no")}>Cancel</button></div>
      </div>
    );
  }
  if (card.type === "done") {
    return <div className="ri-card ri-done"><p>✓ {card.text}</p>{card.lead && <ul className="ri-list"><LeadRow lead={card.lead} onClick={() => onLead(card.lead!.id)} /></ul>}</div>;
  }
  if (card.type === "error") return <div className="ri-card ri-err" role="alert"><p>{card.text}</p></div>;
  return (
    <div className="ri-card">
      {card.title && <div className="ri-ct">{card.title}</div>}
      <p className="ri-text">{card.text}</p>
      {card.text.length > 120 && <div className="ri-acts"><button type="button" onClick={() => void navigator.clipboard?.writeText(card.text).catch(() => {})}>Copy</button></div>}
    </div>
  );
}

function LeadRow({ lead, onClick }: { lead: IslandLead; onClick: () => void }) {
  return (
    <li><button type="button" className="ri-row" onClick={onClick}>
      <span className="ri-n">{lead.number != null ? `#${lead.number} ` : ""}{lead.name}</span>
      <span className="ri-m">{[lead.category, lead.city].filter(Boolean).join(" · ")}{lead.nextFollowUp ? ` · next ${lead.nextFollowUp}` : ""}</span>
      <span className={`ri-pill s-${lead.stage}`}>{lead.stageLabel}</span>
    </button></li>
  );
}

function Settings({ settings, mics, onChange, isDesktop }: { settings: DesktopSettings; mics: MediaDeviceInfo[]; onChange: (p: Partial<DesktopSettings>) => void; isDesktop: boolean }) {
  return (
    <div className="ri-card ri-set">
      <label>Microphone
        <select value={settings.micId ?? ""} onChange={(e) => onChange({ micId: e.target.value || null })}>
          <option value="">System default</option>
          {mics.map((m, i) => <option key={m.deviceId || i} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>)}
        </select>
      </label>
      <label className="ri-chk"><input type="checkbox" checked={settings.wake} onChange={(e) => onChange({ wake: e.target.checked })} />
        Wake phrase (“Open CRM”, “Hey Ruben…”)</label>
      <p className="ri-note">While on, each phrase you say near the mic is sent to speech-to-text to check for the wake phrase (uses voice credits).</p>
      <label className="ri-chk"><input type="checkbox" checked={settings.voiceReplies} onChange={(e) => onChange({ voiceReplies: e.target.checked })} /> Spoken replies</label>
      {isDesktop && <>
        <label className="ri-chk"><input type="checkbox" checked={settings.launchAtLogin} onChange={(e) => onChange({ launchAtLogin: e.target.checked })} /> Start RUBEN when I sign in to Windows</label>
        <p className="ri-note">Shortcuts: {settings.shortcut} opens/closes · {settings.talkShortcut} talk</p>
        <button type="button" className="ri-quit" onClick={() => desktop()?.quit?.()}>Quit RUBEN</button>
      </>}
    </div>
  );
}

function MicIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
}
function GearIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
}

const CSS = `
html, body { background: transparent !important; background-image: none !important; min-height: 0 !important; overflow: hidden; }
@property --ri-a { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.ri-root { position: fixed; inset: 0; display: flex; justify-content: center; pointer-events: none; font-family: "Barlow", system-ui, sans-serif; color: #e6edf7; }
.ri-stage { display: flex; flex-direction: column; align-items: center; padding-top: 12px; gap: 10px; width: 100%; height: 100%; box-sizing: border-box; }
.ri-capsule { pointer-events: auto; position: relative; border: 0; padding: 0; background: transparent; border-radius: 999px; cursor: pointer; touch-action: none; user-select: none;
  transition: width .38s cubic-bezier(.2,.9,.25,1.15), height .38s cubic-bezier(.2,.9,.25,1.15); }
.ri-capsule:focus-visible { outline: 2px solid #93c5fd; outline-offset: 3px; }
.ri-ring { position: absolute; inset: 0; border-radius: inherit; padding: 1.5px; pointer-events: none;
  background: linear-gradient(90deg, ${BLUE}cc, #60a5fa, ${BLUE}cc);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
  box-shadow: 0 0 14px ${BLUE}55; }
.ri-processing .ri-ring, .ri-working .ri-ring { background: conic-gradient(from var(--ri-a), ${BLUE}33, ${BLUE}33 60%, #93c5fd 80%, ${BLUE} 90%, ${BLUE}33); animation: ri-spin 1.4s linear infinite; }
.ri-listening .ri-ring { box-shadow: 0 0 18px ${BLUE}99; }
.ri-away .ri-ring { background: linear-gradient(90deg, #64748b, #94a3b8, #64748b); box-shadow: none; }
@keyframes ri-spin { to { --ri-a: 360deg; } }
.ri-body { position: absolute; inset: 1.5px; border-radius: inherit; background: rgba(4,6,12,.86); backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
  display: flex; align-items: center; justify-content: center; gap: 8px; overflow: hidden; padding: 0 14px; }
.ri-idle .ri-body { background: rgba(4,6,12,.55); }
.ri-label { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #dbeafe; letter-spacing: .02em; }
.ri-bars { display: flex; align-items: center; gap: 3px; height: 20px; }
.ri-bars span { width: 3px; height: 20px; border-radius: 2px; background: linear-gradient(#93c5fd, ${BLUE}); transform: scaleY(.2); transform-origin: center; }
.ri-dots { display: flex; gap: 5px; } .ri-dots i { width: 5px; height: 5px; border-radius: 50%; background: #93c5fd; animation: ri-dot 1s ease-in-out infinite; }
.ri-dots i:nth-child(2) { animation-delay: .15s } .ri-dots i:nth-child(3) { animation-delay: .3s }
@keyframes ri-dot { 0%,100% { opacity: .25; transform: translateY(0) } 50% { opacity: 1; transform: translateY(-2px) } }
.ri-work { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; color: #bfdbfe; letter-spacing: .08em; text-transform: uppercase; }
.ri-prog { width: 120px; height: 2px; border-radius: 2px; background: ${BLUE}33; position: relative; overflow: hidden; }
.ri-prog::after { content: ""; position: absolute; inset: 0; width: 40%; background: #60a5fa; animation: ri-ind 1.2s ease-in-out infinite; }
@keyframes ri-ind { from { transform: translateX(-100%) } to { transform: translateX(260%) } }
/* the CRM: one floating liquid-glass surface that grows out of the outline */
.ri-pop { pointer-events: auto; box-sizing: border-box; width: min(900px, calc(100vw - 16px)); flex: 1; min-height: 0;
  display: flex; flex-direction: column; border-radius: 22px; padding: 0; overflow: hidden; position: relative; border-color: rgba(96,165,250,.45) !important;
  background: linear-gradient(165deg, rgba(10,37,64,.78) 0%, rgba(6,22,42,.84) 45%, rgba(3,10,22,.9) 100%);
  backdrop-filter: blur(28px) saturate(1.7); -webkit-backdrop-filter: blur(28px) saturate(1.7);
  border: 1px solid rgba(147,197,253,.2);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), inset 0 0 0 1px rgba(37,99,235,.08), 0 24px 60px rgba(0,0,0,.5), 0 0 34px rgba(37,99,235,.16);
  transform-origin: 50% -40px;
  transition: transform .34s cubic-bezier(.2,.9,.25,1.05), opacity .26s ease, border-radius .34s ease, visibility 0s linear 0s; }
/* a soft reflection across the top of the glass */
.ri-pop::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 46%; pointer-events: none; border-radius: inherit;
  background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,0) 70%); }
.ri-pop.out { transform: translateY(-34px) scale(.16, .05); opacity: 0; border-radius: 999px; visibility: hidden; pointer-events: none;
  transition: transform .28s cubic-bezier(.5,0,.75,0), opacity .22s ease .04s, border-radius .28s ease, visibility 0s linear .28s; }
.ri-pop > * { position: relative; }
.ri-ans { color: #93c5fd; }
.ri-ready { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: #cbd5e1; letter-spacing: .04em; }
.ri-ready b { color: #93c5fd; font-weight: 700; letter-spacing: .12em; } .ri-ready i { width: 1px; height: 12px; background: rgba(148,163,184,.5); }
.ri-stage { gap: 6px !important; }
.ri-closechip { pointer-events: auto; align-self: flex-end; margin-right: max(8px, calc((100vw - 900px) / 2)); display: inline-flex; gap: 8px; align-items: center;
  font: inherit; font-size: 12px; color: #e2e8f0; padding: 5px 12px; border-radius: 10px; cursor: pointer;
  background: rgba(10,37,64,.82); border: 1px solid rgba(147,197,253,.3); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 6px 18px rgba(0,0,0,.35);
  transition: opacity .25s ease, transform .3s ease; }
.ri-closechip span { color: #93c5fd; } .ri-closechip:hover, .ri-closechip:focus-visible { border-color: #60a5fa; outline: none; }
.ri-closechip.out, .ri-pill.out { opacity: 0; transform: translateY(-10px); pointer-events: none; visibility: hidden; }
.ri-pill { pointer-events: auto; flex: none; display: flex; align-items: center; gap: 8px; width: min(520px, calc(100vw - 32px)); margin-bottom: 6px; padding: 5px 6px 5px 14px; border-radius: 14px;
  background: rgba(10,37,64,.85); border: 1px solid rgba(147,197,253,.28); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); box-shadow: 0 10px 26px rgba(0,0,0,.4);
  transition: opacity .25s ease, transform .3s ease; }
.ri-pill-say { flex: none; max-width: 60%; display: flex; gap: 6px; align-items: baseline; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: text; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ri-pill-say .k { font-size: 12.5px; color: #cbd5e1; } .ri-pill-say .q { font-size: 12.5px; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; } .ri-pill-say .a { font-size: 12px; color: #93c5fd; overflow: hidden; text-overflow: ellipsis; }
.ri-pill-warn { flex: none; max-width: 45%; font-size: 11.5px; color: #fcd34d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ri-pill input { flex: 1; min-width: 0; font: inherit; font-size: 12.5px; padding: 6px 8px; border-radius: 9px; border: 0; background: transparent; color: #f1f5f9; }
.ri-pill input:focus { outline: none; background: rgba(2,8,20,.45); }
.ri-pill:has(.ri-pill-say) input:not(:focus) { flex: 0 0 34px; } .ri-pill:has(.ri-pill-say) input:not(:focus)::placeholder { color: transparent; }
.ri-settings { position: absolute; z-index: 6; top: 54px; right: 16px; width: 320px; padding: 12px; border-radius: 14px; background: rgba(6,20,40,.97); border: 1px solid rgba(147,197,253,.25); box-shadow: 0 16px 40px rgba(0,0,0,.5); }
.ri-settings .ri-card { margin-top: 0; }
.ri-banner { position: absolute; z-index: 6; left: 68px; right: 16px; bottom: 14px; } .ri-banner .ri-card { background: rgba(6,20,40,.96); border-color: rgba(147,197,253,.3); box-shadow: 0 12px 30px rgba(0,0,0,.45); max-height: 220px; overflow: auto; }
.ri-banner { position: relative; } .ri-banner .ri-card { margin-top: 0; padding-right: 34px; }
.ri-x { position: absolute; top: 8px; right: 10px; background: none; border: 0; color: #94a3b8; cursor: pointer; font-size: 12px; }
.ri-head { display: flex; align-items: center; gap: 10px; }
.ri-mic { flex: none; width: 34px; height: 34px; border-radius: 50%; border: 1px solid ${BLUE}88; background: ${BLUE}22; color: #bfdbfe; display: grid; place-items: center; cursor: pointer; }
.ri-mic.on { background: ${BLUE}; color: #fff; box-shadow: 0 0 0 4px ${BLUE}44; }
.ri-heard { flex: 1; min-width: 0; } .ri-k { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #93c5fd; }
.ri-t { font-size: 13.5px; color: #f1f5f9; overflow-wrap: anywhere; }
.ri-icon { flex: none; width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(148,163,184,.25); background: rgba(15,23,42,.4); color: #cbd5e1; cursor: pointer; display: grid; place-items: center; font-size: 12px; }
.ri-say { margin: 10px 2px 0; font-size: 14px; color: #e2e8f0; }
.ri-warn { margin: 8px 2px 0; font-size: 12px; color: #fcd34d; }
.ri-card { margin-top: 10px; border-radius: 14px; padding: 10px 12px; background: rgba(15,23,42,.45); border: 1px solid rgba(148,163,184,.16); }
.ri-ct { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #93c5fd; margin-bottom: 6px; }
.ri-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ri-row { width: 100%; text-align: left; display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; padding: 7px 9px; border-radius: 10px; border: 1px solid transparent; background: rgba(2,6,23,.35); color: inherit; cursor: pointer; }
.ri-row:hover, .ri-row:focus-visible { border-color: ${BLUE}88; outline: none; background: ${BLUE}1f; }
.ri-n { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ri-m { grid-column: 1; font-size: 11.5px; color: #94a3b8; } .ri-m.late { color: #fca5a5; }
.ri-pill { grid-column: 2; grid-row: 1 / span 2; align-self: center; font-size: 10.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(148,163,184,.3); color: #cbd5e1; white-space: nowrap; }
.ri-pill.s-ready_to_purchase { border-color: #34d39988; color: #6ee7b7; } .ri-pill.s-interested { border-color: ${BLUE}aa; color: #93c5fd; } .ri-pill.s-lost { border-color: #f8717188; color: #fca5a5; }
.ri-dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 8px 0 0; font-size: 12.5px; } .ri-dl dt { color: #94a3b8; } .ri-dl dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
.ri-notes, .ri-text { font-size: 13px; color: #e2e8f0; white-space: pre-wrap; margin: 8px 0 0; user-select: text; }
.ri-recent { list-style: none; padding: 0; margin: 8px 0 0; font-size: 12px; color: #cbd5e1; } .ri-recent span { color: #64748b; }
.ri-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.ri-acts button, .ri-type button { font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 999px; border: 1px solid ${BLUE}77; background: ${BLUE}1a; color: #dbeafe; cursor: pointer; }
.ri-acts button:hover, .ri-acts button:focus-visible { background: ${BLUE}40; outline: none; }
.ri-confirm p { margin: 0; font-size: 14px; } .ri-confirm .yes { background: ${BLUE}; color: #fff; }
.ri-done p { margin: 0 0 6px; color: #a7f3d0; font-size: 13.5px; } .ri-err p { margin: 0; color: #fecaca; font-size: 13px; } .ri-err { border-color: #f8717155; }
.ri-empty { margin: 0; font-size: 13px; color: #94a3b8; }
.ri-type { display: flex; gap: 6px; margin-top: 10px; }
.ri-type input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 999px; border: 1px solid rgba(148,163,184,.25); background: rgba(2,6,23,.5); color: #f1f5f9; }
.ri-type input:focus { outline: none; border-color: ${BLUE}; }
.ri-type button:disabled { opacity: .4; cursor: default; }
.ri-note { margin: 8px 2px 0; font-size: 11px; color: #64748b; }
.ri-set { display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
.ri-set select { display: block; width: 100%; margin-top: 4px; font: inherit; padding: 5px 8px; border-radius: 8px; background: rgba(2,6,23,.6); color: #f1f5f9; border: 1px solid rgba(148,163,184,.25); }
.ri-quit { align-self: flex-start; font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 999px; border: 1px solid #f8717188; background: #7f1d1d33; color: #fecaca; cursor: pointer; }
.ri-chk { display: flex; gap: 8px; align-items: center; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) {
  .ri-capsule { transition: none; } .ri-pop, .ri-pop.out { transition: none; }
  .ri-processing .ri-ring, .ri-working .ri-ring { animation: none; background: linear-gradient(90deg, ${BLUE}, #93c5fd, ${BLUE}); }
  .ri-dots i, .ri-prog::after { animation: none; } .ri-dots i { opacity: .8; } .ri-prog::after { width: 100%; opacity: .5; }
}
`;
