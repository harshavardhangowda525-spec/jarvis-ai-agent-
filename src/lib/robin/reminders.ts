import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { emailChannelReady, sendEmail } from "@/lib/darwin/email";
import { getGoogleAccessToken } from "@/lib/integrations/google";
import { loadSettings, logRobin, userTz } from "./crm";
import { spokenLead } from "./numbers";

/**
 * Rubin emails YOU before a follow-up or demo is due (default: an hour before),
 * from your connected Gmail to your own address — one email per check listing
 * everything coming up, each follow-up/demo reminded once. Nothing is ever sent
 * to a lead. Runs from `npm run local` (every minute), JARVIS/RUBIN open in a
 * browser (every couple of minutes) and /api/cron/robin.
 */

export interface ReminderDeps {
  send: (userId: string, to: string, subject: string, body: string) => Promise<string>;
  ready: (userId: string) => Promise<boolean>;
  /** Your Gmail address (when no reminder address is set). */
  myAddress: (userId: string) => Promise<string | null>;
}
const defaultDeps = (): ReminderDeps => ({ send: sendEmail, ready: emailChannelReady, myAddress: gmailAddress });

/** A reminder for something that was due a while ago and never got one is skipped (it's just overdue). */
const LATE_LIMIT_MS = 2 * 3_600_000;
const ACTION: Record<string, string> = { call: "Call", whatsapp: "WhatsApp", email: "Email", instagram: "Instagram message", meeting: "Meeting", task: "Task" };

async function gmailAddress(userId: string): Promise<string | null> {
  try {
    const token = await getGoogleAccessToken(userId);
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const j = (await r.json().catch(() => ({}))) as { emailAddress?: string };
    if (r.ok && j.emailAddress) return j.emailAddress;
  } catch { /* fall back to the sign-in address */ }
  return (await getDb().user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null;
}

const timeOf = (d: Date, tz: string) => d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?([ap])m$/i, (_, x) => ` ${x.toUpperCase()}M`);
const dayOf = (d: Date, tz: string, now: Date) => {
  const k = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  const diff = Math.round((Date.parse(k(d)) - Date.parse(k(now))) / 86_400_000);
  return diff === 0 ? "today" : diff === 1 ? "tomorrow" : d.toLocaleDateString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "short" });
};
export function inWords(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m <= 0) return m > -2 ? "now" : `${-m} min ago`;
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return `in ${h} hour${h === 1 ? "" : "s"}${r ? ` ${r} min` : ""}`;
}

export interface ReminderItem { kind: "followup" | "demo"; id: string; leadId: string; dueAt: Date; what: string; lead: { number: number | null; businessName: string; phone: string | null }; notes: string | null }

/** The reminder email (pure): subject + plain-text body. */
export function reminderEmail(items: ReminderItem[], tz: string, now: Date, appUrl = ""): { subject: string; body: string } {
  const sorted = [...items].sort((a, b) => +a.dueAt - +b.dueAt);
  const first = sorted[0];
  const label = (i: ReminderItem) => `${i.kind === "demo" ? "Demo" : "Follow-up"} with ${spokenLead(i.lead)}`;
  const subject = sorted.length === 1
    ? `Reminder: ${label(first)} — ${first.what.toLowerCase()} ${inWords(+first.dueAt - +now)} (${timeOf(first.dueAt, tz)})`
    : `Reminder: ${sorted.length} coming up — first ${inWords(+first.dueAt - +now)}: ${spokenLead(first.lead)}`;
  const blocks = sorted.map((i) => {
    const notes = (i.notes ?? "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
    return [
      `• ${label(i)}`,
      `  ${i.what} · ${dayOf(i.dueAt, tz, now)} at ${timeOf(i.dueAt, tz)} (${inWords(+i.dueAt - +now)})`,
      ...(i.lead.phone ? [`  Phone: ${i.lead.phone}`] : []),
      notes.length ? `  Your notes: ${notes.join("; ")}` : "  Your notes: none",
      ...(appUrl ? [`  Open: ${appUrl.replace(/\/+$/, "")}/dashboard/rubin?lead=${i.leadId}`] : []),
    ].join("\n");
  });
  const body = [
    sorted.length === 1 ? "Hi! Quick heads-up from Rubin — this is coming up:" : `Hi! Quick heads-up from Rubin — ${sorted.length} things are coming up:`,
    "",
    blocks.join("\n\n"),
    "",
    "When it's done, tell Rubin how it went (e.g. \"done with " + (first.lead.number ?? first.lead.businessName) + ", …\") and it'll note it down.",
    "— Rubin (JARVIS · Sales & CRM)",
  ].join("\n");
  return { subject, body };
}

/**
 * Email the reminders that are due for one user. Each follow-up/demo is claimed
 * before sending (two checks at once never double-send); if the email fails it's
 * released so the next check tries again.
 */
export async function sendDueReminders(userId: string, o: { now?: Date; deps?: ReminderDeps } = {}): Promise<{ sent: number; skipped?: string; to?: string }> {
  const now = o.now ?? new Date();
  const deps = o.deps ?? defaultDeps();
  const db = getDb();
  const s = await loadSettings(userId);
  if (!s.emailReminders) return { sent: 0, skipped: "off" };
  const lead = Math.min(Math.max(s.reminderMinutes || 60, 5), 1440) * 60_000;
  const window = { gte: new Date(now.getTime() - LATE_LIMIT_MS), lte: new Date(now.getTime() + lead) };
  const [fus, demos] = await Promise.all([
    db.robinFollowUp.findMany({ where: { userId, status: "pending", remindedAt: null, dueAt: window }, include: { lead: { select: { number: true, businessName: true, phone: true } } }, orderBy: { dueAt: "asc" }, take: 25 }),
    db.robinDemo.findMany({ where: { userId, status: { in: ["scheduled", "rescheduled"] }, emailRemindedAt: null, scheduledAt: window }, include: { lead: { select: { number: true, businessName: true, phone: true } } }, orderBy: { scheduledAt: "asc" }, take: 10 }),
  ]);
  if (!fus.length && !demos.length) return { sent: 0 };
  if (!(await deps.ready(userId))) return { sent: 0, skipped: "gmail" };
  const to = s.reminderEmail?.trim() || (await deps.myAddress(userId));
  if (!to) return { sent: 0, skipped: "no_address" };

  // claim them (only this check sends these)
  const claimed: ReminderItem[] = [];
  for (const f of fus) {
    const c = await db.robinFollowUp.updateMany({ where: { id: f.id, remindedAt: null }, data: { remindedAt: now } });
    if (c.count === 1) claimed.push({ kind: "followup", id: f.id, leadId: f.leadId, dueAt: f.dueAt, what: ACTION[f.action] ?? f.action, lead: f.lead, notes: f.notes });
  }
  for (const d of demos) {
    const c = await db.robinDemo.updateMany({ where: { id: d.id, emailRemindedAt: null }, data: { emailRemindedAt: now } });
    if (c.count === 1) claimed.push({ kind: "demo", id: d.id, leadId: d.leadId, dueAt: d.scheduledAt, what: `${d.demoType === "in_person" ? "In-person" : d.demoType === "phone" ? "Phone" : "Online"} demo`, lead: d.lead, notes: d.notes });
  }
  if (!claimed.length) return { sent: 0 };
  const tz = await userTz(userId);
  const mail = reminderEmail(claimed, tz, now, env.appUrl);
  try {
    await deps.send(userId, to, mail.subject, mail.body);
  } catch (e) {
    // release them — the next check tries again
    await db.robinFollowUp.updateMany({ where: { id: { in: claimed.filter((c) => c.kind === "followup").map((c) => c.id) } }, data: { remindedAt: null } });
    await db.robinDemo.updateMany({ where: { id: { in: claimed.filter((c) => c.kind === "demo").map((c) => c.id) } }, data: { emailRemindedAt: null } });
    return { sent: 0, skipped: `send failed: ${(e as Error).message.slice(0, 120)}` };
  }
  for (const c of claimed) await logRobin(userId, c.leadId, "reminder_emailed", `Reminder emailed to you: ${c.kind === "demo" ? "demo" : "follow-up"} with ${c.lead.businessName} ${inWords(+c.dueAt - +now)}`, { [c.kind === "demo" ? "demoId" : "followUpId"]: c.id }, 1);
  return { sent: claimed.length, to };
}

/** Every user with something due soon (for the scheduled check). */
export async function sendAllDueReminders(now = new Date(), deps?: ReminderDeps) {
  const db = getDb();
  const horizon = { gte: new Date(now.getTime() - LATE_LIMIT_MS), lte: new Date(now.getTime() + 1440 * 60_000) };
  const [a, b] = await Promise.all([
    db.robinFollowUp.findMany({ where: { status: "pending", remindedAt: null, dueAt: horizon }, select: { userId: true }, distinct: ["userId"] }),
    db.robinDemo.findMany({ where: { status: { in: ["scheduled", "rescheduled"] }, emailRemindedAt: null, scheduledAt: horizon }, select: { userId: true }, distinct: ["userId"] }),
  ]);
  const users = [...new Set([...a, ...b].map((x) => x.userId))].slice(0, 100);
  const results: { user: string; sent: number; skipped?: string }[] = [];
  for (const u of users) {
    const r = await sendDueReminders(u, { now, deps }).catch((e) => ({ sent: 0, skipped: (e as Error).message.slice(0, 120) }));
    results.push({ user: u.slice(-6), sent: r.sent, ...(r.skipped ? { skipped: r.skipped } : {}) });
  }
  return { users: users.length, sent: results.reduce((s, r) => s + r.sent, 0), results };
}
