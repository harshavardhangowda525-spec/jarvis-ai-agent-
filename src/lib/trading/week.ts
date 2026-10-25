/**
 * Reporting weeks in India time (Asia/Kolkata, UTC+05:30, no daylight saving):
 * Monday 00:00 → Sunday 23:59. The weekly review is due Sunday 18:00 IST and
 * covers the week that ends that Sunday.
 */

export const IST_OFFSET_MS = 330 * 60_000;

/** YYYY-MM-DD of an instant, in IST. */
export function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday */
function weekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export interface Week { start: string; end: string }

export function weekOf(date: string): Week {
  const start = addDays(date, -weekday(date));
  return { start, end: addDays(start, 6) };
}

/** Epoch ms of an IST wall-clock time. */
export function istInstant(date: string, hh: number, mm = 0): number {
  return Date.parse(`${date}T00:00:00Z`) + (hh * 60 + mm) * 60_000 - IST_OFFSET_MS;
}

export function inWeek(date: string | undefined | null, w: Week): boolean {
  return !!date && date >= w.start && date <= w.end;
}

export function inWeekMs(ms: number | undefined | null, w: Week): boolean {
  return typeof ms === "number" && Number.isFinite(ms) && inWeek(istDate(ms), w);
}

/** The most recent week whose review time (its Sunday at `hh:mm` IST) has passed. */
export function latestDueWeek(now: number, hh = 18, mm = 0): Week {
  const w = weekOf(istDate(now));
  return now >= istInstant(w.end, hh, mm) ? w : weekOf(addDays(w.start, -1));
}

/** Weeks ending at `last`, oldest first. */
export function weeksBack(last: Week, n: number): Week[] {
  return Array.from({ length: n }, (_, i) => weekOf(addDays(last.start, -7 * (n - 1 - i))));
}

export function weekLabel(w: Week): string {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${f(w.start)} – ${f(w.end)} ${w.end.slice(0, 4)}`;
}
