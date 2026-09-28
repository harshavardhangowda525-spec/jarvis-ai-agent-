import {
  activeStream, clockLabel, localClock, stepStates,
  type DailyLogEntry, type DailyStream, type StepState,
} from "./schedule";
import type { QcResult } from "./qc";

/**
 * What EV's "TODAY'S CONTENT" shows — built only from the stored package row.
 * Client-safe.
 */

export interface DailyPackageView {
  id: string;
  date: string;
  version: number;
  status: string;
  stage: string;
  trigger: string;
  instruction: string | null;
  contentType: string;
  niche: string | null;
  service: string | null;
  format: string | null;
  topic: string;
  angle: string | null;
  hook: string | null;
  caption: string | null;
  cta: string | null;
  hashtags: string[];
  beats: string[];
  creativeConcept: string | null;
  videoConcept: string | null;
  imageUrl: string | null;
  imageProvider: string | null;
  videoUrl: string | null;
  videoSeconds: number | null;
  videoProvider: string | null;
  postingTime: string | null;
  postingLabel: string | null;
  qc: QcResult | null;
  error: string | null;
  publishError: string | null;
  postMediaId: string | null;
  reelMediaId: string | null;
  log: DailyLogEntry[];
  steps: StepState[];
  stream: DailyStream;
  readyAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** Ready (or later) after the promised time on a scheduled run. */
  readyLate: boolean;
}

export interface DailyHistoryItem { id: string; date: string; version: number; topic: string; status: string; niche: string | null; createdAt: string }

export interface DailyView {
  enabled: boolean;
  timezone: string;
  today: string;
  start: string;
  readyBy: string;
  readyByLabel: string;
  startLabel: string;
  autoPublish: boolean;
  /** The day's automatic run has begun (local time ≥ start). */
  started: boolean;
  pkg: DailyPackageView | null;
  history: DailyHistoryItem[];
  capabilities: { writer: string | null; image: string | null; video: string; instagram: boolean; publicUrl: boolean };
}

export interface DailyRow {
  id: string; date: string; version: number; status: string; stage: string; trigger: string; instruction: string | null;
  contentType: string; niche: string | null; service: string | null; format: string | null; topic: string; angle: string | null;
  hook: string | null; caption: string | null; cta: string | null; hashtags: string[]; beats: string[];
  creativeConcept: string | null; videoConcept: string | null; imageUrl: string | null; imageProvider: string | null;
  videoUrl: string | null; videoSeconds: number | null; videoProvider: string | null; postingTime: string | null;
  qc: unknown; error: string | null; publishError: string | null; postMediaId: string | null; reelMediaId: string | null;
  log: unknown; readyAt: Date | null; approvedAt: Date | null; publishedAt: Date | null; createdAt: Date;
}

export function asLog(v: unknown): DailyLogEntry[] {
  return Array.isArray(v) ? (v as DailyLogEntry[]).filter((e) => e && typeof e.text === "string") : [];
}

export function packageView(r: DailyRow, o: { now: Date; tz: string; start: string; readyBy: string }): DailyPackageView {
  const clock = localClock(o.now, o.tz);
  const log = asLog(r.log);
  const qc = (r.qc && typeof r.qc === "object" ? r.qc : null) as QcResult | null;
  const readyMin = (() => { const [h, m] = o.readyBy.split(":").map(Number); return h * 60 + m; })();
  const readyLocal = r.readyAt ? localClock(r.readyAt, o.tz) : null;
  return {
    id: r.id, date: r.date, version: r.version, status: r.status, stage: r.stage, trigger: r.trigger, instruction: r.instruction,
    contentType: r.contentType, niche: r.niche, service: r.service, format: r.format, topic: r.topic, angle: r.angle,
    hook: r.hook, caption: r.caption, cta: r.cta, hashtags: r.hashtags, beats: r.beats,
    creativeConcept: r.creativeConcept, videoConcept: r.videoConcept,
    imageUrl: r.imageUrl, imageProvider: r.imageProvider, videoUrl: r.videoUrl, videoSeconds: r.videoSeconds, videoProvider: r.videoProvider,
    postingTime: r.postingTime, postingLabel: r.postingTime ? clockLabel(r.postingTime) : null,
    qc, error: r.error, publishError: r.publishError, postMediaId: r.postMediaId, reelMediaId: r.reelMediaId,
    log: log.slice(-30),
    steps: stepStates({
      status: r.status, stage: r.stage, trigger: r.trigger, log,
      hasCaption: !!r.caption, hasImage: !!r.imageUrl, hasVideo: !!r.videoUrl, qcPassed: !!qc?.passed, error: r.error,
    }, { nowMin: clock.minutes, isToday: r.date === clock.date, start: o.start }),
    stream: activeStream(r),
    readyAt: r.readyAt?.toISOString() ?? null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    readyLate: !!readyLocal && r.trigger === "schedule" && (readyLocal.date > r.date || (readyLocal.date === r.date && readyLocal.minutes > readyMin)),
  };
}

/** One sentence of true status for EV to say. */
export function spokenStatus(v: DailyView): string {
  const p = v.pkg;
  if (!v.enabled) return "Daily content is switched off (EV_DAILY=off).";
  if (!p) return v.started
    ? "Today's content hasn't started yet. Say \"create today's content\" and I'll start now."
    : `I'll start today's content at ${v.startLabel} and have it ready by ${v.readyByLabel}.`;
  if (p.status === "published") return "Today's content is published on Instagram.";
  if (p.status === "approved") return p.publishError ? `You approved it, but publishing is blocked: ${p.publishError.replace(/[.\s]+$/, "")}.` : "Approved — I'm publishing it to Instagram now.";
  if (p.status === "ready") return "Today's content is ready. Would you like me to publish it?";
  if (p.status === "failed") return `Today's content hit a problem: ${(p.error ?? "unknown error").replace(/[.\s]+$/, "")}. Say "retry" and I'll try again.`;
  const active = p.steps.find((s) => s.state === "active");
  const late = p.steps.some((s) => s.late);
  const what = p.stage === "video_wait" ? "the video is still rendering"
    : p.stage === "image_wait" ? "the image is still rendering"
    : active ? `I'm on the ${active.label.toLowerCase()} step` : "I'm still working on it";
  return `Today's content isn't ready yet — ${what}${late ? ", and it's running later than planned" : ""}.`;
}
