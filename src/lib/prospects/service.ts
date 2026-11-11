import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { isPrivateIp, resolveHost } from "@/lib/darwin/daily/checks";
import {
  STATUSES, LOST_REASONS, isClosed, phoneKey, websiteKind, judgeSite, keepWebsite, leadScore, signalsFor,
  defaultNextAction, splitAddress, placeIdOf, cleanMapsUrl, localParts, scheduleDue, rotation,
  type Status, type WebsiteStatus,
} from "./rules";

/**
 * JARVIS CRM — JARVIS's own pipeline (no separate agent). Prospects come from
 * JARVIS's Google Maps searches (run by the JARVIS Operator in a visible
 * browser on your laptop) or are added by you / JARVIS in chat. Every change is
 * logged as an event with who made it.
 */
const db = () => getDb();
export class CrmError extends Error {}

export const MAX_DAILY = 30; // manual 4.4: max ~30 leads per day
export const STALE_MS = 5 * 60_000;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

async function tzOf(userId: string) {
  return (await db().profile.findUnique({ where: { userId }, select: { timezone: true } }).catch(() => null))?.timezone || "Asia/Kolkata";
}
function validTz(tz: string) { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return "Asia/Kolkata"; } }

/** Start of today in the user's timezone, as a Date. */
function startOfLocalDay(now: Date, tz: string) {
  const { date } = localParts(now, tz);
  // find the UTC instant whose local date starts `date`: step back from now by the local time of day
  const l = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number);
  const t = new Date(now.getTime() - ((l[0] * 60 + l[1]) * 60 + l[2]) * 1000 - now.getMilliseconds());
  return { date, start: t };
}

export async function event(userId: string, prospectId: string | null, kind: string, text: string, by: "jarvis" | "you" = "jarvis", meta?: Record<string, unknown>) {
  await db().prospectEvent.create({ data: { userId, prospectId, kind, text: text.slice(0, 4000), by, meta: meta as Prisma.InputJsonValue | undefined } }).catch((e) => console.error("[crm] event failed:", e));
}

// ───────────────────────────── the CRM ─────────────────────────────

export interface ProspectInput {
  businessName: string; category?: string | null; contactPerson?: string | null; phone?: string | null; whatsapp?: string | null;
  address?: string | null; area?: string | null; city?: string | null; website?: string | null; instagram?: string | null; notes?: string | null;
}

export async function createProspect(userId: string, i: ProspectInput, by: "jarvis" | "you") {
  const name = i.businessName?.trim();
  if (!name) throw new CrmError("A business name is needed.");
  const key = phoneKey(i.phone);
  if (key) {
    const dup = await db().prospect.findUnique({ where: { userId_phoneKey: { userId, phoneKey: key } } });
    if (dup) throw new CrmError(`${dup.businessName} already has that phone number in the CRM.`);
  }
  const kind = websiteKind(i.website);
  const websiteStatus: WebsiteStatus = kind === "site" ? "ok" : kind;
  const score = { websiteStatus, phone: i.phone, instagram: i.instagram, category: i.category };
  const p = await db().prospect.create({
    data: {
      userId, businessName: name.slice(0, 200), category: i.category ?? null, contactPerson: i.contactPerson ?? null,
      phone: i.phone ?? null, phoneKey: key, whatsapp: i.whatsapp ?? null, address: i.address ?? null, area: i.area ?? null, city: i.city ?? null,
      website: i.website ?? null, websiteStatus, instagram: i.instagram ?? null, source: "manual",
      leadScore: leadScore(score), signals: signalsFor(score), ...defaultNextAction("new"),
    },
  });
  await event(userId, p.id, "created", `Added ${p.businessName}${by === "you" ? "" : " to the CRM"}.`, by);
  if (i.notes?.trim()) await event(userId, p.id, "note", i.notes.trim(), by);
  return p;
}

export interface ProspectPatch {
  status?: Status; lostReason?: string | null; nextAction?: string | null; nextActionAt?: Date | null; note?: string | null;
  contactPerson?: string | null; phone?: string | null; whatsapp?: string | null; interestedServices?: string[]; budgetRange?: string | null;
  decisionMaker?: string | null; value?: number | null; contacted?: boolean; doNotContact?: boolean;
}

/** Pipeline rules (manual 5.2) live here, so the UI, chat and calls all follow them. */
export async function updateProspect(userId: string, id: string, patch: ProspectPatch, by: "jarvis" | "you", now = new Date()) {
  const cur = await db().prospect.findFirst({ where: { id, userId } });
  if (!cur) throw new CrmError("That prospect isn't in the CRM.");
  const data: Prisma.ProspectUpdateInput = {};
  const log: string[] = [];
  let status = (patch.status ?? cur.status) as Status;
  if (patch.status && !STATUSES.includes(patch.status)) throw new CrmError("Unknown status.");

  if (patch.status === "not_reachable") {
    const n = cur.unreachableCount + 1;
    data.unreachableCount = n;
    if (n >= 3) {
      status = "lost"; data.lostReason = "unreachable";
      log.push("Not reachable 3 times → moved to Lost (unreachable). Ask before retrying.");
    }
  }
  if (status === "lost") {
    const reason = patch.lostReason ?? (data.lostReason as string | undefined) ?? cur.lostReason;
    if (!reason) throw new CrmError(`Lost needs a reason: ${LOST_REASONS.join(", ")}.`);
    if (!LOST_REASONS.includes(reason as (typeof LOST_REASONS)[number])) throw new CrmError(`Lost reason must be one of: ${LOST_REASONS.join(", ")}.`);
    data.lostReason = reason;
  }
  if (status !== cur.status) {
    data.status = status;
    if (status === "won") data.wonAt = now;
    if (status !== "lost") data.lostReason = null;
    log.push(`Status: ${cur.status.replace(/_/g, " ")} → ${status.replace(/_/g, " ")}${status === "lost" ? ` (${data.lostReason})` : ""}.`);
  }
  if (["called", "not_reachable", "callback", "interested", "demo_booked"].includes(patch.status ?? "") || patch.contacted) data.lastContactedAt = now;

  // next action + date: always set on open leads, cleared on closed ones
  if (isClosed(status)) { data.nextAction = null; data.nextActionAt = null; }
  else if (patch.nextAction !== undefined || patch.nextActionAt !== undefined || status !== cur.status) {
    const d = defaultNextAction(status, now);
    const nextAction = patch.nextAction ?? (status !== cur.status ? d.nextAction : cur.nextAction) ?? d.nextAction;
    const nextActionAt = patch.nextActionAt ?? (status !== cur.status ? d.nextActionAt : cur.nextActionAt) ?? d.nextActionAt;
    data.nextAction = nextAction; data.nextActionAt = nextActionAt;
    if (patch.nextAction !== undefined || patch.nextActionAt !== undefined) log.push(`Next: ${nextAction}${nextActionAt ? ` on ${nextActionAt.toISOString().slice(0, 10)}` : ""}.`);
  }
  for (const k of ["contactPerson", "whatsapp", "budgetRange", "decisionMaker", "value"] as const) {
    if (patch[k] !== undefined && patch[k] !== cur[k]) { (data as Record<string, unknown>)[k] = patch[k]; log.push(`${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${patch[k] ?? "—"}.`); }
  }
  if (patch.phone !== undefined && patch.phone !== cur.phone) {
    const key = phoneKey(patch.phone);
    if (key) {
      const dup = await db().prospect.findUnique({ where: { userId_phoneKey: { userId, phoneKey: key } } });
      if (dup && dup.id !== id) throw new CrmError(`${dup.businessName} already has that phone number.`);
    }
    data.phone = patch.phone; data.phoneKey = key; log.push(`phone: ${patch.phone ?? "—"}.`);
  }
  if (patch.doNotContact !== undefined && patch.doNotContact !== cur.doNotContact) { data.doNotContact = patch.doNotContact; log.push(patch.doNotContact ? "Marked Do not contact — never called or messaged again." : "Do not contact removed."); }
  if (patch.interestedServices) { data.interestedServices = patch.interestedServices.slice(0, 20); log.push(`interested in: ${patch.interestedServices.join(", ") || "—"}.`); }

  const p = Object.keys(data).length ? await db().prospect.update({ where: { id }, data }) : cur;
  if (log.length) await event(userId, id, patch.status ? "status" : "edit", log.join(" "), by);
  if (patch.note?.trim()) await event(userId, id, "note", patch.note.trim(), by);
  return p;
}

export async function getProspect(userId: string, id: string) {
  const p = await db().prospect.findFirst({ where: { id, userId }, include: { events: { orderBy: { createdAt: "desc" }, take: 50 } } });
  if (!p) throw new CrmError("That prospect isn't in the CRM.");
  return p;
}

export async function deleteProspect(userId: string, id: string) {
  const r = await db().prospect.deleteMany({ where: { id, userId } });
  if (!r.count) throw new CrmError("That prospect isn't in the CRM.");
}

export async function findProspects(userId: string, f: { q?: string; status?: string; take?: number } = {}) {
  return db().prospect.findMany({
    where: {
      userId, ...(f.status ? { status: f.status } : {}),
      ...(f.q ? { OR: [{ businessName: { contains: f.q, mode: "insensitive" } }, { area: { contains: f.q, mode: "insensitive" } }, { category: { contains: f.q, mode: "insensitive" } }, { phone: { contains: f.q.replace(/\s/g, "") } }] } : {}),
    },
    orderBy: [{ leadScore: "desc" }, { createdAt: "desc" }], take: Math.min(f.take ?? 200, 500),
  });
}

/** Everything the CRM screen shows, in one go. */
export async function board(userId: string, now = new Date()) {
  const tz = validTz(await tzOf(userId));
  const { start } = startOfLocalDay(now, tz);
  const endToday = new Date(start.getTime() + 86_400_000);
  const monthStart = new Date(start.getTime() - (Number(localParts(now, tz).date.slice(8)) - 1) * 86_400_000);
  const [prospects, events, searches, finder, wonMonth, lostGroups, addedToday] = await Promise.all([
    db().prospect.findMany({ where: { userId }, orderBy: [{ leadScore: "desc" }, { createdAt: "desc" }], take: 500 }),
    db().prospectEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30, include: { prospect: { select: { businessName: true } } } }),
    db().mapsSearch.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 8 }),
    finderStatus(userId, now),
    db().prospect.findMany({ where: { userId, status: "won", wonAt: { gte: monthStart } }, select: { value: true } }),
    db().prospect.groupBy({ by: ["lostReason"], where: { userId, status: "lost" }, _count: true }),
    addedTodayCount(userId, now, tz),
  ]);
  const open = prospects.filter((p) => !isClosed(p.status));
  return {
    statuses: STATUSES, prospects,
    callList: open.filter((p) => p.nextActionAt && p.nextActionAt < endToday && /call/i.test(p.nextAction ?? "")).slice(0, 50).map((p) => p.id),
    followUpsDue: open.filter((p) => p.nextActionAt && p.nextActionAt < endToday && !/call/i.test(p.nextAction ?? "")).slice(0, 50).map((p) => p.id),
    wonThisMonth: { count: wonMonth.length, value: wonMonth.reduce((s, p) => s + (p.value ?? 0), 0) },
    lossReasons: lostGroups.map((g) => ({ reason: g.lostReason ?? "other", count: g._count })),
    events: events.map((e) => ({ id: e.id, kind: e.kind, text: e.text, by: e.by, at: e.createdAt, prospectId: e.prospectId, name: e.prospect?.businessName ?? null })),
    searches, finder, addedToday, maxDaily: finder.dailyLimit,
  };
}

// ───────────────────────── the Google Maps finder ─────────────────────────

export async function finderStatus(userId: string, now = new Date()) {
  const f = await db().mapsFinder.findUnique({ where: { userId } });
  return {
    paired: !!f?.tokenHash, device: f?.device ?? null, lastSeenAt: f?.lastSeenAt ?? null,
    online: !!f?.lastSeenAt && now.getTime() - f.lastSeenAt.getTime() < 90_000,
    scheduleOn: f?.scheduleOn ?? false, scheduleDays: f?.scheduleDays ?? [1, 2, 3, 4, 5, 6], scheduleTime: f?.scheduleTime ?? "10:30",
    dailyLimit: f?.dailyLimit ?? MAX_DAILY, categories: f?.categories ?? [], areas: f?.areas ?? [], city: f?.city ?? "Bengaluru",
  };
}

/** A new token for the operator (shown once). Replaces any earlier one. */
export async function pairFinder(userId: string) {
  const token = `jmf_${randomBytes(24).toString("hex")}`;
  await db().mapsFinder.upsert({ where: { userId }, create: { userId, tokenHash: hash(token) }, update: { tokenHash: hash(token), lastSeenAt: null, device: null } });
  return token;
}
export async function unpairFinder(userId: string) {
  await db().mapsFinder.updateMany({ where: { userId }, data: { tokenHash: null, lastSeenAt: null, device: null } });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export async function saveSchedule(userId: string, s: { scheduleOn?: boolean; scheduleDays?: number[]; scheduleTime?: string; dailyLimit?: number; categories?: string[]; areas?: string[]; city?: string }) {
  if (s.scheduleTime && !HHMM.test(s.scheduleTime)) throw new CrmError("Time must be HH:MM, e.g. 10:30.");
  if (s.dailyLimit != null && (s.dailyLimit < 1 || s.dailyLimit > MAX_DAILY)) throw new CrmError(`Daily leads must be 1–${MAX_DAILY}.`);
  const clean = (a?: string[]) => a?.map((x) => x.trim()).filter(Boolean).slice(0, 30);
  const data = {
    ...(s.scheduleOn != null ? { scheduleOn: s.scheduleOn } : {}),
    ...(s.scheduleDays ? { scheduleDays: [...new Set(s.scheduleDays.filter((d) => d >= 0 && d <= 6))].sort() } : {}),
    ...(s.scheduleTime ? { scheduleTime: s.scheduleTime } : {}),
    ...(s.dailyLimit != null ? { dailyLimit: s.dailyLimit } : {}),
    ...(s.categories ? { categories: clean(s.categories) } : {}),
    ...(s.areas ? { areas: clean(s.areas) } : {}),
    ...(s.city?.trim() ? { city: s.city.trim() } : {}),
  };
  const f = await db().mapsFinder.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  if (f.scheduleOn && (!f.categories.length || !f.areas.length)) throw new CrmError("Add at least one category and one area for the daily search.");
  return finderStatus(userId);
}

async function addedTodayCount(userId: string, now: Date, tz: string) {
  const { start } = startOfLocalDay(now, tz);
  return db().prospect.count({ where: { userId, source: "google_maps", createdAt: { gte: start } } });
}

export async function queueSearch(userId: string, i: { category: string; area: string; city?: string; limit?: number; trigger: "you" | "jarvis" | "schedule" }) {
  const category = i.category?.trim(), area = i.area?.trim();
  if (!category || !area) throw new CrmError("Say what to search for and where, e.g. gyms in Indiranagar.");
  const f = await finderStatus(userId);
  const open = await db().mapsSearch.count({ where: { userId, status: { in: ["queued", "running"] } } });
  if (open >= 5) throw new CrmError("5 searches are already waiting — let those finish first.");
  const left = f.dailyLimit - (await addedTodayCount(userId, new Date(), validTz(await tzOf(userId))));
  if (left <= 0) throw new CrmError(`Today's ${f.dailyLimit} new leads are already in the CRM. JARVIS searches again tomorrow.`);
  const s = await db().mapsSearch.create({ data: { userId, category: category.slice(0, 80), area: area.slice(0, 80), city: (i.city?.trim() || f.city).slice(0, 60), limit: Math.max(1, Math.min(i.limit ?? 20, left)), trigger: i.trigger } });
  return { search: s, finderOnline: f.online, paired: f.paired };
}

export async function stopSearch(userId: string, id: string) {
  const s = await db().mapsSearch.findFirst({ where: { id, userId } });
  if (!s) throw new CrmError("That search isn't there.");
  if (s.status === "queued") await db().mapsSearch.update({ where: { id }, data: { status: "stopped", finishedAt: new Date(), currentText: "Stopped before it started." } });
  else if (s.status === "running") await db().mapsSearch.update({ where: { id }, data: { status: "stopping", currentText: "Stopping…" } });
}

/** Fetch a business's homepage safely (public IPs only, redirects re-checked). */
export async function fetchSite(input: string, timeoutMs = 7000): Promise<{ status?: number; error?: string; html?: string }> {
  let cur: URL;
  try { cur = new URL(input.includes("://") ? input : `https://${input}`); } catch { return { error: "invalid" }; }
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(cur.protocol) || (cur.port && cur.port !== "80" && cur.port !== "443")) return { error: "unsupported" };
    const r = await resolveHost(cur.hostname);
    if (r.state !== "ok") return { error: r.state };
    if (r.ips.some(isPrivateIp)) return { error: "private" };
    let res: Response;
    try { res = await fetch(cur, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", Accept: "text/html,*/*;q=0.8" }, signal: AbortSignal.timeout(timeoutMs) }); }
    catch { return { error: "unreachable" }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { await res.body?.cancel().catch(() => {}); try { cur = new URL(res.headers.get("location")!, cur); } catch { return { error: "bad redirect" }; } continue; }
    let html = "";
    if (/html/i.test(res.headers.get("content-type") ?? "")) {
      const reader = res.body?.getReader(); const chunks: Uint8Array[] = []; let n = 0;
      while (reader && n < 200_000) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); n += value.length; }
      reader?.cancel().catch(() => {});
      html = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    } else await res.body?.cancel().catch(() => {});
    return { status: res.status, html };
  }
  return { error: "too many redirects" };
}

/** What the operator reads off one Google Maps listing. */
export interface Listing {
  name: string; category?: string | null; address?: string | null; phone?: string | null; website?: string | null;
  rating?: number | null; reviews?: number | null; mapsUrl: string; hours?: string | null; instagram?: string | null; facebook?: string | null;
}

type DeviceOut = { authorized: false } | ({ authorized: true } & Record<string, unknown>);

/** The operator on your laptop: next search · which places are already known · one listing · progress. */
export async function device(token: string | null, body: { action: string; device?: string; searchId?: string; placeIds?: string[]; listing?: Listing; status?: string; text?: string; error?: string },
  opts: { now?: Date; checkSite?: (url: string) => Promise<{ status?: number; error?: string; html?: string }> } = {}): Promise<DeviceOut> {
  const now = opts.now ?? new Date();
  if (!token || !token.startsWith("jmf_")) return { authorized: false };
  const f = await db().mapsFinder.findUnique({ where: { tokenHash: hash(token) } });
  if (!f) return { authorized: false };
  const userId = f.userId;
  await db().mapsFinder.update({ where: { id: f.id }, data: { lastSeenAt: now, ...(body.device ? { device: body.device.slice(0, 80) } : {}) } });
  const tz = validTz(await tzOf(userId));

  if (body.action === "next") {
    const running = await db().mapsSearch.findFirst({ where: { userId, status: { in: ["running", "stopping"] } } });
    if (running) {
      // the operator restarted mid-search: finish it honestly and move on
      await db().mapsSearch.update({ where: { id: running.id }, data: { status: running.status === "stopping" ? "stopped" : "failed", finishedAt: now, error: running.status === "stopping" ? null : "The operator restarted in the middle of this search." } });
    }
    const s = await db().mapsSearch.findFirst({ where: { userId, status: "queued" }, orderBy: { createdAt: "asc" } });
    if (!s) return { authorized: true, search: null };
    const left = f.dailyLimit - (await addedTodayCount(userId, now, tz));
    if (left <= 0) {
      await db().mapsSearch.update({ where: { id: s.id }, data: { status: "done", finishedAt: now, currentText: `Today's ${f.dailyLimit} new leads are already in.` } });
      return { authorized: true, search: null };
    }
    const limit = Math.min(s.limit, left);
    await db().mapsSearch.update({ where: { id: s.id }, data: { status: "running", startedAt: now, heartbeatAt: now, limit, currentText: "Opening Google Maps…" } });
    return { authorized: true, search: { id: s.id, query: `${s.category} in ${s.area}, ${s.city}`, category: s.category, area: s.area, city: s.city, limit } };
  }

  const s = body.searchId ? await db().mapsSearch.findFirst({ where: { id: body.searchId, userId } }) : null;
  if (!s) return { authorized: true, stop: true, error: "unknown search" };
  const stop = s.status === "stopping" || s.status === "stopped";

  if (body.action === "known") {
    const ids = (body.placeIds ?? []).filter(Boolean).slice(0, 200);
    const known = await db().prospect.findMany({ where: { userId, placeId: { in: ids } }, select: { placeId: true } });
    await db().mapsSearch.update({ where: { id: s.id }, data: { heartbeatAt: now } });
    return { authorized: true, stop, known: known.map((k) => k.placeId) };
  }

  if (body.action === "listing" && body.listing) {
    const r = await ingest(userId, s, body.listing, now, opts.checkSite ?? fetchSite);
    const fresh = await db().mapsSearch.findUniqueOrThrow({ where: { id: s.id } });
    const left = f.dailyLimit - (await addedTodayCount(userId, now, tz));
    return { authorized: true, stop: stop || fresh.status === "stopping", ...r, done: fresh.added >= fresh.limit || left <= 0 };
  }

  if (body.action === "status") {
    const final = ["done", "blocked", "failed", "stopped"].includes(body.status ?? "");
    const status = final ? (stop && body.status === "done" ? "stopped" : body.status!) : s.status === "stopping" ? "stopping" : "running";
    await db().mapsSearch.update({ where: { id: s.id }, data: { status, heartbeatAt: now, ...(body.text ? { currentText: body.text.slice(0, 300) } : {}), ...(body.error ? { error: body.error.slice(0, 500) } : {}), ...(final ? { finishedAt: now } : {}) } });
    if (final) {
      const d = await db().mapsSearch.findUniqueOrThrow({ where: { id: s.id } });
      await event(userId, null, "search", searchSummary(d), "jarvis", { searchId: d.id });
    }
    return { authorized: true, stop };
  }
  return { authorized: true, stop };
}

export function searchSummary(d: { category: string; area: string; status: string; visited: number; withWebsite: number; kept: number; added: number; duplicates: number; error: string | null }) {
  const head = `Google Maps: ${d.category} in ${d.area} — looked at ${d.visited}, ${d.kept} without a working website, ${d.added} new to the CRM${d.duplicates ? ` (${d.duplicates} already there)` : ""}.`;
  return d.status === "blocked" ? `${head} Stopped: Google showed a CAPTCHA / "unusual traffic" page. ${d.error ?? ""}`.trim()
    : d.status === "failed" ? `${head} It stopped early: ${d.error ?? "unknown error"}` : d.status === "stopped" ? `${head} You stopped it.` : head;
}

async function ingest(userId: string, s: { id: string; category: string; area: string; city: string }, l: Listing, now: Date, checkSite: (url: string) => Promise<{ status?: number; error?: string; html?: string }>) {
  const bump = (d: Prisma.MapsSearchUpdateInput) => db().mapsSearch.update({ where: { id: s.id }, data: { heartbeatAt: now, ...d } });
  const name = l.name?.trim();
  if (!name) { await bump({ visited: { increment: 1 } }); return { kept: false, added: false, reason: "no name" }; }
  const placeId = placeIdOf(l.mapsUrl);
  const key = phoneKey(l.phone);

  let websiteStatus: WebsiteStatus;
  const kind = websiteKind(l.website);
  if (kind !== "site") websiteStatus = kind;
  else websiteStatus = judgeSite(await checkSite(l.website!).catch(() => ({ error: "unreachable" })), now);

  if (!keepWebsite(websiteStatus)) {
    await bump({ visited: { increment: 1 }, withWebsite: { increment: 1 }, currentText: `${name} has a working website — skipped.` });
    return { kept: false, added: false, reason: "has a website" };
  }
  const dup = await db().prospect.findFirst({ where: { userId, OR: [...(key ? [{ phoneKey: key }] : []), ...(placeId ? [{ placeId }] : [])] }, select: { id: true } });
  if (dup) {
    await bump({ visited: { increment: 1 }, kept: { increment: 1 }, duplicates: { increment: 1 }, currentText: `${name} is already in the CRM.` });
    return { kept: true, added: false, reason: "already in the CRM" };
  }
  const where = splitAddress(l.address, s.area, s.city);
  const sc = { websiteStatus, rating: l.rating, reviews: l.reviews, phone: l.phone, instagram: l.instagram, category: l.category ?? s.category, hours: l.hours };
  try {
    const p = await db().prospect.create({
      data: {
        userId, businessName: name.slice(0, 200), category: l.category ?? s.category, phone: l.phone ?? null, phoneKey: key,
        address: where.address, area: where.area, city: where.city, mapsUrl: cleanMapsUrl(l.mapsUrl), placeId,
        rating: l.rating ?? null, reviews: l.reviews ?? null, websiteStatus, website: l.website ?? null,
        instagram: l.instagram ?? null, facebook: l.facebook ?? null, hours: l.hours ?? null,
        signals: signalsFor(sc), leadScore: leadScore(sc), source: "google_maps", searchId: s.id, ...defaultNextAction("new", now),
      },
    });
    await event(userId, p.id, "created", `Found on Google Maps (${s.category} in ${s.area}) — ${signalsFor(sc)[0] ?? "lead"}, score ${p.leadScore}.`);
    await bump({ visited: { increment: 1 }, kept: { increment: 1 }, added: { increment: 1 }, currentText: `Added ${name} to the CRM.` });
    return { kept: true, added: true, prospectId: p.id };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") { await bump({ visited: { increment: 1 }, kept: { increment: 1 }, duplicates: { increment: 1 } }); return { kept: true, added: false, reason: "already in the CRM" }; }
    throw e;
  }
}

/** Every minute: queue the daily searches that are due, and close searches whose operator went quiet. */
export async function tick(now = new Date()) {
  const results: { userId: string; queued?: string; error?: string }[] = [];
  const stale = await db().mapsSearch.findMany({ where: { status: { in: ["running", "stopping"] }, heartbeatAt: { lt: new Date(now.getTime() - STALE_MS) } } });
  for (const s of stale) {
    await db().mapsSearch.update({ where: { id: s.id }, data: { status: s.status === "stopping" ? "stopped" : "failed", finishedAt: now, error: s.status === "stopping" ? null : "The operator on your laptop stopped answering (closed, asleep or offline)." } });
  }
  const finders = await db().mapsFinder.findMany({ where: { scheduleOn: true } });
  for (const f of finders) {
    const tz = validTz(await tzOf(f.userId));
    if (!scheduleDue(f, now, tz)) continue;
    const { date } = localParts(now, tz);
    const pick = rotation(f.categories, f.areas, f.rotateIndex);
    await db().mapsFinder.update({ where: { id: f.id }, data: { lastScheduled: date, rotateIndex: f.rotateIndex + 1 } });
    try {
      const r = await queueSearch(f.userId, { ...pick, city: f.city, limit: f.dailyLimit, trigger: "schedule" });
      results.push({ userId: f.userId, queued: `${pick.category} in ${pick.area}` });
      if (!r.finderOnline) await event(f.userId, null, "search", `Daily search queued (${pick.category} in ${pick.area}), but the JARVIS Operator on your laptop isn't running — it starts when the operator does.`);
    } catch (e) { results.push({ userId: f.userId, error: (e as Error).message }); }
  }
  return { results, closed: stale.length };
}
