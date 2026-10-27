import "server-only";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import type { PhoneLink } from "@prisma/client";
import { getDb } from "@/lib/db";
import { JOB_AGENT_NAME, type JobAgent } from "@/lib/jobs/brief";
import { listCenter } from "@/lib/approvals/center";
import { localClock } from "@/lib/ev/daily/schedule";

/**
 * JARVIS calls you over Wi-Fi, with no calling provider, no API key and no SIM
 * plan. A spare Android phone (Termux, with WhatsApp signed in) is JARVIS's
 * phone. It checks in every few seconds with its pairing token. When something
 * has happened, it sends you the details on WhatsApp and WhatsApp-calls you.
 * Its WhatsApp number is JARVIS's number.
 *
 * Only real events are called about (a task completed or failed, something
 * waiting for your approval), each at most once, grouped into one call, and
 * never more often than CALL_GAP_MS. Quiet hours hold calls until they end.
 */

const db = () => getDb();
export const CALL_GAP_MS = 2 * 60_000;
export const POLL_SECONDS = 15;
/** A batch the phone took but never confirmed goes back in the queue after this. */
const CLAIM_TIMEOUT_MS = 5 * 60_000;
const MAX_ATTEMPTS = 2;
const ONLINE_MS = 90_000;

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const name = (agent: string) => JOB_AGENT_NAME[agent as JobAgent] ?? agent.toUpperCase();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** +, digits, spaces and dashes; 8–15 digits. Returns the cleaned number or null. */
export function cleanNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/[\s\-().]/g, "");
  return /^\+?\d{8,15}$/.test(s) ? s : null;
}

const toMin = (hhmm: string | null) => {
  const m = hhmm?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? +m[1] * 60 + +m[2] : null;
};
/** Inside quiet hours? (From–to may cross midnight; equal or missing = off.) */
export function inQuiet(link: Pick<PhoneLink, "quietFrom" | "quietTo">, now: Date, tz: string) {
  const a = toMin(link.quietFrom), b = toMin(link.quietTo);
  if (a === null || b === null || a === b) return false;
  const m = localClock(now, tz).minutes;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

export async function getLink(userId: string) {
  return db().phoneLink.findUnique({ where: { userId } });
}

/** What Settings shows: your settings, whether the phone is really checking in, and recent calls. */
export async function phoneStatus(userId: string, port?: string) {
  const link = await getLink(userId);
  const events = await db().phoneEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 8 });
  return {
    link: link && {
      mode: link.mode as "android" | "iphone", iphoneEmail: link.iphoneEmail,
      enabled: link.enabled, toNumber: link.toNumber, jarvisNumber: link.jarvisNumber, paired: !!link.tokenHash,
      onCompleted: link.onCompleted, onFailed: link.onFailed, onApproval: link.onApproval,
      quietFrom: link.quietFrom, quietTo: link.quietTo,
      lastSeenAt: link.lastSeenAt?.toISOString() ?? null, device: link.device,
      online: !!link.lastSeenAt && Date.now() - link.lastSeenAt.getTime() < ONLINE_MS,
      lastCallAt: link.lastCallAt?.toISOString() ?? null,
    },
    events: events.map((e) => ({ id: e.id, kind: e.kind, text: e.text, status: e.status, error: e.error, at: e.createdAt.toISOString(), sentAt: e.sentAt?.toISOString() ?? null })),
    lanUrls: lanUrls(port),
  };
}

/** The addresses the spare phone can reach this PC on (same Wi-Fi). */
export function lanUrls(port = "3000") {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list ?? []) {
    if (n.family === "IPv4" && !n.internal && !n.address.startsWith("169.254.")) out.push(`http://${n.address}:${port}`);
  }
  return out;
}

export interface PhoneSettingsInput {
  mode?: "android" | "iphone"; iphoneEmail?: string | null;
  enabled?: boolean; toNumber?: string | null; jarvisNumber?: string | null;
  onCompleted?: boolean; onFailed?: boolean; onApproval?: boolean;
  quietFrom?: string | null; quietTo?: string | null;
}

export async function saveSettings(userId: string, i: PhoneSettingsInput) {
  const data: Partial<PhoneLink> = {};
  if (i.toNumber !== undefined) {
    const n = i.toNumber ? cleanNumber(i.toNumber) : null;
    if (i.toNumber && !n) throw new PhoneError("That doesn't look like a phone number — use digits with your country code, e.g. +919876543210.");
    data.toNumber = n;
  }
  if (i.jarvisNumber !== undefined) {
    const n = i.jarvisNumber ? cleanNumber(i.jarvisNumber) : null;
    if (i.jarvisNumber && !n) throw new PhoneError("JARVIS's WhatsApp number doesn't look like a phone number.");
    data.jarvisNumber = n;
  }
  for (const k of ["quietFrom", "quietTo"] as const) if (i[k] !== undefined) {
    if (i[k] && toMin(i[k]!) === null) throw new PhoneError("Quiet hours use HH:MM, e.g. 23:00.");
    data[k] = i[k] || null;
  }
  for (const k of ["onCompleted", "onFailed", "onApproval"] as const) if (i[k] !== undefined) data[k] = i[k];
  if (i.mode !== undefined) data.mode = i.mode === "iphone" ? "iphone" : "android";
  if (i.iphoneEmail !== undefined) {
    const e = (i.iphoneEmail ?? "").trim().toLowerCase();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new PhoneError("That doesn't look like an email address.");
    data.iphoneEmail = e || null;
  }
  const existing = await getLink(userId);
  // turning calls back on starts fresh — no calls about what happened while they were off
  if (i.enabled !== undefined) { data.enabled = i.enabled; if (i.enabled && !existing?.enabled) data.since = new Date(); }
  return db().phoneLink.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

/** A new pairing token for the spare phone (shown once; only its hash is kept). Replaces any old one. */
export async function pair(userId: string) {
  const token = `jph_${randomBytes(24).toString("base64url")}`;
  await db().phoneLink.upsert({ where: { userId }, create: { userId, tokenHash: hashToken(token) }, update: { tokenHash: hashToken(token), lastSeenAt: null, device: null } });
  return token;
}

export async function unpair(userId: string) {
  await db().phoneLink.updateMany({ where: { userId }, data: { tokenHash: null, lastSeenAt: null, device: null } });
}

/** Queue a test call so you can check the whole path end to end. */
export async function queueTest(userId: string) {
  const link = await getLink(userId);
  if (link?.mode === "iphone") { if (!link.iphoneEmail) throw new PhoneError("Add the iPhone's email address first."); }
  else {
    if (!link?.toNumber) throw new PhoneError("Add your phone number first.");
    if (!link.tokenHash) throw new PhoneError("Pair the spare phone first.");
  }
  await db().phoneEvent.create({ data: { userId, key: `test:${Date.now()}`, kind: "test", text: "Test call - JARVIS can reach you." } });
}

/** Turn what really happened since `since` into queued events (each thing once). */
export async function collect(userId: string, link: PhoneLink) {
  const rows: { key: string; kind: string; text: string }[] = [];
  const since = link.since;
  if (link.onCompleted || link.onFailed) {
    const statuses = [...(link.onCompleted ? ["completed"] : []), ...(link.onFailed ? ["failed"] : [])];
    const jobs = await db().agentJob.findMany({ where: { userId, status: { in: statuses }, finishedAt: { gte: since } }, orderBy: { finishedAt: "asc" }, take: 20 });
    for (const j of jobs) rows.push(j.status === "completed"
      ? { key: `job:${j.id}:completed`, kind: "completed", text: `Done - ${name(j.agent)}: ${clip(j.title, 90)}` }
      : { key: `job:${j.id}:failed`, kind: "failed", text: `Failed - ${name(j.agent)}: ${clip(j.title, 70)}${j.error ? ` (${clip(j.error, 80)})` : ""}` });
  }
  if (link.onApproval) {
    const { approvals } = await listCenter(userId);
    for (const a of approvals) {
      if (!["job", "darwin_message", "ev_daily", "proposal"].includes(a.kind) || Date.parse(a.createdAt) < since.getTime()) continue;
      rows.push({ key: `approval:${a.kind}:${a.id}:${a.createdAt}`, kind: "approval", text: `Needs your approval - ${name(a.agent)}: ${clip(a.title, 90)}` });
    }
  }
  if (rows.length) await db().phoneEvent.createMany({ data: rows.map((r) => ({ userId, ...r })), skipDuplicates: true });
  return rows.length;
}

/** The WhatsApp message for a batch (plain text, no emoji, so it reads the same everywhere). */
export function messageText(events: { kind: string; text: string }[]) {
  const head = events.length === 1 ? "JARVIS:" : `JARVIS: ${events.length} updates`;
  const lines = events.slice(0, 6).map((e) => `- ${e.text}`);
  if (events.length > 6) lines.push(`- and ${events.length - 6} more`);
  const tail = events.some((e) => e.kind === "approval") ? "Open JARVIS > Activity Center to approve." : "";
  return [head, ...lines, tail].filter(Boolean).join("\n")
    .normalize("NFKD").replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\n]/g, "");
}

/**
 * The spare phone checking in. Returns the call to make now, or null.
 * The token is the only credential; an unknown token gets nothing.
 */
export async function deviceNext(token: string, device: string | null, now = new Date()) {
  const link = await db().phoneLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link) return { authorized: false as const };
  await db().phoneLink.update({ where: { id: link.id }, data: { lastSeenAt: now, ...(device ? { device: clip(device, 80) } : {}) } });
  const out = { authorized: true as const, pollSeconds: POLL_SECONDS, call: null as null | { id: string; to: string; message: string } };
  if (!link.enabled || !link.toNumber || link.mode === "iphone") return out;
  const b = await claimBatch(link, now);
  if (b) out.call = { id: b.batchId, to: link.toNumber, message: messageText(b.events) };
  return out;
}

/** What's due for one call now (grouped, spaced, quiet hours respected) — claimed so it's never sent twice. */
async function claimBatch(link: PhoneLink, now: Date) {
  // batches the phone took but never confirmed (it lost power mid-call): back in the queue, or give up
  const stale = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  await db().phoneEvent.updateMany({ where: { userId: link.userId, status: "sending", sentAt: { lt: stale }, attempts: { gte: MAX_ATTEMPTS } }, data: { status: "failed", error: "The phone never confirmed the call." } });
  await db().phoneEvent.updateMany({ where: { userId: link.userId, status: "sending", sentAt: { lt: stale } }, data: { status: "queued", batchId: null } });

  await collect(link.userId, link);
  if (link.lastCallAt && now.getTime() - link.lastCallAt.getTime() < CALL_GAP_MS) return null;
  const tz = (await db().profile.findUnique({ where: { userId: link.userId }, select: { timezone: true } }))?.timezone ?? "UTC";
  // in quiet hours only a test call you asked for goes through; the rest wait
  const quiet = inQuiet(link, now, tz);
  const queued = await db().phoneEvent.findMany({ where: { userId: link.userId, status: "queued", ...(quiet ? { kind: "test" } : {}) }, orderBy: { createdAt: "asc" }, take: 20 });
  if (!queued.length) return null;

  const batchId = randomBytes(8).toString("hex");
  const claimed = await db().phoneEvent.updateMany({ where: { id: { in: queued.map((e) => e.id) }, status: "queued" }, data: { status: "sending", batchId, sentAt: now, attempts: { increment: 1 } } });
  if (!claimed.count) return null;
  await db().phoneLink.update({ where: { id: link.id }, data: { lastCallAt: now } });
  const events = await db().phoneEvent.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } });
  return { batchId, events };
}

export const IPHONE_SUBJECT = "JARVIS CALL";
/**
 * iPhone mode (run every minute by npm run local): what's due goes as one email
 * with the subject "JARVIS CALL" from your Gmail to the spare iPhone. Its
 * Shortcuts automation ("when I get an email … subject contains JARVIS CALL")
 * calls you over Wi-Fi (FaceTime Audio / WhatsApp). The email holds the details.
 */
export async function iphoneTick(now = new Date(), send?: (userId: string, to: string, subject: string, body: string) => Promise<unknown>) {
  const doSend = send ?? (async (u: string, to: string, s: string, b: string) => (await import("@/lib/darwin/email")).sendEmail(u, to, s, b));
  const links = await db().phoneLink.findMany({ where: { mode: "iphone", enabled: true, iphoneEmail: { not: null } } });
  const results: { userId: string; sent: number; error?: string }[] = [];
  for (const link of links) {
    const b = await claimBatch(link, now);
    if (!b) continue;
    try {
      await doSend(link.userId, link.iphoneEmail!, IPHONE_SUBJECT, `${messageText(b.events)}\n\n(Sent by JARVIS to call you. Open JARVIS to see more.)`);
      await db().phoneEvent.updateMany({ where: { batchId: b.batchId }, data: { status: "sent", error: null, sentAt: new Date() } });
      results.push({ userId: link.userId, sent: b.events.length });
    } catch (e) {
      const msg = /NOT CONNECTED/i.test(String((e as Error)?.message)) ? "Gmail isn't connected — connect Google in JARVIS Settings so JARVIS can email the iPhone." : `Couldn't email the iPhone: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
      await db().phoneEvent.updateMany({ where: { batchId: b.batchId }, data: { status: "failed", error: msg } });
      results.push({ userId: link.userId, sent: 0, error: msg });
    }
  }
  return { results };
}

/** The spare phone reporting how the call went. */
export async function deviceAck(token: string, i: { id: string; ok: boolean; error?: string | null }) {
  const link = await db().phoneLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link) return false;
  await db().phoneEvent.updateMany({
    where: { userId: link.userId, batchId: i.id, status: "sending" },
    data: i.ok ? { status: "sent", error: i.error ? clip(i.error, 300) : null, sentAt: new Date() } : { status: "failed", error: clip(i.error || "The phone couldn't place the call.", 300) },
  });
  return true;
}

export class PhoneError extends Error {}
