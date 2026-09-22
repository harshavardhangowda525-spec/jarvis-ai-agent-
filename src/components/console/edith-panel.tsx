"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Square, PlugZap, Plug, Wifi, WifiOff, Volume2, VolumeX, ShieldCheck,
  AlertTriangle, Check, Loader2, ChevronUp, Cpu, Mic, MicOff,
  Eye, X, ExternalLink, RefreshCw,
} from "lucide-react";
import { useEdith, type EdithMode } from "@/hooks/useEdith";
import { useVoice } from "@/hooks/useVoice";
import { cn, timeAgo } from "@/lib/utils";

/**
 * EDITH dashboard — the sci-fi HUD from the reference: a glowing orb with a live
 * waveform at the center, an Activity Stream (left), Execution/Status (right), a
 * UTC clock header, and voice-command / activity-timeline waveforms along the
 * bottom. Every value is REAL runtime state from the local EDITH runtime — the
 * orb reacts to connection/work state, the streams show actual tool activity.
 */
const MODES: { id: EdithMode; label: string }[] = [
  { id: "autonomous", label: "Auto" },
  { id: "confirmation", label: "Confirm" },
  { id: "manual", label: "Manual" },
];

export function EdithPanel() {
  const e = useEdith();
  const [goal, setGoal] = useState("");
  // Default to the standard local EDITH address so pairing is one paste (token only).
  const [url, setUrl] = useState("ws://127.0.0.1:7420");
  const [token, setToken] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [pairMsg, setPairMsg] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const clock = useUtcClock();

  // Hands-free: spoken commands → EDITH. A ref keeps the callback fresh so the
  // voice hook always calls the latest runGoal/stop without re-initializing.
  const cmdRef = useRef<(t: string) => void>(() => {});
  const voice = useVoice({ onTranscript: (t) => cmdRef.current(t), autoListen: true });
  useEffect(() => {
    cmdRef.current = (t: string) => {
      const low = t.toLowerCase().trim();
      if (/\b(stop|halt|cancel|abort)\b/.test(low)) { e.stop(); return; }
      e.runGoal(t);
    };
  });
  const enableVoice = useCallback(async () => { await voice.init(); setVoiceOn(true); }, [voice]);

  useEffect(() => { setUrl(e.savedUrl); setToken(e.savedToken); }, [e.savedUrl, e.savedToken]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.ctrlKey && ev.shiftKey && (ev.key === "X" || ev.key === "x")) { ev.preventDefault(); e.stop(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [e]);

  const connected = e.conn === "connected";
  const orbState: OrbMode = !connected ? "offline" : e.working ? "working" : e.confirm ? "await" : "online";

  return (
    <div className="edith-root relative min-h-[calc(100vh-4rem)] overflow-hidden">
      {/* ambient background glows */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.18),transparent_60%)] blur-2xl" />
        <div className="absolute inset-0 opacity-[0.5] [background:radial-gradient(1200px_500px_at_50%_-10%,hsl(var(--accent)/0.08),transparent)]" />
      </div>

      {/* ===== HEADER ===== */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-3">
        <div className="hud-panel box-glow-soft flex items-center gap-2.5 rounded-xl px-3 py-2">
          <EdithLogo />
          <span className="hud-display text-lg tracking-[0.3em] text-foreground text-glow">EDITH</span>
          <span className={cn("hud-label ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px]",
            connected ? "bg-success/15 text-success" : "bg-muted-foreground/15 text-muted-foreground")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-success animate-hud-pulse" : "bg-muted-foreground/50")} />
            {connected ? "ONLINE" : e.conn === "connecting" ? "LINKING" : "OFFLINE"}
          </span>
        </div>

        <div className="hud-panel box-glow-soft flex items-center gap-2 rounded-xl px-3 py-2">
          <span className="hud-display text-sm tracking-widest text-accent-bright">{clock} UTC</span>
          {connected ? <Wifi className="h-4 w-4 text-accent" /> : <WifiOff className="h-4 w-4 text-muted-foreground" />}
          <button onClick={() => e.setMuted(!e.muted)} title={e.muted ? "Unmute EDITH" : "Mute EDITH"} className="rounded p-0.5 hover:bg-accent/10">
            {e.muted ? <VolumeX className="h-4 w-4 text-muted-foreground" /> : <Volume2 className="h-4 w-4 text-accent" />}
          </button>
          <button onClick={() => setShowSettings((s) => !s)} title="Systems" className="rounded p-0.5 hover:bg-accent/10"><Cpu className="h-4 w-4 text-accent" /></button>
        </div>
      </div>

      {/* ===== CENTER ORB ===== */}
      <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center">
        <EdithOrb state={orbState} />
        <div className="mt-2 text-center">
          <div className="hud-display text-2xl tracking-[0.4em] text-foreground text-glow">EDITH</div>
          <div className="hud-label text-[10px] tracking-[0.3em] text-accent/80">
            {orbState === "offline" ? "OFFLINE" : orbState === "working" ? "EXECUTING" : orbState === "await" ? "AWAITING CONFIRMATION" : "ONLINE"}
          </div>
        </div>
      </div>

      {/* ===== LEFT: ACTIVITY STREAM ===== */}
      <div className="absolute left-4 top-24 z-10 hidden w-72 lg:block">
        <GlassPanel title="Activity Stream">
          <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
            {e.activity.length === 0 && <p className="text-[11px] text-muted-foreground">{connected ? "Awaiting a command." : "Activate EDITH to begin."}</p>}
            {e.activity.slice(0, 20).map((a) => (
              <div key={a.id} className="rounded-lg border border-accent/10 bg-accent/[0.04] px-2.5 py-1.5">
                <div className="flex items-start gap-1.5">
                  <Dot tone={a.tone} />
                  <span className={cn("text-[11px] leading-snug", a.tone === "error" ? "text-destructive" : a.tone === "warn" ? "text-warning" : "text-foreground/85")}>{a.text}</span>
                </div>
                <div className="hud-label mt-0.5 pl-3 text-[8px] text-muted-foreground">{timeAgo(new Date(a.at).toISOString())}</div>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>

      {/* ===== RIGHT: EXECUTION / STATUS ===== */}
      <div className="absolute right-4 top-24 z-10 hidden w-72 lg:block">
        <GlassPanel title="Execution / Status">
          <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
            {e.tasks.length === 0 && <p className="text-[11px] text-muted-foreground">No tasks running.</p>}
            {e.tasks.map((t) => (
              <div key={t.id} className={cn("rounded-lg border px-2.5 py-1.5",
                t.status === "ok" ? "border-success/25 bg-success/[0.06]" : t.status === "error" ? "border-destructive/30 bg-destructive/[0.06]" : "border-warning/25 bg-warning/[0.06]")}>
                <div className="flex items-center gap-1.5">
                  {t.status === "ok" ? <Check className="h-3.5 w-3.5 text-success" />
                    : t.status === "error" ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    : <Loader2 className="h-3.5 w-3.5 animate-spin text-warning" />}
                  <span className="truncate text-[11px] text-foreground/85">{t.label}</span>
                </div>
                <div className="hud-label mt-0.5 pl-5 text-[8px] text-muted-foreground">
                  {t.status === "ok" ? "completed" : t.status === "error" ? "failed" : "ongoing"} · {timeAgo(new Date(t.at).toISOString())}
                </div>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>

      {/* ===== CONFIRMATION (center modal) ===== */}
      {e.confirm && (
        <div className="absolute left-1/2 top-1/2 z-30 w-[min(92vw,26rem)] -translate-x-1/2 translate-y-24">
          <GlassPanel title="Confirmation Required">
            <div className="flex items-start gap-2">
              <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", e.confirm.level === "dangerous" ? "text-destructive" : "text-warning")} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{e.confirm.title}</p>
                {e.confirm.detail && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-border bg-black/30 p-2 text-[11px] text-foreground/80">{e.confirm.detail}</pre>}
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => e.answerConfirm(false)} className="flex-1 rounded border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/40">Cancel</button>
              <button onClick={() => e.answerConfirm(true)} className={cn("flex-1 rounded px-3 py-2 text-sm font-medium text-white transition", e.confirm.level === "dangerous" ? "bg-destructive hover:brightness-110" : "bg-accent hover:brightness-110")}>Confirm</button>
            </div>
          </GlassPanel>
        </div>
      )}

      {/* ===== PAIRING OVERLAY ===== */}
      {!connected && (
        <div className="absolute left-1/2 top-1/2 z-30 w-[min(92vw,24rem)] -translate-x-1/2 translate-y-28">
          <GlassPanel title="Activate EDITH">
            <p className="mb-2 text-[11px] text-muted-foreground">
              Start EDITH on your machine (<code className="text-accent">cd edith &amp;&amp; npm run edith</code>), then just click Auto-detect — no copy/paste.
            </p>

            {/* Preferred path: auto-read the token from local EDITH's /pair. */}
            <button
              onClick={async () => {
                setPairMsg("Detecting local EDITH…");
                const r = await e.autoPair(url.trim() || undefined);
                if (r.ok) { setPairMsg(""); return; }
                setPairMsg(
                  r.reason === "unreachable" ? "No local EDITH found. Run `npm run edith`, then retry."
                  : r.reason === "origin" ? "This site isn't allow-listed. Add it to EDITH_ALLOWED_ORIGINS, or paste the token below."
                  : "Couldn't auto-pair — paste the token below.",
                );
                setShowManual(true);
              }}
              disabled={e.conn === "connecting"}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent-bright transition hover:bg-accent/20 disabled:opacity-40"
            >
              <PlugZap className="h-4 w-4" /> {e.conn === "connecting" ? "Linking…" : "Auto-detect & pair"}
            </button>
            {pairMsg && <p className="mb-2 text-[11px] text-muted-foreground">{pairMsg}</p>}

            <button onClick={() => setShowManual((v) => !v)} className="mb-1 text-[10px] text-muted-foreground underline decoration-dotted hover:text-accent">
              {showManual ? "hide manual pairing" : "paste token manually"}
            </button>

            {/* Manual fallback: token is the only thing you paste — URL is pre-filled. */}
            {showManual && (
            <>
            <input
              value={token}
              onChange={(ev) => setToken(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter" && token.trim()) e.connect(url.trim() || "ws://127.0.0.1:7420", token.trim()); }}
              placeholder="Paste pairing token"
              autoFocus
              className="mb-2 w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-accent/60"
            />
            <button
              onClick={() => e.connect(url.trim() || "ws://127.0.0.1:7420", token.trim())}
              disabled={!token.trim() || e.conn === "connecting"}
              className="flex w-full items-center justify-center gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent-bright transition hover:bg-accent/20 disabled:opacity-40"
            >
              <PlugZap className="h-4 w-4" /> {e.conn === "connecting" ? "Linking…" : "Activate"}
            </button>

            {/* URL is auto-filled; reveal it only if EDITH runs on a custom host/port. */}
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="truncate">Connecting to <code className="text-accent/80">{url || "ws://127.0.0.1:7420"}</code></span>
              <button onClick={() => setShowAdvanced((v) => !v)} className="ml-2 shrink-0 underline decoration-dotted hover:text-accent">
                {showAdvanced ? "hide" : "change"}
              </button>
            </div>
            {showAdvanced && (
              <input
                value={url}
                onChange={(ev) => setUrl(ev.target.value)}
                placeholder="ws://127.0.0.1:7420"
                className="mt-2 w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-accent/60"
              />
            )}
            </>
            )}
            {e.conn === "unauthorized" && <p className="mt-2 text-[11px] text-destructive">Pairing rejected — check the token.</p>}
          </GlassPanel>
        </div>
      )}

      {/* ===== SETTINGS DRAWER (systems + mode + STOP) ===== */}
      {showSettings && (
        <div className="absolute right-4 top-24 z-40 w-72">
          <GlassPanel title="Systems">
            {e.caps && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {[["AI", e.caps.aiProvider], ["Workspace", e.caps.workspace], ["Terminal", e.caps.terminal], ["Node", e.caps.node], ["Git", e.caps.git], ["Python", e.caps.python], ["Docker", e.caps.docker]].map(([label, v]: any) => (
                  <div key={label} className="flex items-center gap-1.5 text-[11px]"><span className={cn("h-1.5 w-1.5 rounded-full", v?.ok ? "bg-success" : "bg-muted-foreground/40")} /><span className="text-foreground/80">{label}</span></div>
                ))}
                {e.caps.deploy && Object.entries(e.caps.deploy).map(([k, v]: any) => (
                  <div key={k} className="flex items-center gap-1.5 text-[11px]"><span className={cn("h-1.5 w-1.5 rounded-full", v.ok ? "bg-success" : "bg-muted-foreground/40")} /><span className="text-foreground/80">{k[0].toUpperCase() + k.slice(1)}</span></div>
                ))}
              </div>
            )}
            <div className="mt-3 flex gap-1.5">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => e.setMode(m.id)} disabled={!connected} className={cn("flex-1 rounded border px-2 py-1.5 text-center transition disabled:opacity-40", e.mode === m.id ? "border-accent bg-accent/15 text-accent-bright" : "border-border text-muted-foreground hover:border-accent/50")}>
                  <ShieldCheck className="mx-auto mb-0.5 h-3.5 w-3.5" /><div className="hud-label text-[8px]">{m.label}</div>
                </button>
              ))}
            </div>
            {connected && <button onClick={e.disconnect} className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-accent"><Plug className="h-3.5 w-3.5" /> Deactivate</button>}
          </GlassPanel>
        </div>
      )}

      {/* ===== BOTTOM: VOICE-COMMAND INPUT (left) + ACTIVITY TIMELINE (right) ===== */}
      <div className="absolute inset-x-0 bottom-4 z-10 flex items-end justify-between gap-3 px-4">
        <div className="w-full max-w-md">
          <div className="hud-label mb-1 flex items-center gap-2 text-[9px] tracking-[0.25em] text-muted-foreground">
            VOICE-COMMAND INPUT
            {voiceOn && <span className="text-accent">{voice.status === "recording" ? "● listening" : voice.status === "processing" ? "…thinking" : voice.status === "speaking" ? "speaking" : "ready"}</span>}
          </div>
          <form onSubmit={(ev) => { ev.preventDefault(); e.runGoal(goal); setGoal(""); }} className="hud-panel box-glow-soft flex items-center gap-2 rounded-xl px-2 py-1.5">
            <Equalizer active={e.working || voice.status === "recording"} bars={16} className="h-6 w-16 shrink-0" />
            <input value={goal} onChange={(ev) => setGoal(ev.target.value)} disabled={!connected || e.working}
              placeholder={connected ? (voiceOn ? "Speak or type a command…" : "Command EDITH…") : "Activate first"} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50" />
            <button type="button" onClick={() => (voiceOn ? voice.toggleMute() : enableVoice())} disabled={!connected}
              title={voiceOn ? (voice.muted ? "Mic muted — tap to unmute" : "Listening — tap to mute") : "Enable hands-free voice"}
              className={cn("flex h-8 w-8 items-center justify-center rounded border transition disabled:opacity-40",
                voiceOn && !voice.muted ? "border-accent bg-accent/15 text-accent animate-hud-pulse" : "border-border text-muted-foreground hover:border-accent/50")}>
              {voiceOn && voice.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button onClick={e.stop} type="button" title="Stop (Ctrl+Shift+X)" disabled={!connected} className="flex h-8 w-8 items-center justify-center rounded border border-destructive/50 text-destructive transition hover:bg-destructive/15 disabled:opacity-40"><Square className="h-3.5 w-3.5" /></button>
            <button type="submit" disabled={!connected || !goal.trim() || e.working} className="flex h-8 w-8 items-center justify-center rounded bg-accent/15 text-accent transition hover:bg-accent/25 disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </form>
        </div>
        <div className="hidden w-full max-w-md md:block">
          <div className="hud-label mb-1 text-right text-[9px] tracking-[0.25em] text-muted-foreground">ACTIVITY TIMELINE</div>
          <div className="hud-panel box-glow-soft rounded-xl px-3 py-2">
            <Equalizer active={e.working || e.tasks.some((t) => t.status === "running")} bars={64} className="h-8 w-full" />
          </div>
        </div>
      </div>

      {/* live website preview — liquid-glass popup */}
      {e.preview && <EdithPreview url={e.preview.url} path={e.preview.path} onDismiss={e.dismissPreview} />}

      {/* floating "Preview" button once a site exists (re-open after dismiss) */}
      {connected && !e.preview && (
        <button
          onClick={e.requestPreview}
          title="Preview the built site"
          className="absolute bottom-24 right-4 z-30 flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-accent backdrop-blur-md transition hover:bg-accent/20"
        >
          <Eye className="h-3.5 w-3.5" /> Preview
        </button>
      )}
    </div>
  );
}

/** Liquid-glass popup that shows a LIVE preview of the site EDITH built,
 *  served from the local EDITH workspace. */
function EdithPreview({ url, path, onDismiss }: { url: string; path: string; onDismiss: () => void }) {
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

/* ---------------- pieces ---------------- */

type OrbMode = "offline" | "online" | "working" | "await";

function GlassPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="hud-panel box-glow-soft rounded-xl p-3 backdrop-blur-md">
      <div className="hud-label mb-2 flex items-center justify-between text-[9px] tracking-[0.2em] text-accent/80">
        <span>{title.toUpperCase()}</span><ChevronUp className="h-3 w-3 opacity-50" />
      </div>
      {children}
    </div>
  );
}

function Dot({ tone }: { tone: string }) {
  const c = tone === "ok" ? "bg-success" : tone === "error" ? "bg-destructive" : tone === "warn" ? "bg-warning" : tone === "tool" ? "bg-accent" : "bg-accent/50";
  return <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", c)} />;
}

function EdithLogo() {
  return (
    <svg viewBox="0 0 32 32" className="h-6 w-6">
      <circle cx="16" cy="16" r="14" fill="none" stroke="hsl(var(--accent)/0.4)" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="hsl(var(--accent-bright)/0.6)" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="4" fill="hsl(var(--accent-bright))" style={{ filter: "drop-shadow(0 0 4px hsl(var(--accent-bright)))" }} />
    </svg>
  );
}

/** The central glowing orb with concentric rings + a live audio waveform. */
function EdithOrb({ state }: { state: OrbMode }) {
  const color = state === "offline" ? "120,132,150" : state === "working" ? "251,191,36" : state === "await" ? "167,139,250" : "120,200,255";
  const active = state === "working" || state === "online";
  return (
    <div className="relative" style={{ width: "min(56vmin,460px)", height: "min(56vmin,460px)" }}>
      <svg viewBox="0 0 400 400" className="h-full w-full">
        <defs>
          <radialGradient id="edith-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={`rgb(${color})`} stopOpacity="0.9" />
            <stop offset="35%" stopColor={`rgb(${color})`} stopOpacity="0.25" />
            <stop offset="100%" stopColor={`rgb(${color})`} stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* soft core glow */}
        <circle cx="200" cy="200" r="150" fill="url(#edith-core)" />
        {/* concentric rings */}
        {[190, 160, 128, 96].map((r, i) => (
          <circle key={r} cx="200" cy="200" r={r} fill="none" stroke={`rgb(${color})`} strokeOpacity={0.15 + i * 0.08} strokeWidth={1.2}
            strokeDasharray={i % 2 ? "3 7" : undefined}
            style={active ? { transformOrigin: "200px 200px", animation: `edith-spin ${18 + i * 6}s linear infinite ${i % 2 ? "reverse" : ""}` } : undefined} />
        ))}
        {/* tilted orbital ellipses */}
        {[0, 60, 120].map((deg) => (
          <ellipse key={deg} cx="200" cy="200" rx="188" ry="66" fill="none" stroke={`rgb(${color})`} strokeOpacity="0.18" strokeWidth="1"
            transform={`rotate(${deg} 200 200)`}
            style={active ? { transformOrigin: "200px 200px", animation: `edith-spin 26s linear infinite` } : undefined} />
        ))}
      </svg>
      {/* central waveform */}
      <div className="absolute inset-0 flex items-center justify-center">
        <Equalizer active={active} bars={40} className="h-16 w-[46%]" color={color} />
      </div>
    </div>
  );
}

/** A symmetric bar equalizer. Animates when active; flat otherwise. */
function Equalizer({ active, bars = 32, className, color }: { active: boolean; bars?: number; className?: string; color?: string }) {
  const heights = useMemo(() => Array.from({ length: bars }, (_, i) => {
    const t = i / (bars - 1);
    return 20 + Math.sin(t * Math.PI) * 60 + (i % 3) * 8; // taller in the middle
  }), [bars]);
  const c = color ? `rgb(${color})` : "hsl(var(--accent-bright))";
  return (
    <div className={cn("flex items-center justify-center gap-[2px]", className)} aria-hidden>
      {heights.map((h, i) => (
        <span key={i} className="w-full rounded-full"
          style={{
            height: active ? `${h}%` : "12%",
            background: c,
            opacity: active ? 0.85 : 0.35,
            transition: "height 200ms ease",
            animation: active ? `edith-bar 900ms ease-in-out ${i * 40}ms infinite alternate` : undefined,
          }} />
      ))}
    </div>
  );
}

function useUtcClock() {
  const [t, setT] = useState("--:--");
  useEffect(() => {
    const tick = () => { const d = new Date(); setT(`${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`); };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);
  return t;
}
