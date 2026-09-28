"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Clock, Loader2, Pause, Play, RefreshCw, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DAILY_STREAMS, type DailyStream } from "@/lib/ev/daily/schedule";
import type { DailyPackageView, DailyView } from "@/lib/ev/daily/view";

/**
 * EV · TODAY'S CONTENT — the day's post + Reel exactly as stored: the real
 * generated image and MP4, the real caption and hashtags, the true status of
 * every step (late steps say so), real errors with a retry. EV's core sits in
 * the middle, feeding IDEA → CREATION → VIDEO → READY → APPROVAL.
 */

export type DailyUiAction =
  | { action: "generate" | "approve" | "retry" | "reject" | "regenerate" | "another" | "video" }
  | { action: "caption"; instruction?: string; caption?: string }
  | { action: "tone"; tone: string; instruction: string };

export interface DailyResponse extends DailyView { message?: string; spoken: string }

/** Loads today's package, keeps the pipeline moving while it's unfinished, and reports what changes. */
export function useDailyContent(opts: { onChange?: (kind: "ready" | "published" | "publish_error" | "failed", view: DailyResponse) => void } = {}) {
  const [view, setView] = useState<DailyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const prev = useRef<DailyPackageView | null>(null);
  const ticking = useRef(false);
  const onChange = useRef(opts.onChange); onChange.current = opts.onChange;
  const alive = useRef(true);

  const accept = useCallback((v: DailyResponse) => {
    if (!alive.current) return;
    const before = prev.current, p = v.pkg;
    if (before && p && before.id === p.id) {
      if (before.status !== "ready" && p.status === "ready") onChange.current?.("ready", v);
      if (before.status !== "published" && p.status === "published") onChange.current?.("published", v);
      if (!before.publishError && p.publishError) onChange.current?.("publish_error", v);
      if (before.status !== "failed" && p.status === "failed") onChange.current?.("failed", v);
    } else if (before && p && before.id !== p.id && p.status === "ready") onChange.current?.("ready", v);
    prev.current = p;
    setView(v);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/ev/daily", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || `Couldn't load today's content (HTTP ${res.status}).`); return null; }
      accept(j.data as DailyResponse);
      return j.data as DailyResponse;
    } catch { setError("Couldn't reach the server."); return null; }
  }, [accept]);

  const needsTick = (v: DailyResponse | null) => {
    const p = v?.pkg;
    return !!p && (p.status === "generating" || (p.status === "approved" && p.stage === "publishing" && !p.publishError));
  };

  const tick = useCallback(async () => {
    if (ticking.current) return;
    ticking.current = true;
    try {
      const res = await fetch("/api/ev/daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tick" }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.data) accept(j.data as DailyResponse);
    } catch { /* next poll retries */ } finally { ticking.current = false; }
  }, [accept]);

  const act = useCallback(async (a: DailyUiAction): Promise<{ ok: boolean; message: string }> => {
    setBusy(a.action);
    try {
      const res = await fetch("/api/ev/daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: j.error || `That didn't work (HTTP ${res.status}).` };
      accept(j.data as DailyResponse);
      if (needsTick(j.data)) void tick();
      return { ok: true, message: j.data.message || "Done." };
    } catch { return { ok: false, message: "I couldn't reach the server." }; } finally { setBusy(null); }
  }, [accept, tick]);

  // poll: fast while EV is working, slow otherwise; nudge the pipeline along
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const v = await refresh();
      if (needsTick(v)) void tick();
      timer = setTimeout(loop, needsTick(v) ? 4000 : 60_000);
    };
    void loop();
    return () => { alive.current = false; clearTimeout(timer); };
  }, [refresh, tick]);

  return { view, error, busy, refresh, act, needsTick: needsTick(view) };
}

const STATUS_WORD: Record<string, string> = {
  draft: "QUEUED", generating: "CREATING", ready: "READY FOR APPROVAL", approved: "APPROVED", published: "PUBLISHED", rejected: "REJECTED", failed: "NEEDS ATTENTION",
};

function time(iso: string | null, tz: string) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz }); } catch { return ""; }
}
function dateLabel(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export function TodayContent({ daily, onAction, onClose }: {
  daily: ReturnType<typeof useDailyContent>;
  onAction: (a: DailyUiAction) => void;
  onClose: () => void;
}) {
  const { view, error, busy } = daily;
  const p = view?.pkg ?? null;
  const [capOpen, setCapOpen] = useState(false);
  return (
    <div className="absolute inset-0 z-[35] overflow-y-auto overscroll-contain bg-[#05040d]/55 backdrop-blur-[2px]" data-ev-today style={{ animation: "ev-rise .6s ease both" }}>
      <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col px-4 pb-28 pt-16 md:px-8 md:pb-32 md:pt-20">
        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="ev-grad-text text-[15px] font-semibold tracking-[0.42em] md:text-lg">TODAY&apos;S CONTENT</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/55">
              {view && <span>{dateLabel(view.today)}</span>}
              {p && <><span className="text-white/25">·</span><span>version {p.version}</span></>}
              {p && <StatusChip status={p.status} />}
              {p?.readyLate && <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[9px] tracking-[0.2em] text-amber-100">READY LATE</span>}
            </div>
          </div>
          <button onClick={onClose} title="Back to the studio" className="ev-glass flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] tracking-[0.18em] text-white/70 transition hover:text-white">
            <X className="h-3.5 w-3.5" /> STUDIO
          </button>
        </div>

        {!view ? (
          <div className="flex flex-1 items-center justify-center py-20 text-sm text-white/55">
            {error ? <span className="text-[#ffb3c4]">{error}</span> : <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading today&apos;s content…</span>}
          </div>
        ) : !view.enabled ? (
          <Empty title="Daily content is off" body="EV_DAILY is set to off, so EV isn't preparing a daily post. Remove it (or set EV_DAILY=on) to turn it back on." />
        ) : !p ? (
          <div className="mt-8 flex flex-1 flex-col items-center justify-center gap-6">
            <Core stream={null} working={false} failed={false} />
            <Empty
              title={`EV starts at ${view.startLabel}`}
              body={`Every morning EV researches, writes, designs and renders today's post and Reel, and has them ready for your approval by ${view.readyByLabel} (${view.timezone.replace("_", " ")}).`}
              action={<button onClick={() => onAction({ action: "generate" })} disabled={!!busy} className="ev-approve mt-4 rounded-full bg-gradient-to-r from-[#60e4ff] via-[#a78bfa] to-[#ff5cd6] px-5 py-2 text-xs font-semibold tracking-[0.18em] text-[#0a0620] disabled:opacity-60">
                {busy === "generate" ? "STARTING…" : "CREATE TODAY'S CONTENT NOW"}
              </button>}
            />
          </div>
        ) : (
          <>
            <div className="mt-5 grid flex-1 grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)_minmax(0,1fr)] md:gap-6">
              <div className="order-2 md:order-1"><PostCard p={p} /></div>
              <div className="order-1 flex flex-col items-center md:order-2">
                <Core stream={p.stream} working={daily.needsTick} failed={p.status === "failed"} />
                <Streams p={p} />
                <Steps p={p} tz={view.timezone} />
              </div>
              <div className="order-3"><VideoCard p={p} /></div>
            </div>
            <ApprovalBar p={p} view={view} busy={busy} onAction={onAction} capOpen={capOpen} setCapOpen={setCapOpen} />
          </>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone = status === "ready" ? "border-[#60e4ff]/40 bg-[#60e4ff]/10 text-[#b9f5ff]"
    : status === "published" ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-100"
    : status === "failed" ? "border-[#ff5878]/40 bg-[#ff5878]/10 text-[#ffc2cf]"
    : status === "approved" ? "border-violet-300/40 bg-violet-300/10 text-violet-100"
    : "border-white/20 bg-white/5 text-white/75";
  return <span className={cn("rounded-full border px-2 py-0.5 text-[9px] tracking-[0.22em]", tone)} data-ev-today-status={status}>{STATUS_WORD[status] ?? status.toUpperCase()}</span>;
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="ev-glass mx-auto max-w-md rounded-3xl p-6 text-center">
      <div className="text-sm font-semibold tracking-[0.2em] text-white/90">{title}</div>
      <p className="mt-2 text-[13px] leading-relaxed text-white/60">{body}</p>
      {action}
    </div>
  );
}

/* ---------------- EV core + streams ---------------- */

function Core({ stream, working, failed }: { stream: DailyStream | null; working: boolean; failed: boolean }) {
  return (
    <div className={cn("ev-core relative h-36 w-36 md:h-44 md:w-44", working && "ev-core-working", failed && "ev-core-failed")} aria-hidden data-ev-core>
      <div className="ev-core-ring absolute inset-0 rounded-full" />
      <div className="ev-core-ring ev-core-ring-2 absolute inset-[12%] rounded-full" />
      <div className="ev-core-ring ev-core-ring-3 absolute inset-[24%] rounded-full" />
      <div className="ev-core-orb absolute inset-[33%] flex items-center justify-center rounded-full">
        <span className="text-[13px] font-semibold tracking-[0.3em] text-white/95 md:text-[15px]">EV</span>
      </div>
      {stream && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] tracking-[0.34em] text-white/55">{stream}</div>}
    </div>
  );
}

function streamState(p: DailyPackageView, s: DailyStream): "done" | "active" | "pending" | "failed" {
  const order = DAILY_STREAMS.indexOf(p.stream);
  const i = DAILY_STREAMS.indexOf(s);
  if (p.status === "published") return "done";
  if (i < order) return "done";
  if (i === order) {
    if (p.status === "failed") return "failed";
    if (s === "READY" && p.status === "ready") return "done";
    return "active";
  }
  return "pending";
}

function Streams({ p }: { p: DailyPackageView }) {
  return (
    <div className="mt-6 w-full" data-ev-streams>
      <div className="relative flex items-center justify-between px-1">
        <div className="absolute inset-x-3 top-[7px] h-px bg-white/10" />
        {DAILY_STREAMS.map((s, i) => {
          const st = streamState(p, s);
          const next = DAILY_STREAMS[i + 1];
          const flowing = next && (st === "done" || st === "active") && streamState(p, next) !== "pending";
          return (
            <div key={s} className="relative z-10 flex flex-1 flex-col items-center" data-stream={s} data-state={st}>
              {next && (
                <div className="absolute left-1/2 top-[7px] h-px w-full overflow-hidden">
                  <div className={cn("h-full w-full transition-opacity duration-700", st === "done" ? "bg-gradient-to-r from-[#60e4ff] to-[#ff5cd6] opacity-80" : "opacity-0")} />
                  {(flowing || st === "active") && <span className="ev-stream-dot absolute top-1/2 -translate-y-1/2" />}
                </div>
              )}
              <span className={cn("relative h-[15px] w-[15px] rounded-full border-2 transition",
                st === "done" ? "border-[#a78bfa] bg-[#a78bfa]" : st === "active" ? "ev-live-node border-white bg-white" : st === "failed" ? "border-[#ff5878] bg-[#ff5878]/60" : "border-white/25 bg-[#05040d]")} />
              <span className={cn("mt-2 text-[8.5px] tracking-[0.16em] md:text-[9px] md:tracking-[0.22em]", st === "pending" ? "text-white/35" : st === "failed" ? "text-[#ffb3c4]" : "text-white/85")}>{s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Steps({ p, tz }: { p: DailyPackageView; tz: string }) {
  const [open, setOpen] = useState(false);
  const scheduled = p.trigger === "schedule";
  return (
    <div className="ev-glass mt-5 w-full rounded-2xl px-3.5 py-3" data-ev-steps>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-[9px] tracking-[0.3em] text-white/45">
        {scheduled ? "MORNING SCHEDULE" : `VERSION ${p.version} · ${p.trigger.toUpperCase()}`}
        <ChevronDown className={cn("h-3 w-3 transition", open && "rotate-180")} />
      </button>
      <ul className="mt-2 space-y-1">
        {p.steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-[11.5px]">
            <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full",
              s.state === "done" ? "bg-[#a78bfa]/80" : s.state === "active" ? "border border-white/80" : s.state === "failed" ? "bg-[#ff5878]/70" : "border border-white/20")}>
              {s.state === "done" ? <Check className="h-2.5 w-2.5 text-[#0a0620]" /> : s.state === "active" ? <Loader2 className="h-2.5 w-2.5 animate-spin text-white" /> : s.state === "failed" ? <X className="h-2.5 w-2.5 text-white" /> : null}
            </span>
            <span className={cn("flex-1", s.state === "pending" ? "text-white/40" : "text-white/85")}>{s.label}</span>
            {scheduled && <span className="tabular-nums text-[10px] text-white/35">{s.plannedAt}</span>}
            <span className={cn("w-[62px] text-right tabular-nums text-[10px]", s.late ? "text-amber-200" : "text-white/55")}>
              {s.doneAt ? time(s.doneAt, tz) : s.late ? "late" : ""}
            </span>
          </li>
        ))}
      </ul>
      {open && (
        <ol className="mt-3 max-h-48 space-y-1.5 overflow-y-auto border-t border-white/10 pt-2" data-ev-log>
          {[...p.log].reverse().map((e, i) => (
            <li key={i} className="text-[10.5px] leading-snug">
              <span className="mr-1.5 tabular-nums text-white/35">{time(e.at, tz)}</span>
              <span className={e.ok ? "text-white/70" : "text-[#ffb3c4]"}>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ---------------- previews ---------------- */

function Waiting({ label, failed, error }: { label: string; failed?: boolean; error?: string | null }) {
  return (
    <div className={cn("flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-2xl border px-6 text-center", failed ? "border-[#ff5878]/30 bg-[#ff5878]/[0.05]" : "ev-scan border-white/10 bg-white/[0.02]")}>
      {failed ? <AlertTriangle className="h-5 w-5 text-[#ff8aa3]" /> : <Loader2 className="h-5 w-5 animate-spin text-white/50" />}
      <p className={cn("text-[12px] leading-snug", failed ? "text-[#ffc2cf]" : "text-white/55")}>{failed && error ? error : label}</p>
    </div>
  );
}

function PostCard({ p }: { p: DailyPackageView }) {
  const [more, setMore] = useState(false);
  const failedHere = p.status === "failed" && ["plan", "image", "image_wait", "rewrite_caption", "rewrite_tone"].includes(p.stage);
  return (
    <section className="ev-glass rounded-3xl p-3.5 md:p-4" data-ev-post>
      <div className="mb-2.5 flex items-center justify-between text-[9px] tracking-[0.32em] text-white/45">
        <span>POST PREVIEW</span>
        <span className="tracking-[0.12em] text-white/40">{p.contentType}</span>
      </div>
      {p.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt={p.creativeConcept ?? p.topic} className="aspect-[4/5] w-full rounded-2xl object-cover" data-ev-post-image />
      ) : (
        <Waiting label={p.caption ? "Creating the image…" : "Researching and writing the post…"} failed={failedHere} error={p.error} />
      )}
      {p.topic && <div className="mt-3 text-[13px] font-semibold leading-snug text-white/95">{p.topic}</div>}
      {p.caption ? (
        <div className="mt-2">
          <p className={cn("whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/75", !more && "line-clamp-5")} data-ev-caption>{p.caption}</p>
          <button onClick={() => setMore((m) => !m)} className="mt-1 text-[11px] text-[#9ff0ff]/80 hover:text-[#9ff0ff]">{more ? "Less" : "Full caption"}</button>
        </div>
      ) : null}
      {p.hashtags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" data-ev-hashtags>
          {p.hashtags.map((h) => <span key={h} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10.5px] text-[#c4b5fd]">{h}</span>)}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-2.5 text-[10.5px] text-white/50">
        {p.postingLabel && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Planned for {p.postingLabel}</span>}
        {p.niche && <span>{p.niche}</span>}
        {p.service && <span>{p.service}</span>}
        {p.imageProvider && <span className="text-white/35">image · {p.imageProvider}</span>}
      </div>
    </section>
  );
}

function fmt(sec: number) {
  if (!Number.isFinite(sec)) return "–:––";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function VideoCard({ p }: { p: DailyPackageView }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [pos, setPos] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setDuration(null); setErr(null); setPlaying(false); setPos(0); }, [p.videoUrl]);
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch((e) => setErr(`Couldn't play: ${(e as Error).message}`));
    else v.pause();
  };
  const failedHere = p.status === "failed" && ["video", "video_wait", "rewrite_video", "qc"].includes(p.stage);
  const label = p.stage === "video_wait" ? "Magic Hour is rendering the clip…" : p.imageUrl ? "Rendering the promotional Reel…" : "The Reel is made after the image.";
  return (
    <section className="ev-glass rounded-3xl p-3.5 md:p-4" data-ev-video>
      <div className="mb-2.5 flex items-center justify-between text-[9px] tracking-[0.32em] text-white/45">
        <span>VIDEO PREVIEW · REEL 9:16</span>
        <span className="tabular-nums tracking-[0.1em] text-white/55" data-ev-duration>{duration != null ? fmt(duration) : p.videoSeconds ? fmt(p.videoSeconds) : ""}</span>
      </div>
      {p.videoUrl ? (
        <div className="relative mx-auto aspect-[9/16] max-h-[62vh] overflow-hidden rounded-2xl bg-black md:max-h-[520px]">
          <video
            key={p.videoUrl} ref={ref} src={p.videoUrl} poster={p.imageUrl ?? undefined} playsInline loop preload="metadata"
            className="h-full w-full object-cover" data-ev-reel
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onError={(e) => { const c = e.currentTarget.error?.code; setErr(`The video couldn't be played${c ? ` (media error ${c})` : ""}.`); }}
            onClick={toggle}
          />
          <button onClick={toggle} aria-label={playing ? "Pause" : "Play"}
            className={cn("absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/40 text-white backdrop-blur transition", playing && "opacity-0 hover:opacity-100")}>
            {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </button>
          <div className="absolute inset-x-3 bottom-3 flex items-center gap-2">
            <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
            </button>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
              <div className="h-full bg-gradient-to-r from-[#60e4ff] to-[#ff5cd6]" style={{ width: `${duration ? Math.min(100, (pos / duration) * 100) : 0}%` }} />
            </div>
            <span className="rounded bg-black/50 px-1.5 text-[10px] tabular-nums text-white/85">{fmt(pos)} / {duration != null ? fmt(duration) : "–:––"}</span>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-[300px]"><Waiting label={label} failed={failedHere} error={p.error} /></div>
      )}
      {err && <p className="mt-2 text-[11px] text-[#ffb3c4]">{err}</p>}
      {p.hook && <div className="mt-3 text-[13px] font-semibold leading-snug text-white/95">“{p.hook}”</div>}
      {p.caption && <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-white/60">{p.caption}</p>}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/10 pt-2.5 text-[10.5px] text-white/50">
        {p.videoProvider && <span>{p.videoProvider}</span>}
        {p.videoConcept && <span className="line-clamp-2 text-white/40">{p.videoConcept}</span>}
      </div>
    </section>
  );
}

/* ---------------- approval ---------------- */

function ApprovalBar({ p, view, busy, onAction, capOpen, setCapOpen }: {
  p: DailyPackageView; view: DailyResponse; busy: string | null; onAction: (a: DailyUiAction) => void;
  capOpen: boolean; setCapOpen: (v: boolean) => void;
}) {
  const [text, setText] = useState("");
  const qc = p.qc;
  const passed = qc ? qc.checks.filter((c) => c.ok).length : 0;
  const warn = qc?.checks.filter((c) => !c.ok && c.severity === "warn") ?? [];
  const canRevise = !!p.caption && !!p.imageUrl && p.status !== "published" && p.status !== "generating";
  const chip = (label: string, a: DailyUiAction, key = a.action) => (
    <button key={label} onClick={() => onAction(a)} disabled={!!busy}
      className="rounded-full border border-white/15 bg-white/[0.03] px-3 py-1.5 text-[11px] tracking-[0.08em] text-white/80 transition hover:border-[#60e4ff]/50 hover:text-white disabled:opacity-50">
      {busy === key ? <Loader2 className="inline h-3 w-3 animate-spin" /> : label}
    </button>
  );
  return (
    <div className="ev-glass mt-6 rounded-3xl p-4 md:p-5" data-ev-approval-bar>
      {p.status === "ready" && (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[15px] font-semibold text-white">Today&apos;s content is ready. Would you like me to publish it?</div>
            <div className="mt-1 text-[11px] text-white/50">
              {qc ? `Quality check ${passed}/${qc.checks.length} passed` : ""}{warn.length ? ` · ${warn.map((w) => w.detail).join(" ")}` : ""}
              {" · "}{view.autoPublish ? `Auto-publish is on — it posts at ${p.postingLabel ?? "the planned time"} unless you change it.` : "Nothing posts without your approval."}
            </div>
          </div>
          <button onClick={() => onAction({ action: "approve" })} disabled={!!busy}
            className="ev-approve relative flex shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full bg-gradient-to-r from-[#60e4ff] via-[#a78bfa] to-[#ff5cd6] px-6 py-2.5 text-xs font-semibold tracking-[0.18em] text-[#0a0620] hover:brightness-110 disabled:opacity-60" data-ev-approve>
            {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} APPROVE &amp; PUBLISH
          </button>
        </div>
      )}
      {p.status === "generating" && (
        <div className="flex items-center gap-2 text-[13px] text-white/80">
          <Loader2 className="h-4 w-4 animate-spin text-[#9ff0ff]" />
          <span>{view.spoken}</span>
        </div>
      )}
      {p.status === "failed" && (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-2 text-[13px] text-[#ffc2cf]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span data-ev-error>{p.error ?? "Something went wrong."}</span></div>
          <button onClick={() => onAction({ action: "retry" })} disabled={!!busy} className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/25 px-4 py-2 text-xs tracking-[0.16em] text-white hover:bg-white/10 disabled:opacity-50">
            {busy === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} RETRY
          </button>
        </div>
      )}
      {p.status === "approved" && (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {p.publishError ? (
            <div className="flex items-start gap-2 text-[13px] text-[#ffc2cf]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span data-ev-error>Approved, not published: {p.publishError}</span></div>
          ) : (
            <div className="flex items-center gap-2 text-[13px] text-white/80"><Loader2 className="h-4 w-4 animate-spin text-[#9ff0ff]" /> Approved — publishing to Instagram{p.postMediaId ? " (post is live, finishing the Reel)" : ""}…</div>
          )}
          {p.publishError && (
            <button onClick={() => onAction({ action: "approve" })} disabled={!!busy} className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/25 px-4 py-2 text-xs tracking-[0.16em] text-white hover:bg-white/10 disabled:opacity-50">
              <RefreshCw className="h-3.5 w-3.5" /> TRY PUBLISHING AGAIN
            </button>
          )}
        </div>
      )}
      {p.status === "published" && (
        <div className="flex items-center gap-2 text-[13px] text-emerald-100"><Check className="h-4 w-4" /> Published to Instagram{p.publishedAt ? ` at ${time(p.publishedAt, view.timezone)}` : ""}.</div>
      )}

      {p.status !== "published" && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3.5">
          {canRevise && (
            <button onClick={() => setCapOpen(!capOpen)} disabled={!!busy} data-ev-change-caption
              className={cn("rounded-full border px-3 py-1.5 text-[11px] tracking-[0.08em] transition disabled:opacity-50", capOpen ? "border-[#60e4ff]/60 text-white" : "border-white/15 bg-white/[0.03] text-white/80 hover:border-[#60e4ff]/50 hover:text-white")}>
              {busy === "caption" ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Change the caption"}
            </button>
          )}
          {canRevise && chip("Change the video", { action: "video" })}
          {canRevise && chip("More professional", { action: "tone", tone: "more professional", instruction: "Make it more professional" }, "tone")}
          {canRevise && chip("More engaging", { action: "tone", tone: "more engaging", instruction: "Make it more engaging" }, "tone")}
          {chip("Another idea", { action: "another" })}
          {p.status !== "generating" && chip("Regenerate", { action: "regenerate" })}
          {p.status !== "generating" && (
            <button onClick={() => onAction({ action: "reject" })} disabled={!!busy} className="rounded-full border border-[#ff5878]/30 px-3 py-1.5 text-[11px] tracking-[0.08em] text-[#ffb3c4] transition hover:bg-[#ff5878]/10 disabled:opacity-50">
              {busy === "reject" ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Reject"}
            </button>
          )}
        </div>
      )}
      {capOpen && (
        <div className="mt-3 flex flex-col gap-2 md:flex-row" data-ev-caption-editor>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Tell EV how to change it — or paste your own caption"
            className="min-h-[70px] flex-1 resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white/90 outline-none focus:border-[#60e4ff]/50" />
          <div className="flex gap-2 md:flex-col">
            <button onClick={() => { onAction({ action: "caption", instruction: text.trim() || "Change the caption" }); setCapOpen(false); setText(""); }} disabled={!!busy}
              className="flex items-center gap-1 rounded-full border border-white/20 px-3 py-1.5 text-[11px] text-white/85 hover:bg-white/10"><Sparkles className="h-3 w-3" /> EV rewrites it</button>
            <button onClick={() => { if (text.trim().length > 20) { onAction({ action: "caption", caption: text.trim(), instruction: "My own caption" }); setCapOpen(false); setText(""); } }} disabled={!!busy || text.trim().length <= 20}
              className="rounded-full border border-white/20 px-3 py-1.5 text-[11px] text-white/85 hover:bg-white/10 disabled:opacity-40">Use my caption</button>
          </div>
        </div>
      )}
    </div>
  );
}
