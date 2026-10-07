import "server-only";
import { createHash } from "node:crypto";
import type { DarwinDailyRun, DarwinIgRun, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { recordActivity } from "@/lib/activity/record";
import { areaCenter } from "@/lib/darwin/bangalore";
import { categoryPlan, discoveryFingerprint, haversineM, mapFeature, matchesPlan, GeoapifyError, type GeoCenter, type GeoLead } from "@/lib/darwin/geoapify";
import { SearchPool, configuredProviders, type Provider, type ProviderId } from "@/lib/darwin/web-search";
import { classifyWebsite, isSocialUrl, nameTokens, verifyPhone } from "@/lib/darwin/daily/verify";
import { dailyNow, defaultDeps as primaryDeps, searchShares, PAGE, type DarwinDeps } from "@/lib/darwin/daily/run";
import { handleNamesBusiness, igHandle, scoreIgLead, verifyInstagram, type IgProfile, type IgResult } from "./verify";

/**
 * DARWIN's secondary daily task — "Instagram + No Website Leads".
 *
 * It starts only after that day's main lead search is marked COMPLETE and
 * never touches it: its own run, its own list (DarwinIgLead), its own record
 * of what it checked. It looks at real businesses (map listings) in the kinds
 * of business that live on Instagram, and keeps one only when BOTH hold:
 *   Instagram = VERIFIED (exists, carries the name, tied to this business)
 *   Website   = NO OFFICIAL WEBSITE FOUND (the same checks as the main search,
 *               with an independent web search confirming the absence).
 * Anything it can't confirm is left out and counted as "unverified".
 */

/** The kinds of business this task looks at (strong Instagram users that gain from a website). */
export const IG_NICHES = [
  "cafes", "restaurants", "gyms", "salons", "spas", "clothing stores", "clinics", "coaching centers", "yoga studios",
  "hotels", "bakeries", "real estate agencies", "photographers", "event planners", "beauty parlours", "jewellery stores",
];
const IG_GEO_CAP = 80;            // map requests per day for this task (Geoapify's free plan: 3,000/day)
const IG_AREAS = 12;              // areas (from today's main search) this task works through
const BATCH = 3;
type Log = { at: string; text: string; tone?: "ok" | "warn" }[];
type Api = { geoapify: number; search: number; searchBy?: Partial<Record<ProviderId, number>>; searchDown?: ProviderId[] };

export interface IgDeps {
  now: () => Date;
  geocode: DarwinDeps["geocode"];
  page: DarwinDeps["page"];
  gather: DarwinDeps["gather"];
  /** What instagram.com itself says about a handle (null when it won't say — login wall, rate limit). */
  profile: (handle: string) => Promise<IgProfile | null>;
  searchProviders?: Provider[];
}

/** Instagram's public profile page: 404 = no such account; 200 = its own title/description. */
export async function fetchIgProfile(handle: string): Promise<IgProfile | null> {
  try {
    const res = await fetch(`https://www.instagram.com/${encodeURIComponent(handle)}/`, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", Accept: "text/html", "Accept-Language": "en" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return { status: 404, title: "", description: "" };
    if (res.status !== 200) { await res.body?.cancel().catch(() => {}); return null; }
    const html = (await res.text()).slice(0, 400_000);
    const meta = (p: string) => html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ?? "";
    const decode = (s: string) => s.replace(/&#064;/g, "@").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
    const title = decode(meta("title")), description = decode(meta("description"));
    return title || description ? { status: 200, title, description } : null;
  } catch { return null; }
}

export function defaultIgDeps(): IgDeps {
  const d = primaryDeps();
  return { now: d.now, geocode: d.geocode, page: d.page, gather: d.gather, profile: fetchIgProfile };
}

const logOf = (r: { log: unknown }): Log => (Array.isArray(r.log) ? (r.log as Log) : []);
const normName = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const tail10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);

/** Today's task for this user, if any. */
export function todayIgRun(userId: string, now = new Date()) {
  return getDb().darwinIgRun.findUnique({ where: { userId_date: { userId, date: dailyNow(now).date } } });
}

/**
 * Start (or return) today's task — only once today's main search is COMPLETE.
 * Returns null while the main search isn't complete (it never waits on, or for, this task).
 */
export async function ensureIgRun(primary: DarwinDailyRun, now = new Date()): Promise<DarwinIgRun | null> {
  if (primary.status !== "completed") return null;
  const db = getDb();
  const existing = await db.darwinIgRun.findUnique({ where: { userId_date: { userId: primary.userId, date: primary.date } } });
  if (existing) return existing;
  return db.darwinIgRun.upsert({
    where: { userId_date: { userId: primary.userId, date: primary.date } },
    update: {},
    create: {
      userId: primary.userId, date: primary.date, primaryRunId: primary.id, target: env.darwinIgTarget, status: "running",
      log: [{ at: now.toISOString(), text: `Today's main search is complete (${primary.verified}/${primary.target}) — starting "Instagram + No Website Leads".` }] as unknown as Prisma.InputJsonValue,
    },
  });
}

async function lease(id: string, now: Date, ms: number) {
  const r = await getDb().darwinIgRun.updateMany({ where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(now.getTime() + ms) } });
  return r.count === 1;
}

/** Everything DARWIN already has (both lists) — so nothing is repeated. */
async function knowledge(userId: string) {
  const db = getDb();
  const [leads, igLeads, checks, known] = await Promise.all([
    db.darwinLead.findMany({ where: { userId }, select: { fingerprint: true, sourceRef: true, phone: true, businessName: true, latitude: true, longitude: true } }),
    db.darwinIgLead.findMany({ where: { userId }, select: { fingerprint: true, placeId: true, phone: true, businessName: true, latitude: true, longitude: true, instagramUsername: true } }),
    db.darwinIgCheck.findMany({ where: { userId }, select: { fingerprint: true, placeId: true } }),
    // businesses the main search already found WITH a website — no point checking them here
    db.darwinCandidate.findMany({ where: { userId, status: { in: ["website_exists", "closed"] } }, select: { fingerprint: true, placeId: true } }),
  ]);
  const fps = new Set([...leads.map((l) => l.fingerprint), ...igLeads.map((l) => l.fingerprint)]);
  const refs = new Set([...leads.map((l) => l.sourceRef), ...igLeads.map((l) => l.placeId)].filter(Boolean) as string[]);
  const phones = new Set([...leads, ...igLeads].map((l) => tail10(l.phone)).filter((p) => p.length === 10));
  const named = [...leads, ...igLeads].filter((l) => l.latitude != null && l.longitude != null).map((l) => ({ n: normName(l.businessName), lat: l.latitude!, lon: l.longitude! }));
  const handles = new Set(igLeads.map((l) => l.instagramUsername));
  const seen = new Set([...checks, ...known].flatMap((c) => [c.fingerprint, c.placeId ?? ""]).filter(Boolean));
  return {
    isLead(l: GeoLead, fp: string) {
      if (fps.has(fp) || (l.placeId && refs.has(l.placeId))) return true;
      const ph = tail10(l.phone);
      if (ph.length === 10 && phones.has(ph)) return true;
      const n = normName(l.name);
      return named.some((x) => x.n === n && haversineM(x, l) <= 150);
    },
    seen(l: GeoLead, fp: string) { return seen.has(fp) || (!!l.placeId && seen.has(l.placeId)); },
    handleTaken(h: string) { return handles.has(h); },
    remember(l: GeoLead, fp: string, handle?: string) {
      seen.add(fp); if (l.placeId) seen.add(l.placeId);
      if (handle) { handles.add(handle); fps.add(fp); const ph = tail10(l.phone); if (ph.length === 10) phones.add(ph); named.push({ n: normName(l.name), lat: l.lat, lon: l.lon }); }
    },
  };
}

/** Advance today's task within the time budget (one caller at a time). */
export async function advanceIgRun(runId: string, opts: { budgetMs?: number; deps?: IgDeps } = {}): Promise<DarwinIgRun> {
  const deps = opts.deps ?? defaultIgDeps();
  const budget = opts.budgetMs ?? 120_000;
  const db = getDb();
  const t0 = deps.now().getTime();
  if (!(await lease(runId, deps.now(), budget + 60_000))) return db.darwinIgRun.findUniqueOrThrow({ where: { id: runId } });
  try {
    let run = await db.darwinIgRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status !== "running") return run;
    const primary = await db.darwinDailyRun.findUnique({ where: { userId_date: { userId: run.userId, date: run.date } } });
    // the main search re-opened (say, "search again") — it goes first; this waits
    if (!primary || primary.status !== "completed") return run;
    const cfg = primary.config as unknown as { locations?: string[]; allBangalore?: boolean };
    const areas = (cfg.locations ?? []).slice(0, IG_AREAS);
    const combos = areas.flatMap((loc) => IG_NICHES.map((cat) => ({ loc, cat, key: `${loc.toLowerCase()}|${cat}` })));
    const log = logOf(run);
    const say = (text: string, tone?: "ok" | "warn") => log.push({ at: deps.now().toISOString(), text: text.slice(0, 300), ...(tone ? { tone } : {}) });
    const c = { found: run.found, igVerified: run.igVerified, noWebsite: run.noWebsite, saved: run.saved, contactable: run.contactable, highPotential: run.highPotential, duplicates: run.duplicates, unverified: run.unverified, noInstagram: run.noInstagram, websiteFound: run.websiteFound };
    const api: Api = { geoapify: 0, search: 0, ...((run.apiRequests as Api | null) ?? {}) };
    const exhausted = new Set(run.exhausted);
    let comboIndex = run.comboIndex;

    // web searches: what's left of TODAY's share after the main search (SearXNG has no limit)
    const providers = deps.searchProviders ?? configuredProviders();
    const pApi = (primary.apiRequests ?? {}) as Api;
    const usedToday: Partial<Record<ProviderId, number>> = { ...(pApi.searchBy ?? {}) };
    for (const [k, v] of Object.entries(api.searchBy ?? {})) usedToday[k as ProviderId] = (usedToday[k as ProviderId] ?? 0) + (v ?? 0);
    const outToday = new Set<ProviderId>([...(pApi.searchDown ?? []), ...(api.searchDown ?? [])]);
    const shares = providers.length ? await searchShares(run.userId, run.date, providers, usedToday) : {};
    const pool = new SearchPool(providers.filter((p) => !outToday.has(p.id)), shares, (o) => say(`${o.message} — trying the next web search.`, "warn"));
    const searchByStart = { ...(api.searchBy ?? {}) };
    const persist = async (extra: Prisma.DarwinIgRunUpdateInput = {}) => {
      const by = { ...searchByStart };
      for (const [k, v] of Object.entries(pool.used)) by[k as ProviderId] = (by[k as ProviderId] ?? 0) + (v ?? 0);
      api.searchBy = by;
      api.search = Object.values(by).reduce((s, v) => s + (v ?? 0), 0);
      const hard = [...pool.down.entries()].filter(([, o]) => o.kind === "credits" || o.kind === "auth").map(([k]) => k);
      api.searchDown = [...new Set([...(api.searchDown ?? []), ...hard])];
      run = await db.darwinIgRun.update({ where: { id: run.id }, data: { ...c, comboIndex, exhausted: [...exhausted], apiRequests: api as unknown as Prisma.InputJsonValue, log: log.slice(-80) as unknown as Prisma.InputJsonValue, ...extra } });
    };
    if (!providers.length) {
      await persist({ status: "needs_setup", lastError: "Verifying Instagram needs a web search — connect SearXNG (npm run searxng) or set BRAVE_SEARCH_API_KEY, SERPER_API_KEY or SEARCH_API_KEY." });
      return run;
    }
    if (!areas.length) { say("Today's main search had no areas to work from.", "warn"); await persist({ status: "completed", completedAt: deps.now(), reasons: ["No areas to search."] }); return run; }

    const k = await knowledge(run.userId);
    let stop: string | null = null;
    const record = (l: GeoLead, fp: string, status: string, reasons: string[]) =>
      db.darwinIgCheck.upsert({
        where: { userId_fingerprint: { userId: run.userId, fingerprint: fp } },
        create: { userId: run.userId, fingerprint: fp, placeId: l.placeId, name: l.name, status, reasons: reasons.slice(0, 8) },
        update: { status, reasons: reasons.slice(0, 8), checkedAt: deps.now() },
      }).catch(() => {});

    while (c.saved < run.target && deps.now().getTime() - t0 < budget - 8_000) {
      if (comboIndex >= combos.length) { stop = "scope"; break; }
      const combo = combos[comboIndex];
      if (exhausted.has(combo.key)) { comboIndex++; continue; }
      if (api.geoapify >= IG_GEO_CAP) { stop = "geo_cap"; break; }

      // ---- this task's own place in each area × kind of business (kept across days)
      const queryKey = `ig:${createHash("sha256").update(combo.key).digest("hex").slice(0, 24)}`;
      let cur = await db.darwinSearchCursor.findUnique({ where: { userId_queryKey: { userId: run.userId, queryKey } } });
      if (!cur) {
        let center = cfg.allBangalore ? areaCenter(combo.loc) : null;
        if (!center) {
          try { center = await deps.geocode(combo.loc); api.geoapify++; }
          catch (e) {
            if (e instanceof GeoapifyError && ["rate_limit", "auth", "network"].includes(e.kind)) { stop = "geo"; say(e.message, "warn"); break; }
            exhausted.add(combo.key); comboIndex++; continue;
          }
        }
        cur = await db.darwinSearchCursor.create({ data: { userId: run.userId, queryKey, category: combo.cat, location: combo.loc, filter: "instagram", centerLat: center.lat, centerLon: center.lon, placeLabel: center.label, baseRadiusM: 3000 } });
      }
      if (cur.exhausted) { exhausted.add(combo.key); comboIndex++; continue; }
      const center: GeoCenter = { lat: cur.centerLat!, lon: cur.centerLon!, label: cur.placeLabel ?? combo.loc };
      let features: unknown[];
      try { features = await deps.page({ center, radiusM: cur.baseRadiusM, category: combo.cat, offset: cur.offset }); api.geoapify++; }
      catch (e) {
        if (e instanceof GeoapifyError && ["rate_limit", "auth", "network"].includes(e.kind)) { stop = "geo"; say(e.message, "warn"); break; }
        exhausted.add(combo.key); comboIndex++; continue;
      }
      const last = features.length < PAGE;
      await db.darwinSearchCursor.update({ where: { id: cur.id }, data: { offset: cur.offset + features.length, exhausted: last } });
      if (last) { exhausted.add(combo.key); comboIndex++; }

      const plan = categoryPlan(combo.cat);
      const fresh: { l: GeoLead; fp: string }[] = [];
      for (const f of features) {
        const l = mapFeature(f, center, plan);
        if (!l || !matchesPlan(l, plan) || !nameTokens(l.name).length) continue; // a name only of generic words can't be matched to an account
        const fp = discoveryFingerprint(l);
        if (k.seen(l, fp) || fresh.some((x) => x.fp === fp)) continue;
        if (k.isLead(l, fp)) { c.duplicates++; k.remember(l, fp); continue; }
        fresh.push({ l, fp });
      }
      c.found += fresh.length;

      // ---- check each business: Instagram first (most have none), then the website
      for (let i = 0; i < fresh.length && c.saved < run.target; i += BATCH) {
        if (deps.now().getTime() - t0 > budget - 8_000) { stop = "time"; break; }
        if (pool.capacity() < 1) { stop = "search_share"; break; }
        const batch = fresh.slice(i, i + BATCH);
        const out = await Promise.all(batch.map(async ({ l, fp }) => {
          const locality = center.label.split(",").slice(0, 2).join(",");
          // a listing whose "website" is its Instagram page has an Instagram, not a website
          const listedIg = l.instagram ?? (l.website && /instagram\.com/i.test(l.website) ? l.website : null);
          const website = l.website && isSocialUrl(l.website) ? null : l.website;
          const ans = await pool.search(`"${l.name}" ${locality} instagram`);
          if (!ans.ok) return { l, fp, outage: ans.outage.message };
          const results: IgResult[] = ans.results;
          const handles = [...new Set([igHandle(listedIg), ...results.map((r) => igHandle(r.url))].filter(Boolean) as string[])].slice(0, 2);
          const profiles: Record<string, IgProfile | null> = {};
          for (const h of handles) profiles[h] = await deps.profile(h).catch(() => null);
          const ig = verifyInstagram({ name: l.name, locality: `${locality} ${l.address ?? ""}`, phone: l.phone, listingInstagram: listedIg, results, profiles });
          if (ig.status !== "verified") return { l, fp, ig };
          const g = await deps.gather({ name: l.name, address: l.address, lat: l.lat, lon: l.lon, website, phone: l.phone, email: l.email, locality }, { google: false, search: true, searcher: pool });
          if (g.outage?.length) return { l, fp, outage: g.outage.map((o) => o.message).join("; ") };
          return { l, fp, ig, g, verdict: classifyWebsite(g.signals, { strict: true }) };
        }));
        const outage = out.find((r) => "outage" in r && r.outage);
        if (outage && "outage" in outage) { stop = "search_down"; say(`${outage.outage} — paused; this batch is checked again on the next run.`, "warn"); break; }
        for (const r of out) {
          if (!("ig" in r) || !r.ig) continue;
          const { l, fp, ig } = r;
          if (ig.status !== "verified") {
            if (ig.handle) { c.unverified++; await record(l, fp, "instagram_unverified", [ig.reason ?? "Instagram not verified"]); }
            else { c.noInstagram++; await record(l, fp, "no_instagram", [ig.reason ?? "No Instagram account found"]); }
            k.remember(l, fp);
            continue;
          }
          c.igVerified++;
          if (k.handleTaken(ig.handle!)) { c.duplicates++; k.remember(l, fp); await record(l, fp, "duplicate", [`@${ig.handle} is already on the list.`]); continue; }
          const v = "verdict" in r ? r.verdict : null;
          if (!v || v.status === "unclear" || v.status === "closed") { c.unverified++; await record(l, fp, "website_unclear", v?.reasons ?? ["Website check incomplete"]); k.remember(l, fp); continue; }
          if (v.status !== "no_website") { c.websiteFound++; await record(l, fp, "website_found", v.reasons); k.remember(l, fp); continue; }
          c.noWebsite++;
          // ---- a verified "Instagram + No Website" lead
          const g = "g" in r ? r.g : null;
          const phone = verifyPhone(l.phone).ok ? l.phone : g?.phoneFound?.phone ?? null;
          const ph = verifyPhone(phone);
          const s = scoreIgLead({ followers: ig.followers, posts: ig.posts, phoneOk: ph.ok, mobile: ph.mobile, category: l.category, fromListing: ig.evidence.some((e) => /map listing/.test(e)), byHandle: handleNamesBusiness(ig.handle!, l.name), rating: g?.google?.rating ?? null, reviews: g?.google?.reviews ?? null });
          try {
            await db.darwinIgLead.create({
              data: {
                userId: run.userId, runId: run.id, fingerprint: fp, placeId: l.placeId, businessName: l.name, category: l.category, location: l.address, latitude: l.lat, longitude: l.lon,
                phone: ph.ok ? phone : null, instagramUsername: ig.handle!, instagramUrl: ig.url!, instagramEvidence: ig.evidence, followers: ig.followers, posts: ig.posts,
                instagramActivity: s.activity, websiteReasons: v.reasons, qualityScore: s.score, highPotential: s.highPotential, scoreParts: s.parts as unknown as Prisma.InputJsonValue,
                source: `Map listing (OpenStreetMap via Geoapify) · Instagram (${ig.evidence.some((e) => /serves the profile/.test(e)) ? "instagram.com" : "search index"}) · web search (${[...new Set(Object.keys(pool.used))].join(", ") || "web"})`,
                foundDate: run.date,
              },
            });
          } catch { c.duplicates++; k.remember(l, fp); continue; } // a race / same account under another listing
          await record(l, fp, "lead", [`@${ig.handle}`]);
          k.remember(l, fp, ig.handle!);
          c.saved++; if (ph.ok) c.contactable++; if (s.highPotential) c.highPotential++;
          say(`${l.name} — @${ig.handle} verified, no website${ph.ok ? "" : " (no public phone)"} · score ${s.score}.`, "ok");
        }
        if (stop) break;
      }
      await persist();
      if (stop) break;
    }

    // ---- finish, or carry on next run
    const done = c.saved >= run.target || stop === "scope" || stop === "geo_cap";
    if (done) {
      const reasons = [
        c.saved >= run.target ? `Reached today's ${run.target} Instagram + No Website leads.` : stop === "scope" ? `Looked through every area × kind of business for today — ${c.saved} found.` : `Used today's map searches for this task — ${c.saved} found.`,
      ];
      say(`"Instagram + No Website Leads" complete: ${c.saved} verified lead${c.saved === 1 ? "" : "s"} (${c.contactable} contactable, ${c.highPotential} high-potential).`, "ok");
      await persist({ status: "completed", completedAt: deps.now(), reasons, lastError: null, lockedUntil: null });
      await recordActivity(run.userId, {
        category: "business", agent: "DARWIN", source: "darwin", importance: 3, status: "success",
        action: `DARWIN "Instagram + No Website": ${c.saved} verified lead${c.saved === 1 ? "" : "s"}`,
        result: `${c.found} businesses looked at · ${c.igVerified} Instagram verified · ${c.noWebsite} no website verified · ${c.unverified} unverified left out · ${c.duplicates} duplicates removed`,
      }).catch(() => {});
    } else {
      await persist({
        lastError: stop === "search_share" ? "Today's share of the paid web searches is used — set up SearXNG (unlimited) to keep going today."
          : stop === "search_down" || stop === "geo" ? "A search service is unavailable — paused, carrying on next run." : null,
      });
    }
    return run;
  } finally {
    await db.darwinIgRun.update({ where: { id: runId }, data: { lockedUntil: null } }).catch(() => {});
  }
}

/** A finished day's task stays as it ended; an unfinished one closes when its day ends. */
export async function closeStaleIgRuns(userId: string, now = new Date()) {
  const today = dailyNow(now).date;
  await getDb().darwinIgRun.updateMany({ where: { userId, status: "running", date: { lt: today } }, data: { status: "partial", completedAt: now, reasons: ["The day ended before the task finished."] } });
}

export interface IgSummary {
  businessesFound: number; instagramVerified: number; noWebsiteVerified: number; contactable: number; highPotential: number; duplicatesRemoved: number; unverifiedExcluded: number;
  saved: number; noInstagram: number; websiteFound: number;
}
export const igSummary = (r: DarwinIgRun): IgSummary => ({
  businessesFound: r.found, instagramVerified: r.igVerified, noWebsiteVerified: r.noWebsite, contactable: r.contactable, highPotential: r.highPotential,
  duplicatesRemoved: r.duplicates, unverifiedExcluded: r.unverified, saved: r.saved, noInstagram: r.noInstagram, websiteFound: r.websiteFound,
});
