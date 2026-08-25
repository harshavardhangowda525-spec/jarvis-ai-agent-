"use client";

import { useEffect, useState } from "react";
import {
  Send, Square, Pause, Play, Hand, Plug, PlugZap, ShieldCheck,
  Bot, CircleDot, AlertTriangle, Check, Loader2,
} from "lucide-react";
import { HudPanel } from "@/components/hud/panel";
import { useOperator, type OperatorMode } from "@/hooks/useOperator";
import { cn } from "@/lib/utils";

const MODES: { id: OperatorMode; label: string; hint: string }[] = [
  { id: "autonomous", label: "Autonomous", hint: "Runs safe & moderate actions automatically" },
  { id: "confirmation", label: "Confirmation", hint: "Asks before moderate & high-impact actions" },
  { id: "manual", label: "Manual", hint: "Only observes and suggests" },
];

/**
 * Operator panel — drives the local JARVIS Operator service (visible browser).
 * Shows pairing, live activity, the current plan, the confirmation prompt, and
 * the emergency controls. Real browser control happens in the local service;
 * this panel is the cockpit.
 */
export function OperatorPanel() {
  const op = useOperator();
  const [cmd, setCmd] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => { setUrl(op.savedUrl); setToken(op.savedToken); }, [op.savedUrl, op.savedToken]);

  // Emergency stop keyboard shortcut: Ctrl+Shift+X.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "X" || e.key === "x")) { e.preventDefault(); op.stop(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [op]);

  const connected = op.conn === "connected";

  return (
    <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* LEFT: pairing + command + controls */}
      <div className="flex flex-col gap-3">
        <HudPanel label="Operator Link" bodyClassName="p-3">
          <div className="flex items-center gap-2">
            <span className={cn("flex h-2.5 w-2.5 rounded-full",
              connected ? "bg-success shadow-[0_0_8px_hsl(var(--success))] animate-hud-pulse"
              : op.conn === "connecting" ? "bg-warning animate-pulse"
              : op.conn === "unauthorized" ? "bg-destructive" : "bg-muted-foreground/40")} />
            <span className="hud-label text-[11px] text-foreground/85">
              {connected ? "Paired" : op.conn === "connecting" ? "Connecting…" : op.conn === "unauthorized" ? "Bad token" : "Not connected"}
            </span>
            {op.provider && connected && (
              <span className="hud-label ml-auto rounded-full border border-accent/25 bg-accent/8 px-2 py-0.5 text-[8px] text-accent">
                <Bot className="mr-1 inline h-3 w-3" />{op.provider}
              </span>
            )}
          </div>

          {!connected && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Start the Operator on your computer (<code className="text-accent">cd operator &amp;&amp; npm run operator</code>),
                then paste the URL and token it prints.
              </p>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ws://127.0.0.1:7317"
                className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-accent/60" />
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="pairing token"
                className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-accent/60" />
              <button onClick={() => op.connect(url.trim(), token.trim())}
                className="flex w-full items-center justify-center gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent-bright transition hover:bg-accent/20">
                <PlugZap className="h-4 w-4" /> Pair
              </button>
            </div>
          )}
          {connected && (
            <button onClick={op.disconnect} className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-accent">
              <Plug className="h-3.5 w-3.5" /> Unpair
            </button>
          )}
        </HudPanel>

        <HudPanel label="Mode" bodyClassName="p-3">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => op.setMode(m.id)} disabled={!connected} title={m.hint}
                className={cn("rounded border px-2 py-2 text-center transition disabled:opacity-40",
                  op.mode === m.id ? "border-accent bg-accent/15 text-accent-bright" : "border-border text-muted-foreground hover:border-accent/50")}>
                <ShieldCheck className="mx-auto mb-1 h-4 w-4" />
                <div className="hud-label text-[9px]">{m.label}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">{MODES.find((m) => m.id === op.mode)?.hint}</p>
        </HudPanel>

        <HudPanel label="Command" bodyClassName="p-3">
          <form onSubmit={(e) => { e.preventDefault(); op.runCommand(cmd); setCmd(""); }} className="flex items-center gap-2">
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} disabled={!connected}
              placeholder={connected ? "e.g. Open Gmail and compose an email to Rahul…" : "Pair the Operator first"}
              className="flex-1 rounded border border-border bg-transparent px-2 py-2 text-sm outline-none focus:border-accent/60 disabled:opacity-50" />
            <button type="submit" disabled={!connected || !cmd.trim()}
              className="flex h-9 w-9 items-center justify-center rounded bg-accent/15 text-accent transition hover:bg-accent/25 disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            <Control onClick={op.pause} disabled={!connected} icon={Pause} label="Pause" />
            <Control onClick={op.resume} disabled={!connected} icon={Play} label="Resume" />
            <Control onClick={op.pause} disabled={!connected} icon={Hand} label="Take Control" title="Pause JARVIS so you can use the browser" />
          </div>
          <button onClick={op.stop} disabled={!connected}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border-2 border-destructive/70 bg-destructive/15 px-3 py-3 text-sm font-semibold text-destructive transition hover:bg-destructive/25 disabled:opacity-40">
            <Square className="h-5 w-5" /> STOP JARVIS
            <span className="ml-1 rounded bg-destructive/20 px-1.5 py-0.5 text-[9px] font-normal">Ctrl+Shift+X</span>
          </button>
        </HudPanel>
      </div>

      {/* RIGHT: plan + confirmation + live activity */}
      <div className="flex flex-col gap-3">
        {op.plan && (
          <HudPanel label={`Action Plan · ${op.plan.application}`} bodyClassName="p-3">
            <p className="text-sm text-foreground/90">{op.plan.summary}</p>
            {op.plan.steps.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-accent/80">
                {op.plan.steps.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5">
                    {i > 0 && <span className="text-muted-foreground">→</span>}
                    <span className="rounded border border-accent/20 bg-accent/8 px-1.5 py-0.5">{s}</span>
                  </span>
                ))}
              </div>
            )}
          </HudPanel>
        )}

        {op.confirm && (
          <HudPanel label="Confirmation Required" bodyClassName="p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", op.confirm.risk === "high" ? "text-destructive" : "text-warning")} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{op.confirm.title}</p>
                {op.confirm.detail && (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-border bg-black/20 p-2 text-xs text-foreground/80">{op.confirm.detail}</pre>
                )}
                {op.confirm.risk === "high" && <p className="mt-1 text-[11px] text-destructive">High-impact action — please review carefully.</p>}
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => op.answerConfirm(false)} className="flex-1 rounded border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/40">Cancel</button>
              <button onClick={() => op.answerConfirm(true)}
                className={cn("flex-1 rounded px-3 py-2 text-sm font-medium text-white transition",
                  op.confirm.risk === "high" ? "bg-destructive hover:brightness-110" : "bg-accent hover:brightness-110")}>
                Confirm
              </button>
            </div>
          </HudPanel>
        )}

        <HudPanel label="JARVIS Activity" className="flex-1" bodyClassName="flex h-full flex-col p-3">
          <div className="flex-1 space-y-1.5 overflow-y-auto">
            {op.activity.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {connected ? "Ready. Type a command and watch the browser." : "Pair the Operator to begin."}
              </p>
            )}
            {op.activity.map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-xs animate-fade-in">
                {a.tone === "ok" ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  : a.tone === "error" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  : a.tone === "warn" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  : a.tone === "act" ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  : <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent/50" />}
                <span className={cn(a.tone === "error" ? "text-destructive" : a.tone === "warn" ? "text-warning" : "text-foreground/85")}>{a.text}</span>
              </div>
            ))}
          </div>
          {op.lastResult && <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">{op.lastResult}</div>}
        </HudPanel>
      </div>
    </div>
  );
}

function Control({ onClick, disabled, icon: Icon, label, title }: {
  onClick: () => void; disabled?: boolean; icon: React.ComponentType<{ className?: string }>; label: string; title?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title || label}
      className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-accent/50 hover:text-accent disabled:opacity-40">
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
