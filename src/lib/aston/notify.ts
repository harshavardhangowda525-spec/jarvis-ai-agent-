import "server-only";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { redact } from "@/lib/activity/redact";
import { sendEmail as gmailSend, EmailNotConnected } from "@/lib/darwin/email";
import { closeIncident, addRecovery } from "./incidents";
import { confirmDown } from "./probe";
import { callProvider, phoneGuard, type CallProvider } from "./phone";
import { summarize } from "./summary";
import type { GroqDeps } from "./groq";
import { parseChannels, type Channel, type RecoveryStep } from "./types";

/**
 * The attention manager's delivery side. For every open critical/high
 * incident it (1) verifies the incident is real and still unresolved,
 * (2) writes the alert text, (3) queues one alert per channel — the unique
 * (incident, channel, round) index makes duplicate alerts impossible — and
 * (4) delivers with bounded, exponentially backed-off retries. Undelivered
 * alerts stay in the database and are shown the next time ASTON is opened.
 *
 * Channels, free first: browser notification (shown by an open ASTON/JARVIS
 * tab), email from the owner's own Gmail, and — only when explicitly enabled —
 * a phone call.
 */

type Row = Prisma.AstonIncidentGetPayload<object>;

export const MAX_ATTEMPTS: Record<Channel, number> = { browser: 1, email: 5, phone: 2 };
/** Critical incidents nobody acknowledged get one reminder after this long. */
export const REMINDER_AFTER_MS = 60 * 60_000;
const LEASE_MS = 2 * 60_000;

export interface NotifyDeps {
  sendEmail(userId: string, to: string, subject: string, body: string): Promise<string>;
  phone(): CallProvider | null;
  groq?: Partial<GroqDeps>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now(): Date;
}

const defaults = (): NotifyDeps => ({ sendEmail: gmailSend, phone: callProvider, now: () => new Date() });

export const backoffMs = (attempts: number) => Math.min(60, 2 ** attempts) * 60_000; // 2, 4, 8, 16 … minutes, max 1 h

/** Verify an incident before anyone is interrupted. Returns false if it should not alert. */
async function verify(r: Row, d: NotifyDeps): Promise<boolean> {
  if (r.verified) return true;
  const db = getDb();
  const url = (r.evidence as { url?: string } | null)?.url;
  // A production incident reported from outside: confirm the site really is down.
  if (r.kind === "prod_incident" && r.source !== "probe" && url) {
    const { down, checks } = await confirmDown(url, d.fetchImpl, 4_000, d.sleep);
    for (const [i, c] of checks.entries()) await addRecovery(r.id, { action: `Verification check ${i + 1} of ${url}`, ok: c.ok, note: c.error ?? `HTTP ${c.status}` });
    if (!down) {
      await closeIncident(r.id, { resolution: `Not alerted: ${url} answered ${checks.at(-1)?.status ?? "OK"} when ASTON checked — the site is up.` });
      return false;
    }
    await db.astonIncident.update({ where: { id: r.id }, data: { verified: true, verifyNote: `Confirmed down by two checks (${checks.map((c) => c.error ?? c.status).join(", ")}).` } });
    return true;
  }
  const how: Record<string, string> = {
    github: "Reported by a signature-verified GitHub webhook.",
    webhook: "Reported by a signature-verified event.",
    probe: "Confirmed by two failed health checks.",
  };
  const viaWebhook = (r.evidence as { via?: string } | null)?.via === "signed-webhook";
  const note = how[r.source] ?? (viaWebhook ? `Reported by a signature-verified event from ${r.source}.` : `Confirmed from ${r.source.toUpperCase()} records.`);
  await db.astonIncident.update({ where: { id: r.id }, data: { verified: true, verifyNote: note } });
  return true;
}

function emailText(r: Row): { subject: string; body: string } {
  const rec = Array.isArray(r.recovery) ? (r.recovery as unknown as RecoveryStep[]) : [];
  const subject = `[ASTON ${r.priority.toUpperCase()}] ${r.project ? `${r.project}: ` : ""}${r.title}`.slice(0, 180);
  const body = [
    r.summary ?? r.title,
    "",
    `Project: ${r.project ?? "—"}`,
    `Problem: ${r.title}`,
    r.detail ? `Details: ${r.detail}` : null,
    `First seen: ${r.firstSeenAt.toISOString()}${r.occurrences > 1 ? ` (seen ${r.occurrences} times)` : ""}`,
    r.verifyNote ? `Verified: ${r.verifyNote}` : null,
    rec.length ? `Recovery attempts:\n${rec.map((s) => `  • ${s.action}: ${s.ok ? "ok" : "failed"}${s.note ? ` — ${s.note}` : ""}`).join("\n")}` : "Recovery attempts: none (needs a person).",
    `Recommended next action: ${r.recommendation ?? "Open ASTON to review."}`,
    "",
    `Open ASTON: ${env.appUrl}/aston`,
  ].filter((x) => x !== null).join("\n");
  return { subject, body: redact(body) };
}

/** Queue the alerts for incidents that need them (verification + text first). */
async function queueAlerts(userId: string, d: NotifyDeps): Promise<number> {
  const db = getDb();
  const now = d.now();
  const channels = parseChannels(env.astonNotificationChannel);
  let queued = 0;
  const due = await db.astonIncident.findMany({
    where: { userId, status: "open", priority: { in: ["critical", "high"] }, alerts: { none: { round: 0 } } },
    take: 20,
  });
  for (const inc of due) {
    if (!(await verify(inc, d))) continue;
    let r = (await db.astonIncident.findUnique({ where: { id: inc.id } }))!;
    if (r.status !== "open") continue; // resolved while verifying
    if (!r.summary) {
      const s = await summarize(r, d.groq);
      r = await db.astonIncident.update({ where: { id: r.id }, data: { summary: s.summary, recommendation: r.recommendation ?? s.recommendation, aiNote: s.aiNote } });
    }
    const list: Channel[] = [...channels, ...(r.priority === "critical" && env.astonPhoneAlertsEnabled ? (["phone"] as Channel[]) : [])];
    if (!list.length) continue; // in-app only (ASTON_NOTIFICATION_CHANNEL=none)
    const res = await db.astonAlert.createMany({
      data: list.map((channel) => ({ incidentId: r.id, userId, channel, round: 0, testMode: channel === "phone" && env.astonPhoneMode !== "live", nextAttemptAt: now })),
      skipDuplicates: true,
    });
    queued += res.count;
  }
  // One reminder for critical incidents nobody has acknowledged.
  const stale = await db.astonIncident.findMany({
    where: {
      userId, status: "open", priority: "critical",
      alerts: { some: { round: 0, createdAt: { lte: new Date(now.getTime() - REMINDER_AFTER_MS) } }, none: { round: 1 } },
    },
    select: { id: true }, take: 20,
  });
  for (const s of stale) {
    const res = await db.astonAlert.createMany({
      data: channels.map((channel) => ({ incidentId: s.id, userId, channel, round: 1, nextAttemptAt: now })),
      skipDuplicates: true,
    });
    queued += res.count;
  }
  return queued;
}

/** Deliver due email/phone alerts (browser alerts are picked up by an open tab). */
async function deliverDue(userId: string, d: NotifyDeps): Promise<{ delivered: number; failed: number }> {
  const db = getDb();
  const now = d.now();
  const due = await db.astonAlert.findMany({
    where: {
      userId, channel: { in: ["email", "phone"] }, status: { in: ["pending", "failed", "sending"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    include: { incident: true }, take: 20, orderBy: { createdAt: "asc" },
  });
  let delivered = 0, failed = 0;
  for (const a of due) {
    // Claim it (a lease) so two ticks can't send the same alert twice.
    const claim = await db.astonAlert.updateMany({
      where: { id: a.id, status: a.status, attempts: a.attempts },
      data: { status: "sending", attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (!claim.count) continue;
    const attempts = a.attempts + 1;
    const inc = a.incident;
    // Already acknowledged or closed → the owner knows; don't send it.
    if (inc.status !== "open") {
      await db.astonAlert.update({ where: { id: a.id }, data: { status: "skipped", lastError: `Incident ${inc.status} before delivery.`, nextAttemptAt: null } });
      continue;
    }
    try {
      if (a.channel === "email") {
        const owner = env.astonOwnerEmail || (await db.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email;
        if (!owner) throw new EmailNotConnected("No owner email address (set ASTON_OWNER_EMAIL).");
        const { subject, body } = emailText(inc);
        const ref = await d.sendEmail(userId, owner, subject, body);
        await db.astonAlert.update({ where: { id: a.id }, data: { status: "delivered", deliveredAt: d.now(), providerRef: String(ref).slice(0, 120), lastError: null, nextAttemptAt: null } });
      } else {
        const guard = await phoneGuard(userId, now);
        const provider = d.phone();
        if (!guard.allowed || !provider) {
          await db.astonAlert.update({ where: { id: a.id }, data: { status: "skipped", lastError: guard.reason ?? "No call provider configured.", nextAttemptAt: null } });
          continue;
        }
        const r = await provider.place(env.astonOwnerPhone, inc.summary ?? inc.title);
        await db.astonAlert.update({
          where: { id: a.id },
          data: { status: "delivered", deliveredAt: d.now(), providerRef: r.ref, testMode: !provider.live, costUsd: provider.live ? env.astonPhoneEstCostUsd : 0, lastError: provider.live ? null : "TEST MODE — no real call was placed.", nextAttemptAt: null },
        });
      }
      delivered++;
    } catch (e) {
      const msg = redact(e instanceof Error ? e.message : String(e)).slice(0, 400);
      if (e instanceof EmailNotConnected) {
        // Not a transient failure — don't retry; the incident stays visible in ASTON.
        await db.astonAlert.update({ where: { id: a.id }, data: { status: "skipped", lastError: `${msg} Saved for in-app display.`, nextAttemptAt: null } });
        continue;
      }
      const giveUp = attempts >= MAX_ATTEMPTS[a.channel as Channel];
      await db.astonAlert.update({
        where: { id: a.id },
        data: { status: giveUp ? "gave_up" : "failed", lastError: msg, nextAttemptAt: giveUp ? null : new Date(now.getTime() + backoffMs(attempts)) },
      });
      failed++;
    }
  }
  return { delivered, failed };
}

export async function dispatch(userId: string, deps: Partial<NotifyDeps> = {}): Promise<{ queued: number; delivered: number; failed: number }> {
  const d = { ...defaults(), ...deps };
  const queued = await queueAlerts(userId, d);
  const r = await deliverDue(userId, d);
  return { queued, ...r };
}

export interface BrowserAlert { id: string; incidentId: string; priority: string; title: string; summary: string; project: string | null; round: number }

/** Browser alerts waiting for an open tab to show them (oldest first). */
export async function pendingBrowserAlerts(userId: string): Promise<BrowserAlert[]> {
  const rows = await getDb().astonAlert.findMany({
    where: { userId, channel: "browser", status: "pending", incident: { status: "open" } },
    include: { incident: { select: { priority: true, title: true, summary: true, project: true } } },
    orderBy: { createdAt: "asc" }, take: 10,
  });
  return rows.map((a) => ({ id: a.id, incidentId: a.incidentId, priority: a.incident.priority, title: a.incident.title, summary: a.incident.summary ?? a.incident.title, project: a.incident.project, round: a.round }));
}

/** An open tab showed the alert (notification and/or on screen). */
export async function ackBrowserAlert(userId: string, id: string): Promise<boolean> {
  const r = await getDb().astonAlert.updateMany({ where: { id, userId, channel: "browser", status: "pending" }, data: { status: "delivered", deliveredAt: new Date(), attempts: { increment: 1 } } });
  return r.count > 0;
}
