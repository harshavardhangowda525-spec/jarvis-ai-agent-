"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, MessageSquare, RotateCcw, SkipForward, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Briefing, BriefingEvent } from "@/lib/briefing/build";

/**
 * The previous-day intelligence briefing — a liquid-glass popup over the
 * JARVIS environment. Everything it shows comes from the Briefing object,
 * which is computed from the recorded activity history (no demo values).
 * The narrative leads; the analytics support it.
 */

const CAT_COLOR: Record<string, string> = {
  development: "#7fd8ff", business: "#6ee7b7", marketing: "#c4b5fd", task: "#93c5fd", communication: "#5eead4",
  error: "#fda4af", solution: "#bef264", notice: "#fcd34d", command: "rgba(255,255,255,0.55)", agent: "rgba(255,255,255,0.35)",
  decision: "#fde68a", file: "#a5b4fc", conversation: "#e0f2fe",
};
const colorOf = (c: string) => CAT_COLOR[c] ?? "rgba(255,255,255,0.5)";

export interface BriefingPopupProps {
  briefing: Briefing | null;
  error?: string | null;
  speaking: boolean;
  /** Called once the entrance finished and the text is on screen (start the voice now). */
  onReady: () => void;
  onReplay: () => void;
  onSkip: () => void;
  onAsk: () => void;
  onForget: (id: string) => void;
  closing: boolean;
}

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = window.matchMedia?.("(prefers-reduced-motion: reduce)"); setR(!!m?.matches); }, []);
  return r;
}

export function BriefingPopup(p: BriefingPopupProps) {
  const b = p.briefing;
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (expanded) setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }), 120); }, [expanded, reduced]);
  const ready = useRef(false);
  const onReady = useRef(p.onReady); onReady.current = p.onReady;

  // Voice starts only after the popup has materialised and the text is in.
  useEffect(() => {
    if (!b || ready.current) return;
    const t = setTimeout(() => { ready.current = true; onReady.current(); }, reduced ? 150 : 1500);
    return () => clearTimeout(t);
  }, [b, reduced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") p.onSkip(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const delay = (i: number) => (reduced ? undefined : { animationDelay: `${0.45 + i * 0.12}s` });
  const periodWord = b?.kind === "day" ? (b.label === "Yesterday" ? "YESTERDAY" : b.label.toUpperCase()) : (b?.label ?? "").toUpperCase();

  const overview = useMemo(() => {
    if (!b) return [];
    const m = new Map(b.metrics.map((x) => [x.key, x.value]));
    const out: string[] = [];
    if (m.has("tasksCompleted")) out.push(`${m.get("tasksCompleted")} Task${m.get("tasksCompleted") === 1 ? "" : "s"} Completed`);
    if (m.has("tasksRemaining")) out.push(`${m.get("tasksRemaining")} Remaining`);
    if (m.has("projects")) out.push(`${m.get("projects")} Project${m.get("projects") === 1 ? "" : "s"}`);
    if (m.has("agents")) out.push(`${m.get("agents")} Agent Activit${m.get("agents") === 1 ? "y" : "ies"}`);
    if (!out.length && m.has("commands")) out.push(`${m.get("commands")} Command${m.get("commands") === 1 ? "" : "s"}`);
    return out;
  }, [b]);

  return (
    <div className="fixed inset-0 z-[88] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Intelligence briefing" data-briefing
      style={{ animation: p.closing ? "dw-scrim-out .45s ease forwards" : reduced ? undefined : "dw-scrim-in .5s ease" }}>
      <div className="absolute inset-0 bg-[#01040a]/55 backdrop-blur-[3px]" />
      {!reduced && <DataStreams />}

      <div className={cn("jv-brief relative flex max-h-[calc(100dvh-24px)] w-full flex-col overflow-hidden rounded-[28px] border border-white/15 sm:max-h-[88vh]", expanded ? "max-w-5xl" : "max-w-4xl")}
        style={{
          background: "linear-gradient(150deg, rgba(255,255,255,0.10), rgba(120,190,255,0.05) 40%, rgba(6,12,24,0.55))",
          backdropFilter: "blur(26px) saturate(150%)", WebkitBackdropFilter: "blur(26px) saturate(150%)",
          boxShadow: "0 40px 120px -30px rgba(0,0,0,0.75), 0 0 0 1px rgba(140,210,255,0.08), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 0 80px -40px rgba(140,210,255,0.5)",
          animation: p.closing ? "ev-dissolve .45s ease forwards" : reduced ? undefined : "jv-brief-in 1.05s cubic-bezier(.2,.9,.25,1) both",
          transition: "max-width .5s cubic-bezier(.2,.9,.25,1)",
        }}>
        {/* glass reflections */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -left-1/4 -top-1/2 h-full w-3/4 rotate-12 bg-gradient-to-b from-white/10 to-transparent blur-2xl" />
          {!reduced && <div className="jv-brief-scan absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-100/80 to-transparent" />}
        </div>

        {/* header */}
        <div className="relative flex items-start justify-between gap-3 px-5 pt-5 sm:px-7 sm:pt-6">
          <div className="min-w-0">
            <div className="jv-brief-rise text-[10px] tracking-[0.42em] text-cyan-100/70" style={delay(0)}>{b ? b.greeting.toUpperCase() : "ANALYZING"}</div>
            <h2 className="jv-brief-rise mt-1 text-lg font-light tracking-wide text-white sm:text-xl" style={delay(1)}>{b?.title ?? "Preparing your briefing…"}</h2>
            {b && <div className="jv-brief-rise mt-0.5 text-[11px] tracking-[0.2em] text-white/45" style={delay(1)}>{b.dateLabel.toUpperCase()}</div>}
          </div>
          <button onClick={p.onSkip} aria-label="Close briefing" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* body */}
        <div className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4 sm:px-7">
          {!b ? (
            <div className="py-10 text-center text-sm text-white/60">{p.error ?? <span className="inline-flex items-center gap-2"><span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" /> Reading your activity history…</span>}</div>
          ) : (
            <div className="grid gap-6 md:grid-cols-[1.35fr_1fr]">
              {/* ===== the briefing (primary) ===== */}
              <div className="min-w-0">
                <div className={cn("space-y-3 text-[14.5px] font-light leading-relaxed text-white/90 sm:text-[15px]", p.speaking && "jv-brief-speaking")}>
                  {b.paragraphs.map((t, i) => (
                    <p key={i} className="jv-brief-rise" style={delay(2 + i)}>{t}</p>
                  ))}
                </div>

                {b.insights.length > 0 && (
                  <div className="jv-brief-rise mt-5 rounded-2xl border border-cyan-100/15 bg-cyan-100/[0.04] px-4 py-3" style={delay(3 + b.paragraphs.length)}>
                    <div className="text-[9px] tracking-[0.36em] text-cyan-100/70">JARVIS INSIGHT</div>
                    {b.insights.map((t, i) => <p key={i} className="mt-1 text-[13px] leading-snug text-white/80">{t}</p>)}
                  </div>
                )}

                <div className="jv-brief-rise mt-5" style={delay(4 + b.paragraphs.length)}>
                  <div className="text-[9px] tracking-[0.36em] text-white/45">CONTINUE TODAY</div>
                  {b.unfinished.length ? (
                    <ul className="mt-2 space-y-1.5">
                      {b.unfinished.slice(0, 5).map((t, i) => (
                        <li key={i} className="flex items-start gap-2 text-[13px] text-white/80"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-100/70" />{t}</li>
                      ))}
                    </ul>
                  ) : b.hasData ? (
                    <p className="mt-1.5 text-[12px] tracking-[0.18em] text-emerald-100/70">ALL RECORDED PRIORITIES COMPLETED</p>
                  ) : (
                    <p className="mt-1.5 text-[12px] text-white/45">Not enough recorded activity to list unfinished work.</p>
                  )}
                </div>
              </div>

              {/* ===== analytics (supporting) ===== */}
              <div className="min-w-0 space-y-5">
                <div className="jv-brief-rise" style={delay(2)}>
                  <div className="text-[9px] tracking-[0.36em] text-white/45">{periodWord}</div>
                  {overview.length ? <div className="mt-1 text-[13px] text-white/85">{overview.join(" · ")}</div>
                    : <div className="mt-1 text-[12px] text-white/45">Not enough recorded activity to calculate an overview.</div>}
                </div>

                <div className="jv-brief-rise flex items-center gap-4" style={delay(3)}>
                  <CompletionRing completion={b.completion} animate={!reduced} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[9px] tracking-[0.36em] text-white/45">TASK COMPLETION</div>
                    {b.completion
                      ? <div className="mt-1 text-[12px] text-white/70">{b.completion.done} done · {b.completion.remaining} open</div>
                      : <div className="mt-1 text-[11px] leading-snug text-white/45">Not enough recorded activity to calculate this metric.</div>}
                  </div>
                </div>

                {b.metrics.length > 0 && (
                  <div className="jv-brief-rise space-y-1.5" style={delay(4)}>
                    {b.metrics.filter((m) => !["tasksCompleted", "tasksRemaining"].includes(m.key)).slice(0, 7).map((m) => (
                      <MetricBar key={m.key} label={m.label} value={m.value} max={Math.max(...b.metrics.map((x) => x.value), 1)} animate={!reduced} />
                    ))}
                  </div>
                )}

                <div className="jv-brief-rise" style={delay(5)}>
                  <div className="text-[9px] tracking-[0.36em] text-white/45">{b.kind === "day" ? "ACTIVITY TIMELINE" : "ACTIVITY ACROSS THE PERIOD"}</div>
                  {b.points.length ? <Timeline briefing={b} /> : <p className="mt-1.5 text-[11px] text-white/45">Not enough recorded activity for a timeline.</p>}
                </div>

                <div className="jv-brief-rise" style={delay(6)}>
                  <div className="text-[9px] tracking-[0.36em] text-white/45">AGENT ACTIVITY</div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {b.agents.map((a) => (
                      <div key={a.name} className="flex items-center gap-2 text-[11.5px]">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", a.status === "active" ? "jv-brief-pulse bg-cyan-200" : a.status === "opened" ? "bg-white/40" : "bg-white/15")} />
                        <span className={a.status === "inactive" ? "text-white/35" : "text-white/80"}>{a.name}</span>
                        <span className="ml-auto text-[10px] text-white/40">{a.status === "active" ? `Active · ${a.count}` : a.status === "opened" ? "Opened" : "Inactive"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {b && expanded && <div ref={detailsRef}><Details briefing={b} onForget={p.onForget} /></div>}
        </div>

        {/* controls */}
        <div className="relative flex flex-wrap items-center gap-2 border-t border-white/10 px-5 py-3 sm:px-7">
          <Ctl onClick={p.onReplay} disabled={!b} icon={<RotateCcw className="h-3.5 w-3.5" />} label={p.speaking ? "Speaking…" : "Replay"} />
          <Ctl onClick={() => setExpanded((x) => !x)} disabled={!b} icon={expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} label={expanded ? "Less" : "Expand"} />
          <Ctl onClick={p.onAsk} icon={<MessageSquare className="h-3.5 w-3.5" />} label="Ask JARVIS" />
          <span className="flex-1" />
          <Ctl onClick={p.onSkip} icon={<SkipForward className="h-3.5 w-3.5" />} label="Skip" subtle />
        </div>
      </div>
    </div>
  );
}

function Ctl({ onClick, icon, label, disabled, subtle }: { onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean; subtle?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] transition disabled:opacity-40",
        subtle ? "border-transparent text-white/55 hover:text-white" : "border-white/15 bg-white/[0.04] text-white/85 hover:border-cyan-100/40 hover:bg-white/10")}>
      {icon}{label}
    </button>
  );
}

function CompletionRing({ completion, animate }: { completion: Briefing["completion"]; animate: boolean }) {
  const r = 26, c = 2 * Math.PI * r;
  const pct = completion?.pct ?? 0;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
        {completion && (
          <circle cx="32" cy="32" r={r} fill="none" stroke="url(#jvRing)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
            style={animate ? { animation: "jv-ring 1.4s cubic-bezier(.2,.9,.25,1) .8s both", ["--c" as string]: `${c}` } : undefined} />
        )}
        <defs><linearGradient id="jvRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#bdeaff" /><stop offset="1" stopColor="#6ee7b7" /></linearGradient></defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[13px] font-light text-white">{completion ? `${pct}%` : "—"}</div>
    </div>
  );
}

function MetricBar({ label, value, max, animate }: { label: string; value: number; max: number; animate: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-[11.5px]">
      <span className="text-white/65">{label}</span>
      <span className="text-right tabular-nums text-white/90">{value}</span>
      <div className="col-span-2 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-100/80 to-cyan-300/60" style={{ width: `${Math.max(4, (100 * value) / max)}%`, transformOrigin: "left", animation: animate ? "jv-bar 1s cubic-bezier(.2,.9,.25,1) .9s both" : undefined }} />
      </div>
    </div>
  );
}

function Timeline({ briefing: b }: { briefing: Briefing }) {
  const span = b.kind === "day" ? 1440 : Math.max(1, Math.round((Date.parse(b.to) - Date.parse(b.from)) / 86_400_000) + 1) * 1440;
  return (
    <div className="mt-2">
      <div className="relative h-7 rounded-lg bg-white/[0.04]">
        {b.kind === "day" && [6, 12, 18].map((h) => <span key={h} className="absolute inset-y-1 w-px bg-white/10" style={{ left: `${(h / 24) * 100}%` }} />)}
        {b.points.map((pt, i) => (
          <span key={i} title={pt.label} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${Math.min(99, Math.max(1, (100 * pt.at) / span))}%`, width: pt.importance >= 4 ? 7 : pt.importance >= 3 ? 5 : 4, height: pt.importance >= 4 ? 7 : pt.importance >= 3 ? 5 : 4, background: colorOf(pt.category), boxShadow: `0 0 8px ${colorOf(pt.category)}` }} />
        ))}
      </div>
      {b.kind === "day" && (
        <div className="mt-1 flex justify-between text-[9px] tracking-[0.2em] text-white/30"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
      )}
      {b.timeline.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-white/70">
          {b.timeline.map((t, i) => (
            <span key={t.part} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-white/25">→</span>}
              <span className="text-white/45">{t.part}</span>{t.lead && <span className="text-white/85">{t.lead}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Details({ briefing: b, onForget }: { briefing: Briefing; onForget: (id: string) => void }) {
  const d = b.daily;
  const sections: [string, string[]][] = [
    ["ACCOMPLISHMENTS", d.accomplishments], ["BUSINESS PROGRESS", d.business_progress], ["DEVELOPMENT PROGRESS", d.development_progress],
    ["PROBLEMS", d.problems], ["SOLUTIONS", d.solutions], ["DECISIONS", d.important_decisions], ["NEXT ACTIONS", d.next_actions],
  ];
  return (
    <div className="mt-6 border-t border-white/10 pt-5" style={{ animation: "jv-k-sweep .5s ease both" }}>
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.filter(([, xs]) => xs.length).map(([title, xs]) => (
          <div key={title}>
            <div className="text-[9px] tracking-[0.36em] text-white/45">{title}</div>
            <ul className="mt-1.5 space-y-1">{xs.map((x, i) => <li key={i} className="text-[12.5px] leading-snug text-white/75">{x}</li>)}</ul>
          </div>
        ))}
      </div>
      <div className="mt-5 text-[9px] tracking-[0.36em] text-white/45">RECORDED ACTIVITY</div>
      {b.events.length ? (
        <ul className="mt-2 divide-y divide-white/[0.06]">
          {b.events.map((e) => <EventRow key={e.id} e={e} onForget={onForget} range={b.kind === "range"} />)}
        </ul>
      ) : <p className="mt-1.5 text-[12px] text-white/45">No recorded activity in this period.</p>}
    </div>
  );
}

function EventRow({ e, onForget, range }: { e: BriefingEvent; onForget: (id: string) => void; range: boolean }) {
  const t = new Date(e.time);
  const when = range ? t.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <li className="group flex items-start gap-3 py-2 text-[12px]">
      <span className="w-16 shrink-0 tabular-nums text-white/40">{when}</span>
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorOf(e.category) }} />
      <div className="min-w-0 flex-1">
        <div className={cn("text-white/85", e.status === "failed" && "text-rose-100/90")}>{e.action}</div>
        {e.result && <div className="mt-0.5 line-clamp-2 text-white/45">{e.result}</div>}
      </div>
      <span className="shrink-0 text-[10px] tracking-[0.15em] text-white/35">{e.agent}</span>
      <button onClick={() => onForget(e.id)} title="Forget this event" aria-label="Forget this event"
        className="shrink-0 rounded p-1 text-white/25 opacity-60 transition hover:bg-white/10 hover:text-rose-200 group-hover:opacity-100">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/** Faint data streams behind the glass while JARVIS analyses the day. */
function DataStreams() {
  const cols = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ left: 3 + i * 5.5 + (i % 3), dur: 5 + (i % 5) * 1.3, delay: -(i * 0.7), op: 0.05 + (i % 4) * 0.025 })), []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {cols.map((c, i) => (
        <span key={i} className="jv-brief-stream absolute top-0 h-40 w-px"
          style={{ left: `${c.left}%`, opacity: c.op, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s`, background: "linear-gradient(to bottom, transparent, rgba(150,220,255,0.9), transparent)" }} />
      ))}
    </div>
  );
}
