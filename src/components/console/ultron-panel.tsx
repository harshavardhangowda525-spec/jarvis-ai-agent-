"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Square, PlugZap, Plug, Volume2, VolumeX, ShieldCheck, AlertTriangle, Check, Loader2, Mic, MicOff,
  Eye, X, ExternalLink, RefreshCw, Code2, FileCode, ScrollText, SlidersHorizontal, LogOut, CornerDownLeft,
} from "lucide-react";
import { useUltron, type UltronMode, type FileChange, type UltronEvent } from "@/hooks/useUltron";
import { useRouter } from "next/navigation";
import { useVoice, useResumeVoice } from "@/hooks/useVoice";
import { cn, timeAgo } from "@/lib/utils";
import { classifyTool, goalIntent, toolNode, STATE_WORD, type ActivityState } from "@/lib/ultron-visual";
import { UltronCore, type CoreState, type UltronCoreHandle } from "./ultron/ultron-core";

/**
 * ULTRON — a cinematic, living developer-agent screen. The animated motion core
 * IS the interface: it boots like an AI coming online, idles with constant subtle
 * motion, and changes how it moves for what ULTRON is really doing (listening,
 * thinking, coding, debugging, building, deploying, done). Everything else stays
 * out of the way until it's relevant: a glass command bar, the current operation,
 * and drawers for the log and systems. All state is REAL runtime state from the
 * local ULTRON runtime.
 */
const MODES: { id: UltronMode; label: string }[] = [
  { id: "autonomous", label: "Auto" },
  { id: "confirmation", label: "Confirm" },
  { id: "manual", label: "Manual" },
];

const QUICK: { label: string; text: string }[] = [
  { label: "Build", text: "Build " },
  { label: "Debug", text: "Debug " },
  { label: "Analyze", text: "Analyze this repository and summarize how it's structured" },
  { label: "Deploy", text: "Deploy this project" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function UltronPanel() {
  const e = useUltron();
  const router = useRouter();
  const coreRef = useRef<UltronCoreHandle>(null);
  const [goal, setGoal] = useState("");
  const [url, setUrl] = useState("ws://127.0.0.1:7420");
  const [token, setToken] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [pairMsg, setPairMsg] = useState("");
  const [drawer, setDrawer] = useState<"log" | "systems" | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [ui, setUi] = useState(false); // boot finished → interface emerges
  const [focused, setFocused] = useState(false);
  const [activity, setActivityState] = useState<ActivityState>("thinking");
  const [transient, setTransient] = useState<"success" | "error" | null>(null);
  const [operation, setOperation] = useState("");
  const [deployBanner, setDeployBanner] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const pendingGoal = useRef<string | null>(null);
  const goalText = useRef("");
  const transientTimer = useRef<ReturnType<typeof setTimeout>>();
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();

  const connected = e.conn === "connected";

  // The coding popup appears only once ULTRON has actually written code in
  // this task — never for goals that just read files or run commands.
  const codeCount = e.files.filter((f) => f.preview && f.preview.trim()).length;
  // Deploying: step the code view aside so the deployment stream is visible.
  useEffect(() => { if (activity === "deploying") setCodeOpen(false); }, [activity]);
  const shownFor = useRef(0);
  useEffect(() => {
    if (codeCount === 0) { setCodeOpen(false); shownFor.current = 0; return; }
    if (shownFor.current === 0) { setCodeOpen(true); shownFor.current = codeCount; }
  }, [codeCount]);

  // ---- runtime events → motion ------------------------------------------------
  const flash = useCallback((kind: "success" | "error", ms: number) => {
    setTransient(kind);
    clearTimeout(transientTimer.current);
    transientTimer.current = setTimeout(() => setTransient(null), ms);
  }, []);
  useEffect(() => () => { clearTimeout(transientTimer.current); clearTimeout(settleTimer.current); }, []);
  // Show an activity now, and let it linger a moment after the step ends: a
  // file write takes milliseconds, but you should still SEE ULTRON coding.
  const showActivity = useCallback((a: ActivityState, holdMs?: number) => {
    clearTimeout(settleTimer.current);
    setActivityState(a);
    if (holdMs) settleTimer.current = setTimeout(() => setActivityState(goalIntent(goalText.current)), holdMs);
  }, []);
  useEffect(() => e.onEvent((ev: UltronEvent) => {
    const core = coreRef.current;
    switch (ev.kind) {
      case "goal":
        goalText.current = ev.goal;
        showActivity(goalIntent(ev.goal));
        setOperation(ev.goal);
        core?.activate("NEURAL CORE");
        break;
      case "tool":
        if (ev.status === "running") {
          showActivity(classifyTool(ev.name, ev.label));
          setOperation(ev.label);
          core?.activate(toolNode(ev.name, ev.label));
        } else {
          if (ev.status === "error") core?.diagnostic();
          else if (classifyTool(ev.name, ev.label) === "deploying") { core?.deployComplete(); setDeployBanner(true); setTimeout(() => setDeployBanner(false), 2600); }
          // Between steps: back to thinking (or the debug scan) after a short hold.
          const done = classifyTool(ev.name, ev.label);
          showActivity(ev.status === "error" ? "debugging" : done, done === "thinking" && ev.status !== "error" ? 900 : 2600);
        }
        break;
      case "file": core?.codeBurst(6); core?.activate("REPOSITORY"); showActivity("coding", 2600); break;
      case "terminal": if (ev.exitCode && ev.exitCode !== 0) core?.diagnostic(); break;
      case "result": flash(ev.ok ? "success" : "error", ev.ok ? 1900 : 1500); setOperation(""); break;
      case "stopped": flash("error", 1200); setOperation(""); break;
      case "error": flash("error", 1500); break;
      default: break;
    }
  }), [e.onEvent, flash, showActivity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- sending a command: it travels from the bar into the core first ----------
  const dispatch = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    const r = barRef.current?.getBoundingClientRect();
    if (r && coreRef.current) {
      pendingGoal.current = t;
      coreRef.current.launchCommand(r.left + r.width / 2, r.top + r.height / 2);
      // Safety net if the animation can't run (e.g. the tab is in the background).
      setTimeout(() => { if (pendingGoal.current === t) { pendingGoal.current = null; e.runGoal(t); } }, 1500);
    } else {
      e.runGoal(t);
    }
  }, [e]);
  const onArrive = useCallback(() => {
    const t = pendingGoal.current;
    pendingGoal.current = null;
    if (t) e.runGoal(t);
  }, [e]);

  // ---- hands-free voice ----------------------------------------------------------
  const cmdRef = useRef<(t: string) => void>(() => {});
  const voice = useVoice({ onTranscript: (t) => cmdRef.current(t), autoListen: true, voiceProfile: "ultron" });
  useEffect(() => {
    cmdRef.current = (t: string) => {
      const low = t.toLowerCase().trim();
      // Switching agents by voice — these are never sent to ULTRON as coding goals.
      if (/\b(deactivate|shut ?down|stand ?down|close|exit|leave)\b.*\b(ultron|ultra ?on)\b|^(deactivate|exit|close|stand ?down)[\s!.,]*$|\b(back to|go to|open|return to|switch to) jarvis\b/.test(low)) {
        e.speak("Handing you back to JARVIS."); setTimeout(() => router.push("/dashboard"), 900); return;
      }
      if (/\b(open|go to|switch to|launch|activate)\s+darwin\b/.test(low)) { router.push("/dashboard/darwin"); return; }
      if (/\b(stop|halt|cancel|abort)\b/.test(low)) { e.stop(); return; }
      if (e.conn !== "connected") { setPairMsg("ULTRON isn't connected yet — start it with `npm run ultron` in the edith folder, then pair."); return; }
      // Echo guard: the mic picking up what ULTRON just said is not a new goal.
      const said = norm(e.recentlySpoken());
      if (said && norm(t).length > 3 && said.includes(norm(t))) return;
      if (e.working) { e.speak("I'm still working on the last task. Say stop to cancel it."); return; }
      dispatch(t);
    };
  });
  const enableVoice = useCallback(async () => { const ok = await voice.init(); if (ok) setVoiceOn(true); return ok; }, [voice]);
  useResumeVoice(enableVoice);
  const { setSpeaker } = e;
  const voiceSpeak = voice.speak;
  useEffect(() => { setSpeaker(voiceOn ? (text: string) => voiceSpeak(text) : null); }, [voiceOn, voiceSpeak, setSpeaker]);

  useEffect(() => { setUrl(e.savedUrl); setToken(e.savedToken); }, [e.savedUrl, e.savedToken]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey && ev.shiftKey && (ev.key === "X" || ev.key === "x")) { ev.preventDefault(); e.stop(); }
      if (ev.key === "Escape") { if (!ui) coreRef.current?.skipBoot(); else setDrawer(null); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [e, ui]);

  // Auto-pairing status (the hook pairs by itself on mount).
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  useEffect(() => {
    setPairMsg("Auto-detecting local ULTRON…");
    const t = setTimeout(() => {
      if (!connectedRef.current) setPairMsg("No local ULTRON detected yet. Run `cd edith && npm run ultron`, then click Auto-detect & pair.");
    }, 16000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (connected) setPairMsg(""); }, [connected]);

  // ---- what the core shows -------------------------------------------------------
  const hearing = voiceOn && !voice.muted && voice.status === "recording";
  const coreState: CoreState = !connected ? "offline"
    : transient ?? (e.confirm ? "await" : hearing ? "listening" : e.working ? activity : "idle");
  const word = STATE_WORD[coreState] ?? "AWAKE";
  const project = e.project?.name || (e.workspace ? e.workspace.split(/[\\/]/).filter(Boolean).pop() : null) || "—";
  const branch = e.caps?.git?.branch || (e.caps?.git?.repo ? "—" : "no git");
  const running = e.tasks.find((t) => t.status === "running");
  const opLine = e.working ? (running?.label || operation) : "";

  // Typing: tiny particles answer each character at the caret.
  const measure = useMemo(() => (typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d")), []);
  const onType = (value: string) => {
    if (value.length > goal.length && inputRef.current && coreRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      let w = value.length * 7.5;
      if (measure) { measure.font = "14px Barlow, system-ui, sans-serif"; w = measure.measureText(value).width; }
      coreRef.current.keystroke(r.left + Math.min(w, r.width - 4), r.top + r.height / 2);
    }
    setGoal(value);
  };
  const onBarMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    ev.currentTarget.style.setProperty("--mx", `${ev.clientX - r.left}px`);
    ev.currentTarget.style.setProperty("--my", `${ev.clientY - r.top}px`);
  };
  const submit = () => {
    if (!connected || e.working || !goal.trim()) return;
    dispatch(goal);
    setGoal("");
  };

  const accent = coreState === "offline" ? "text-slate-400" : coreState === "error" ? "text-rose-300" : coreState === "await" || coreState === "deploying" ? "text-violet-300" : "text-cyan-200";

  return (
    <div className="ultron-stage relative h-[calc(100dvh-4rem)] select-none overflow-hidden bg-[#020408]"
      onClick={() => { if (!ui) coreRef.current?.skipBoot(); }}>
      <UltronCore ref={coreRef} state={coreState} level={hearing ? voice.level : 0} onCommandArrive={onArrive}
        onPhase={(p) => { if (p === "ui") setUi(true); }} className="absolute inset-0" />

      {/* soft cinematic vignette */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />

      {!ui && (
        <button onClick={() => coreRef.current?.skipBoot()} className="absolute bottom-5 right-5 z-20 text-[10px] uppercase tracking-[0.3em] text-white/25 transition hover:text-white/60">
          Skip
        </button>
      )}

      {ui && (
        <>
          {/* ===== top-left: project / branch / status ===== */}
          <div className="ultron-emerge absolute left-4 top-4 z-10 flex gap-6 sm:left-6 sm:top-5" style={{ animationDelay: "0.05s" }}>
            <Meta label="Project" value={project} />
            <Meta label="Branch" value={branch} className="hidden sm:block" />
            <Meta label="Status" value={connected ? "Connected" : e.conn === "connecting" ? "Linking…" : "Offline"}
              dot={connected ? "bg-cyan-300" : e.conn === "connecting" ? "bg-amber-300" : "bg-slate-500"} />
          </div>

          {/* ===== top-center: state word ===== */}
          <div className="ultron-emerge pointer-events-none absolute inset-x-0 top-[4.6rem] z-10 flex flex-col items-center sm:top-5" style={{ animationDelay: "0.12s" }}>
            <span key={word} data-ultron-state={coreState} className={cn("hud-display text-xl tracking-[0.35em] transition-colors duration-700 sm:text-2xl", accent)}
              style={{ textShadow: "0 0 18px currentColor", animation: "ultron-word .6s ease both" }}>{word}</span>
            <span className="hud-label mt-0.5 text-[9px] tracking-[0.35em] text-white/35">
              {connected ? `${MODES.find((m) => m.id === e.mode)?.label.toUpperCase() ?? ""} MODE · ${e.provider ? e.provider.split(" ")[0].toUpperCase() : "NO BRAIN"}` : "LOCAL RUNTIME NOT LINKED"}
            </span>
          </div>

          {/* ===== top-right: controls ===== */}
          <div className="ultron-emerge absolute right-3 top-4 z-20 flex items-center gap-1 sm:right-5" style={{ animationDelay: "0.18s" }}>
            <span className="hud-label mr-2 hidden text-[10px] tracking-[0.25em] text-white/40 md:inline">
              SYSTEM: <span className={cn(e.working ? "text-cyan-300" : connected ? "text-white/70" : "text-slate-500")}>{e.working ? "ACTIVE" : connected ? "READY" : "STANDBY"}</span>
            </span>
            <IconBtn title={e.muted ? "Unmute ULTRON" : "Mute ULTRON"} onClick={() => e.setMuted(!e.muted)}>
              {e.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </IconBtn>
            <IconBtn title="Activity log" active={drawer === "log"} onClick={() => setDrawer((d) => (d === "log" ? null : "log"))}><ScrollText className="h-4 w-4" /></IconBtn>
            <IconBtn title="Systems & mode" active={drawer === "systems"} onClick={() => setDrawer((d) => (d === "systems" ? null : "systems"))}><SlidersHorizontal className="h-4 w-4" /></IconBtn>
            <IconBtn title="Back to JARVIS" onClick={() => router.push("/dashboard")}><LogOut className="h-4 w-4" /></IconBtn>
          </div>

          {/* ===== current operation (tertiary) ===== */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[7.6rem] z-10 flex justify-center px-6 sm:bottom-[8.2rem]">
            {opLine && !e.confirm && (
              <div key={opLine} className="flex max-w-xl items-center gap-2 truncate text-[11px] tracking-[0.12em] text-cyan-100/70" style={{ animation: "ultron-word .5s ease both" }}>
                <span className="h-1 w-1 shrink-0 animate-pulse rounded-full bg-cyan-300" />
                <span className="truncate uppercase">{opLine}</span>
              </div>
            )}
          </div>

          {/* ===== deployment complete ===== */}
          {deployBanner && (
            <div className="pointer-events-none absolute inset-x-0 top-[30%] z-20 flex justify-center">
              <span className="hud-display text-lg text-white sm:text-2xl" style={{ animation: "ultron-banner 2.6s ease both", textShadow: "0 0 24px rgba(160,140,255,.9)" }}>DEPLOYMENT COMPLETE</span>
            </div>
          )}

          {/* ===== command bar ===== */}
          <div className="ultron-emerge absolute inset-x-0 bottom-5 z-20 flex flex-col items-center px-3 sm:bottom-7" style={{ animationDelay: "0.25s" }}>
            <div ref={barRef} onPointerMove={onBarMove}
              className={cn("ultron-bar relative w-full rounded-full transition-[max-width,transform] duration-500 ease-out", focused ? "max-w-2xl -translate-y-1" : "max-w-xl", !focused && !goal && "ultron-breathe")}>
              {focused && <span aria-hidden className="ultron-bar-border pointer-events-none absolute -inset-px rounded-full" />}
              <form onSubmit={(ev) => { ev.preventDefault(); submit(); }} className="relative flex items-center gap-2 rounded-full py-1.5 pl-5 pr-1.5">
                <input ref={inputRef} value={goal} onChange={(ev) => onType(ev.target.value)}
                  onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                  disabled={!connected || e.working}
                  placeholder={!connected ? "Activate ULTRON first…" : e.working ? "ULTRON is working…" : voiceOn ? "Speak or command ULTRON…" : "Command ULTRON..."}
                  className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-white shadow-none outline-none ring-0 placeholder:text-white/35 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:opacity-60" />
                <button type="button" onClick={() => (voiceOn ? voice.toggleMute() : enableVoice())} disabled={!connected}
                  title={voiceOn ? (voice.muted ? "Mic muted — tap to unmute" : "Listening — tap to mute") : "Enable hands-free voice"}
                  className={cn("flex h-9 w-9 items-center justify-center rounded-full transition disabled:opacity-30",
                    hearing ? "bg-cyan-300/20 text-cyan-200" : voiceOn && !voice.muted ? "text-cyan-300" : "text-white/45 hover:text-white/80")}>
                  {voiceOn && voice.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
                {e.working ? (
                  <button type="button" onClick={e.stop} title="Stop (Ctrl+Shift+X)"
                    className="flex h-9 items-center gap-1.5 rounded-full border border-rose-300/30 bg-rose-400/10 px-4 text-xs font-medium tracking-wide text-rose-200 transition hover:bg-rose-400/20">
                    <Square className="h-3 w-3" /> Stop
                  </button>
                ) : (
                  <button type="submit" disabled={!connected || !goal.trim()}
                    className="flex h-9 items-center gap-1.5 rounded-full border border-cyan-200/25 bg-cyan-200/10 px-4 text-xs font-medium tracking-wide text-cyan-50 transition hover:bg-cyan-200/20 disabled:opacity-35">
                    Execute <CornerDownLeft className="h-3 w-3 opacity-60" />
                  </button>
                )}
              </form>
            </div>
            <div className="mt-2.5 flex gap-1.5">
              {QUICK.map((q) => (
                <button key={q.label} disabled={!connected || e.working}
                  onClick={() => { setGoal(q.text); requestAnimationFrame(() => { inputRef.current?.focus(); const n = q.text.length; inputRef.current?.setSelectionRange(n, n); }); }}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-white/55 backdrop-blur-md transition hover:border-cyan-200/30 hover:text-cyan-100 disabled:opacity-30">
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* ===== pairing (only when not linked) ===== */}
          {!connected && (
            <div className="ultron-emerge absolute left-1/2 z-30 w-[min(92vw,23rem)] -translate-x-1/2" style={{ bottom: "8.5rem", animationDelay: "0.35s" }}>
              <Glass title="Activate ULTRON">
                <p className="mb-2 text-[11px] text-white/55">
                  Start ULTRON on your machine (<code className="text-cyan-200">cd edith &amp;&amp; npm run ultron</code>), then click Auto-detect — no copy/paste.
                </p>
                <button
                  onClick={async () => {
                    setPairMsg("Detecting local ULTRON…");
                    const r = await e.autoPair(url.trim() || undefined);
                    if (r.ok) { setPairMsg(""); return; }
                    setPairMsg(
                      r.reason === "unreachable" ? "No local ULTRON found. Run `npm run ultron`, then retry."
                      : r.reason === "origin" ? "This site isn't allow-listed. Add it to ULTRON_ALLOWED_ORIGINS, or paste the token below."
                      : "Couldn't auto-pair — paste the token below.",
                    );
                    setShowManual(true);
                  }}
                  disabled={e.conn === "connecting"}
                  className="mb-2 flex w-full items-center justify-center gap-2 rounded-full border border-cyan-200/30 bg-cyan-200/10 px-3 py-2 text-sm text-cyan-50 transition hover:bg-cyan-200/20 disabled:opacity-40"
                >
                  <PlugZap className="h-4 w-4" /> {e.conn === "connecting" ? "Linking…" : "Auto-detect & pair"}
                </button>
                {pairMsg && <p className="mb-2 text-[11px] text-white/50">{pairMsg}</p>}
                <button onClick={() => setShowManual((v) => !v)} className="mb-1 text-[10px] text-white/45 underline decoration-dotted hover:text-cyan-200">
                  {showManual ? "hide manual pairing" : "paste token manually"}
                </button>
                {showManual && (
                  <>
                    <input value={token} onChange={(ev) => setToken(ev.target.value)}
                      onKeyDown={(ev) => { if (ev.key === "Enter" && token.trim()) e.connect(url.trim() || "ws://127.0.0.1:7420", token.trim()); }}
                      placeholder="Paste pairing token" autoFocus
                      className="mb-2 w-full rounded-lg border border-white/15 bg-transparent px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-200/50" />
                    <button onClick={() => e.connect(url.trim() || "ws://127.0.0.1:7420", token.trim())} disabled={!token.trim() || e.conn === "connecting"}
                      className="flex w-full items-center justify-center gap-2 rounded-full border border-cyan-200/30 bg-cyan-200/10 px-3 py-2 text-sm text-cyan-50 transition hover:bg-cyan-200/20 disabled:opacity-40">
                      <PlugZap className="h-4 w-4" /> {e.conn === "connecting" ? "Linking…" : "Activate"}
                    </button>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-white/45">
                      <span className="truncate">Connecting to <code className="text-cyan-200/80">{url || "ws://127.0.0.1:7420"}</code></span>
                      <button onClick={() => setShowAdvanced((v) => !v)} className="ml-2 shrink-0 underline decoration-dotted hover:text-cyan-200">{showAdvanced ? "hide" : "change"}</button>
                    </div>
                    {showAdvanced && (
                      <input value={url} onChange={(ev) => setUrl(ev.target.value)} placeholder="ws://127.0.0.1:7420"
                        className="mt-2 w-full rounded-lg border border-white/15 bg-transparent px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-200/50" />
                    )}
                  </>
                )}
                {e.conn === "unauthorized" && <p className="mt-2 text-[11px] text-rose-300">Pairing rejected — check the token.</p>}
              </Glass>
            </div>
          )}

          {/* ===== confirmation ===== */}
          {e.confirm && (
            <div className="absolute left-1/2 z-30 w-[min(92vw,26rem)] -translate-x-1/2" style={{ bottom: "8.5rem", animation: "ultron-word .45s ease both" }}>
              <Glass title="Approval required">
                <div className="flex items-start gap-2">
                  <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", e.confirm.level === "dangerous" ? "text-rose-300" : "text-violet-300")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{e.confirm.title}</p>
                    {e.confirm.detail && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-2 text-[11px] text-white/75">{e.confirm.detail}</pre>}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => e.answerConfirm(false)} className="flex-1 rounded-full border border-white/15 px-3 py-2 text-sm text-white/60 transition hover:bg-white/5">Cancel</button>
                  <button onClick={() => e.answerConfirm(true)} className={cn("flex-1 rounded-full px-3 py-2 text-sm font-medium text-white transition hover:brightness-110", e.confirm.level === "dangerous" ? "bg-rose-500/80" : "bg-violet-500/70")}>Approve</button>
                </div>
              </Glass>
            </div>
          )}

          {/* ===== drawers ===== */}
          {drawer && (
            <div className="absolute bottom-28 right-3 top-16 z-30 w-[min(92vw,20rem)] sm:right-5" style={{ animation: "ultron-drawer .45s cubic-bezier(.2,.9,.25,1) both" }}>
              {drawer === "log" ? (
                <Glass title="Activity" onClose={() => setDrawer(null)} className="flex h-full flex-col">
                  {e.tasks.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {e.tasks.slice(0, 6).map((t) => (
                        <div key={t.id} className="flex items-center gap-1.5 text-[11px] text-white/80">
                          {t.status === "ok" ? <Check className="h-3 w-3 shrink-0 text-cyan-300" /> : t.status === "error" ? <AlertTriangle className="h-3 w-3 shrink-0 text-rose-300" /> : <Loader2 className="h-3 w-3 shrink-0 animate-spin text-violet-300" />}
                          <span className="truncate">{t.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
                    {e.activity.length === 0 && <p className="text-[11px] text-white/45">{connected ? "Awaiting a command." : "Activate ULTRON to begin."}</p>}
                    {e.activity.slice(0, 40).map((a) => (
                      <div key={a.id} className="flex items-start gap-1.5">
                        <Dot tone={a.tone} />
                        <div className="min-w-0">
                          <p className={cn("text-[11px] leading-snug", a.tone === "error" ? "text-rose-300" : a.tone === "warn" ? "text-amber-200" : "text-white/80")}>{a.text}</p>
                          <p className="text-[9px] text-white/30">{timeAgo(new Date(a.at).toISOString())}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Glass>
              ) : (
                <Glass title="Systems" onClose={() => setDrawer(null)}>
                  {e.caps ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {[["AI", e.caps.aiProvider], ["Workspace", e.caps.workspace], ["Terminal", e.caps.terminal], ["Node", e.caps.node], ["Git", e.caps.git], ["Python", e.caps.python], ["Docker", e.caps.docker]].map(([label, v]: any) => (
                        <div key={label} className="flex items-center gap-1.5 text-[11px]" title={v?.detail}><span className={cn("h-1.5 w-1.5 rounded-full", v?.ok ? "bg-cyan-300" : "bg-white/20")} /><span className="text-white/75">{label}</span></div>
                      ))}
                      {e.caps.deploy && Object.entries(e.caps.deploy).map(([k, v]: any) => (
                        <div key={k} className="flex items-center gap-1.5 text-[11px]"><span className={cn("h-1.5 w-1.5 rounded-full", v.ok ? "bg-cyan-300" : "bg-white/20")} /><span className="text-white/75">{k[0].toUpperCase() + k.slice(1)}</span></div>
                      ))}
                    </div>
                  ) : <p className="text-[11px] text-white/45">Link ULTRON to see its systems.</p>}
                  {e.provider && <p className="mt-3 truncate text-[10px] text-white/40" title={e.provider}>Brain: {e.provider}</p>}
                  <p className="hud-label mb-1.5 mt-3 text-[9px] tracking-[0.25em] text-white/40">APPROVAL MODE</p>
                  <div className="flex gap-1.5">
                    {MODES.map((m) => (
                      <button key={m.id} onClick={() => e.setMode(m.id)} disabled={!connected}
                        className={cn("flex-1 rounded-xl border px-2 py-1.5 text-center transition disabled:opacity-40", e.mode === m.id ? "border-cyan-200/40 bg-cyan-200/10 text-cyan-50" : "border-white/10 text-white/50 hover:border-cyan-200/25")}>
                        <ShieldCheck className="mx-auto mb-0.5 h-3.5 w-3.5" /><div className="text-[10px]">{m.label}</div>
                      </button>
                    ))}
                  </div>
                  {connected && <button onClick={e.disconnect} className="mt-3 flex items-center gap-1.5 text-[11px] text-white/45 hover:text-cyan-200"><Plug className="h-3.5 w-3.5" /> Unlink ULTRON</button>}
                </Glass>
              )}
            </div>
          )}

          {/* ===== re-open code / preview ===== */}
          {connected && (
            <div className="absolute bottom-7 right-3 z-20 hidden flex-col items-end gap-2 sm:right-5 md:flex">
              {!codeOpen && codeCount > 0 && (
                <button onClick={() => setCodeOpen(true)} title="Show the code ULTRON is writing"
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/60 backdrop-blur-md transition hover:text-cyan-100">
                  <Code2 className="h-3.5 w-3.5" /> Code
                </button>
              )}
              {!e.preview && (
                <button onClick={e.requestPreview} title="Preview the built site"
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/60 backdrop-blur-md transition hover:text-cyan-100">
                  <Eye className="h-3.5 w-3.5" /> Preview
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* live coding stream — liquid-glass popup while ULTRON writes files */}
      {codeOpen && codeCount > 0 && <UltronBuildStream files={e.files} working={e.working} onDismiss={() => setCodeOpen(false)} />}
      {/* live website preview — liquid-glass popup */}
      {e.preview && <UltronPreview url={e.preview.url} path={e.preview.path} onDismiss={e.dismissPreview} />}
    </div>
  );
}

/* ---------------- pieces ---------------- */

function Meta({ label, value, dot, className }: { label: string; value: string; dot?: string; className?: string }) {
  return (
    <div className={cn("leading-tight", className)}>
      <div className="hud-label text-[9px] tracking-[0.25em] text-white/35">{label.toUpperCase()}</div>
      <div className="mt-0.5 flex max-w-[11rem] items-center gap-1.5 truncate text-[13px] text-white/85">
        {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, active, children }: { title: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className={cn("flex h-8 w-8 items-center justify-center rounded-full transition", active ? "bg-white/10 text-cyan-100" : "text-white/45 hover:bg-white/5 hover:text-white/85")}>
      {children}
    </button>
  );
}

function Glass({ title, children, onClose, className }: { title: string; children: React.ReactNode; onClose?: () => void; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-3xl border border-white/10 p-4", className)}
      style={{ background: "linear-gradient(150deg, rgba(255,255,255,0.07), rgba(20,30,50,0.35))", backdropFilter: "blur(22px) saturate(140%)", WebkitBackdropFilter: "blur(22px) saturate(140%)", boxShadow: "0 30px 80px -30px rgba(40,180,255,.35), inset 0 1px 0 rgba(255,255,255,.12)" }}>
      <div className="hud-label mb-2.5 flex items-center justify-between text-[9px] tracking-[0.3em] text-white/45">
        <span>{title.toUpperCase()}</span>
        {onClose && <button onClick={onClose} aria-label="Close" className="text-white/40 hover:text-white/80"><X className="h-3.5 w-3.5" /></button>}
      </div>
      {children}
    </div>
  );
}

function Dot({ tone }: { tone: string }) {
  const c = tone === "ok" ? "bg-cyan-300" : tone === "error" ? "bg-rose-300" : tone === "warn" ? "bg-amber-200" : tone === "tool" ? "bg-violet-300" : "bg-white/30";
  return <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", c)} />;
}

/** Liquid-glass popup that streams the CODE as ULTRON writes each file. */
function UltronBuildStream({ files, working, onDismiss }: { files: FileChange[]; working: boolean; onDismiss: () => void }) {
  const coded = useMemo(() => files.filter((f) => f.preview && f.preview.trim()), [files]);
  const [selId, setSelId] = useState<string | null>(null);
  // Follow the latest file while building unless the user pinned one.
  const current = (selId && coded.find((f) => f.id === selId)) || coded[0] || null;
  const codeRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (!selId && codeRef.current) codeRef.current.scrollTop = 0; }, [current?.id, selId]);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-4 lg:justify-end lg:pb-24 lg:pr-6">
      <div
        className="pointer-events-auto relative flex h-[min(78vh,600px)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/15 lg:h-[min(62vh,520px)] lg:max-w-md"
        style={{
          transformOrigin: "center bottom",
          animation: "ev-holo-in 0.9s cubic-bezier(0.22,1,0.36,1) both",
          background: "linear-gradient(145deg, hsl(0 0% 100% / 0.10), hsl(210 60% 12% / 0.34))",
          backdropFilter: "blur(26px) saturate(1.3)",
          WebkitBackdropFilter: "blur(26px) saturate(1.3)",
          boxShadow: "0 24px 80px -24px hsl(var(--accent)/0.6), inset 0 1px 0 hsl(0 0% 100% / 0.22), inset 0 0 40px -20px hsl(var(--accent)/0.5)",
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 z-10 h-px" aria-hidden
          style={{ background: "linear-gradient(90deg, transparent, hsl(var(--accent-bright)), transparent)", boxShadow: "0 0 12px hsl(var(--accent-bright))", animation: "ev-holo-scan 0.9s ease-out both" }} />
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute -inset-y-8 left-0 w-1/3" style={{ background: "linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.10), transparent)", animation: "ev-sheen 5s ease-in-out infinite" }} />
        </div>

        {/* header */}
        <div className="relative flex items-center justify-between border-b border-white/10 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-accent">
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Code2 className="h-3.5 w-3.5" />}
            </span>
            <span className="hud-label text-[10px] tracking-[0.28em] text-accent/80">
              {working ? "ULTRON · WRITING CODE" : "ULTRON · CODE"} {coded.length ? `· ${coded.length} file${coded.length === 1 ? "" : "s"}` : ""}
            </span>
          </div>
          <button onClick={onDismiss} title="Close" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* file tabs */}
        {coded.length > 0 && (
          <div className="relative flex gap-1 overflow-x-auto border-b border-white/10 px-3 py-1.5">
            {selId && (
              <button onClick={() => setSelId(null)} className="shrink-0 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">● live</button>
            )}
            {coded.slice(0, 12).map((f) => (
              <button key={f.id} onClick={() => setSelId(f.id)}
                className={cn("flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition",
                  current?.id === f.id ? "border border-accent/40 bg-accent/15 text-accent-bright" : "text-muted-foreground hover:text-foreground")}>
                <FileCode className="h-3 w-3" /> {f.path.split(/[\\/]/).pop()}
              </button>
            ))}
          </div>
        )}

        {/* code */}
        <div className="relative flex-1 overflow-hidden">
          {current ? (
            <pre ref={codeRef} className="h-full overflow-auto px-4 py-3 text-[11px] leading-relaxed text-foreground/90"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>
              <code>{current.preview}</code>
              {working && !selId && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-accent-bright animate-hud-pulse" />}
            </pre>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {working ? "Analyzing… code will stream here as ULTRON writes files." : "No code written yet."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Liquid-glass popup that shows a LIVE preview of the site ULTRON built,
 *  served from the local ULTRON workspace. */
function UltronPreview({ url, path, onDismiss }: { url: string; path: string; onDismiss: () => void }) {
  const [nonce, setNonce] = useState(0);
  const src = `${url}${url.includes("?") ? "&" : "?"}_=${nonce}`;
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-4">
      <div
        className="pointer-events-auto relative flex w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/15"
        style={{
          height: "min(80vh, 640px)",
          transformOrigin: "center bottom",
          animation: "ev-holo-in 0.9s cubic-bezier(0.22,1,0.36,1) both",
          background: "linear-gradient(145deg, hsl(0 0% 100% / 0.10), hsl(210 60% 12% / 0.30))",
          backdropFilter: "blur(26px) saturate(1.3)",
          WebkitBackdropFilter: "blur(26px) saturate(1.3)",
          boxShadow: "0 24px 80px -24px hsl(var(--accent)/0.6), inset 0 1px 0 hsl(0 0% 100% / 0.22), inset 0 0 40px -20px hsl(var(--accent)/0.5)",
        }}
      >
        {/* one-shot holo scan line on entrance */}
        <div className="pointer-events-none absolute inset-x-0 z-10 h-px" aria-hidden
          style={{ background: "linear-gradient(90deg, transparent, hsl(var(--accent-bright)), transparent)", boxShadow: "0 0 12px hsl(var(--accent-bright))", animation: "ev-holo-scan 0.9s ease-out both" }} />
        {/* moving sheen */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute -inset-y-8 left-0 w-1/3" style={{ background: "linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.12), transparent)", animation: "ev-sheen 5s ease-in-out infinite" }} />
        </div>

        {/* header */}
        <div className="relative flex items-center justify-between border-b border-white/10 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-accent"><Eye className="h-3.5 w-3.5" /></span>
            <span className="hud-label text-[10px] tracking-[0.28em] text-accent/80">LIVE PREVIEW · {path}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setNonce((n) => n + 1)} title="Reload" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
            <a href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>
            <button onClick={onDismiss} title="Close" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {/* the live site inside an inner glass frame */}
        <div className="relative m-3 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white">
          <iframe key={nonce} src={src} title="Website preview" className="h-full w-full" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        </div>
      </div>
    </div>
  );
}
