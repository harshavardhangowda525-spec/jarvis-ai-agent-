import { startOfDay, addDays, todayIn } from "@/lib/activity/dates";
import { isRobinDeactivation, stripRobinWake } from "./wake";
import type { NodeId, Stage } from "./types";
import { leadNumberOf } from "./numbers";

/**
 * What a spoken/typed RUBIN command means. Fast local routing for the commands
 * that drive the interface; anything else goes to Rubin's AI brain. Client-safe.
 * Nothing here changes data — the console validates the lead first and asks
 * for confirmation on decisions.
 */
export type View = "pipeline" | "funnel" | "revenue" | "followups" | "quotations" | "clients" | "analytics" | "demos";
export type LeadFilter = "hottest" | "uncontacted" | "high_priority" | NodeId;

export type RobinCommand =
  | { kind: "exit" }
  | { kind: "confirm"; yes: boolean }
  | { kind: "briefing" }
  | { kind: "view"; view: View; filter?: LeadFilter }
  | { kind: "leads"; filter: LeadFilter }
  | { kind: "open"; name: string }
  | { kind: "move"; name: string | null; stage: Stage }
  | { kind: "followup"; name: string | null; when: string; note?: string }
  | { kind: "demo"; name: string | null; when: string }
  | { kind: "complete_followup"; name: string | null; note?: string }
  | { kind: "note"; name: string | null; text: string }
  | { kind: "followups"; which: "all" | "today" | "overdue" | "upcoming" }
  | { kind: "convert"; name: string | null }
  | { kind: "undo" }
  | { kind: "chat"; topic: "hello" | "how_are_you" | "thanks" | "who" | "bye" }
  | { kind: "stat"; stat: "won_month" | "conversion" | "count"; filter?: LeadFilter }
  | { kind: "ask"; text: string };

const STAGE_WORDS: [RegExp, Stage][] = [
  [/^(?:do not contact|don'?t contact|dnc)$/, "do_not_contact"],
  [/^not interested$/, "not_interested"],
  [/^(?:closed )?won$|^(?:a )?client$|^closed$/, "won"],
  [/^lost$/, "lost"],
  [/^(?:quotation|quote)(?: sent)?$/, "quotation_sent"],
  [/^negotiat(?:ing|ion)$/, "negotiating"],
  [/^demo (?:done|completed|complete)$/, "demo_completed"],
  [/^demo(?: scheduled| booked)?$/, "demo_scheduled"],
  [/^follow[- ]?ups?$/, "follow_up"],
  [/^interested$/, "interested"],
  [/^contacted$/, "contacted"],
  [/^qualified$/, "qualified"],
  [/^new$/, "new"],
];
export function stageFromWords(s: string): Stage | null {
  const t = s.toLowerCase().replace(/[.!?]/g, "").replace(/\b(the|stage|status|column|lane)\b/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, st] of STAGE_WORDS) if (re.test(t)) return st;
  return null;
}

const THIS = /^(?:this|that|the current|the selected)(?: lead| one| business)?$|^it$/i;
const nameOrThis = (s: string) => (THIS.test(s.trim()) ? null : s.trim().replace(/[.!?]+$/, ""));

const FILTER_WORDS: [RegExp, LeadFilter][] = [
  [/\b(highest[- ]priority|high[- ]priority|hottest|top|best|most important)\b/, "hottest"],
  [/\b(haven'?t been contacted|not (?:been )?contacted|uncontacted|never contacted|not reached)\b/, "uncontacted"],
  [/\bqualified\b/, "qualified"],
  [/\binterested\b/, "interested"],
  [/\b(negotiat\w*|proposals?|quotations? sent)\b/, "proposal"],
  [/\brejected\b/, "lost"],
  [/\b(won|clients?)\b/, "won"],
  [/\blost\b/, "lost"],
  [/\bnew\b/, "new"],
  [/\bcontacted\b/, "contacted"],
];

export function parseRobinCommand(raw: string): RobinCommand {
  const text = stripRobinWake(raw).replace(/\s+/g, " ").trim();
  const low = text.toLowerCase().replace(/[’]/g, "'");
  if (isRobinDeactivation(raw) || /^(close|exit|deactivate|go back)[.!\s]*$/.test(low)) return { kind: "exit" };
  if (/^(yes|yeah|yep|yup|confirm(ed)?|do it|go ahead|sure|correct|ok(ay)?)( please| do it| confirm)?[.!\s]*$/.test(low)) return { kind: "confirm", yes: true };
  if (/^(no|nope|cancel|don'?t|stop|never ?mind|not now)[.!\s]*$/.test(low)) return { kind: "confirm", yes: false };
  // small talk — answered on the spot (no AI needed)
  const bare = low.replace(/[.!?,]/g, " ").replace(/\b(rubin|ruben|reuben|robin|robbin|robyn|buddy|bro|man|dude|mate|there)\b/g, " ").replace(/\s+/g, " ").trim();
  if (/^(hi+|hey+|hello+|hiya|yo|hola|namaste|good (morning|afternoon|evening)|sup|wassup|what'?s up|hey hi|hi hi)$/.test(bare)) return { kind: "chat", topic: "hello" };
  if (/^((hi|hey|hello) )?(how are you( doing)?|how'?s it going|how are things|how do you do|you good|all good)$/.test(bare)) return { kind: "chat", topic: "how_are_you" };
  if (/^(thanks?( a lot| so much)?|thank you( so much)?|thx|cheers|great job|nice|awesome|cool|perfect|good job|well done)$/.test(bare)) return { kind: "chat", topic: "thanks" };
  if (/^(who are you|what are you|what can you do|what do you do|help)$/.test(bare)) return { kind: "chat", topic: "who" };
  if (/^(bye|goodbye|see you|see ya|good night|later)$/.test(bare)) return { kind: "chat", topic: "bye" };
  if (/^(undo|undo (that|it|the last (one|move|change))|take (that|it) back|revert( that| it)?|go back one|move it back)[.!\s]*$/.test(low)) return { kind: "undo" };
  if (/\b(what'?s my day|my day|daily briefing|sales briefing|morning (report|briefing)|brief me|today'?s briefing)\b/.test(low)) return { kind: "briefing" };

  // ---- notes: "note for 7: wants an online menu", "add a note to ABC Café that he's travelling"
  let m = low.match(/^(?:please\s+)?(?:(?:add|make|take(?:\s+down)?|put|write(?:\s+down)?|save|jot(?:\s+down)?)\s+(?:a\s+)?)?notes?\s+(?:for|on|to|about|against)\s+(.+?)\s*(?:[:;–—-]\s*|,\s*|\s+(?:that|saying)\s+)(.+)$/)
    ?? low.match(/^(?:please\s+)?(?:(?:add|make|take(?:\s+down)?|put|write(?:\s+down)?|save)\s+(?:a\s+)?)?notes?\s+(?:for|on|to)\s+((?:lead\s+|client\s+|number\s+|no\.?\s*|#)?\d{1,6})\s+(.+)$/);
  if (m) return { kind: "note", name: nameOrThis(origCase(text, m[1])), text: cleanNote(origCase(text, m[2])) };
  m = low.match(/^(?:please\s+)?(?:(?:add|make|take(?:\s+down)?|write(?:\s+down)?|save)\s+(?:a\s+)?)?notes?\s*[:,–—-]\s*(.+)$/);
  if (m) return { kind: "note", name: null, text: cleanNote(origCase(text, m[1])) };

  // ---- follow-ups done (a note can follow): "done with 7, he wants a quote", "followed up with ABC Café — call back Monday"
  m = low.match(/^(?:i'?m\s+|i\s+(?:have\s+|just\s+)?|we\s+)?(?:done with|followed up with|finished (?:the\s+)?follow[- ]?up with|completed (?:the\s+)?follow[- ]?up with)\s+(.+?)(?:\s*[,:;–—-]\s*(.+))?$/)
    ?? low.match(/^follow[- ]?up\s+with\s+(.+?)\s+(?:is\s+)?(?:done|complete|completed)(?:\s*[,:;–—-]\s*(.+))?$/);
  if (m) return { kind: "complete_followup", name: nameOrThis(origCase(text, m[1])), ...(m[2] ? { note: cleanNote(origCase(text, m[2])) } : {}) };

  // ---- the follow-up list, read out with your notes: "how many follow-ups do we have?"
  if (/\bfollow[- ]?ups?\b/.test(low) && !/^(?:please\s+)?(?:schedule|set up|book|add|create|plan|mark|complete|finish|close|cancel)\b/.test(low)
    && /\b(how many|what|which|list|tell me|give me|read|breakdown|break down|show|do (?:we|i) have|have we got|got|pending|my|our|today'?s?|overdue|missed|upcoming|coming up|due|waiting|all|open|status)\b/.test(low)) {
    const which = /\b(overdue|missed|late)\b/.test(low) ? "overdue" : /\btoday'?s?\b/.test(low) ? "today" : /\b(upcoming|coming up|this week|tomorrow|later)\b/.test(low) ? "upcoming" : "all";
    return { kind: "followups", which };
  }

  // ---- actions on a lead
  m = low.match(/^(?:please )?(?:schedule|set up|book|add|create|plan)\s+(?:a |another |the next )?follow[- ]?up\s+(?:call\s+)?(?:with|for)\s+(.+?)\s+((?:today|tonight|tomorrow|day after tomorrow|on|next|this|in|at|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*)$/);
  if (!m) m = low.match(/^(?:please )?follow[- ]?up\s+with\s+(.+?)\s+((?:today|tonight|tomorrow|day after tomorrow|on|next|this|in|at|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*)$/);
  if (m) {
    // "… tomorrow at 4, note: wants an online menu" / "… about the menu" — the note rides along
    const [name, n1] = splitNote(m[1]);
    const [when, n2] = splitNote(m[2]);
    const note = [n1, n2].filter(Boolean).map((n) => cleanNote(origCase(text, n!))).join(" ");
    return { kind: "followup", name: nameOrThis(origCase(text, name)), when, ...(note ? { note } : {}) };
  }
  m = low.match(/^(?:please )?(?:schedule|set up|book|arrange|plan)\s+(?:a |the )?demo\s+(?:with|for)\s+(.+?)\s+((?:today|tonight|tomorrow|day after tomorrow|on|next|this|in|at|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*)$/);
  if (m) return { kind: "demo", name: nameOrThis(origCase(text, m[1])), when: m[2] };
  m = low.match(/^(?:mark|complete|finish|close)\s+(?:the\s+)?follow[- ]?up\s+(?:with|for)\s+(.+?)\s*(?:as\s+)?(?:done|complete|completed)?(?:\s*[,:;–—-]\s*(.+))?$/);
  if (m) {
    const [name, n1] = splitNote(m[1]);
    const note = [n1, m[2]].filter(Boolean).map((n) => cleanNote(origCase(text, n!))).join(" ");
    return { kind: "complete_followup", name: nameOrThis(origCase(text, name.replace(/\s+(?:as\s+)?(?:done|complete|completed)$/, ""))), ...(note ? { note } : {}) };
  }
  m = low.match(/^(?:make|convert|turn)\s+(.+?)\s+(?:a|into a|to a|as a)\s+(?:client|customer)[.!?]*$/) ?? low.match(/^(?:convert)\s+(.+?)(?:\s+to\s+(?:a\s+)?client)?[.!?]*$/);
  if (m) return { kind: "convert", name: nameOrThis(origCase(text, m[1])) };
  m = low.match(/^(?:mark|set|move|put|change|update|shift)\s+(.+?)\s+(?:as|to|into|in|at)\s+(.+)$/);
  if (m) {
    const stage = stageFromWords(m[2]);
    if (stage) return { kind: "move", name: nameOrThis(origCase(text, m[1])), stage };
  }
  m = low.match(/^(.+?)\s+is\s+(?:now\s+)?(interested|not interested|won|lost|qualified|negotiating)$/);
  if (m && !/^(who|what|which|how)\b/.test(m[1])) return { kind: "move", name: nameOrThis(origCase(text, m[1])), stage: stageFromWords(m[2])! };

  // ---- numbers
  if (/\b(conversion rate|convert(ing)? rate|close rate)\b/.test(low)) return { kind: "stat", stat: "conversion" };
  if (/\bhow many\b.*\b(clients?|deals?)\b.*\b(win|won|closed|close)\b|\b(won|closed)\b.*\bthis month\b/.test(low)) return { kind: "stat", stat: "won_month" };
  if (/^how many\b/.test(low)) {
    const f = FILTER_WORDS.find(([re]) => re.test(low))?.[1];
    return f ? { kind: "stat", stat: "count", filter: f } : { kind: "ask", text: raw.trim() };
  }

  // ---- views
  if (/\b(funnel)\b/.test(low)) return { kind: "view", view: "funnel" };
  if (/\b(potential revenue|pipeline value|revenue pipeline|revenue)\b/.test(low) && /\b(show|what|my|open|display|view)\b/.test(low)) return { kind: "view", view: "revenue" };
  if (/\b(quotations?|quotes)\b/.test(low) && /\b(show|all|my|open|list)\b/.test(low)) return { kind: "view", view: "quotations" };
  if (/\bdemos?\b/.test(low) && /\b(show|all|my|open|list|upcoming)\b/.test(low)) return { kind: "view", view: "demos" };
  if (/\b(won clients?|clients?|customers?)\b/.test(low) && /\b(show|all|my|open|list)\b/.test(low)) return { kind: "view", view: "clients" };
  if (/\b(analytics|stats|statistics|performance|report)\b/.test(low) && /\b(show|open|my|sales)\b/.test(low)) return { kind: "view", view: "analytics" };
  if (/\b(crm|pipeline|sales pipeline)\b/.test(low) && /\b(show|open|my|the|display|view)\b/.test(low)) return { kind: "view", view: "pipeline" };
  if (/\bleads?\b/.test(low) && /\b(show|list|open|which|give|find|display|what are)\b/.test(low)) {
    const f = FILTER_WORDS.find(([re]) => re.test(low))?.[1];
    if (f) return { kind: "leads", filter: f };
  }
  // "open lead 7", "show me number 12", "open #3", "open 7"
  m = text.match(/^(?:open|show(?: me)?|pull up|bring up|go to|display)\s+(?:the\s+)?((?:lead|client|customer|number|no\.?)\s*(?:number\s+)?#?\s*\d{1,6}|#?\d{1,6}|(?:lead|client|number)\s+[a-z]+(?:[\s-][a-z]+)?)[.!?]*$/i);
  if (m && (/\d/.test(m[1]) || leadNumberOf(m[1]))) return { kind: "open", name: m[1].trim() };
  m = text.match(/^(?:open|show(?: me)?|pull up|bring up|go to|display)\s+(?:the\s+)?(?:lead\s+(?:for\s+)?)?(.{2,80}?)(?:'s\s+(?:lead|profile|details))?[.!?]*$/i);
  if (m && !/\b(leads?|pipeline|crm|funnel|revenue|follow[- ]?ups?|quotations?|demos?|clients?|analytics|rubin|ruben|reuben|robin|jarvis|today|my day)\b/i.test(m[1])) return { kind: "open", name: m[1].trim() };
  return { kind: "ask", text: raw.trim() };
}

/**
 * Split "<main part> <note>" at a note marker: "…, note: X", "… and note that X",
 * "… saying X", "… about X" (not "about 4"), "… regarding X", "… to discuss X".
 */
const NOTE_MARK = /\s*(?:[,;:–—-]\s*)?(?:\b(?:and\s+)?(?:(?:add|make|take|put|with)\s+(?:down\s+)?(?:a\s+)?)?notes?(?:\s+that|\s+saying)?\s*[:,–—-]?\s+|\b(?:saying|regarding|re:|to discuss|to talk about)\s+|\babout\s+(?!\d|noon|midday))/;
export function splitNote(s: string): [string, string | undefined] {
  const m = s.match(NOTE_MARK);
  if (!m || m.index === undefined || m.index === 0) return [s, undefined];
  const note = s.slice(m.index + m[0].length).trim();
  return note ? [s.slice(0, m.index).trim(), note] : [s, undefined];
}
/** "note: wants an online menu." → "wants an online menu" */
export function cleanNote(s: string): string {
  return s.trim().replace(/^(?:note|notes)\s*[:,–—-]\s*/i, "").replace(/^(?:that|saying)\s+/i, "").replace(/[.!\s]+$/, "").slice(0, 1000);
}

/** Keep the user's own spelling/case of a captured name. */
function origCase(text: string, lowered: string): string {
  const i = text.toLowerCase().indexOf(lowered);
  return i >= 0 ? text.slice(i, i + lowered.length) : lowered;
}

// ---------------------------------------------------------------- natural times

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * "tomorrow at 4 PM", "Friday 11am", "in 2 hours", "on 5 Oct at 3:30", "next Monday morning"
 * → the instant in the user's timezone. null when there's no date or time in it.
 */
export function parseWhen(text: string, tz: string, now = new Date()): Date | null {
  const t = ` ${text.toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ")} `;
  const rel = t.match(/\bin (\d+|an?|one|two|three) (minute|min|hour|hr|day|week)s?\b/);
  if (rel) {
    const n = /^\d+$/.test(rel[1]) ? Number(rel[1]) : ({ a: 1, an: 1, one: 1, two: 2, three: 3 } as Record<string, number>)[rel[1]];
    const unit = { minute: 60_000, min: 60_000, hour: 3_600_000, hr: 3_600_000, day: 86_400_000, week: 604_800_000 }[rel[2] as "minute"];
    return new Date(now.getTime() + n * unit);
  }
  const today = todayIn(tz, +now);
  let date: string | null = null;
  if (/\bday after tomorrow\b/.test(t)) date = addDays(today, 2);
  else if (/\b(tomorrow|tmrw|tmr)\b/.test(t)) date = addDays(today, 1);
  else if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(t)) date = today;
  if (!date) {
    const wd = t.match(/\b(next |this |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (wd) {
      const cur = new Date(`${today}T12:00:00Z`).getUTCDay();
      let diff = (WEEKDAYS.indexOf(wd[2]) - cur + 7) % 7;
      if (diff === 0) diff = 7; // "next Monday" / "Monday" = the coming one
      date = addDays(today, diff);
    }
  }
  if (!date) {
    const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)? (?:of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) ?? null;
    const md = !dm ? t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(?:st|nd|rd|th)?\b/) : null;
    const num = !dm && !md ? t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/) : null;
    let d: number | null = null, mo: number | null = null, y = Number(today.slice(0, 4));
    if (dm) { d = Number(dm[1]); mo = MONTHS.indexOf(dm[2]) + 1; }
    else if (md) { d = Number(md[2]); mo = MONTHS.indexOf(md[1]) + 1; }
    else if (num) { d = Number(num[1]); mo = Number(num[2]); if (num[3]) y = Number(num[3].length === 2 ? `20${num[3]}` : num[3]); }
    if (d && mo && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let ds = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (ds < today && !num?.[3]) ds = `${y + 1}${ds.slice(4)}`;
      date = ds;
    }
  }
  // time of day
  let minutes: number | null = null;
  const tm = t.match(/\b(?:at |by |@ ?)?(\d{1,2})(?::(\d{2}))? ?(am|pm|a m|p m)\b/) ?? t.match(/\b(?:at |by |@ ?)(\d{1,2})(?::(\d{2}))?\b(?! ?(?:min|hour|hr|day|week|st|nd|rd|th|\/))/) ?? t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (tm) {
    let h = Number(tm[1]);
    const mi = Number(tm[2] ?? 0);
    const ap = tm[3]?.replace(" ", "");
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && h >= 1 && h <= 7) h += 12; // "at 4" during business = 4 PM
    if (h <= 23 && mi <= 59) minutes = h * 60 + mi;
  } else if (/\bnoon\b/.test(t)) minutes = 12 * 60;
  else if (/\bmorning\b/.test(t)) minutes = 10 * 60;
  else if (/\bafternoon\b/.test(t)) minutes = 15 * 60;
  else if (/\b(evening|tonight)\b/.test(t)) minutes = 18 * 60;
  if (!date && minutes == null) return null;
  if (!date) {
    // a time alone: today if still ahead, else tomorrow
    date = today;
    const cand = new Date(startOfDay(today, tz).getTime() + minutes! * 60_000);
    if (cand <= now) date = addDays(today, 1);
  }
  return new Date(startOfDay(date, tz).getTime() + (minutes ?? 10 * 60) * 60_000); // a day alone → 10:00 AM
}
