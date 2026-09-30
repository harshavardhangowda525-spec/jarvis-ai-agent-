import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { EV_BUSINESS } from "@/lib/ev/config";
import { logActivity } from "@/lib/darwin/store";
import { sendEmail, emailChannelReady, EmailNotConnected } from "@/lib/darwin/email";

/**
 * DARWIN's automatic outreach: every lead with a public email address gets ONE
 * email from the user's own Gmail, as the leads come in — no draft to approve.
 *
 * Safety rails (never loosened by the caller):
 * - only real addresses the source listed (never guessed), each emailed once,
 *   ever — a second lead with the same address is skipped;
 * - only leads nobody has contacted yet (stage new/qualified), never one marked
 *   not interested or "do not email";
 * - a 24-hour cap and a gap between sends (Gmail limits; no burst of spam);
 * - every email says who it's from and how to opt out;
 * - it stops at the first sign Gmail is refusing (quota, auth) and says why;
 * - "sent" is recorded only when Gmail confirms it.
 */

export interface AutoEmailDeps {
  now: () => Date;
  send: (userId: string, to: string, subject: string, body: string) => Promise<string>;
  ready: (userId: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
}

export const defaultEmailDeps = (): AutoEmailDeps => ({
  now: () => new Date(),
  send: sendEmail,
  ready: emailChannelReady,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
/** A real inbox worth writing to (not a no-reply, a placeholder, or a scraped image name). */
export function usableEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().replace(/^mailto:/i, "").split(/[?\s,;]/)[0].toLowerCase();
  if (!EMAIL.test(e) || e.length > 120) return null;
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse)@/.test(e)) return null;
  if (/@(example\.(com|org|net)|test\.com|domain\.com|email\.com)$/.test(e)) return null;
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(e)) return null;
  return e;
}

/** What a website does for this kind of business — the one line that makes the email about THEM. */
const PITCH: Record<string, string> = {
  "Restaurants/Cafes": "A simple site with your menu, photos, timings and a button to order or reserve means people who search for you online can choose you in seconds.",
  "Salons/Spas": "A simple site with your services, prices and online booking lets new clients find you and book an appointment any time, even when you're busy.",
  "Clinics": "A simple site with your services, doctor timings and appointment booking helps patients who search online find you and book without calling.",
  "Gyms": "A simple site with your plans, timings, trainers and a membership enquiry form helps people nearby who search for a gym pick you.",
  "Coaching Centers": "A simple site with your courses, batch timings, results and an enquiry form helps parents and students who search online reach you directly.",
  "Retail Stores": "A simple site with your products, store timings and a WhatsApp order button lets nearby customers who search online see what you stock and reach you.",
};
const DEFAULT_PITCH = "A simple site lets people who search for you online see your services, timings and location, and contact you directly.";

/** The email, written only from what's known about the lead (verified facts; nothing invented). */
export function composeOutreach(lead: {
  businessName: string; category?: string | null; location?: string | null; website?: string | null; opportunityType?: string | null; metadata?: unknown;
}): { subject: string; body: string } {
  const name = lead.businessName.trim();
  const where = (lead.location ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(-3, -1)[0] ?? "";
  const cat = (lead.category ?? "").trim().toLowerCase();
  const noSite = !lead.website && lead.opportunityType === "no_website";
  const m = (lead.metadata ?? {}) as { bucket?: string; google?: { rating?: number | null; reviews?: number | null } | null };
  const b = EV_BUSINESS;
  const intro = `I came across ${name}${cat ? ` (${cat})` : ""}${where ? ` in ${where}` : ""}`;
  // a real, verified Google rating is worth mentioning — people already like them
  const g = m.google;
  const praise = g?.rating != null && g.rating >= 4 && (g.reviews ?? 0) >= 10 ? ` Your ${g.rating}★ rating from ${g.reviews} Google reviews shows customers love you` : "";
  const body = [
    `Hi ${name} team,`,
    "",
    noSite
      ? `${intro} and noticed you don't have a website yet.${praise ? `${praise} — a website would help many more people find you.` : ""}`
      : `${intro} and wanted to reach out.${praise ? `${praise}.` : ""}`,
    "",
    `I run ${b.name} — we build websites and mobile apps for local businesses (websites from ${b.websiteFrom}). ` + (PITCH[m.bucket ?? ""] ?? DEFAULT_PITCH),
    "",
    `If that sounds useful, just reply to this email or call/WhatsApp ${b.phone}, and I'll send you a few examples${cat ? ` of sites we've made for ${cat.replace(/s$/, "")} businesses` : ""}.`,
    "",
    "Best regards,",
    b.name,
    `${b.phone} · ${b.instagram}`,
    "",
    "—",
    "If you'd rather not hear from us, reply \"stop\" and we won't email you again.",
  ].join("\n");
  return { subject: noSite ? `A website for ${name}${where ? ` in ${where}` : ""}` : `A quick idea for ${name}`, body };
}

const DONE = ["sending", "sent", "delivered", "replied"];

export interface AutoEmailState {
  enabled: boolean; connected: boolean; cap: number;
  sentLast24h: number; waiting: number;
}

/** Leads that would get an email next (newest first), with the addresses already written to. */
async function queue(userId: string, take = 200) {
  const db = getDb();
  const [leads, sentTo] = await Promise.all([
    db.darwinLead.findMany({
      // one attempt per lead: an earlier automatic failure isn't retried (it's in DARWIN to handle by hand)
      where: { userId, email: { not: null }, stage: { in: ["new", "qualified"] }, messages: { none: { status: { in: [...DONE, "failed"] } } } },
      orderBy: { discoveredAt: "desc" }, take,
      select: { id: true, businessName: true, category: true, location: true, website: true, opportunityType: true, email: true, metadata: true, stage: true },
    }),
    db.darwinMessage.findMany({ where: { userId, channel: "email", status: { in: DONE } }, select: { lead: { select: { email: true } } } }),
  ]);
  const written = new Set(sentTo.map((m) => usableEmail(m.lead.email)).filter(Boolean) as string[]);
  const out: { lead: (typeof leads)[number]; to: string }[] = [];
  for (const lead of leads) {
    const to = usableEmail(lead.email);
    if (!to || written.has(to)) continue;
    if ((lead.metadata as { doNotEmail?: boolean } | null)?.doNotEmail) continue;
    written.add(to);
    out.push({ lead, to });
  }
  return out;
}

async function sentSince(userId: string, since: Date) {
  return getDb().darwinMessage.count({ where: { userId, channel: "email", status: { in: DONE }, sentAt: { gte: since } } });
}

export async function autoEmailState(userId: string, enabled: boolean, deps: Pick<AutoEmailDeps, "now" | "ready"> = defaultEmailDeps()): Promise<AutoEmailState> {
  const now = deps.now();
  const [connected, sent, q] = await Promise.all([deps.ready(userId), sentSince(userId, new Date(now.getTime() - 86_400_000)), queue(userId)]);
  return { enabled: enabled && env.darwinAutoEmail, connected, cap: env.darwinAutoEmailCap, sentLast24h: sent, waiting: q.length };
}

export interface AutoEmailResult { sent: number; failed: number; waiting: number; stopped: string | null }

/**
 * Send the next emails until `until` (a time), the 24-hour cap, or the queue
 * runs out. Safe to call from anywhere: a message is claimed ("sending") before
 * it goes out, so two callers never email the same lead.
 */
export async function sendAutoEmails(userId: string, opts: { until: number; deps?: AutoEmailDeps }): Promise<AutoEmailResult> {
  const deps = opts.deps ?? defaultEmailDeps();
  const db = getDb();
  const res: AutoEmailResult = { sent: 0, failed: 0, waiting: 0, stopped: null };
  if (!env.darwinAutoEmail) { res.stopped = "off"; return res; }
  if (!(await deps.ready(userId))) { res.stopped = "Gmail isn't connected — connect Google in Settings so DARWIN can email leads."; res.waiting = (await queue(userId)).length; return res; }
  const gapMs = env.darwinAutoEmailGapSec * 1000;
  const q = await queue(userId);
  res.waiting = q.length;
  // respect the gap since the last email, even one sent by an earlier call
  const last = await db.darwinMessage.findFirst({ where: { userId, channel: "email", sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } });
  let nextAt = last?.sentAt ? last.sentAt.getTime() + gapMs : 0;

  for (const { lead, to } of q) {
    const now = deps.now().getTime();
    if ((await sentSince(userId, new Date(now - 86_400_000))) >= env.darwinAutoEmailCap) { res.stopped = `Reached today's limit of ${env.darwinAutoEmailCap} emails — the rest go out tomorrow.`; break; }
    const wait = Math.max(0, nextAt - now);
    if (now + wait + 25_000 > opts.until) break; // no time left in this call — the next one carries on
    if (wait) await deps.sleep(wait);

    const { subject, body } = composeOutreach(lead);
    // claim it atomically (moving it to "contacted"): if two runners overlap, only one gets the lead
    const claim = await db.darwinLead.updateMany({ where: { id: lead.id, stage: { in: ["new", "qualified"] } }, data: { stage: "contacted" } });
    if (claim.count !== 1) continue;
    const msg = await db.darwinMessage.create({ data: { userId, leadId: lead.id, channel: "email", subject, body, status: "sending" }, select: { id: true } });
    try {
      const externalId = await deps.send(userId, to, subject, body);
      const sentAt = deps.now();
      await db.darwinMessage.update({ where: { id: msg.id }, data: { status: "sent", externalId, sentAt } });
      await db.darwinLead.update({ where: { id: lead.id }, data: { lastContactedAt: sentAt } });
      await logActivity(userId, "message_sent", `Emailed ${lead.businessName} (${to}) automatically.`, lead.id, { externalId, auto: true });
      res.sent++; res.waiting--;
      nextAt = sentAt.getTime() + gapMs;
    } catch (e) {
      const reason = e instanceof EmailNotConnected ? "Gmail isn't connected." : (e as Error).message;
      // Gmail refusing (auth, quota, rate) isn't this lead's fault: put it back and stop for now
      const refusing = e instanceof EmailNotConnected || /quota|rate|limit|invalid_grant|unauthori|forbidden|403|401|429|token/i.test(reason);
      if (refusing) {
        await db.darwinMessage.delete({ where: { id: msg.id } }).catch(() => {});
        await db.darwinLead.update({ where: { id: lead.id }, data: { stage: lead.stage } }).catch(() => {});
        res.stopped = `Gmail refused: ${reason}`;
        break;
      }
      // anything else (e.g. an address Gmail won't take): recorded as failed, not retried
      await db.darwinMessage.update({ where: { id: msg.id }, data: { status: "failed", error: reason.slice(0, 500) } }).catch(() => {});
      await db.darwinLead.update({ where: { id: lead.id }, data: { stage: lead.stage } }).catch(() => {});
      await logActivity(userId, "message_failed", `Automatic email to ${lead.businessName} failed: ${reason}`, lead.id, { auto: true });
      res.failed++; res.waiting--;
      nextAt = deps.now().getTime() + gapMs;
    }
  }
  return res;
}
