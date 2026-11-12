"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, PhoneCall, MonitorOff } from "lucide-react";

type Check = { label: string; ok: boolean | null; detail?: string };
type Line = { who: "jarvis" | "them" | "info"; text: string; at: number };
type Live = { online: true; at: number; running: boolean; via: string | null; wait: string | null; error: string | null; checks: Check[]; lines: Line[] } | null;

/**
 * What JARVIS's Calls window on the laptop is doing right now: whether it's
 * open, its setup checks (and exactly what's failing), what it's waiting for,
 * and the live conversation of the current call.
 */
export function LiveCaller({ compact = false }: { compact?: boolean }) {
  const [live, setLive] = useState<Live | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/calls/live").then((r) => r.json()).then((j) => { if (alive) setLive(j?.data?.caller ?? null); }).catch(() => {});
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 2500);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (live === undefined) return null;
  if (!live) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-3 text-[12px] text-muted-foreground">
        <div className="mb-1 flex items-center gap-2 font-medium text-foreground"><MonitorOff className="h-4 w-4" /> Calls window on the laptop: not open</div>
        JARVIS opens it by itself when calling is on. Check that JARVIS is running on the laptop (start-jarvis.cmd) and the laptop is connected (CRM → Google Maps finder → Connect this laptop).
      </div>
    );
  }
  const failing = live.checks.filter((c) => c.ok === false);
  const inCall = live.lines.length > 0 && live.running && !!live.lines.slice(-1)[0] && live.lines.slice(-1)[0].who !== "info";
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-[12px]">
      <div className="mb-2 flex items-center gap-2">
        <PhoneCall className="h-4 w-4 text-accent" />
        <b className="text-foreground">Calls window on the laptop</b>
        {live.via && <span className="text-muted-foreground">· {live.via}</span>}
        <span className={`ml-auto rounded-full border px-2 py-0.5 ${live.running ? "border-accent/50 text-accent" : "border-border text-muted-foreground"}`}>{live.running ? (inCall ? "On a call" : "Ready") : "Not calling"}</span>
      </div>
      {failing.length > 0 && (
        <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2">
          <div className="mb-1 font-medium text-red-400">It won&apos;t dial until these are fixed:</div>
          <ul className="space-y-1">{failing.map((c) => (
            <li key={c.label} className="flex gap-2"><XCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-red-400" /><span><span className="text-foreground">{c.label}</span>{c.detail ? <span className="block text-muted-foreground">{c.detail}</span> : null}</span></li>
          ))}</ul>
        </div>
      )}
      {!compact && failing.length === 0 && live.checks.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">{live.checks.map((c) => (
          <li key={c.label} className="flex items-center gap-1">{c.ok === null ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 text-emerald-400" />}{c.label}</li>
        ))}</ul>
      )}
      {live.error && <p className="mb-2 text-red-400">{live.error}</p>}
      {live.running && live.wait && <p className="mb-2 text-muted-foreground">{live.wait}</p>}
      {live.lines.length > 0 && (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg bg-black/20 p-2">
          {live.lines.map((l, i) => (
            <div key={i} className={l.who === "info" ? "text-muted-foreground" : l.who === "jarvis" ? "text-accent" : "text-foreground"}>
              {l.who === "jarvis" ? "JARVIS: " : l.who === "them" ? "Them: " : ""}{l.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
