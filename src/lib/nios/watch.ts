import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { sendEmail, emailChannelReady } from "@/lib/darwin/email";
import { parseNotices, type ParsedNotice } from "./parse";
import { sourcesFor, type NiosSource } from "./sources";

/**
 * The NIOS watcher. Reads the official NIOS notice pages, remembers every
 * notice per user, and announces only notices that APPEAR after watching
 * started — the first read of each page is stored as history (baseline), so
 * turning the watcher on never floods you with years of old PDFs.
 *
 * New notices reach the user three ways: the JARVIS console polls and shows /
 * speaks them (+ a desktop notification), and — when Gmail is connected — an
 * email digest is sent from the user's own Gmail to themselves.
 */

export interface NiosSettings {
  enabled: boolean;
  email: boolean;
  regions: string[];
  baselined: string[];
  lastCheckedAt: string | null;
  lastEmailError?: string | null;
}
const DEFAULTS: NiosSettings = { enabled: true, email: true, regions: [], baselined: [], lastCheckedAt: null };

/** Minutes between real page reads (per user). Polls in between return stored notices. */
export const CHECK_EVERY_MIN = 10;
/** At most this many notices are announced from one page in one check (a site redesign isn't news). */
export const ANNOUNCE_CAP = 8;

export interface NoticeDTO {
  id: string; source: string; sourceLabel: string; title: string; url: string;
  dateText: string | null; category: string; firstSeenAt: string; isNew: boolean; seen: boolean;
}
export interface SourceStatus { key: string; label: string; url: string; ok: boolean; count: number; error?: string }
export interface CheckResult {
  checked: boolean;
  checkedAt: string | null;
  sources: SourceStatus[];
  newNotices: NoticeDTO[];
  /** Notices stored as history on this check (first read of a page). */
  baselineAdded: number;
  emailed: number;
  emailNote: string | null;
}

// ------------------------------------------------------------------ settings

export async function getSettings(userId: string, create = true): Promise<NiosSettings> {
  const db = getDb();
  const row = await db.integration.findUnique({ where: { userId_provider: { userId, provider: "nios" } } });
  if (!row) {
    if (!create) return { ...DEFAULTS, enabled: false };
    await db.integration.create({ data: { userId, provider: "nios", status: "connected", metadata: { ...DEFAULTS } as object } });
    return { ...DEFAULTS };
  }
  const m = (row.metadata ?? {}) as Partial<NiosSettings>;
  return { ...DEFAULTS, ...m, enabled: row.status === "connected" };
}

export async function saveSettings(userId: string, patch: Partial<NiosSettings>): Promise<NiosSettings> {
  const cur = await getSettings(userId);
  const next = { ...cur, ...patch };
  await getDb().integration.update({
    where: { userId_provider: { userId, provider: "nios" } },
    data: { status: next.enabled ? "connected" : "disconnected", metadata: next as unknown as object },
  });
  return next;
}

export function userSources(s: NiosSettings): NiosSource[] {
  return sourcesFor({ regions: s.regions, envRegions: env.niosRegionalCentres, extraUrls: env.niosExtraUrls });
}

// ------------------------------------------------------------------ fetching

const pageCache = new Map<string, { at: number; result: { ok: true; notices: ParsedNotice[] } | { ok: false; error: string } }>();
const PAGE_TTL = 5 * 60_000;
/** Tests / forced refreshes: forget cached page reads. */
export function clearPageCache() { pageCache.clear(); }

/** Read one NIOS page (cached for a few minutes so many users / polls share one read). */
export async function readSource(src: NiosSource) {
  const hit = pageCache.get(src.url);
  if (hit && Date.now() - hit.at < PAGE_TTL) return hit.result;
  let result: { ok: true; notices: ParsedNotice[] } | { ok: false; error: string };
  try {
    const res = await fetch(src.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS-NIOS-watcher/1.0)", Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) result = { ok: false, error: `The page answered HTTP ${res.status}.` };
    else {
      const html = (await res.text()).slice(0, 3_000_000);
      result = { ok: true, notices: parseNotices(html, res.url || src.url).slice(0, 200) };
    }
  } catch (e) {
    result = { ok: false, error: /timeout|abort/i.test(String(e)) ? "The page took too long to answer." : "Couldn't reach the page." };
  }
  pageCache.set(src.url, { at: Date.now(), result });
  return result;
}

export const noticeFingerprint = (source: string, n: Pick<ParsedNotice, "url" | "title">) =>
  createHash("sha256").update(`${source}|${n.url.trim().toLowerCase()}|${n.title.trim().toLowerCase().replace(/\s+/g, " ")}`).digest("hex").slice(0, 40);

// ------------------------------------------------------------------ checking

/**
 * Read every watched page and store what's new for this user. Skips the read
 * (returns stored state) when the last check was under CHECK_EVERY_MIN minutes
 * ago, unless `force`.
 */
export async function checkForUser(userId: string, opts: { force?: boolean } = {}): Promise<CheckResult> {
  const db = getDb();
  let settings = await getSettings(userId);
  if (!settings.enabled) return { checked: false, checkedAt: settings.lastCheckedAt, sources: [], newNotices: [], baselineAdded: 0, emailed: 0, emailNote: "NIOS watch is off." };
  const last = settings.lastCheckedAt ? Date.parse(settings.lastCheckedAt) : 0;
  if (!opts.force && Date.now() - last < CHECK_EVERY_MIN * 60_000) {
    return { checked: false, checkedAt: settings.lastCheckedAt, sources: [], newNotices: [], baselineAdded: 0, emailed: 0, emailNote: null };
  }

  const sources = userSources(settings);
  const reads = await Promise.all(sources.map(async (s) => ({ s, r: await readSource(s) })));
  const statuses: SourceStatus[] = [];
  const createdNew: string[] = [];
  let baselineAdded = 0;
  const baselined = new Set(settings.baselined);

  for (const { s, r } of reads) {
    if (!r.ok) { statuses.push({ key: s.key, label: s.label, url: s.url, ok: false, count: 0, error: r.error }); continue; }
    statuses.push({ key: s.key, label: s.label, url: s.url, ok: true, count: r.notices.length });
    const withFp = r.notices.map((n) => ({ n, fp: noticeFingerprint(s.key, n) }));
    const known = new Set((await db.niosNotice.findMany({
      where: { userId, fingerprint: { in: withFp.map((x) => x.fp) } }, select: { fingerprint: true },
    })).map((x) => x.fingerprint));
    const fresh = withFp.filter((x) => !known.has(x.fp));
    const firstRead = !baselined.has(s.key) && r.notices.length > 0;
    let announced = 0;
    for (const { n, fp } of fresh) {
      const announce = !firstRead && announced < ANNOUNCE_CAP;
      if (announce) announced++;
      try {
        const row = await db.niosNotice.create({
          data: {
            userId, source: s.key, title: n.title.slice(0, 2000), url: n.url.slice(0, 2000), dateText: n.dateText,
            publishedAt: n.publishedAt, category: n.category, fingerprint: fp, baseline: !announce,
          },
          select: { id: true },
        });
        if (announce) createdNew.push(row.id); else baselineAdded++;
      } catch { /* a concurrent check stored it first */ }
    }
    if (r.notices.length) baselined.add(s.key);
  }

  settings = await saveSettings(userId, { baselined: [...baselined], lastCheckedAt: new Date().toISOString() });
  const rows = createdNew.length
    ? await db.niosNotice.findMany({ where: { id: { in: createdNew } }, orderBy: [{ publishedAt: "desc" }, { firstSeenAt: "desc" }] })
    : [];
  const labels = new Map(sources.map((s) => [s.key, s.label]));
  const newNotices = rows.map((r) => toDTO(r, labels));

  // email digest (from the user's own Gmail, to themselves)
  let emailed = 0, emailNote: string | null = null;
  if (newNotices.length && settings.email) {
    const res = await emailDigest(userId, newNotices);
    emailed = res.sent ? newNotices.length : 0; emailNote = res.note;
  }
  return { checked: true, checkedAt: settings.lastCheckedAt, sources: statuses, newNotices, baselineAdded, emailed, emailNote };
}

async function emailDigest(userId: string, notices: NoticeDTO[]): Promise<{ sent: boolean; note: string | null }> {
  const db = getDb();
  if (!(await emailChannelReady(userId))) return { sent: false, note: "Email alerts need Gmail connected (Settings → Integrations)." };
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user?.email) return { sent: false, note: "No email address on the account." };
  const subject = notices.length === 1 ? `NIOS: ${notices[0].title.slice(0, 120)}` : `NIOS: ${notices.length} new notifications`;
  const body = [
    `JARVIS spotted ${notices.length === 1 ? "a new notice" : `${notices.length} new notices`} on the official NIOS website:`,
    "",
    ...notices.flatMap((n) => [`• [${n.category.toUpperCase()}] ${n.title}${n.dateText ? ` (${n.dateText})` : ""}`, `  ${n.sourceLabel} — ${n.url}`, ""]),
    "Always confirm details on nios.ac.in.",
  ].join("\n");
  try {
    await sendEmail(userId, user.email, subject, body);
    await db.niosNotice.updateMany({ where: { id: { in: notices.map((n) => n.id) } }, data: { emailedAt: new Date() } });
    await saveSettings(userId, { lastEmailError: null });
    return { sent: true, note: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Email failed.";
    await saveSettings(userId, { lastEmailError: msg }).catch(() => {});
    return { sent: false, note: msg };
  }
}

// ------------------------------------------------------------------ reading

type Row = { id: string; source: string; title: string; url: string; dateText: string | null; category: string; firstSeenAt: Date; baseline: boolean; seenAt: Date | null };
export function toDTO(r: Row, labels: Map<string, string>): NoticeDTO {
  return {
    id: r.id, source: r.source, sourceLabel: labels.get(r.source) ?? r.source, title: r.title, url: r.url,
    dateText: r.dateText, category: r.category, firstSeenAt: r.firstSeenAt.toISOString(), isNew: !r.baseline, seen: !!r.seenAt,
  };
}

/** New notices the user hasn't been shown in JARVIS yet (oldest first, so they're read in order). */
export async function unseenNotices(userId: string, settings?: NiosSettings): Promise<NoticeDTO[]> {
  const s = settings ?? await getSettings(userId);
  const labels = new Map(userSources(s).map((x) => [x.key, x.label]));
  const rows = await getDb().niosNotice.findMany({ where: { userId, baseline: false, seenAt: null }, orderBy: { firstSeenAt: "asc" }, take: 20 });
  return rows.map((r) => toDTO(r, labels));
}

/** The latest notices on file (newest first), optionally one category. */
export async function latestNotices(userId: string, opts: { category?: string; limit?: number } = {}): Promise<NoticeDTO[]> {
  const s = await getSettings(userId);
  const labels = new Map(userSources(s).map((x) => [x.key, x.label]));
  const rows = await getDb().niosNotice.findMany({
    where: { userId, ...(opts.category ? { category: opts.category } : {}) },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { firstSeenAt: "desc" }],
    take: Math.min(Math.max(opts.limit ?? 15, 1), 50),
  });
  return rows.map((r) => toDTO(r, labels));
}

export async function markSeen(userId: string, ids: string[]) {
  if (!ids.length) return 0;
  const r = await getDb().niosNotice.updateMany({ where: { userId, id: { in: ids.slice(0, 100) }, seenAt: null }, data: { seenAt: new Date() } });
  return r.count;
}

/** Cron: check every user who has the NIOS watch on. Pages are read once and shared. */
export async function checkAllUsers(): Promise<{ users: number; newNotices: number; emailed: number }> {
  const rows = await getDb().integration.findMany({ where: { provider: "nios", status: "connected" }, select: { userId: true } });
  let newNotices = 0, emailed = 0;
  for (const { userId } of rows) {
    try { const r = await checkForUser(userId, { force: true }); newNotices += r.newNotices.length; emailed += r.emailed; }
    catch { /* one user's failure doesn't stop the others */ }
  }
  return { users: rows.length, newNotices, emailed };
}
