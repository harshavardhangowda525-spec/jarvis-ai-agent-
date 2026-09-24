import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import {
  GeoapifyError, categoryPlan, discoveryFingerprint, geocode, mapFeature, matchesPlan, searchPlaces, mapLinks,
  type GeoCenter, type GeoLead,
} from "./geoapify";
import { leadFingerprint } from "./dedup";
import { logActivity } from "./store";
import { LEAD_SELECT, toLeadDTO } from "./lead-dto";
import type { FindLeadsResult, LeadFilter } from "./types";

/**
 * DARWIN's "FIND NEW LEADS" engine.
 *
 * - Real Geoapify results only; a business is never shown twice: every lead's
 *   fingerprint (name + address + phone + coordinates) and Geoapify place id are
 *   stored permanently and checked before anything is shown.
 * - A persistent cursor per (category, location, filter, radius) remembers how
 *   far the search got, so "find more" continues instead of restarting. Within a
 *   radius it pages with Geoapify's offset; when a radius is exhausted it widens
 *   the circle. Qualifying leads beyond the requested count go into a backlog
 *   and are returned first next time.
 * - Hard stop after MAX_REQUESTS calls per click, on a rate limit, or when the
 *   area is exhausted — it never loops or pretends there are more.
 */

export const PAGE_SIZE = 50;
export const MAX_REQUESTS = 8;
const MAX_RADIUS_M = 50_000;
const BACKLOG_MAX = 200;
const RADIUS_OVERLAP = 10;

export interface FindParams {
  userId: string;
  category: string;
  location: string;
  limit: number;
  filter: LeadFilter;
  radiusKm?: number;
}

/** Widening search circles: r, 2r, 4r, 8r (capped). */
export function radiusSchedule(baseM: number): number[] {
  const out: number[] = [];
  for (let r = baseM; out.length < 4; r *= 2) {
    const v = Math.min(r, MAX_RADIUS_M);
    if (!out.includes(v)) out.push(v);
    if (v === MAX_RADIUS_M) break;
  }
  return out;
}

export function passesFilter(l: Pick<GeoLead, "phone" | "website">, filter: LeadFilter): boolean {
  switch (filter) {
    case "no_website": return !l.website;
    case "has_website": return !!l.website;
    case "phone": return !!l.phone;
    case "no_phone": return !l.phone;
    default: return true;
  }
}

/** Phone numbers first (sales outreach), then nearest. */
const byPriority = (a: GeoLead, b: GeoLead) =>
  Number(!!b.phone) - Number(!!a.phone) || (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity);

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function findNewLeads(p: FindParams): Promise<FindLeadsResult> {
  const key = env.geoapifyApiKey;
  if (!key) throw new GeoapifyError("Geoapify API key is not configured.", "no_key");
  const db = getDb();
  const limit = Math.min(Math.max(Math.round(p.limit) || 20, 1), 50);
  const baseRadiusM = Math.min(Math.max(Math.round((p.radiusKm ?? 5) * 1000), 500), MAX_RADIUS_M);
  const plan = categoryPlan(p.category);
  const queryKey = createHash("sha256")
    .update(`${norm(p.category)}|${norm(p.location)}|${p.filter}|${baseRadiusM}`).digest("hex").slice(0, 40);

  // ---- where this search left off ----------------------------------------
  let cursor = await db.darwinSearchCursor.findUnique({ where: { userId_queryKey: { userId: p.userId, queryKey } } });
  let center: GeoCenter;
  let geocodeRequests = 0;
  if (cursor?.centerLat != null && cursor.centerLon != null) {
    center = { lat: cursor.centerLat, lon: cursor.centerLon, label: cursor.placeLabel ?? p.location };
  } else {
    center = await geocode(p.location, key);
    geocodeRequests = 1;
  }
  if (!cursor) {
    cursor = await db.darwinSearchCursor.create({
      data: {
        userId: p.userId, queryKey, category: p.category.trim(), location: p.location.trim(), filter: p.filter,
        centerLat: center.lat, centerLon: center.lon, placeLabel: center.label, baseRadiusM,
      },
    });
  }

  // ---- everything DARWIN has ever discovered for this user -----------------
  const history = await db.darwinLead.findMany({ where: { userId: p.userId }, select: { fingerprint: true, sourceRef: true } });
  const knownFp = new Set(history.map((h) => h.fingerprint));
  const knownRef = new Set(history.map((h) => h.sourceRef).filter((x): x is string => !!x));
  const inHistory = (l: GeoLead, fp: string) =>
    knownFp.has(fp) || knownFp.has(legacyFp(l)) || (!!l.placeId && knownRef.has(l.placeId));

  // Keys already handled in THIS run (picked or backlogged) — so a widened circle
  // doesn't return the same place twice, and it isn't miscounted as "skipped".
  const thisRun = new Set<string>();
  const seenThisRun = (l: GeoLead, fp: string) => thisRun.has(fp) || (!!l.placeId && thisRun.has(l.placeId));
  const markRun = (l: GeoLead, fp: string) => { thisRun.add(fp); if (l.placeId) thisRun.add(l.placeId); };

  const picked: GeoLead[] = [];
  const backlog: GeoLead[] = [];
  const seenAgainRefs = new Set<string>();
  const seenAgainFps = new Set<string>();
  let skippedDuplicates = 0;
  let filteredOut = 0;

  // 1) qualifying leads found last time but not shown yet
  for (const b of ((cursor.backlog as unknown as GeoLead[]) ?? [])) {
    const fp = discoveryFingerprint(b);
    if (inHistory(b, fp) || !passesFilter(b, p.filter) || seenThisRun(b, fp)) continue;
    markRun(b, fp);
    (picked.length < limit ? picked : backlog).push(b);
  }

  // 2) page through Geoapify until we have enough NEW leads
  const radii = radiusSchedule(cursor.baseRadiusM || baseRadiusM);
  let radiusStep = Math.min(cursor.radiusStep, radii.length);
  let offset = cursor.offset;
  let exhausted = cursor.exhausted || radiusStep >= radii.length;
  let requests = 0;
  let stoppedReason: FindLeadsResult["stoppedReason"] | null = null;
  let rateLimitMessage = "";

  while (picked.length < limit && !exhausted) {
    if (requests >= MAX_REQUESTS) { stoppedReason = "request_cap"; break; }
    let features: any[];
    try {
      ({ features } = await searchPlaces({ center, radiusM: radii[radiusStep], plan, limit: PAGE_SIZE, offset, key }));
      requests++;
    } catch (e) {
      if (e instanceof GeoapifyError && e.kind === "rate_limit") { stoppedReason = "rate_limit"; rateLimitMessage = e.message; break; }
      throw e;
    }

    const fresh: GeoLead[] = [];
    for (const f of features) {
      const l = mapFeature(f, center, plan);
      if (!l || !matchesPlan(l, plan)) { filteredOut++; continue; }
      const fp = discoveryFingerprint(l);
      if (seenThisRun(l, fp)) continue;
      if (inHistory(l, fp)) {
        markRun(l, fp);
        skippedDuplicates++;
        if (l.placeId) seenAgainRefs.add(l.placeId); else seenAgainFps.add(fp);
        continue;
      }
      if (!passesFilter(l, p.filter)) { filteredOut++; continue; }
      markRun(l, fp);
      fresh.push(l);
    }
    fresh.sort(byPriority);
    for (const l of fresh) (picked.length < limit ? picked : backlog).push(l);

    // advance the cursor: next page, or a wider circle when this one ran out
    if (features.length < PAGE_SIZE) {
      // Results are proximity-sorted, so the wider circle starts with the places
      // already covered — skip past them (keeping a small overlap for ties).
      const covered = offset + features.length;
      radiusStep += 1;
      offset = Math.max(0, covered - RADIUS_OVERLAP);
      if (radiusStep >= radii.length) exhausted = true;
    } else {
      offset += PAGE_SIZE;
    }
  }
  if (!stoppedReason) stoppedReason = picked.length >= limit ? "limit" : "exhausted";
  picked.sort(byPriority);

  // ---- persist: new leads, cursor, "seen again" timestamps -----------------
  const now = new Date();
  const created = picked.length
    ? await db.$transaction(picked.map((l) => {
      const links = mapLinks(l.lat, l.lon);
      return db.darwinLead.create({
        data: {
          userId: p.userId,
          businessName: l.name,
          category: l.category,
          location: l.address,
          website: l.website,
          phone: l.phone,
          email: l.email,
          instagram: l.instagram,
          source: "geoapify",
          sourceRef: l.placeId,
          sourceUrl: links.osmUrl,
          latitude: l.lat,
          longitude: l.lon,
          lastSeenAt: now,
          lastVerifiedAt: now,
          verifiedFields: ["businessName", "location", "coordinates", ...(l.phone ? ["phone"] : []), ...(l.website ? ["website"] : []), ...(l.email ? ["email"] : [])],
          fingerprint: discoveryFingerprint(l),
          opportunityType: l.website ? null : "no_website",
          metadata: {
            distanceM: l.distanceM,
            geoapifyCategories: l.geoCategories,
            search: { category: p.category, location: p.location, filter: p.filter },
          },
        },
        select: LEAD_SELECT,
      });
    }))
    : [];

  await db.darwinSearchCursor.update({
    where: { id: cursor.id },
    data: {
      radiusStep, offset, exhausted,
      backlog: backlog.slice(0, BACKLOG_MAX) as unknown as object,
      totalNew: { increment: created.length },
    },
  });
  if (seenAgainRefs.size || seenAgainFps.size) {
    await db.darwinLead.updateMany({
      where: { userId: p.userId, OR: [{ sourceRef: { in: [...seenAgainRefs] } }, { fingerprint: { in: [...seenAgainFps] } }] },
      data: { lastSeenAt: now },
    }).catch(() => {});
  }
  if (created.length) {
    await logActivity(p.userId, "discovered", `Discovered ${created.length} new ${plan.label.toLowerCase()} lead${created.length === 1 ? "" : "s"} near ${center.label} via Geoapify.`, undefined, { count: created.length, category: p.category, location: p.location });
  }

  const radiusKm = Math.round(radii[Math.min(radiusStep, radii.length - 1)] / 100) / 10;
  return {
    leads: created.map(toLeadDTO),
    newCount: created.length,
    skippedDuplicates,
    filteredOut,
    exhausted,
    stoppedReason,
    requests: requests + geocodeRequests,
    radiusKm,
    center,
    message: resultMessage({ newCount: created.length, skippedDuplicates, stoppedReason, limit, rateLimitMessage }),
  };
}

/** Honest summary — never implies more leads exist than were found. */
export function resultMessage(r: { newCount: number; skippedDuplicates: number; stoppedReason: FindLeadsResult["stoppedReason"]; limit: number; rateLimitMessage?: string }): string {
  const skipped = r.skippedDuplicates ? ` · ${r.skippedDuplicates} previously discovered lead${r.skippedDuplicates === 1 ? "" : "s"} skipped` : "";
  const found = `Found ${r.newCount} new lead${r.newCount === 1 ? "" : "s"}${skipped}.`;
  switch (r.stoppedReason) {
    case "limit": return found;
    case "rate_limit": return `${r.newCount ? found + " " : ""}${r.rateLimitMessage}`;
    case "request_cap":
      return r.newCount
        ? `${found} DARWIN paused after ${MAX_REQUESTS} Geoapify requests to respect API limits — click FIND NEW LEADS again to keep searching further out.`
        : `No new qualifying leads in this batch${skipped}. DARWIN paused after ${MAX_REQUESTS} Geoapify requests — click FIND NEW LEADS again to search further out.`;
    default:
      return r.newCount
        ? `${found} No additional unseen qualifying businesses were returned.`
        : `No new qualifying leads found for this search${skipped}.`;
  }
}

/** Fingerprint used by DARWIN's older discovery code (so old leads still count as known). */
function legacyFp(l: GeoLead): string {
  return leadFingerprint({ businessName: l.name, website: l.website, phone: l.phone, location: l.address, sourceRef: l.placeId });
}
