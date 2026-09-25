"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, X, Send, CheckCircle2, AlertTriangle, ExternalLink, Loader2, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** One email going out, as reported by the agent stream ("email" events). */
export interface EmailEvent {
  id: string;
  phase: "sending" | "sent" | "failed";
  to?: string;
  subject?: string;
  body?: string;
  label?: string;
  gmailId?: string | null;
  error?: string;
}
interface EmailState {
  id: string;
  to: string;
  subject: string;
  body: string;
  label?: string;
  phase: EmailEvent["phase"];
  gmailId?: string | null;
  error?: string;
}

/**
 * Queue of outgoing emails for the compose popup: a "sending" event opens one,
 * later "sent"/"failed" events for the same id update it. Several emails in a
 * row (e.g. DARWIN outreach) are shown one after another.
 */
export function useEmailPopups() {
  const [queue, setQueue] = useState<EmailState[]>([]);
  const push = useCallback((ev: EmailEvent) => {
    setQueue((q) => {
      if (ev.phase === "sending") {
        if (q.some((e) => e.id === ev.id)) return q;
        return [...q, { id: ev.id, to: ev.to ?? "", subject: ev.subject ?? "", body: ev.body ?? "", label: ev.label, phase: "sending" }];
      }
      return q.map((e) => (e.id === ev.id ? { ...e, phase: ev.phase, gmailId: ev.gmailId ?? e.gmailId, error: ev.error } : e));
    });
  }, []);
  const close = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, waiting: Math.max(0, queue.length - 1), push, close };
}

/**
 * Liquid-glass "browser" popup: a Gmail-style compose window in which the email
 * is typed out in front of you while the real send runs, then shows the real
 * result (Sent ✓ with a link to it in Gmail, or why it failed).
 */
export function EmailComposePopup({ email, waiting, onClose }: { email: EmailState; waiting: number; onClose: () => void }) {
  const total = email.to.length + email.subject.length + email.body.length;
  // Fast enough to watch, never so slow it gets in the way: 1.5–7s per email.
  const duration = Math.min(7000, Math.max(1500, total * 16));
  const [shown, setShown] = useState(0);
  const [closing, setClosing] = useState(false);
  const [hover, setHover] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Typewriter: reveal To → Subject → Body.
  useEffect(() => {
    setShown(0);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setShown(Math.round(p * total));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [email.id, duration, total]);

  const toN = Math.min(shown, email.to.length);
  const subjN = Math.min(Math.max(0, shown - email.to.length), email.subject.length);
  const bodyN = Math.max(0, shown - email.to.length - email.subject.length);
  const typing = shown < total;
  const field: "to" | "subject" | "body" | null = !typing ? null : toN < email.to.length ? "to" : subjN < email.subject.length ? "subject" : "body";

  // Keep the newest line in view while the body types.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [bodyN]);

  const close = useCallback(() => { setClosing(true); setTimeout(() => { setClosing(false); onClose(); }, 300); }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  // Once it's written AND sent, fade away by itself (not while you're reading it).
  useEffect(() => {
    if (typing || email.phase !== "sent" || hover) return;
    const t = setTimeout(close, waiting > 0 ? 2500 : 7000);
    return () => clearTimeout(t);
  }, [typing, email.phase, hover, close, waiting]);

  const status = typing ? "writing" : email.phase === "sending" ? "sending" : email.phase;
  const gmailUrl = email.gmailId ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(email.gmailId)}` : "https://mail.google.com/mail/u/0/#sent";
  const caret = <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-accent-bright" style={{ animation: "caret-blink 0.9s steps(1) infinite" }} />;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-3 sm:p-6"
      style={{ animation: closing ? "dw-scrim-out .3s ease forwards" : "dw-scrim-in .35s ease" }}>
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" onClick={close} />

      <div role="dialog" aria-label={`Email to ${email.to}`}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        className="relative flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-[22px] border border-white/15"
        style={{
          background: "linear-gradient(150deg, hsl(0 0% 100% / 0.12), hsl(210 60% 12% / 0.38))",
          backdropFilter: "blur(24px) saturate(150%)", WebkitBackdropFilter: "blur(24px) saturate(150%)",
          boxShadow: "0 40px 120px -30px hsl(var(--accent)/0.7), inset 0 1px 0 hsl(0 0% 100% / 0.28), inset 0 0 80px -40px hsl(var(--accent)/0.6)",
          animation: closing ? "ev-dissolve .3s ease forwards" : "dw-pop-in .5s cubic-bezier(.2,.9,.25,1.15) both",
        }}>
        {/* moving sheen */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[22px]">
          <div className="absolute -inset-y-10 -left-1/3 w-1/3 -skew-x-12 bg-white/10 blur-md" style={{ animation: "ev-sheen 2.4s ease-in-out .3s" }} />
        </div>

        {/* browser chrome */}
        <div className="relative flex items-center gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-2">
          <div className="flex gap-1.5">
            <button onClick={close} aria-label="Close" className="h-3 w-3 rounded-full bg-[#ff5f57] ring-1 ring-black/20 hover:brightness-110" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e] ring-1 ring-black/20" />
            <span className="h-3 w-3 rounded-full bg-[#28c840] ring-1 ring-black/20" />
          </div>
          <div className="ml-1 hidden items-center gap-1 text-white/35 sm:flex">
            <ChevronLeft className="h-4 w-4" /><ChevronRight className="h-4 w-4" /><RotateCw className="h-3.5 w-3.5" />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] text-foreground/70">
            <Lock className="h-3 w-3 shrink-0 text-success" />
            <span className="truncate">mail.google.com/mail/u/0/#{status === "sent" ? "sent" : "compose"}</span>
          </div>
          <button onClick={close} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* compose window */}
        <div className="relative flex min-h-0 flex-1 flex-col px-5 pb-4 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="hud-label text-[11px] tracking-[0.25em] text-accent-bright">NEW MESSAGE</span>
            <span className="text-[10px] text-muted-foreground">
              {email.label ? `${email.label} · ` : ""}{waiting > 0 ? `${waiting} more after this` : "written by JARVIS"}
            </span>
          </div>

          <Row label="To">{email.to.slice(0, toN)}{field === "to" && caret}</Row>
          <Row label="Subject"><span className="font-medium text-foreground">{email.subject.slice(0, subjN)}</span>{field === "subject" && caret}</Row>

          <div ref={bodyRef} className="mt-3 min-h-[160px] flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-[13px] leading-relaxed text-foreground/90" style={{ scrollbarWidth: "thin" }}>
            {email.body.slice(0, bodyN)}{field === "body" && caret}
          </div>

          {/* status / result */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {status === "sent" ? (
              <span className="flex items-center gap-1.5 rounded-full border border-success/40 bg-success/15 px-3 py-1.5 text-xs font-semibold text-success"
                style={{ animation: "dw-hex-pop .5s ease both" }}>
                <CheckCircle2 className="h-4 w-4" /> Sent to {email.to}
              </span>
            ) : status === "failed" ? (
              <span className="flex items-start gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Not sent — {email.error || "the email provider refused it."}
              </span>
            ) : (
              <span className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs",
                status === "sending" ? "border-accent/40 bg-accent/15 text-accent-bright" : "border-white/15 bg-white/5 text-foreground/75")}>
                {status === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 animate-hud-pulse" />}
                {status === "sending" ? "Sending…" : "JARVIS is writing…"}
              </span>
            )}
            {status === "sent" && (
              <a href={gmailUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-accent hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> Open in Gmail
              </a>
            )}
            <button onClick={close} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">
              {status === "sent" || status === "failed" ? "Close" : "Hide"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-white/10 py-1.5 text-[13px]">
      <span className="w-14 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-all text-foreground/90">{children}</span>
    </div>
  );
}
