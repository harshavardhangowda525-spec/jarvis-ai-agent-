/**
 * EV daily content — the morning schedule and the status the UI shows. Pure and
 * client-safe. Every "done" comes from the package's own log (the real time a
 * step finished); a step that's past its planned time and not done is shown as
 * late, never as complete.
 */

export const DAILY_STEPS = [
  { key: "research", label: "Research", at: "04:00" },
  { key: "content", label: "Content", at: "04:15" },
  { key: "creative", label: "Creative", at: "04:45" },
  { key: "video", label: "Video", at: "05:00" },
  { key: "qc", label: "Quality check", at: "05:20" },
  { key: "ready", label: "Ready", at: "05:30" },
] as const;
export type DailyStepKey = (typeof DAILY_STEPS)[number]["key"];

/** The five streams around EV's core. */
export const DAILY_STREAMS = ["IDEA", "CREATION", "VIDEO", "READY", "APPROVAL"] as const;
export type DailyStream = (typeof DAILY_STREAMS)[number];

export type DailyStatus = "draft" | "generating" | "ready" | "approved" | "published" | "rejected" | "failed";

export interface DailyLogEntry { at: string; step: string; text: string; ok: boolean }

export interface StepState {
  key: DailyStepKey;
  label: string;
  plannedAt: string; // HH:MM
  state: "done" | "active" | "pending" | "failed";
  doneAt: string | null;
  late: boolean;
}

/** Minutes after local midnight for "HH:MM". */
export function hm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : NaN;
}

/** Shift every planned step so the pipeline starts at `start` (default 04:00). */
export function plannedTimes(start = "04:00"): Record<DailyStepKey, string> {
  const base = hm(DAILY_STEPS[0].at);
  const s = Number.isFinite(hm(start)) ? hm(start) : base;
  const out = {} as Record<DailyStepKey, string>;
  for (const step of DAILY_STEPS) {
    const t = (hm(step.at) - base + s + 1440) % 1440;
    out[step.key] = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }
  return out;
}

/** Which pipeline stage a step is finished by (stages in order). */
const STAGE_ORDER = ["plan", "rewrite_caption", "rewrite_tone", "rewrite_video", "image", "video", "video_wait", "qc", "ready", "publishing", "done"];

export interface StepInput {
  status: string;
  stage: string;
  trigger: string;
  log: DailyLogEntry[];
  hasCaption: boolean;
  hasImage: boolean;
  hasVideo: boolean;
  qcPassed: boolean;
  error: string | null;
}

/**
 * Per-step state. `nowMin` = minutes after local midnight now; `isToday` says
 * whether the package's date is today (lateness only applies to today's
 * scheduled run — a revision you asked for at noon isn't "late").
 */
export function stepStates(p: StepInput, o: { nowMin: number; isToday: boolean; start?: string }): StepState[] {
  const planned = plannedTimes(o.start);
  const lastDone = (step: string) => [...p.log].reverse().find((e) => e.step === step && e.ok)?.at ?? null;
  const done: Record<DailyStepKey, boolean> = {
    research: !!lastDone("research") || p.hasCaption,
    content: p.hasCaption,
    creative: p.hasImage,
    video: p.hasVideo,
    qc: p.qcPassed,
    ready: ["ready", "approved", "published"].includes(p.status),
  };
  const failed = p.status === "failed";
  let activeGiven = false;
  return DAILY_STEPS.map((s) => {
    const isDone = done[s.key];
    let state: StepState["state"] = isDone ? "done" : "pending";
    if (!isDone && !activeGiven && (p.status === "generating" || p.status === "draft" || failed)) {
      state = failed ? "failed" : "active";
      activeGiven = true;
    }
    const late = !isDone && o.isToday && p.trigger === "schedule" && o.nowMin > hm(planned[s.key]) && p.status !== "rejected";
    return { key: s.key, label: s.label, plannedAt: planned[s.key], state, doneAt: isDone ? lastDone(s.key) : null, late };
  });
}

/** The stream EV's core is currently feeding. */
export function activeStream(p: { status: string; stage: string }): DailyStream {
  if (["approved", "published"].includes(p.status) || p.stage === "publishing" || p.stage === "done") return "APPROVAL";
  if (p.status === "ready" || p.stage === "qc" || p.stage === "ready") return "READY";
  if (p.stage === "video" || p.stage === "video_wait" || p.stage === "rewrite_video") return "VIDEO";
  if (p.stage === "image") return "CREATION";
  return "IDEA";
}

export function stageRank(stage: string): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i < 0 ? 0 : i;
}

/** Local date + minutes in a timezone (falls back to UTC for a bad zone). */
export function localClock(now: Date, tz: string): { date: string; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    return localClock(now, "UTC");
  }
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: (+g("hour") % 24) * 60 + +g("minute") };
}

/** Has the day's automatic run started? (local time ≥ start) */
export function autostartDue(now: Date, tz: string, start = "04:00"): boolean {
  const s = hm(start);
  return localClock(now, tz).minutes >= (Number.isFinite(s) ? s : 240);
}

/** "5:30 AM" from "05:30". */
export function clockLabel(s: string): string {
  const m = hm(s);
  if (!Number.isFinite(m)) return s;
  const h = Math.floor(m / 60), mi = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
