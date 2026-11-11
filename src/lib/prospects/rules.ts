/**
 * JARVIS CRM rules — pure, tested. Straight from the operating manual
 * (Part 4.3 lead score, Part 5 pipeline rules). Nothing here touches the DB.
 */

export const STATUSES = ["new", "called", "not_reachable", "callback", "interested", "demo_booked", "demo_done", "quotation_sent", "negotiating", "won", "lost"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  new: "New", called: "Called", not_reachable: "Not reachable", callback: "Callback", interested: "Interested",
  demo_booked: "Demo booked", demo_done: "Demo done", quotation_sent: "Quotation sent", negotiating: "Negotiating", won: "Won", lost: "Lost",
};
export const LOST_REASONS = ["price", "timing", "has_vendor", "not_interested", "wrong_number", "unreachable", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const isClosed = (s: string) => s === "won" || s === "lost";

/** Last 10 digits — "+91 98765-43210", "098765 43210" and "9876543210" are the same phone. */
export function phoneKey(phone?: string | null): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-10) : null;
}

/** Sites that are a social/profile page, not the business's own website. */
const NOT_A_WEBSITE = /(^|\.)(instagram\.com|facebook\.com|fb\.me|m\.facebook\.com|linktr\.ee|wa\.me|api\.whatsapp\.com|whatsapp\.com|business\.site|justdial\.com|sulekha\.com|zomato\.com|swiggy\.com|practo\.com|youtube\.com|x\.com|twitter\.com|linkedin\.com|g\.page|goo\.gl|maps\.app\.goo\.gl|google\.com|sites\.google\.com|booksy\.com|fresha\.com|urbancompany\.com)$/i;

export type WebsiteStatus = "none" | "social_only" | "broken" | "outdated" | "ok";

/** What the website field alone tells us (before any network check). */
export function websiteKind(url?: string | null): "none" | "social_only" | "site" {
  if (!url?.trim()) return "none";
  try {
    const h = new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    return NOT_A_WEBSITE.test(h) ? "social_only" : "site";
  } catch { return "none"; }
}

/** Reading a fetched homepage: broken / outdated / ok. */
export function judgeSite(r: { status?: number; error?: string; html?: string }, now = new Date()): "broken" | "outdated" | "ok" {
  // 401/403/429 is a bot wall or a login: the site exists, so don't call it broken
  if (r.error || !r.status || r.status >= 500 || r.status === 404 || r.status === 410) return "broken";
  if (r.status >= 400) return "ok";
  const html = r.html ?? "";
  const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2}|19\d{2})/gi)].map((m) => Number(m[1]));
  const latest = years.length ? Math.max(...years) : null;
  const noViewport = html.length > 500 && !/<meta[^>]+name=["']?viewport/i.test(html);
  if ((latest && latest <= now.getFullYear() - 4) || noViewport) return "outdated";
  return "ok";
}

/** Keep for the CRM? Manual 4.2: only businesses with no website, or a broken/very outdated one ("Redesign lead"). */
export const keepWebsite = (w: WebsiteStatus) => w !== "ok";

const BOOKING = /\b(gym|fitness|yoga|pilates|crossfit|clinic|dental|dentist|physio|hospital|doctor|derma|skin|salon|spa|beauty|barber|parlou?r|nail|tattoo|massage|ayurved|veterinar|pet groom|studio)\b/i;

export interface ScoreInput { websiteStatus: WebsiteStatus; rating?: number | null; reviews?: number | null; phone?: string | null; instagram?: string | null; category?: string | null }

/** Manual 4.3 (0–100). Broken/outdated sites get +20 instead of +40 (they have a site, but it's a redesign lead). */
export function leadScore(i: ScoreInput): number {
  let s = 0;
  if (i.websiteStatus === "none" || i.websiteStatus === "social_only") s += 40;
  else if (i.websiteStatus === "broken" || i.websiteStatus === "outdated") s += 20;
  if ((i.rating ?? 0) >= 4) s += 15;
  if ((i.reviews ?? 0) >= 50) s += 15;
  if (phoneKey(i.phone)) s += 10;
  if (i.instagram) s += 10;
  if (i.category && BOOKING.test(i.category)) s += 10;
  return Math.min(100, s);
}

export function signalsFor(i: ScoreInput & { hours?: string | null }): string[] {
  const out: string[] = [];
  if (i.websiteStatus === "none") out.push("No website");
  if (i.websiteStatus === "social_only") out.push("Only a social/listing page, no website");
  if (i.websiteStatus === "broken") out.push("Website is down — Redesign lead");
  if (i.websiteStatus === "outdated") out.push("Website looks outdated — Redesign lead");
  if (i.category && BOOKING.test(i.category)) out.push("Booking-type business");
  if ((i.reviews ?? 0) >= 50 && (i.rating ?? 0) >= 4) out.push("Well reviewed");
  if (!phoneKey(i.phone)) out.push("No phone on the listing");
  return out;
}

const DAY = 86_400_000;
/** Manual 5.2: every open lead always has a next action + date. Defaults per status. */
export function defaultNextAction(status: Status, now = new Date()): { nextAction: string | null; nextActionAt: Date | null } {
  const at = (days: number) => new Date(now.getTime() + days * DAY);
  switch (status) {
    case "new": return { nextAction: "First call", nextActionAt: now };
    case "called": return { nextAction: "Follow up", nextActionAt: at(2) };
    case "not_reachable": return { nextAction: "Try calling again", nextActionAt: at(1) };
    case "callback": return { nextAction: "Call back", nextActionAt: at(1) };
    case "interested": return { nextAction: "Book a demo", nextActionAt: at(1) };
    case "demo_booked": return { nextAction: "Demo", nextActionAt: at(1) };
    case "demo_done": return { nextAction: "Send quotation", nextActionAt: at(1) };
    case "quotation_sent": return { nextAction: "Follow up on the quotation", nextActionAt: at(3) };
    case "negotiating": return { nextAction: "Follow up", nextActionAt: at(2) };
    default: return { nextAction: null, nextActionAt: null };
  }
}

/** "Address: 441, 14th Main, HSR Layout, Bengaluru, Karnataka 560102, India" → { address, area, city }. */
export function splitAddress(raw?: string | null, fallbackArea?: string, fallbackCity?: string): { address: string | null; area: string | null; city: string | null } {
  const a = (raw ?? "").replace(/^address:\s*/i, "").trim();
  if (!a) return { address: null, area: fallbackArea ?? null, city: fallbackCity ?? null };
  const parts = a.split(",").map((s) => s.trim()).filter(Boolean).filter((p) => !/^india$/i.test(p) && !/^[A-Za-z ]+\s\d{6}$/.test(p));
  const city = fallbackCity && a.toLowerCase().includes(fallbackCity.toLowerCase()) ? fallbackCity : parts.length >= 2 ? parts[parts.length - 1] : fallbackCity ?? null;
  const cityIdx = city ? parts.findIndex((p) => p.toLowerCase() === city.toLowerCase()) : -1;
  const area = fallbackArea && a.toLowerCase().includes(fallbackArea.toLowerCase()) ? fallbackArea : cityIdx > 0 ? parts[cityIdx - 1] : fallbackArea ?? null;
  return { address: a, area, city };
}

/** The place id inside a Google Maps place link ("…!1s0x3bae15d6a70624db:0xfd6a1870e818fa8!…"). */
export function placeIdOf(mapsUrl?: string | null): string | null {
  const m = (mapsUrl ?? "").match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) ?? (mapsUrl ?? "").match(/[?&]place_id=([\w-]+)/) ?? (mapsUrl ?? "").match(/[?&]cid=(\d+)/);
  return m ? m[1] : null;
}

/** A clean link to the listing (Maps links carry a lot of view state). */
export function cleanMapsUrl(url?: string | null): string | null {
  if (!url) return null;
  try { const u = new URL(url); u.search = ""; return u.toString(); } catch { return url; }
}

export function parseRating(s?: string | null): number | null {
  const m = (s ?? "").match(/(\d(?:[.,]\d)?)/);
  const n = m ? Number(m[1].replace(",", ".")) : NaN;
  return n >= 0 && n <= 5 ? n : null;
}
export function parseCount(s?: string | null): number | null {
  const m = (s ?? "").match(/\(?([\d,.]+)\s*(k)?\)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(m[2] ? n * 1000 : n);
}

/** Is it calling-friendly, local-time "HH:MM" helpers for the schedule. */
export function localParts(now: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, dow };
}

/** Should the daily schedule queue a search now? Pure (tested). */
export function scheduleDue(s: { scheduleOn: boolean; scheduleDays: number[]; scheduleTime: string; lastScheduled: string | null; categories: string[]; areas: string[] }, now: Date, tz: string): boolean {
  if (!s.scheduleOn || !s.categories.length || !s.areas.length) return false;
  const l = localParts(now, tz);
  return s.scheduleDays.includes(l.dow) && l.hhmm >= s.scheduleTime && s.lastScheduled !== l.date;
}

/** The schedule rotates through every category × area pair. */
export function rotation(categories: string[], areas: string[], index: number): { category: string; area: string } {
  const pairs = categories.flatMap((c) => areas.map((a) => ({ category: c, area: a })));
  return pairs[((index % pairs.length) + pairs.length) % pairs.length];
}

export const MAX_SCORE_NOTE = "Lead score 0–100 (manual 4.3): no website +40 (broken/outdated site +20), rating ≥ 4.0 +15, ≥ 50 reviews +15, phone listed +10, Instagram listed +10, booking-type business (gym/salon/clinic…) +10.";
