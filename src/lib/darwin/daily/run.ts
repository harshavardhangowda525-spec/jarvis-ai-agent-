import "server-only";
import { sendAutoEmails, autoEmailState, type AutoEmailDeps, type AutoEmailResult, type AutoEmailState } from "@/lib/darwin/auto-email";
import { createHash } from "node:crypto";
import type { DarwinDailyRun, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { recordActivity } from "@/lib/activity/record";
import { localClock, hm } from "@/lib/ev/daily/schedule";
import {
  GeoapifyError, categoryPlan, discoveryFingerprint, geocode, haversineM, mapFeature, mapLinks, matchesPlan, searchPlaces,
  type GeoCenter, type GeoLead,
} from "../geoapify";
import { logActivity } from "../store";
import { gatherSignals, googleAvailable, searchAvailable, type Gathered } from "./checks";
import { BUCKETS, categoryBucket, classifyWebsite, scoreLead, verifyPhone, type Bucket } from "./verify";
import { buildReport, runLeads, type DailyReport } from "./report";

/**
 * DARWIN's autonomous daily search — a persistent, resumable job:
 *   configured locations × categories → Geoapify candidates (paged with a
 *   persistent cursor) → drop anything already in DARWIN or checked on an
 *   earlier day → verify the website with real checks → score → save → repeat
 *   until the target of verified no-website leads, or the search scope runs out.
 * Every tick (Vercel Cron, `npm run local`, JARVIS/DARWIN open) continues from
 * the saved position. It never pads the count: fewer found = fewer reported.
 */

export interface DailyConfig {
  locations: string[];
  categories: string[];
  target: number;
  radiusKm: number;
  requirePhone: boolean;
  strict: boolean;
  /** Email every new lead that has a public address, automatically (once each). */
  autoEmail: boolean;
}

export const DEFAULT_CATEGORIES = ["gyms", "cafes", "restaurants", "salons", "spas", "clinics", "dentists", "coaching centres", "clothing stores", "bakeries", "yoga studios", "physiotherapists"];

const list = (s: string) => s.split(/[;|\n]|,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);

/** Settings: what you saved in DARWIN → env → the places you've searched before. */
export async function loadConfig(userId: string): Promise<DailyConfig & { source: string }> {
  const db = getDb();
  const row = await db.integration.findUnique({ where: { userId_provider: { userId, provider: "darwin_daily" } } }).catch(() => null);
  const saved = (row?.metadata ?? {}) as Partial<DailyConfig>;
  let locations = saved.locations?.length ? saved.locations : list(env.darwinDailyLocations);
  let source = saved.locations?.length ? "saved" : locations.length ? "env" : "none";
  if (!locations.length) {
    const recent = await db.darwinSearchCursor.findMany({ where: { userId, NOT: { queryKey: { startsWith: "daily:" } } }, orderBy: { updatedAt: "desc" }, take: 20, select: { location: true } });
    locations = [...new Set(recent.map((r) => r.location.trim()).filter(Boolean))].slice(0, 3);
    if (locations.length) source = "recent searches";
  }
  const categories = saved.categories?.length ? saved.categories : list(env.darwinDailyCategories).length ? list(env.darwinDailyCategories) : DEFAULT_CATEGORIES;
  return {
    locations: locations.slice(0, 12),
    categories: categories.slice(0, 24),
    target: Math.min(Math.max(saved.target ?? env.darwinDailyTarget, 1), 200),
    radiusKm: Math.min(Math.max(saved.radiusKm ?? 6, 1), 25),
    requirePhone: saved.requirePhone ?? false,
    strict: saved.strict ?? env.darwinDailyStrict,
    autoEmail: saved.autoEmail ?? env.darwinAutoEmail,
    source,
  };
}

export async function saveConfig(userId: string, c: Partial<DailyConfig>) {
  const cur = await loadConfig(userId);
  const next: DailyConfig = {
    locations: (c.locations ?? cur.locations).map((x) => x.trim()).filter(Boolean).slice(0, 12),
    categories: (c.categories ?? cur.categories).map((x) => x.trim()).filter(Boolean).slice(0, 24),
    target: Math.min(Math.max(Math.round(c.target ?? cur.target), 1), 200),
    radiusKm: Math.min(Math.max(c.radiusKm ?? cur.radiusKm, 1), 25),
    requirePhone: c.requirePhone ?? cur.requirePhone,
    strict: c.strict ?? cur.strict,
    autoEmail: c.autoEmail ?? cur.autoEmail,
  };
  await getDb().integration.upsert({
    where: { userId_provider: { userId, provider: "darwin_daily" } },
    create: { userId, provider: "darwin_daily", status: "connected", metadata: next as unknown as Prisma.InputJsonValue },
    update: { metadata: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

export function dailyNow(now = new Date()) { return localClock(now, env.darwinDailyTz); }
/**
 * Has today's search time come? `earlyMin` lets the scheduler start a little
 * before it (Vercel runs a daily cron any time within its hour), so the leads
 * are ready by the start time rather than after it.
 */
export function dailyDue(now = new Date(), earlyMin = 0) {
  const s = hm(env.darwinDailyStart);
  return dailyNow(now).minutes >= (Number.isFinite(s) ? s : 360) - earlyMin;
}

/** Could a run start with these settings (a location to search and Geoapify)? */
const canRun = (cfg: DailyConfig) => cfg.locations.length > 0 && !!env.geoapifyApiKey;

/* ---------------- dependencies (real by default; injected in tests) ---------------- */

export interface DarwinDeps {
  now: () => Date;
  geocode: (text: string) => Promise<GeoCenter>;
  page: (o: { center: GeoCenter; radiusM: number; category: string; offset: number }) => Promise<unknown[]>;
  gather: (c: { name: string; address: string | null; lat: number; lon: number; website: string | null; locality: string; phone?: string | null }, o: { google: boolean; search: boolean }) => Promise<Gathered>;
  google: boolean;
  search: boolean;
}

export function defaultDeps(): DarwinDeps {
  const key = env.geoapifyApiKey;
  return {
    now: () => new Date(),
    geocode: (t) => geocode(t, key),
    page: async ({ center, radiusM, category, offset }) => (await searchPlaces({ center, radiusM, plan: categoryPlan(category), limit: PAGE, offset, key })).features,
    gather: gatherSignals,
    google: googleAvailable(),
    search: searchAvailable(),
  };
}

const PAGE = 50;
const MAX_GEO_REQUESTS = 260;         // per day — well inside Geoapify's free 3,000/day
const PAID_CALLS_PER_TARGET = 3;      // Google / search lookups allowed per wanted lead
const RECHECK_AFTER_DAYS = 21;        // unclear / temporarily-down businesses get another look later
const BATCH = 4;

type Log = { at: string; text: string; tone?: "ok" | "warn" }[];
const logOf = (r: DarwinDailyRun): Log => (Array.isArray(r.log) ? (r.log as Log) : []);

/* ---------------- runs ---------------- */

export async function todayRun(userId: string, now = new Date()) {
  return getDb().darwinDailyRun.findUnique({ where: { userId_date: { userId, date: dailyNow(now).date } } });
}

export async function ensureRun(userId: string, now = new Date()): Promise<DarwinDailyRun> {
  const date = dailyNow(now).date;
  const existing = await getDb().darwinDailyRun.findUnique({ where: { userId_date: { userId, date } } });
  if (existing) return existing;
  const cfg = await loadConfig(userId);
  const needsSetup = !cfg.locations.length || !env.geoapifyApiKey;
  // earlier days' search positions are no longer needed
  const weekAgo = localClock(new Date(now.getTime() - 7 * 86_400_000), env.darwinDailyTz).date;
  await getDb().darwinSearchCursor.deleteMany({ where: { userId, queryKey: { startsWith: "daily:" }, NOT: { queryKey: { gte: `daily:${weekAgo}` } } } }).catch(() => {});
  try {
    return await getDb().darwinDailyRun.create({
      data: {
        userId, date, target: cfg.target, config: cfg as unknown as Prisma.InputJsonValue,
        status: needsSetup ? "needs_setup" : "running",
        lastError: !env.geoapifyApiKey ? "Geoapify isn't configured (GEOAPIFY_API_KEY), so DARWIN can't search." : !cfg.locations.length ? "No target locations yet — add them in DARWIN's daily search settings." : null,
        log: [{ at: now.toISOString(), text: needsSetup ? "Daily search needs setup." : `Daily search started — target ${cfg.target} verified no-website leads across ${cfg.locations.length} location${cfg.locations.length === 1 ? "" : "s"} × ${cfg.categories.length} categories.` }] as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return (await getDb().darwinDailyRun.findUnique({ where: { userId_date: { userId, date } } }))!;
    throw e;
  }
}

async function lease(id: string, now: Date, ms: number) {
  const r = await getDb().darwinDailyRun.updateMany({ where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(now.getTime() + ms) } });
  return r.count === 1;
}

const combosOf = (c: DailyConfig) => c.locations.flatMap((loc) => c.categories.map((cat) => ({ loc, cat, key: `${loc.toLowerCase()}|${cat.toLowerCase()}` })));
const normName = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Everything DARWIN already knows, for dedup (loaded once per tick). */
async function knowledge(userId: string, now: Date, run: { id: string; date: string }) {
  const db = getDb();
  const [leads, cands, todayLeads] = await Promise.all([
    db.darwinLead.findMany({ where: { userId }, select: { fingerprint: true, sourceRef: true, phone: true, businessName: true, latitude: true, longitude: true, website: true } }),
    db.darwinCandidate.findMany({ where: { userId }, select: { fingerprint: true, placeId: true, status: true, checkedAt: true, runDate: true } }),
    db.darwinLead.findMany({ where: { userId, metadata: { path: ["dailyRunId"], equals: run.id } }, select: { fingerprint: true, sourceRef: true } }),
  ]);
  // handled earlier in THIS run (a wider circle re-reads the nearest places) — not duplicates
  const today = new Set<string>([
    ...todayLeads.flatMap((l) => [l.fingerprint, l.sourceRef ?? ""]),
    ...cands.filter((c) => c.runDate === run.date).flatMap((c) => [c.fingerprint, c.placeId ?? ""]),
  ].filter(Boolean));
  const fps = new Set(leads.map((l) => l.fingerprint));
  const refs = new Set(leads.map((l) => l.sourceRef).filter(Boolean) as string[]);
  const phones = new Set(leads.map((l) => (l.phone ?? "").replace(/\D/g, "").slice(-10)).filter((p) => p.length === 10));
  const named = leads.filter((l) => l.latitude != null && l.longitude != null).map((l) => ({ n: normName(l.businessName), lat: l.latitude!, lon: l.longitude! }));
  const cutoff = now.getTime() - RECHECK_AFTER_DAYS * 86_400_000;
  const settled = (c: { status: string; checkedAt: Date }) => !(["unclear", "temporarily_unavailable"].includes(c.status) && c.checkedAt.getTime() < cutoff);
  const candFp = new Set(cands.filter(settled).map((c) => c.fingerprint));
  const candRef = new Set(cands.filter(settled).map((c) => c.placeId).filter(Boolean) as string[]);
  return {
    seenToday(l: GeoLead, fp: string) { return today.has(fp) || (!!l.placeId && today.has(l.placeId)); },
    isLead(l: GeoLead, fp: string) {
      if (fps.has(fp) || (l.placeId && refs.has(l.placeId))) return true;
      const ph = (l.phone ?? "").replace(/\D/g, "").slice(-10);
      if (ph.length === 10 && phones.has(ph)) return true;
      const n = normName(l.name);
      return named.some((x) => x.n === n && haversineM(x, l) <= 150);
    },
    wasChecked(l: GeoLead, fp: string) { return candFp.has(fp) || (!!l.placeId && candRef.has(l.placeId)); },
    remember(l: GeoLead, fp: string) {
      today.add(fp); if (l.placeId) today.add(l.placeId);
      fps.add(fp); if (l.placeId) refs.add(l.placeId);
      const ph = (l.phone ?? "").replace(/\D/g, "").slice(-10); if (ph.length === 10) phones.add(ph);
      named.push({ n: normName(l.name), lat: l.lat, lon: l.lon });
    },
    rememberChecked(l: GeoLead, fp: string) { candFp.add(fp); if (l.placeId) candRef.add(l.placeId); today.add(fp); if (l.placeId) today.add(l.placeId); },
  };
}

type Counters = Pick<DarwinDailyRun, "verified" | "candidates" | "duplicates" | "alreadyChecked" | "websiteRejected" | "unclear" | "tempUnavailable" | "closed" | "missingPhone" | "outOfArea" | "errors">;
type Api = { geoapify: number; google: number; search: number };

/**
 * Advance a run within the time budget. Safe to call from anywhere at any time:
 * only one caller works at once (lease); the rest just read.
 */
export async function advanceRun(runId: string, opts: { budgetMs?: number; deps?: DarwinDeps; stats?: { worked?: boolean } } = {}): Promise<DarwinDailyRun> {
  const deps = opts.deps ?? defaultDeps();
  const budget = opts.budgetMs ?? 240_000;
  const db = getDb();
  const t0 = deps.now().getTime();
  if (!(await lease(runId, deps.now(), budget + 60_000))) return db.darwinDailyRun.findUniqueOrThrow({ where: { id: runId } });
  if (opts.stats) opts.stats.worked = true;
  try {
    let run = await db.darwinDailyRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status !== "running") return run;
    const cfg = run.config as unknown as DailyConfig;
    const combos = combosOf(cfg);
    const k = await knowledge(run.userId, deps.now(), run);
    const c: Counters = { ...run };
    const api: Api = { geoapify: 0, google: 0, search: 0, ...((run.apiRequests as Api | null) ?? {}) };
    const log = logOf(run);
    const exhausted = new Set(run.exhaustedCombos);
    let comboIndex = run.comboIndex;
    const paidCap = cfg.target * PAID_CALLS_PER_TARGET;
    const say = (text: string, tone?: "ok" | "warn") => log.push({ at: deps.now().toISOString(), text: text.slice(0, 300), ...(tone ? { tone } : {}) });
    const persist = async (extra: Prisma.DarwinDailyRunUpdateInput = {}) => {
      run = await db.darwinDailyRun.update({
        where: { id: run.id },
        data: { ...c, comboIndex, exhaustedCombos: [...exhausted], apiRequests: api as unknown as Prisma.InputJsonValue, log: log.slice(-80) as unknown as Prisma.InputJsonValue, ...extra },
      });
    };
    let stopReason: string | null = null;

    while (c.verified < cfg.target && deps.now().getTime() - t0 < budget - 8_000) {
      if (comboIndex >= combos.length) { stopReason = "scope"; break; }
      const combo = combos[comboIndex];
      if (exhausted.has(combo.key)) { comboIndex++; continue; }
      if (api.geoapify >= MAX_GEO_REQUESTS) { stopReason = "geo_cap"; break; }

      // ---- the saved position for this location × category
      // position is per day: each day re-reads the area from the start (new listings appear);
      // the permanent history (CRM + checked candidates) is what stops repeats
      const queryKey = `daily:${run.date}:${createHash("sha256").update(`${combo.key}|${cfg.radiusKm}`).digest("hex").slice(0, 24)}`;
      let cur = await db.darwinSearchCursor.findUnique({ where: { userId_queryKey: { userId: run.userId, queryKey } } });
      if (!cur) {
        let center: GeoCenter;
        try { center = await deps.geocode(combo.loc); api.geoapify++; }
        catch (e) {
          if (e instanceof GeoapifyError && e.kind === "rate_limit") { stopReason = "rate_limit"; say(`Geoapify rate limit — pausing until the next run. (${e.message})`, "warn"); break; }
          say(`Couldn't find the location "${combo.loc}": ${(e as Error).message}`, "warn");
          exhausted.add(combo.key); comboIndex++; c.errors++; continue;
        }
        cur = await db.darwinSearchCursor.create({ data: { userId: run.userId, queryKey, category: combo.cat, location: combo.loc, filter: "daily", centerLat: center.lat, centerLon: center.lon, placeLabel: center.label, baseRadiusM: Math.round(cfg.radiusKm * 1000) } });
      }
      const center: GeoCenter = { lat: cur.centerLat!, lon: cur.centerLon!, label: cur.placeLabel ?? combo.loc };
      const radii = [cur.baseRadiusM, Math.min(cur.baseRadiusM * 2, 25_000)].filter((v, i, a) => a.indexOf(v) === i);
      if (cur.exhausted || cur.radiusStep >= radii.length) { exhausted.add(combo.key); comboIndex++; continue; }

      // ---- candidates: first any left over from the last run (backlog), else the next page
      const plan = categoryPlan(combo.cat);
      const fresh: { l: GeoLead; fp: string }[] = [];
      const consider = (l: GeoLead) => {
        const fp = discoveryFingerprint(l);
        if (k.seenToday(l, fp)) return;
        if (k.isLead(l, fp)) { c.duplicates++; return; }
        if (k.wasChecked(l, fp)) { c.alreadyChecked++; return; }
        if (fresh.some((x) => x.fp === fp)) return;
        fresh.push({ l, fp });
      };
      const backlog = (Array.isArray(cur.backlog) ? cur.backlog : []) as unknown as GeoLead[];
      if (backlog.length) {
        for (const l of backlog) consider(l);
        await db.darwinSearchCursor.update({ where: { id: cur.id }, data: { backlog: [] } });
      } else {
        let features: unknown[];
        try { features = await deps.page({ center, radiusM: radii[cur.radiusStep], category: combo.cat, offset: cur.offset }); api.geoapify++; }
        catch (e) {
          if (e instanceof GeoapifyError && e.kind === "rate_limit") { stopReason = "rate_limit"; say(`Geoapify rate limit — pausing until the next run.`, "warn"); break; }
          c.errors++; say(`Search failed for ${combo.cat} in ${combo.loc}: ${(e as Error).message}`, "warn");
          exhausted.add(combo.key); comboIndex++; continue;
        }
        // advance the cursor first — a crash mid-verification never re-reads the page
        const lastPage = features.length < PAGE;
        const nextStep = lastPage ? cur.radiusStep + 1 : cur.radiusStep;
        await db.darwinSearchCursor.update({ where: { id: cur.id }, data: { offset: lastPage ? Math.max(0, cur.offset + features.length - 10) : cur.offset + PAGE, radiusStep: nextStep, exhausted: nextStep >= radii.length } });
        for (const f of features) {
          const l = mapFeature(f, center, plan);
          if (!l || !matchesPlan(l, plan)) continue;
          if (k.seenToday(l, discoveryFingerprint(l))) continue;
          c.candidates++;
          if ((l.distanceM ?? 0) > radii[radii.length - 1] * 1.05) { c.outOfArea++; continue; }
          consider(l);
        }
        if (nextStep >= radii.length && !fresh.length) { exhausted.add(combo.key); comboIndex++; }
      }

      // ---- verify, a few at a time
      let processed = 0;
      for (let i = 0; i < fresh.length && c.verified < cfg.target; i += BATCH) {
        if (deps.now().getTime() - t0 > budget - 8_000) break;
        const useGoogle = deps.google && api.google < paidCap;
        const useSearch = deps.search && api.search < paidCap;
        if ((deps.google && !useGoogle) || (deps.search && !useSearch)) { stopReason = "paid_cap"; break; }
        const batch = fresh.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async ({ l, fp }) => {
          try { return { l, fp, g: await deps.gather({ name: l.name, address: l.address, lat: l.lat, lon: l.lon, website: l.website, phone: l.phone, locality: center.label.split(",").slice(0, 2).join(",") }, { google: useGoogle, search: useSearch }) }; }
          catch (e) { return { l, fp, err: (e as Error).message }; }
        }));
        for (const r of results) {
          if (c.verified >= cfg.target) break;
          processed = i + results.indexOf(r) + 1;
          if ("err" in r) { c.errors++; continue; }
          api.google += r.g.calls.google; api.search += r.g.calls.search;
          const v = classifyWebsite(r.g.signals, { strict: cfg.strict });
          const listingPhone = verifyPhone(r.l.phone);
          const googlePhone = verifyPhone(r.g.google?.phone);
          const phone = listingPhone.ok ? { ...listingPhone, raw: r.l.phone, source: "listing" } : googlePhone.ok ? { ...googlePhone, raw: r.g.google!.phone, source: "google" } : null;
          if (v.status !== "no_website" || (cfg.requirePhone && !phone)) {
            const status = v.status === "no_website" ? "no_phone" : v.status;
            if (v.status === "website_exists") c.websiteRejected++;
            else if (v.status === "temporarily_unavailable") c.tempUnavailable++;
            else if (v.status === "unclear") c.unclear++;
            else if (v.status === "closed") c.closed++;
            else c.missingPhone++;
            k.rememberChecked(r.l, r.fp);
            await db.darwinCandidate.upsert({
              where: { userId_fingerprint: { userId: run.userId, fingerprint: r.fp } },
              create: { userId: run.userId, fingerprint: r.fp, placeId: r.l.placeId, name: r.l.name, category: r.l.category, address: r.l.address, status, website: v.website, reasons: v.reasons, runDate: run.date },
              update: { status, website: v.website, reasons: v.reasons, runDate: run.date, checkedAt: deps.now() },
            }).catch(() => {});
            continue;
          }
          // ---- a verified no-website lead
          if (!phone) c.missingPhone++;
          const bucket = categoryBucket(r.l.category);
          const social = r.g.search?.social ?? [];
          const s = scoreLead({
            verdict: "no_website", bucket, phoneOk: !!phone, mobile: !!phone?.mobile, email: !!r.l.email,
            social: social.length + (r.l.instagram ? 1 : 0), distanceM: r.l.distanceM, reviews: r.g.google?.reviews ?? null, rating: r.g.google?.rating ?? null,
          });
          const links = mapLinks(r.l.lat, r.l.lon);
          const today = run.date;
          await db.darwinLead.create({
            data: {
              userId: run.userId, businessName: r.l.name, category: r.l.category, location: r.l.address,
              website: null, phone: phone?.raw ?? null, email: r.l.email, instagram: r.l.instagram ?? social.find((u) => /instagram/i.test(u)) ?? null,
              source: "geoapify", sourceRef: r.l.placeId, sourceUrl: links.osmUrl,
              latitude: r.l.lat, longitude: r.l.lon, lastSeenAt: deps.now(), lastVerifiedAt: deps.now(),
              stage: "new", opportunityType: "no_website", leadScore: s.score,
              verifiedFields: ["businessName", "location", "coordinates", "websiteStatus", ...(phone ? ["phone"] : []), ...(r.l.email ? ["email"] : [])],
              fingerprint: r.fp,
              notes: `DARWIN daily search ${today}: verified no website — ${v.reasons.join(" ")}${s.needs.length > 1 ? ` Could use: ${s.needs.join(", ")}.` : ""}`,
              metadata: {
                dailyRunId: run.id, dailyDate: today, bucket, highPotential: s.highPotential,
                websiteVerification: { status: v.status, reasons: v.reasons, independent: v.independent, checkedAt: deps.now().toISOString() },
                score: s.parts, needs: s.needs, phoneSource: phone?.source ?? null,
                google: r.g.google?.found ? { mapsUri: r.g.google.mapsUri, rating: r.g.google.rating, reviews: r.g.google.reviews } : null,
                social, distanceM: r.l.distanceM, geoapifyCategories: r.l.geoCategories,
                search: { category: combo.cat, location: combo.loc },
                contactStatus: "not_contacted", followUpStatus: "none",
              } as unknown as Prisma.InputJsonValue,
            },
          });
          k.remember(r.l, r.fp);
          c.verified++;
        }
        await persist();
      }
      // anything not verified yet waits in the backlog for the next run (never skipped)
      const left = fresh.slice(processed).map((x) => x.l);
      if (left.length) await db.darwinSearchCursor.update({ where: { id: cur.id }, data: { backlog: left as unknown as Prisma.InputJsonValue } });
      else {
        const after = await db.darwinSearchCursor.findUnique({ where: { id: cur.id }, select: { exhausted: true } });
        if (after?.exhausted && !exhausted.has(combo.key)) { exhausted.add(combo.key); comboIndex++; }
      }
      if (stopReason) break;
      if (fresh.length) say(`${combo.cat} · ${combo.loc}: ${fresh.length} new candidate${fresh.length === 1 ? "" : "s"} checked — ${c.verified}/${cfg.target} verified so far.`);
      await persist();
    }

    // ---- finish, or stay running for the next tick
    const done = c.verified >= cfg.target;
    const outOfScope = stopReason === "scope" || (comboIndex >= combos.length);
    const capped = stopReason === "geo_cap" || stopReason === "paid_cap";
    if (done || outOfScope || capped) {
      const reasons = shortfallReasons(c, cfg, { outOfScope, capped, api, google: deps.google, search: deps.search });
      const status = done ? "completed" : "partial";
      say(done ? `Daily target reached: ${c.verified}/${cfg.target}.` : `Search finished with ${c.verified}/${cfg.target} verified — ${reasons[0] ?? "scope exhausted"}.`, done ? "ok" : "warn");
      await persist({ status, completedAt: deps.now(), reasons, lockedUntil: null });
      const report = await buildReport(run);
      run = await db.darwinDailyRun.update({ where: { id: run.id }, data: { report: report as unknown as Prisma.InputJsonValue } });
      await logActivity(run.userId, "discovered", `DARWIN's daily search found ${report.verified} new verified no-website lead${report.verified === 1 ? "" : "s"} (target ${report.target}).`, undefined, { count: report.verified });
      await recordActivity(run.userId, {
        category: "business", agent: "DARWIN", source: "darwin", project: "DARWIN", importance: 4, status: done ? "success" : "info",
        action: `DARWIN daily report: ${report.verified}/${report.target} verified no-website leads`,
        result: `${report.contactable} contactable · ${report.highPotential} high-potential · ${report.duplicates} duplicates removed · ${report.websiteRejected} with websites rejected`,
      });
    } else {
      await persist({ lastError: stopReason === "rate_limit" ? "Geoapify rate limit — will continue on the next run." : null });
    }
    return run;
  } finally {
    await db.darwinDailyRun.update({ where: { id: runId }, data: { lockedUntil: null } }).catch(() => {});
  }
}

/** Why the target wasn't reached — from the counters only. */
export function shortfallReasons(c: Counters, cfg: DailyConfig, o: { outOfScope: boolean; capped: boolean; api: Api; google: boolean; search: boolean }): string[] {
  if (c.verified >= cfg.target) return [];
  const r: string[] = [];
  if (o.outOfScope) r.push(`Insufficient businesses found — every location × category in the search area (${cfg.locations.join(", ")}) was searched`);
  if (o.capped) r.push("API/search limitations — today's request budget was used up");
  if (c.duplicates) r.push(`${c.duplicates} were already in your DARWIN database`);
  if (c.alreadyChecked) r.push(`${c.alreadyChecked} were checked on earlier days (had websites or were unclear)`);
  if (c.unclear) r.push(`${c.unclear} had an unclear website status${!o.google && !o.search && cfg.strict ? " — no Google Places or web-search key is set, so the absence of a website couldn't be independently confirmed" : ""}`);
  if (c.tempUnavailable) r.push(`${c.tempUnavailable} had websites that were temporarily unavailable`);
  if (c.missingPhone && cfg.requirePhone) r.push(`${c.missingPhone} had no public phone number`);
  if (c.errors) r.push(`${c.errors} verification failure${c.errors === 1 ? "" : "s"}`);
  return r;
}

/** One natural sentence for JARVIS to say — never more than the report holds. */
export function spokenReport(r: DailyReport): string {
  const n = r.verified;
  if (r.status === "completed") {
    return `DARWIN has finished today's lead search. I found ${n} new business${n === 1 ? "" : "es"} without verified websites. ${r.contactable} ${r.contactable === 1 ? "has a" : "have"} publicly available phone number${r.contactable === 1 ? "" : "s"}, and ${r.highPotential} ${r.highPotential === 1 ? "was" : "were"} marked as high-potential lead${r.highPotential === 1 ? "" : "s"}. I've saved them to your CRM.`;
  }
  const short = r.target - n;
  return `DARWIN completed today's search. ${n} new business${n === 1 ? " was" : "es were"} verified as having no website. I could not safely verify another ${short}, so I did not add them.${r.reasons[0] ? ` Main reason: ${r.reasons[0].replace(/ — .*/, "")}.` : ""}${n ? ` ${r.contactable} ${r.contactable === 1 ? "has" : "have"} a public phone number, and ${r.highPotential} ${r.highPotential === 1 ? "is" : "are"} high-potential.` : ""}`;
}

export { BUCKETS, type Bucket };

/* ---------------- read side ---------------- */

export interface DarwinDailyView {
  enabled: boolean;
  timezone: string;
  today: string;
  startLabel: string;
  due: boolean;
  run: null | {
    id: string; date: string; status: string; target: number; verified: number; remaining: number;
    candidates: number; duplicates: number; alreadyChecked: number; websiteRejected: number; unclear: number; tempUnavailable: number; closed: number;
    contactable: number; highPotential: number; reasons: string[]; lastError: string | null;
    log: Log; startedAt: string; completedAt: string | null; reportedAt: string | null;
    leadIds: string[];
  };
  report: DailyReport | null;
  spoken: string | null;
  config: DailyConfig & { source: string };
  sources: { geoapify: boolean; google: boolean; search: boolean };
  /** Automatic outreach: on/off, Gmail connected, sent in the last 24 h, leads waiting for their email. */
  email: AutoEmailState;
  history: { date: string; verified: number; target: number; status: string }[];
}

export async function darwinDailyView(userId: string, now = new Date()): Promise<DarwinDailyView> {
  const db = getDb();
  const clock = dailyNow(now);
  const [run, cfg, hist] = await Promise.all([
    db.darwinDailyRun.findUnique({ where: { userId_date: { userId, date: clock.date } } }),
    loadConfig(userId),
    db.darwinDailyRun.findMany({ where: { userId, date: { not: clock.date } }, orderBy: { date: "desc" }, take: 7, select: { date: true, verified: true, target: true, status: true } }),
  ]);
  const leads = run ? await runLeads(run) : [];
  const report = run?.report ? (run.report as unknown as DailyReport) : null;
  const s = env.darwinDailyStart;
  const [h, m] = s.split(":").map(Number);
  return {
    enabled: env.darwinDaily,
    timezone: env.darwinDailyTz,
    today: clock.date,
    startLabel: `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`,
    due: dailyDue(now),
    run: run ? {
      id: run.id, date: run.date, status: run.status, target: run.target, verified: leads.length, remaining: Math.max(0, run.target - leads.length),
      candidates: run.candidates, duplicates: run.duplicates, alreadyChecked: run.alreadyChecked, websiteRejected: run.websiteRejected,
      unclear: run.unclear, tempUnavailable: run.tempUnavailable, closed: run.closed,
      contactable: leads.filter((l) => l.phone).length,
      highPotential: leads.filter((l) => (l.metadata as { highPotential?: boolean } | null)?.highPotential).length,
      reasons: run.reasons, lastError: run.lastError, log: logOf(run).slice(-14),
      startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null, reportedAt: run.reportedAt?.toISOString() ?? null,
      leadIds: leads.map((l) => l.id),
    } : null,
    report,
    spoken: report ? spokenReport(report) : null,
    config: cfg,
    sources: { geoapify: !!env.geoapifyApiKey, google: googleAvailable(), search: searchAvailable() },
    email: await autoEmailState(userId, cfg.autoEmail),
    history: hist,
  };
}

/**
 * Who gets the autonomous search: anyone using DARWIN — and, when target
 * locations are set in the environment, every account (so the leads are ready
 * even if DARWIN was never opened).
 */
export async function darwinUsers(): Promise<string[]> {
  const db = getDb();
  const [a, b, c, all] = await Promise.all([
    db.darwinLead.findMany({ distinct: ["userId"], select: { userId: true } }),
    db.darwinSearchCursor.findMany({ distinct: ["userId"], select: { userId: true } }),
    db.integration.findMany({ where: { provider: "darwin_daily" }, select: { userId: true } }),
    list(env.darwinDailyLocations).length ? db.user.findMany({ select: { id: true }, take: 50 }) : Promise.resolve([] as { id: string }[]),
  ]);
  return [...new Set([...a, ...b, ...c].map((r) => r.userId).concat(all.map((u) => u.id)))];
}

const progressOf = (r: DarwinDailyRun) => [r.verified, r.candidates, r.alreadyChecked, r.duplicates, r.comboIndex, r.exhaustedCombos.length, r.errors].join(":");

/**
 * The scheduled tick: start today's run once it's due, and push unfinished runs
 * forward. `more` says a run is still searching and this call did real work —
 * the caller should come straight back (the cron chains itself; the local
 * runner loops) so the day's leads are ready without anyone opening DARWIN.
 */
export async function runDarwinDaily(opts: { budgetMs?: number; deps?: DarwinDeps; userIds?: string[]; earlyMin?: number; emailDeps?: AutoEmailDeps } = {}) {
  if (!env.darwinDaily) return { skipped: "DARWIN_DAILY is off", results: [], more: false };
  const deps = opts.deps ?? defaultDeps();
  const now = deps.now();
  const users = opts.userIds ?? await darwinUsers();
  const per = Math.max(30_000, Math.floor((opts.budgetMs ?? 240_000) / Math.max(users.length, 1)));
  const results: { userId: string; status: string; verified: number; emailed?: number; emailWaiting?: number; emailNote?: string | null }[] = [];
  let more = false;
  const clock = opts.emailDeps?.now ?? (() => new Date());
  for (const userId of users) {
    const userStart = clock().getTime();
    let run = await todayRun(userId, now);
    // set up since the run was created (locations saved, Geoapify key added) → start it properly
    if (run?.status === "needs_setup" && canRun(await loadConfig(userId))) {
      await getDb().darwinDailyRun.delete({ where: { id: run.id } }).catch(() => {});
      run = null;
    }
    if (!run && dailyDue(now, opts.earlyMin ?? 0)) run = await ensureRun(userId, now);
    if (run?.status === "running") {
      const stats: { worked?: boolean } = {};
      const before = progressOf(run);
      run = await advanceRun(run.id, { budgetMs: per, deps, stats });
      // come back only when this call really moved the search on (never spin on a stuck one)
      if (run.status === "running" && stats.worked && progressOf(run) !== before) more = true;
    }
    // then email the new leads (and any earlier ones not yet written to) with the time left
    let mail: AutoEmailResult | null = null;
    if ((await loadConfig(userId)).autoEmail) {
      mail = await sendAutoEmails(userId, { until: userStart + per - 5_000, deps: opts.emailDeps });
      if (mail.sent > 0 && mail.waiting > 0 && !mail.stopped) more = true;
    }
    if (!run && !mail?.sent) continue;
    results.push({
      userId, status: run?.status ?? "not_started", verified: run?.verified ?? 0,
      ...(mail ? { emailed: mail.sent, emailWaiting: mail.waiting, emailNote: mail.stopped } : {}),
    });
  }
  return { date: dailyNow(now).date, results, more };
}
