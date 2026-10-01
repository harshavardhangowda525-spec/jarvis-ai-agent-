/**
 * Calendar-day maths in the user's own timezone (the briefing is about "your"
 * yesterday, not the server's). Client-safe (pure).
 */
export function validTz(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsCache.set(tz, f);
  }
  return f;
}
function parts(ts: number, tz: string) {
  const o: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(ts))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, min: o.minute, s: o.second };
}

const TZ_ALIASES: Record<string, string> = {
  ist: "Asia/Kolkata", "india standard time": "Asia/Kolkata", india: "Asia/Kolkata", "asia/calcutta": "Asia/Kolkata", kolkata: "Asia/Kolkata", "gmt+5:30": "Asia/Kolkata", "utc+5:30": "Asia/Kolkata", "utc+05:30": "Asia/Kolkata", "gmt+05:30": "Asia/Kolkata",
  gmt: "UTC", utc: "UTC", "coordinated universal time": "UTC",
};
/**
 * A timezone as typed ("IST", "India Standard Time", "asia/kolkata") → its IANA
 * name ("Asia/Kolkata"), or null when it isn't a timezone at all.
 */
export function normalizeTz(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const alias = TZ_ALIASES[t.toLowerCase()];
  if (alias) return alias;
  try {
    const z = new Intl.DateTimeFormat("en-US", { timeZone: t }).resolvedOptions().timeZone;
    return z === "Asia/Calcutta" ? "Asia/Kolkata" : z; // same zone; keep the modern name
  } catch { return null; }
}

/** "YYYY-MM-DD" of an instant in a timezone. */
export function localDate(ts: number | Date, tz: string): string {
  const p = parts(+ts, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
export function localHour(ts: number | Date, tz: string): number { return parts(+ts, tz).h; }
/** Minutes since local midnight. */
export function localMinutes(ts: number | Date, tz: string): number { const p = parts(+ts, tz); return p.h * 60 + p.min; }

/** Minutes the timezone is ahead of UTC at an instant. */
function offsetMin(ts: number, tz: string) {
  const p = parts(ts, tz);
  return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ts / 1000) * 1000) / 60_000;
}

/** UTC instant of local midnight at the start of `date` ("YYYY-MM-DD"). */
export function startOfDay(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMin(guess, tz) * 60_000;
  t = guess - offsetMin(t, tz) * 60_000; // DST edge
  return new Date(t);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** [start, end) instants covering local dates from..to inclusive. */
export function rangeBounds(from: string, to: string, tz: string) {
  return { start: startOfDay(from, tz), end: startOfDay(addDays(to, 1), tz) };
}

export const todayIn = (tz: string, now = Date.now()) => localDate(now, tz);
export const yesterdayIn = (tz: string, now = Date.now()) => addDays(todayIn(tz, now), -1);

export function isDate(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)); }

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Saturday, 27 September" style label. */
export function dayLabel(date: string, opts: { weekday?: boolean } = {}) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString("en-GB", { timeZone: "UTC", ...(opts.weekday ? { weekday: "long" } : {}), day: "numeric", month: "long" });
}

export interface DayRange { from: string; to: string; label: string; kind: "day" | "range" }

/**
 * Which days a history question is about. Returns null when the text isn't a
 * history question. "yesterday" (default), "today", "on September 25", "25/09",
 * "last week" (the 7 days before today), "last 7 days" / "past 3 days" (incl. today).
 */
export function parseHistoryRange(text: string, tz: string, now = Date.now()): DayRange | null {
  const t = text.toLowerCase();
  const today = todayIn(tz, now), yesterday = addDays(today, -1);
  const history = /\b(what (did|have) i (do|done|work(ed)? on|get done|accomplish)|what happened|briefing|summary|recap|activity|what was i (doing|working on)|my (day|work))\b/.test(t);
  if (!history) return null;

  const lastN = t.match(/\b(?:last|past|previous)\s+(\d{1,2})\s+days?\b/);
  if (lastN) { const n = Math.min(Math.max(+lastN[1], 1), 31); return { from: addDays(today, -(n - 1)), to: today, label: `Last ${n} days`, kind: n === 1 ? "day" : "range" }; }
  if (/\b(last|past|previous)\s+week\b|\bthis past week\b/.test(t)) return { from: addDays(today, -7), to: yesterday, label: "Last week", kind: "range" };
  if (/\btoday\b/.test(t)) return { from: today, to: today, label: "Today", kind: "day" };
  if (/\bday before yesterday\b/.test(t)) { const d = addDays(today, -2); return { from: d, to: d, label: dayLabel(d, { weekday: true }), kind: "day" }; }

  const y = Number(today.slice(0, 4));
  const pick = (mo: number, d: number) => {
    let date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (date > today) date = `${y - 1}${date.slice(4)}`; // "on December 30" asked in January → last year
    return isDate(date) ? { from: date, to: date, label: dayLabel(date, { weekday: true }), kind: "day" as const } : null;
  };
  const mName = MONTHS.map((m) => `${m.slice(0, 3)}${m.length > 3 ? `(?:${m.slice(3)})?` : ""}`).join("|");
  let m = t.match(new RegExp(`\\b(${mName})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  if (m) { const r = pick(MONTHS.findIndex((x) => x.startsWith(m![1].slice(0, 3))) + 1, +m[2]); if (r) return r; }
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${mName})\\b`));
  if (m) { const r = pick(MONTHS.findIndex((x) => x.startsWith(m![2].slice(0, 3))) + 1, +m[1]); if (r) return r; }
  m = t.match(/\bon\s+(\d{1,2})[/.-](\d{1,2})\b/);
  if (m) { const r = pick(+m[2], +m[1]); if (r) return r; }
  return { from: yesterday, to: yesterday, label: "Yesterday", kind: "day" };
}
