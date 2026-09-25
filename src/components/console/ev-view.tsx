"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Send, Power, X, ExternalLink, Loader2, Check, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { StudioCanvas, type StudioCanvasHandle } from "@/components/console/ev/studio-canvas";
import type { PublishPhase, StudioMode } from "@/components/console/ev/studio-engine";
import {
  EV_PIPELINE, STARTER_FORMATS, compact, formatFromText, formatOfKind, kindLabel, liveStage,
  type CreativeFormat, type StudioData, type StudioItem,
} from "@/lib/ev/studio";

/**
 * EV — the creative studio. A presentation layer only: it reuses the JARVIS
 * voice, agent stream and command router. The canvas (motion) reacts to EV's
 * real operating state; every number on the page comes from EV's content memory
 * or the connected Instagram account, and sits apart from the motion.
 *
 * Hierarchy: 1) the creative canvas, 2) the preview / approval, 3) the command.
 */

export type EvState =
  | "IDLE" | "LISTENING" | "THINKING" | "GENERATING"
  | "WAITING_FOR_APPROVAL" | "EXECUTING" | "SUCCESS" | "ERROR";

export interface EvViewProps {
  state: EvState;
  /** Current EV activity line. */
  activity: string;
  /** Current command being processed. */
  command: string;
  /** Voice input level 0..1 for reactive motion. */
  level: number;
  /** Transition phase driven by the console. */
  phase: "in" | "active" | "out";
  /** A freshly generated EV image / video, shown in the creative canvas. */
  image: { url: string } | null;
  /** EV's latest reply (holds the caption for the creative). */
  caption?: string;
  onDismissImage: () => void;
  /** Bumped by the console when you say "publish" — triggers the Instagram post. */
  publishSignal?: number;
  /** Caption spoken with the command ("publish with caption …"), overrides the draft. */
  captionOverride?: string;
  /** Reports the real publish outcome back (so EV can say it out loud). */
  onPublishResult?: (r: { ok: boolean; message: string }) => void;
  /** Send a command to EV as if you'd said it (APPROVE on text content). */
  onCommand?: (text: string) => void;
  input: string;
  onInput: (v: string) => void;
  onSubmit: () => void;
  voiceStarted: boolean;
  muted: boolean;
  onMic: () => void;
  onSleep: () => void;
}

const STATE_WORD: Record<EvState, string> = {
  IDLE: "STUDIO READY", LISTENING: "LISTENING", THINKING: "CONCEPTING", GENERATING: "CREATING",
  WAITING_FOR_APPROVAL: "AWAITING APPROVAL", EXECUTING: "PRODUCING", SUCCESS: "DONE", ERROR: "INTERRUPTED",
};

/** What the canvas should be doing, from EV's real activity line. */
function modeOf(activity: string): StudioMode {
  if (/\bvideo\b/i.test(activity) || /\b(generat|render|produc)\w*\s+(a\s+|the\s+)?(marketing\s+)?reel\b/i.test(activity)) return "video";
  if (/\bimage\b|\bvisual\b|\bgraphic\b/i.test(activity)) return "image";
  if (/\bcaption\b/i.test(activity)) return "caption";
  return "none";
}

interface LogEntry { id: number; at: Date; text: string; tone: "info" | "ok" | "warn" }

export function EvView(props: EvViewProps) {
  const { state, phase, image } = props;
  const canvas = useRef<StudioCanvasHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [publish, setPublish] = useState<PublishPhase>("idle");
  const [mediaAspect, setMediaAspect] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<CreativeFormat | null>(null);
  const { data, reload } = useStudioData();

  // EV's reply only counts once it's EV's (not JARVIS's last line from before EV opened).
  const initialCaption = useRef(props.caption ?? "");
  const reply = props.caption && props.caption !== initialCaption.current ? props.caption : "";

  const approval = !!image || state === "WAITING_FOR_APPROVAL";
  const mode = modeOf(props.activity);
  const commandFormat = useMemo(() => formatFromText(props.command), [props.command]);
  useEffect(() => { setSelectedFormat(null); setSelected(null); }, [props.command]);
  const format = selectedFormat ?? commandFormat ?? (mode === "video" ? "reel" : null);

  // anchors: the media sits inside the canvas frame, the approval panel beside it
  const mediaEl = useRef<HTMLDivElement | null>(null);
  const sideEl = useRef<HTMLDivElement | null>(null);
  const syncAnchors = useCallback(() => canvas.current?.setAnchors(mediaEl.current, sideEl.current), []);
  const setMediaEl = useCallback((el: HTMLDivElement | null) => { mediaEl.current = el; syncAnchors(); }, [syncAnchors]);
  const setSideEl = useCallback((el: HTMLDivElement | null) => { sideEl.current = el; syncAnchors(); }, [syncAnchors]);
  useEffect(() => { if (!image) { setMediaAspect(null); setPublish("idle"); } }, [image]);

  // Tiny activity stream — real events only.
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);
  const push = useCallback((text: string, tone: LogEntry["tone"] = "info") => {
    setLog((l) => (l[0]?.text === text ? l : [{ id: ++logId.current, at: new Date(), text, tone }, ...l].slice(0, 5)));
  }, []);
  useEffect(() => {
    const a = props.activity.trim();
    if (a && !/^(idle|listening…|speaking…)$/i.test(a)) push(a.replace(/…$/, ""), state === "ERROR" ? "warn" : "info");
  }, [props.activity, state, push]);
  useEffect(() => { if (image) push(/kind=video|\.mp4|\.webm|\.mov/i.test(image.url) ? "Video ready for review" : "Creative ready for review", "ok"); }, [image, push]);
  useEffect(() => { if (state === "SUCCESS") void reload(); }, [state, reload]);

  const onPublishStatus = useCallback((s: PublishPhase, message?: string) => {
    setPublish(s);
    if (s === "publishing") push("Publishing to Instagram");
    if (s === "done") { push("Published to Instagram", "ok"); void reload(); }
    if (s === "error" && message) push(message, "warn");
  }, [push, reload]);

  const focusInput = useCallback((prefill?: string) => {
    if (prefill != null) props.onInput(prefill);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [props]);

  const stage = liveStage(state, { hasMedia: !!image, publish });
  const hideSides = approval;

  return (
    <div
      className="fixed inset-0 z-40 overflow-hidden bg-[#05040d] text-white"
      style={{ animation: phase === "out" ? "ev-dissolve 0.9s ease-in both" : phase === "in" ? "fade-in .4s ease" : undefined }}
      aria-label="EV creative studio"
      data-ev-state={state}
    >
      <StudioCanvas
        ref={canvas}
        className="absolute inset-0 h-full w-full"
        state={state}
        mode={image ? "none" : mode}
        format={format}
        mediaAspect={image ? (mediaAspect ?? (/kind=video|\.mp4|\.webm|\.mov/i.test(image.url) ? 9 / 16 : 0.8)) : null}
        focus={approval}
        publish={publish}
        level={props.level}
        headline={props.command}
        brand={data?.brand ?? []}
      />
      {/* soft vignette */}
      <div className="pointer-events-none absolute inset-0" aria-hidden
        style={{ background: "radial-gradient(ellipse at 50% 46%, transparent 45%, rgba(3,2,10,0.55) 100%)" }} />

      {/* emblem label (the emblem itself is drawn by the canvas) */}
      <div className="absolute left-[60px] top-[26px] z-20 md:left-[80px] md:top-[30px]" style={{ animation: "ev-rise .8s ease .7s both" }}>
        <div className="flex items-baseline gap-2">
          <span className="ev-grad-text text-lg font-semibold tracking-[0.42em]">EV</span>
          <span className="hidden text-[10px] tracking-[0.3em] text-white/45 sm:inline">CREATIVE STUDIO</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] tracking-[0.28em] text-white/60">
          <span className={cn("h-1.5 w-1.5 rounded-full", state === "ERROR" ? "bg-[#ff5878]" : "bg-[#60e4ff] ev-pulse-dot")} />
          <span data-ev-word>{STATE_WORD[state]}</span>
        </div>
      </div>

      {/* LIVE METRICS — real numbers only, kept apart from the motion */}
      <div className="absolute right-4 top-4 z-20 md:right-8 md:top-6" style={{ animation: "ev-rise .8s ease 2.8s both" }}>
        <div className={cn("transition duration-500", hideSides && "pointer-events-none opacity-20 blur-[3px]")}>
          <LiveMetrics data={data} />
        </div>
      </div>

      {/* idea stream (right) */}
      <div className="absolute right-6 top-[19%] z-20 hidden w-[min(300px,24vw)] md:block" style={{ animation: "ev-rise 1s ease 2.4s both" }}>
        <div className={cn("transition duration-500", hideSides && "pointer-events-none scale-95 opacity-[0.12] blur-[4px]")}>
        <IdeaStream
          items={data?.recent ?? null}
          selected={selected}
          onSelect={(id, fmt) => { setSelected(id); setSelectedFormat(id ? fmt : null); }}
          onUse={(text) => focusInput(text)}
        />
        </div>
      </div>

      {/* EV's words / caption as a glass text surface (right, lower) */}
      {reply && !approval && (
        <div className="absolute bottom-[150px] right-6 z-20 hidden w-[min(320px,26vw)] md:block">
          <TextSurface text={reply} streaming={state === "THINKING" || state === "GENERATING" || state === "EXECUTING"} />
        </div>
      )}

      {/* tiny activity stream (left, lower) */}
      <div className="absolute bottom-[140px] left-6 z-20 hidden w-60 md:block" style={{ animation: "ev-rise .8s ease 3s both" }}>
        <div className={cn("transition duration-500", hideSides && "opacity-25 blur-[2px]")}>
          <ActivityStream log={log} />
        </div>
      </div>

      {/* the real generated media, glued into the canvas frame */}
      {image && (
        <div ref={setMediaEl} className="absolute z-10 overflow-hidden" style={{ left: "50%", top: "40%", width: 0, height: 0 }}>
          <Media url={image.url} onAspect={setMediaAspect} />
        </div>
      )}

      {/* approval scene */}
      {approval && (
        <div ref={setSideEl} className="absolute z-30 w-auto md:w-[330px]" style={{ left: "60%", top: "50%" }}>
          {image ? (
            <MediaApproval
              url={image.url}
              caption={reply || props.caption}
              onDismiss={props.onDismissImage}
              publishSignal={props.publishSignal}
              captionOverride={props.captionOverride}
              onPublishResult={props.onPublishResult}
              onStatus={onPublishStatus}
            />
          ) : (
            <TextApproval
              text={reply}
              onApprove={() => { props.onCommand?.("Approve it"); push("Approved", "ok"); }}
              onEdit={() => focusInput("Change it: ")}
              canApprove={!!props.onCommand}
            />
          )}
        </div>
      )}

      {/* pipeline + command (bottom) */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-3 px-4 pb-4 md:pb-6">
        {!approval && (
          <div className="w-full md:hidden" style={{ animation: "ev-rise .8s ease 2.4s both" }}>
            {reply
              ? <div className="mb-1 max-h-[22vh] overflow-hidden"><TextSurface text={reply} /></div>
              : <IdeaChips items={data?.recent ?? null} onUse={(text) => focusInput(text)} onPreview={(f) => setSelectedFormat(f)} />}
          </div>
        )}
        <div className={cn("w-full max-w-[620px]", approval && "hidden sm:block")} style={{ animation: "ev-rise .8s ease 2.6s both" }}>
          <div className={cn("transition duration-500", approval && publish === "idle" && "opacity-60")}>
            <Pipeline counts={data?.pipeline ?? null} live={stage} published={publish === "done"} />
          </div>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}
          className="ev-glass flex w-full max-w-[560px] items-center gap-2 rounded-full px-2 py-1.5"
          style={{ animation: "ev-rise .8s ease 1.8s both" }}
        >
          <VoiceGlyph level={props.level} active={props.voiceStarted && !props.muted} listening={state === "LISTENING"} />
          <button
            type="button" onClick={props.onMic}
            title={props.voiceStarted ? (props.muted ? "Unmute" : "Mute") : "Enable voice"}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition",
              props.voiceStarted && !props.muted ? "border-[#60e4ff]/70 bg-[#60e4ff]/10 text-[#9ff0ff]" : "border-white/15 text-white/60 hover:border-[#a78bfa]/60",
            )}
          >
            {props.voiceStarted && props.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <input
            ref={inputRef}
            value={props.input}
            onChange={(e) => props.onInput(e.target.value)}
            placeholder={state === "LISTENING" ? "Listening…" : "Tell EV what to create…"}
            className="min-w-0 flex-1 bg-transparent text-sm text-white/90 outline-none placeholder:text-white/40"
          />
          {props.input.trim() && (
            <button type="submit" title="Send" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#60e4ff]/30 to-[#ff5cd6]/30 text-white transition hover:brightness-125">
              <Send className="h-4 w-4" />
            </button>
          )}
          {props.voiceStarted && (
            <button type="button" onClick={props.onSleep} title="Sleep" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/50 hover:text-[#ff5cd6]">
              <Power className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

/* ---------------- real data ---------------- */

function useStudioData() {
  const [data, setData] = useState<StudioData | null>(null);
  const alive = useRef(true);
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/ev/studio", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      if (alive.current && j?.data) setData(j.data as StudioData);
    } catch { /* offline — keep what we have */ }
  }, []);
  useEffect(() => {
    alive.current = true;
    void reload();
    const id = setInterval(() => void reload(), 90_000);
    return () => { alive.current = false; clearInterval(id); };
  }, [reload]);
  return { data, reload };
}

function LiveMetrics({ data }: { data: StudioData | null }) {
  const ig = data?.instagram;
  return (
    <div className="ev-glass max-w-[44vw] rounded-2xl px-3 py-2 text-right sm:min-w-[180px] sm:max-w-none sm:px-3.5 sm:py-2.5" data-ev-metrics>
      <div className="flex items-center justify-end gap-1.5 text-[9px] tracking-[0.3em] text-white/45">
        <span className="h-1 w-1 rounded-full bg-[#60e4ff]" /> LIVE METRICS
      </div>
      {!data ? (
        <div className="mt-1 text-[11px] text-white/40">Loading…</div>
      ) : !ig || !ig.connected ? (
        <div className="mt-1 text-[11px] leading-snug text-white/55">Instagram not connected<br /><span className="hidden text-white/35 sm:inline">no live audience numbers</span></div>
      ) : "error" in ig ? (
        <div className="mt-1 text-[11px] text-[#ffb3c4]">{ig.error}</div>
      ) : (
        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-left">
          <Metric label="FOLLOWERS" value={compact(ig.followers)} />
          <Metric label="POSTS" value={compact(ig.mediaCount)} />
          <Metric label={`LIKES · LAST ${ig.recentPosts}`} value={compact(ig.recentLikes)} />
          <Metric label={`COMMENTS · LAST ${ig.recentPosts}`} value={compact(ig.recentComments)} />
        </div>
      )}
      {data && (
        <div className="mt-2 hidden border-t border-white/10 pt-1.5 text-[10px] text-white/45 sm:block">
          EV memory · {data.totals.items} piece{data.totals.items === 1 ? "" : "s"} · {data.totals.last7Days} this week
        </div>
      )}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[8px] tracking-[0.18em] text-white/40">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-white/90">{value}</div>
    </div>
  );
}

/* ---------------- idea stream ---------------- */

function IdeaStream({ items, selected, onSelect, onUse }: {
  items: StudioItem[] | null;
  selected: string | null;
  onSelect: (id: string | null, fmt: CreativeFormat | null) => void;
  onUse: (text: string) => void;
}) {
  const real = items && items.length > 0;
  return (
    <div data-ev-ideas>
      <div className="mb-3 text-[9px] tracking-[0.34em] text-white/40">{real ? "IDEA STREAM · EV MEMORY" : "START A CREATIVE"}</div>
      <div className="flex flex-col gap-2.5">
        {real
          ? items!.slice(0, 5).map((it, i) => {
            const isSel = selected === it.id;
            const dim = selected && !isSel;
            return (
              <div key={it.id} className="ev-float" style={{ animationDelay: `${i * 0.7}s` }}>
                <button
                  type="button"
                  onClick={() => onSelect(isSel ? null : it.id, formatOfKind(it.kind))}
                  className={cn("ev-idea group block w-full text-left", isSel && "ev-idea-on", dim && "ev-idea-dim")}
                >
                  <span className="ev-kinetic block text-[13px] font-semibold tracking-[0.2em]">{kindLabel(it.kind)}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-white/60">{it.title}</span>
                  <span className="ev-meta mt-1 block text-[10px] tracking-[0.12em] text-white/40">
                    {it.status.toUpperCase()}{it.niche ? ` · ${it.niche}` : ""} · {ago(it.createdAt)}
                  </span>
                </button>
                {isSel && (
                  <div className="ev-glass mt-2 rounded-xl p-3 text-[12px] text-white/75" style={{ animation: "ev-rise .45s ease both" }}>
                    {it.mediaUrl && !it.isVideo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.mediaUrl} alt="" className="mb-2 max-h-32 w-full rounded-lg object-cover" />
                    )}
                    {it.excerpt ? <p className="line-clamp-4 leading-snug">{it.excerpt}</p> : <p className="text-white/40">No text stored for this piece.</p>}
                    <button type="button" onClick={() => onUse(`Create a new ${it.kind} based on: ${it.title}`)}
                      className="mt-2 rounded-full border border-white/15 px-3 py-1 text-[11px] tracking-[0.12em] text-white/80 hover:border-[#60e4ff]/60">
                      USE AS BRIEF
                    </button>
                  </div>
                )}
              </div>
            );
          })
          : STARTER_FORMATS.map((f, i) => (
            <div key={f.label} className="ev-float" style={{ animationDelay: `${i * 0.7}s` }}>
              <button type="button" onClick={() => { onSelect(null, null); onUse(f.command); }}
                onMouseEnter={() => onSelect(`starter:${i}`, f.format)} onMouseLeave={() => onSelect(null, null)}
                className={cn("ev-idea block w-full text-left", selected && selected !== `starter:${i}` && "ev-idea-dim")}>
                <span className="ev-kinetic block text-[13px] font-semibold tracking-[0.2em]">{f.label}</span>
                <span className="ev-meta mt-0.5 block text-[10px] tracking-[0.12em] text-white/40">tap to brief EV</span>
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Phone: the idea stream as a row of swipeable chips. */
function IdeaChips({ items, onUse, onPreview }: { items: StudioItem[] | null; onUse: (text: string) => void; onPreview: (f: CreativeFormat | null) => void }) {
  const list = items && items.length
    ? items.slice(0, 6).map((it) => ({ key: it.id, label: kindLabel(it.kind), sub: it.title, command: `Create a new ${it.kind} based on: ${it.title}`, format: formatOfKind(it.kind) }))
    : STARTER_FORMATS.map((f) => ({ key: f.label, label: f.label, sub: "tap to brief EV", command: f.command, format: f.format }));
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" data-ev-chips>
      {list.map((c) => (
        <button key={c.key} type="button" onClick={() => { onPreview(c.format); onUse(c.command); }}
          className="ev-glass shrink-0 rounded-2xl px-3 py-2 text-left" style={{ maxWidth: 200 }}>
          <span className="ev-kinetic block text-[11px] font-semibold tracking-[0.18em]">{c.label}</span>
          <span className="block truncate text-[11px] text-white/55">{c.sub}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- pipeline ---------------- */

function Pipeline({ counts, live, published }: { counts: Record<string, number> | null; live: string | null; published: boolean }) {
  const idx = live ? EV_PIPELINE.indexOf(live as (typeof EV_PIPELINE)[number]) : -1;
  const pct = (i: number) => (i / (EV_PIPELINE.length - 1)) * 100;
  return (
    <div className="relative px-3" data-ev-pipeline>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-[#60e4ff]/10 via-[#a78bfa]/40 to-[#ff5cd6]/20" />
        {idx >= 0 && (
          <div className="absolute top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-[#60e4ff] to-[#ff5cd6] transition-all duration-700"
            style={{ left: 0, width: `${pct(idx)}%`, boxShadow: "0 0 10px #a78bfa" }} />
        )}
        {/* the particle travelling toward the live stage */}
        <span className="ev-pipe-dot absolute top-1/2" style={{ ["--to" as string]: `${idx >= 0 ? pct(idx) : 100}%` }} />
        {published && <span className="ev-pipe-flash absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2" />}
        {EV_PIPELINE.map((s, i) => (
          <span key={s} className={cn("absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition",
            i === idx ? "ev-live-node border-white bg-white" : i < idx ? "border-[#a78bfa] bg-[#a78bfa]/60" : "border-white/30 bg-[#05040d]")}
            style={{ left: `${pct(i)}%` }} />
        ))}
      </div>
      <div className="relative mt-1 h-7">
        {EV_PIPELINE.map((s, i) => (
          <div key={s} className="absolute -translate-x-1/2 text-center" style={{ left: `${pct(i)}%` }}>
            <div className={cn("text-[7.5px] tracking-[0.08em] sm:text-[9px] sm:tracking-[0.2em]", i === idx ? "text-white" : "text-white/40")}>{s}</div>
            <div className="text-[10px] tabular-nums text-white/60" title="Pieces at this stage in EV's memory">{counts ? counts[s] : "·"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- activity + text ---------------- */

function ActivityStream({ log }: { log: LogEntry[] }) {
  return (
    <div data-ev-activity>
      <div className="mb-2 text-[9px] tracking-[0.34em] text-white/40">ACTIVITY</div>
      <div className="relative flex flex-col gap-1.5 border-l border-white/10 pl-3">
        {log.length === 0 && <div className="text-[11px] text-white/35">Waiting for your first brief.</div>}
        {log.map((e, i) => (
          <div key={e.id} className="truncate text-[11px] leading-tight" title={e.text} style={{ opacity: 1 - i * 0.16, animation: "ev-rise .5s ease both" }}>
            <span className={cn("mr-1.5 inline-block h-1 w-1 rounded-full align-middle", e.tone === "ok" ? "bg-[#60e4ff]" : e.tone === "warn" ? "bg-[#ff5878]" : "bg-[#a78bfa]")} />
            <span className="text-white/75">{e.text}</span>
            <span className="ml-1.5 text-[9px] tabular-nums text-white/30">{e.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Word particles → sentences → a glass text surface. */
function TextSurface({ text, streaming }: { text: string; streaming?: boolean }) {
  const hasCaption = /(^|\n)\s*\**\s*caption\s*\**\s*[:：]/i.test(text);
  const shown = (hasCaption ? extractCaption(text) : text.replace(/\*\*/g, "")).slice(0, 420);
  const words = shown.split(/(\s+)/);
  return (
    <div className="ev-glass rounded-2xl px-4 py-3" data-ev-text>
      <div className="mb-1.5 text-[9px] tracking-[0.34em] text-white/40">{hasCaption ? "CAPTION" : "EV"}</div>
      <p className="max-h-44 overflow-hidden whitespace-pre-wrap text-[13px] leading-relaxed text-white/85">
        {words.map((w, i) => (/^\s+$/.test(w) ? w : <span key={i} className="ev-word" style={{ animationDelay: `${Math.min(i, 60) * 0.018}s` }}>{w}</span>))}
        {streaming && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-white/70 align-middle" />}
      </p>
    </div>
  );
}

function VoiceGlyph({ level, active, listening }: { level: number; active: boolean; listening: boolean }) {
  const amp = active ? (listening ? 1 : 0.5) : 0.15;
  return (
    <div className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center gap-[2px]" aria-hidden title="Voice">
      {[0.55, 0.85, 1, 0.8, 0.5].map((k, i) => (
        <span key={i} className="w-[2px] rounded-full bg-gradient-to-t from-[#60e4ff] to-[#ff5cd6] transition-[height] duration-100"
          style={{ height: `${Math.max(3, Math.min(22, 3 + level * 40 * k * amp + (active ? (i % 2) * 2 : 0)))}px`, opacity: active ? 0.95 : 0.4 }} />
      ))}
    </div>
  );
}

/* ---------------- media + approval ---------------- */

function Media({ url, onAspect }: { url: string; onAspect: (a: number) => void }) {
  const isVideo = /kind=video|\.mp4|\.webm|\.mov/i.test(url);
  return (
    <div className="ev-media-in absolute inset-0">
      {isVideo ? (
        <video src={url} controls autoPlay loop playsInline className="h-full w-full object-cover"
          onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) onAspect(v.videoWidth / v.videoHeight); }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="EV generated marketing creative" className="ev-kenburns h-full w-full select-none object-cover"
          onLoad={(e) => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight) onAspect(im.naturalWidth / im.naturalHeight); }} />
      )}
    </div>
  );
}

/**
 * Pull the Instagram caption out of EV's reply. EV presents content as
 * "CONTENT READY / Preview: … / Caption: … / CTA: … / Hashtags: …" — post the
 * caption (+ CTA + hashtags), not the whole briefing. Falls back to the reply.
 */
export function extractCaption(text?: string): string {
  const t = (text ?? "").replace(/\*\*/g, "").trim();
  if (!t) return "";
  const field = (name: string) =>
    t.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:preview|caption|cta|call to action|hashtags?|visual|image|format)\\s*[:：]|$)`, "i"))?.[1]?.trim();
  // Drop EV's own follow-up question ("Want me to publish it?") and wrapping quotes.
  const clean = (v?: string) =>
    v?.replace(/\n\s*(want me to|shall i|should i|do you want|let me know|ready to|say ["“]?publish).*$/is, "")
      .trim().replace(/^["“']+|["”']+$/g, "").trim();
  const caption = clean(field("caption"));
  if (!caption) return clean(t)!.slice(0, 2200);
  const firstLine = (v?: string) => clean(v)?.split("\n")[0].trim();
  const parts = [caption, firstLine(field("(?:cta|call to action)")), firstLine(field("hashtags?"))].filter(Boolean);
  return parts.join("\n\n").slice(0, 2200);
}

/**
 * READY TO PUBLISH — the real Instagram publish flow for the creative on the
 * canvas. APPROVE is the explicit approval; nothing posts without it (or a
 * spoken "publish").
 */
function MediaApproval({ url, caption, onDismiss, publishSignal, captionOverride, onPublishResult, onStatus }: {
  url: string; caption?: string; onDismiss: () => void;
  publishSignal?: number; captionOverride?: string; onPublishResult?: (r: { ok: boolean; message: string }) => void;
  onStatus: (s: PublishPhase, message?: string) => void;
}) {
  const isVideo = /kind=video|\.mp4|\.webm|\.mov/i.test(url);
  const [cap, setCap] = useState(() => extractCaption(caption));
  const edited = useRef(false);
  const capRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<"idle" | "publishing" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [containerId, setContainerId] = useState<string | undefined>();

  // EV's reply often lands after the image — keep the draft caption in sync
  // until you edit it yourself.
  useEffect(() => { if (!edited.current) setCap(extractCaption(caption)); }, [caption]);
  const statusCb = useRef(onStatus); statusCb.current = onStatus;
  useEffect(() => { statusCb.current(status, msg); }, [status, msg]);

  async function publish(textArg?: string) {
    const text = (textArg ?? cap).trim();
    const report = (ok: boolean, message: string) => onPublishResult?.({ ok, message });
    if (!text) { setStatus("error"); setMsg("Add a caption first."); report(false, "I need a caption first. Say: publish with caption, then your caption."); return; }
    if (status === "publishing" || status === "done") return;
    setStatus("publishing"); setMsg("");
    try {
      const res = await fetch("/api/ev/instagram/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isVideo ? { videoUrl: url, caption: text, containerId } : { imageUrl: url, caption: text }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { const m = j.error || `Publish failed (HTTP ${res.status}).`; setStatus("error"); setMsg(m); report(false, m); return; }
      if (j.data?.published) { setStatus("done"); setMsg(`Published to Instagram ✓ (id ${j.data.mediaId})`); report(true, "Published to Instagram."); }
      else if (j.data?.containerId) { setStatus("idle"); setContainerId(j.data.containerId); const m = j.data.message || "Still processing — say publish again to finish."; setMsg(m); report(false, "Instagram is still processing the video. Say publish again in a moment."); }
      else { setStatus("error"); setMsg("Instagram didn't confirm the post."); report(false, "Instagram didn't confirm the post."); }
    } catch { setStatus("error"); setMsg("Network error — couldn't reach the server."); report(false, "I couldn't reach the server."); }
  }

  // Voice/text "publish" from the console.
  const lastSignal = useRef(publishSignal ?? 0);
  useEffect(() => {
    if (!publishSignal || publishSignal === lastSignal.current) return;
    lastSignal.current = publishSignal;
    const text = captionOverride?.trim();
    if (text) { edited.current = true; setCap(text); }
    void publish(text || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishSignal]);

  const busy = status === "publishing" || status === "done";
  const title = status === "done" ? "PUBLISHED" : status === "publishing" ? "PUBLISHING" : "READY TO PUBLISH";
  return (
    <div className="ev-glass ev-approval relative max-h-[calc(100dvh-250px)] overflow-y-auto rounded-3xl p-4 md:max-h-[80vh]" data-ev-approval>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[9px] tracking-[0.34em] text-white/45">{isVideo ? "REEL · VIDEO" : "CREATIVE · IMAGE"}</div>
          <div key={title} className="ev-grad-text mt-0.5 text-base font-semibold tracking-[0.28em]" style={{ animation: "ev-rise .5s ease both" }}>{title}</div>
        </div>
        <button onClick={onDismiss} title="Dismiss" className="flex h-7 w-7 items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <label className="mt-3 block text-[9px] tracking-[0.3em] text-white/40">CAPTION</label>
      <textarea
        ref={capRef}
        value={cap}
        onChange={(e) => { edited.current = true; setCap(e.target.value); }}
        rows={5}
        placeholder="Write the Instagram caption…"
        disabled={busy}
        className="mt-1 max-h-40 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] leading-relaxed text-white/90 outline-none transition focus:border-[#60e4ff]/50 disabled:opacity-60"
      />

      {msg && (
        <p className={cn("mt-2 text-[11px] leading-snug", status === "error" ? "text-[#ffb3c4]" : status === "done" ? "text-[#9ff0ff]" : "text-white/55")}>{msg}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => publish()}
          disabled={busy}
          className={cn("ev-approve relative flex flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-full px-4 py-2 text-xs font-semibold tracking-[0.18em] transition disabled:opacity-70",
            status === "done" ? "bg-[#60e4ff]/20 text-[#9ff0ff]" : "bg-gradient-to-r from-[#60e4ff] via-[#a78bfa] to-[#ff5cd6] text-[#0a0620] hover:brightness-110")}
          title="Approve and publish to Instagram"
        >
          {status === "publishing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === "done" ? <Check className="h-3.5 w-3.5" /> : null}
          {status === "publishing" ? "PUBLISHING…" : status === "done" ? "PUBLISHED" : "APPROVE & PUBLISH"}
        </button>
        <button onClick={() => capRef.current?.focus()} disabled={busy} title="Edit the caption"
          className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-2 text-xs tracking-[0.14em] text-white/75 transition hover:border-white/40 disabled:opacity-50">
          <PenLine className="h-3.5 w-3.5" /> EDIT
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" title="Open full size"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-white/60 transition hover:text-white">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <p className="mt-2 text-[10px] text-white/35">Posts to Instagram only when you approve.</p>
    </div>
  );
}

/** Text-only content EV is holding for approval (no media yet). */
function TextApproval({ text, onApprove, onEdit, canApprove }: { text: string; onApprove: () => void; onEdit: () => void; canApprove: boolean }) {
  return (
    <div className="ev-approval flex flex-col gap-3" data-ev-approval>
      <div className="ev-grad-text text-base font-semibold tracking-[0.28em]" style={{ animation: "ev-rise .5s ease both" }}>READY FOR APPROVAL</div>
      {text && <TextSurface text={text} />}
      <div className="flex items-center gap-2">
        {canApprove && (
          <button onClick={onApprove} className="ev-approve relative flex flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-full bg-gradient-to-r from-[#60e4ff] via-[#a78bfa] to-[#ff5cd6] px-4 py-2 text-xs font-semibold tracking-[0.18em] text-[#0a0620] hover:brightness-110">
            <Check className="h-3.5 w-3.5" /> APPROVE
          </button>
        )}
        <button onClick={onEdit} className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-2 text-xs tracking-[0.14em] text-white/75 transition hover:border-white/40">
          <PenLine className="h-3.5 w-3.5" /> EDIT
        </button>
      </div>
    </div>
  );
}
