/**
 * Every RUBIN lead has a short number (1, 2, 3 …, in the order they arrived) so
 * you can name it by number — "follow up with 7 tomorrow at 4", "open lead 12",
 * "move number 3 to interested". And the spoken follow-up breakdown, notes
 * included. Client-safe, pure.
 */

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** "seven" → 7, "twenty one" / "twenty-one" → 21, "a hundred and five" → 105. null if it isn't a number. */
export function wordsToNumber(s: string): number | null {
  const w = s.toLowerCase().replace(/-/g, " ").replace(/\band\b/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return null;
  let total = 0, cur = 0, any = false;
  for (const x of w) {
    const u = UNITS.indexOf(x), t = TENS.indexOf(x);
    if (u >= 0) { cur += u; any = true; }
    else if (t >= 2) { cur += t * 10; any = true; }
    else if (x === "hundred") { cur = (cur || 1) * 100; any = true; }
    else if (x === "a" && !any) continue;
    else return null;
  }
  total += cur;
  return any ? total : null;
}

/**
 * The lead number in what you said, when it names a lead by number:
 * "7", "#7", "lead 7", "number 7", "no. 7", "client 7", "lead number seven", "lead #12".
 * null when it's a name ("ABC Café", "Cafe 7 Seas").
 */
export function leadNumberOf(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/, "").replace(/^(?:the\s+)/, "");
  const m = t.match(/^(?:(?:lead|client|customer|business)\s+)?(?:(?:number|no\.?|num)\s*)?#?\s*(\d{1,6})$/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 ? n : null;
  }
  // spoken: "lead seven", "number twenty one", "client number 3" (a bare word needs "lead"/"number")
  const w = t.match(/^(?:(?:lead|client|customer)\s+)?(?:number|no\.?|num)\s+([a-z\s-]+)$|^(?:lead|client|customer)\s+([a-z\s-]+)$/);
  if (w) {
    const n = wordsToNumber(w[1] ?? w[2]);
    return n && n >= 1 ? n : null;
  }
  return null;
}

type Numbered = { number?: number | null; businessName: string };
/** "#7 ABC Café" (screen) */
export const leadLabel = (l: Numbered) => (l.number ? `#${l.number} ${l.businessName}` : l.businessName);
/** "lead 7, ABC Café" (said out loud — reads naturally in both text and speech) */
export const spokenLead = (l: Numbered) => (l.number ? `lead ${l.number}, ${l.businessName}` : l.businessName);

export interface FollowUpRow {
  dueAt: string | Date;
  action: string;
  notes: string | null;
  lead: { number?: number | null; businessName: string };
}
export interface FollowUpQueueLike { overdue: FollowUpRow[]; today: FollowUpRow[]; upcoming: FollowUpRow[]; tz: string }

const ACTION: Record<string, string> = { call: "call", whatsapp: "WhatsApp", email: "email", instagram: "Instagram message", meeting: "meeting", task: "task" };

function whenOf(d: Date, tz: string, part: "overdue" | "today" | "upcoming", now: Date): string {
  const time = d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?([ap])m$/i, (_, x) => ` ${x.toUpperCase()}M`);
  if (part === "today") return `at ${time}`;
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  const diff = Math.round((Date.parse(day(d)) - Date.parse(day(now))) / 86_400_000);
  const date = d.toLocaleDateString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "short" });
  if (part === "overdue") return diff === -1 ? `was due yesterday at ${time}` : `was due ${date}`;
  return diff === 1 ? `tomorrow at ${time}` : `${date} at ${time}`;
}

/** The note you gave, cleaned for reading out (the newest line last). */
const noteText = (n: string | null) => (n ?? "").split(/\n+/).map((x) => x.trim()).filter(Boolean).join("; ").replace(/[.;\s]+$/, "");

/**
 * "You have 4 follow-ups — 1 overdue, 2 today, 1 coming up.
 *  Overdue: lead 7, ABC Café — call, was due yesterday at 4:00 PM. Note: wants an online menu.
 *  Today: …"  Every follow-up is listed with the note you told Rubin (up to `max`).
 */
export function followUpBreakdown(q: FollowUpQueueLike, opts: { now?: Date; max?: number; which?: "all" | "today" | "overdue" | "upcoming" } = {}): string {
  const now = opts.now ?? new Date();
  const max = opts.max ?? 12;
  const which = opts.which ?? "all";
  const parts = (["overdue", "today", "upcoming"] as const).filter((p) => which === "all" || which === p);
  const total = parts.reduce((s, p) => s + q[p].length, 0);
  const label = { overdue: "overdue", today: "today", upcoming: "coming up" };
  if (!total) {
    return which === "all" ? "You don't have any follow-ups scheduled right now."
      : which === "today" ? "No follow-ups today." : which === "overdue" ? "Nothing overdue — nice." : "No upcoming follow-ups.";
  }
  const counts = parts.filter((p) => q[p].length).map((p) => `${q[p].length} ${label[p]}`);
  const head = which === "all"
    ? `You have ${total} follow-up${total === 1 ? "" : "s"}${counts.length > 1 ? ` — ${counts.join(", ")}` : ` ${label[parts.find((p) => q[p].length)!]}`}.`
    : `${total} follow-up${total === 1 ? "" : "s"} ${label[which]}.`;
  const lines: string[] = [];
  let told = 0;
  for (const p of parts) {
    const rows = q[p];
    if (!rows.length || told >= max) continue;
    const take = rows.slice(0, max - told);
    told += take.length;
    const items = take.map((f) => {
      const note = noteText(f.notes);
      return `${spokenLead(f.lead)} — ${ACTION[f.action] ?? f.action}, ${whenOf(new Date(f.dueAt), q.tz, p, now)}. ${note ? `Note: ${note}.` : "No note."}`;
    });
    lines.push(`${which === "all" ? `${p === "upcoming" ? "Coming up" : p[0].toUpperCase() + p.slice(1)}: ` : ""}${items.join(" ")}`);
  }
  const more = total - told;
  return [head, ...lines, ...(more > 0 ? [`And ${more} more — they're all on screen.`] : [])].join("\n");
}
