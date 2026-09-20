"use client";

import { useEffect, useState } from "react";
import {
  Send, Square, PlugZap, Plug, Bot, TerminalSquare, FileCode2, ShieldCheck,
  AlertTriangle, Check, Loader2, CircleDot, GitBranch, Rocket, Cpu, Volume2, VolumeX,
} from "lucide-react";
import { HudPanel } from "@/components/hud/panel";
import { useEdith, type EdithMode } from "@/hooks/useEdith";
import { cn } from "@/lib/utils";

const MODES: { id: EdithMode; label: string; hint: string }[] = [
  { id: "autonomous", label: "Autonomous", hint: "Runs safe & review-level steps automatically" },
  { id: "confirmation", label: "Confirmation", hint: "Asks before review & dangerous steps" },
  { id: "manual", label: "Manual", hint: "Confirms every step" },
];

/**
 * EDITH — JARVIS's software-development subagent cockpit. Everything shown is
 * REAL runtime state from the local EDITH service: capability check, live tool
 * calls, actual terminal output, real file changes. No simulated progress.
 */
export function EdithPanel() {
  const e = useEdith();
  const [goal, setGoal] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => { setUrl(e.savedUrl); setToken(e.savedToken); }, [e.savedUrl, e.savedToken]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.ctrlKey && ev.shiftKey && (ev.key === "X" || ev.key === "x")) { ev.preventDefault(); e.stop(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [e]);

  const connected = e.conn === "connected";

  return (
    <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      {/* LEFT: pairing, capabilities, mode, goal, controls */}
      <div className="flex flex-col gap-3">
        <HudPanel label="EDITH Link" bodyClassName="p-3">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full",
              connected ? "bg-success shadow-[0_0_8px_hsl(var(--success))] animate-hud-pulse"
              : e.conn === "connecting" ? "bg-warning animate-pulse"
              : e.conn === "unauthorized" ? "bg-destructive" : "bg-muted-foreground/40")} />
            <span className="hud-label text-[11px] text-foreground/85">
              {connected ? "Online" : e.conn === "connecting" ? "Connecting…" : e.conn === "unauthorized" ? "Bad token" : "Offline"}
            </span>
            {e.provider && connected && (
              <span className="hud-label ml-auto rounded-full border border-accent/25 bg-accent/8 px-2 py-0.5 text-[8px] text-accent">
                <Bot className="mr-1 inline h-3 w-3" />{e.provider}
              </span>
            )}
            <button onClick={() => e.setMuted(!e.muted)} title={e.muted ? "Unmute EDITH's voice" : "Mute EDITH's voice"}
              className={cn("ml-1 rounded p-1 transition hover:bg-accent/10", e.provider && connected ? "" : "ml-auto")}>
              {e.muted ? <VolumeX className="h-3.5 w-3.5 text-muted-foreground" /> : <Volume2 className="h-3.5 w-3.5 text-accent" />}
            </button>
          </div>
          {!connected ? (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Start EDITH on your machine (<code className="text-accent">cd edith &amp;&amp; npm run edith</code>), then paste its URL + token.
              </p>
              <input value={url} onChange={(ev) => setUrl(ev.target.value)} placeholder="ws://127.0.0.1:7420"
                className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-accent/60" />
              <input value={token} onChange={(ev) => setToken(ev.target.value)} placeholder="pairing token"
                className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-accent/60" />
              <button onClick={() => e.connect(url.trim(), token.trim())}
                className="flex w-full items-center justify-center gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent-bright transition hover:bg-accent/20">
                <PlugZap className="h-4 w-4" /> Activate EDITH
              </button>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between">
              {e.workspace && <span className="truncate text-[10px] text-muted-foreground" title={e.workspace}>📁 {e.workspace}</span>}
              <button onClick={e.disconnect} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-accent"><Plug className="h-3.5 w-3.5" /> Deactivate</button>
            </div>
          )}
        </HudPanel>

        {e.caps && (
          <HudPanel label="System Check" bodyClassName="p-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Cap label="AI Provider" ok={e.caps.aiProvider?.ok} detail={e.caps.aiProvider?.detail} />
              <Cap label="Workspace" ok={e.caps.workspace?.ok} />
              <Cap label="Terminal" ok={e.caps.terminal?.ok} />
              <Cap label="Node.js" ok={e.caps.node?.ok} detail={e.caps.node?.detail} />
              <Cap label="Git" ok={e.caps.git?.ok} />
              <Cap label="Python" ok={e.caps.python?.ok} />
              <Cap label="Docker" ok={e.caps.docker?.ok} />
              {e.caps.deploy && Object.entries(e.caps.deploy).map(([k, v]: any) => (
                <Cap key={k} label={k[0].toUpperCase() + k.slice(1)} ok={v.ok} detail={v.ok ? "connected" : "not connected"} />
              ))}
            </div>
          </HudPanel>
        )}

        <HudPanel label="Mode" bodyClassName="p-3">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => e.setMode(m.id)} disabled={!connected} title={m.hint}
                className={cn("rounded border px-2 py-2 text-center transition disabled:opacity-40",
                  e.mode === m.id ? "border-accent bg-accent/15 text-accent-bright" : "border-border text-muted-foreground hover:border-accent/50")}>
                <ShieldCheck className="mx-auto mb-1 h-4 w-4" />
                <div className="hud-label text-[9px]">{m.label}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">{MODES.find((m) => m.id === e.mode)?.hint}</p>
        </HudPanel>

        <HudPanel label="Command" bodyClassName="p-3">
          <form onSubmit={(ev) => { ev.preventDefault(); e.runGoal(goal); setGoal(""); }} className="flex items-center gap-2">
            <input value={goal} onChange={(ev) => setGoal(ev.target.value)} disabled={!connected || e.working}
              placeholder={connected ? "e.g. Build a cafe website, then run the build" : "Activate EDITH first"}
              className="flex-1 rounded border border-border bg-transparent px-2 py-2 text-sm outline-none focus:border-accent/60 disabled:opacity-50" />
            <button type="submit" disabled={!connected || !goal.trim() || e.working}
              className="flex h-9 w-9 items-center justify-center rounded bg-accent/15 text-accent transition hover:bg-accent/25 disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </form>
          <button onClick={e.stop} disabled={!connected}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border-2 border-destructive/70 bg-destructive/15 px-3 py-2.5 text-sm font-semibold text-destructive transition hover:bg-destructive/25 disabled:opacity-40">
            <Square className="h-4 w-4" /> STOP EDITH <span className="ml-1 rounded bg-destructive/20 px-1.5 py-0.5 text-[9px] font-normal">Ctrl+Shift+X</span>
          </button>
        </HudPanel>
      </div>

      {/* RIGHT: plan/confirm, activity, terminal, files */}
      <div className="flex flex-col gap-3">
        {e.confirm && (
          <HudPanel label="Confirmation Required" bodyClassName="p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", e.confirm.level === "dangerous" ? "text-destructive" : "text-warning")} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{e.confirm.title}</p>
                {e.confirm.detail && <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-border bg-black/20 p-2 text-xs text-foreground/80">{e.confirm.detail}</pre>}
                {e.confirm.level === "dangerous" && <p className="mt-1 text-[11px] text-destructive">Destructive action — review carefully.</p>}
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => e.answerConfirm(false)} className="flex-1 rounded border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/40">Cancel</button>
              <button onClick={() => e.answerConfirm(true)} className={cn("flex-1 rounded px-3 py-2 text-sm font-medium text-white transition", e.confirm.level === "dangerous" ? "bg-destructive hover:brightness-110" : "bg-accent hover:brightness-110")}>Confirm</button>
            </div>
          </HudPanel>
        )}

        <HudPanel label="EDITH Activity" bodyClassName="p-3">
          <div className="max-h-52 space-y-1.5 overflow-y-auto">
            {e.activity.length === 0 && <p className="text-xs text-muted-foreground">{connected ? "Ready. Give EDITH a development goal." : "Activate EDITH to begin."}</p>}
            {e.activity.map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-xs animate-fade-in">
                {a.tone === "ok" ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  : a.tone === "error" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  : a.tone === "warn" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  : a.tone === "tool" ? <Loader2 className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-accent", e.working && "animate-spin")} />
                  : <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent/50" />}
                <span className={cn(a.tone === "error" ? "text-destructive" : a.tone === "warn" ? "text-warning" : "text-foreground/85")}>{linkify(a.text)}</span>
              </div>
            ))}
          </div>
        </HudPanel>

        <HudPanel label="Terminal" bodyClassName="p-3">
          <div className="max-h-56 space-y-2 overflow-y-auto font-mono text-[11px]">
            {e.terminal.length === 0 && <p className="text-muted-foreground">No commands run yet.</p>}
            {e.terminal.map((t) => (
              <div key={t.id} className="rounded border border-border/60 bg-black/25 p-2">
                <div className="flex items-center gap-2">
                  <TerminalSquare className="h-3.5 w-3.5 text-accent" />
                  <span className="truncate text-accent-bright">$ {t.command}</span>
                  <span className={cn("ml-auto rounded px-1.5 text-[9px]", t.exitCode === 0 ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive")}>exit {t.exitCode}{t.durationMs != null ? ` · ${t.durationMs}ms` : ""}</span>
                </div>
                {t.stdout && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-foreground/75">{t.stdout}</pre>}
                {t.stderr && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-destructive/80">{t.stderr}</pre>}
              </div>
            ))}
          </div>
        </HudPanel>

        <HudPanel label="File Changes" bodyClassName="p-3">
          <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {e.files.length === 0 && <p className="text-muted-foreground">No file changes yet.</p>}
            {e.files.map((f) => (
              <div key={f.id} className="flex items-center gap-2">
                <FileCode2 className="h-3.5 w-3.5 text-accent/70" />
                <span className={cn("hud-label rounded px-1.5 text-[8px]",
                  f.kind === "created" ? "bg-success/15 text-success" : f.kind === "deleted" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning")}>{f.kind}</span>
                <span className="truncate text-foreground/85">{f.path}</span>
              </div>
            ))}
          </div>
        </HudPanel>
      </div>
    </div>
  );
}

function Cap({ label, ok, detail }: { label: string; ok?: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-success" : "bg-muted-foreground/40")} />
      <span className="text-foreground/80">{label}</span>
      <span className={cn("ml-auto truncate text-[9px]", ok ? "text-success" : "text-muted-foreground")} title={detail}>{ok ? (detail || "ready") : "—"}</span>
    </div>
  );
}

/** Turn any https URLs in a line into clickable links (e.g. a deployed URL). */
function linkify(text: string): React.ReactNode {
  const parts = text.split(/(https:\/\/[^\s)"']+)/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    /^https:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 hover:text-accent-bright">{p}</a>
      : <span key={i}>{p}</span>,
  );
}
