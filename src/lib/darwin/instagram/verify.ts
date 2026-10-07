/**
 * DARWIN "Instagram + No Website" — the Instagram rules. PURE (no network):
 * the runner gathers the evidence, this decides. A business's Instagram counts
 * as VERIFIED only when all three hold:
 *   1. the account exists (Instagram served the profile, or a search engine
 *      indexed Instagram's own profile page for it — "Name (@handle)");
 *   2. it's this business's account (the handle or the profile name carries
 *      the business's distinctive name);
 *   3. it's tied to THIS business, not a namesake elsewhere (the map listing
 *      itself links it, or the profile/search text names its area or phone).
 * Anything less is NOT VERIFIED — the lead is left out rather than guessed.
 */
import { nameTokens, textNamesBusiness } from "@/lib/darwin/daily/verify";

export type IgStatus = "verified" | "not_verified";
export interface IgResult { url: string; title: string; content: string }
/** What instagram.com itself said about a profile (null = not fetched / blocked). */
export interface IgProfile { status: number; title: string; description: string }

export interface IgCheck {
  status: IgStatus;
  handle: string | null;
  url: string | null;
  evidence: string[];
  reason: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  fullName: string | null;
}

const RESERVED = new Set(["p", "reel", "reels", "tv", "explore", "stories", "accounts", "about", "developer", "legal", "directory", "web", "s", "tags", "locations", "challenge", "privacy"]);

/** "https://www.instagram.com/the.brew.room/?hl=en" → "the.brew.room" (profiles only, never posts/reels). */
export function igHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i)
    ?? s.match(/^@?([A-Za-z0-9._]{1,30})$/);
  if (!m) return null;
  const h = m[1].toLowerCase().replace(/^\.+|\.+$/g, "");
  return h && !RESERVED.has(h) && /[a-z]/.test(h) ? h : null;
}
export const igUrl = (handle: string) => `https://www.instagram.com/${handle}/`;

/** "1,234" / "12.5K" / "1.2M" → a number. */
export function parseCount(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().replace(/,/g, "").match(/^([\d.]+)\s*([KkMm])?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1_000 : 1_000_000) : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Instagram's own profile summary: "1,234 Followers, 56 Following, 78 Posts …" (also "1.2K followers · 78 posts"). */
export function parseCounts(text: string): { followers: number | null; following: number | null; posts: number | null } {
  const num = "([\\d.,]+\\s*[KkMm]?)";
  const f = text.match(new RegExp(`${num}\\s+followers`, "i"));
  const g = text.match(new RegExp(`${num}\\s+following`, "i"));
  const p = text.match(new RegExp(`${num}\\s+posts`, "i"));
  return { followers: parseCount(f?.[1]), following: parseCount(g?.[1]), posts: parseCount(p?.[1]) };
}

/** Does the handle carry the business's distinctive name ("thebrewroom" ← "The Brew Room Cafe")? */
export function handleNamesBusiness(handle: string, name: string): boolean {
  const t = nameTokens(name);
  if (!t.length) return false;
  const h = handle.toLowerCase().replace(/[._\d]/g, "");
  return t.filter((w) => h.includes(w)).length >= Math.max(1, Math.ceil(t.length * 0.66));
}

/** "Fresh Brew (@thebrewroom) • Instagram photos and videos" → "Fresh Brew" */
function profileName(title: string, handle: string): string | null {
  const m = title.match(new RegExp(`^(.*?)\\s*\\(@${handle.replace(/\./g, "\\.")}\\)`, "i"));
  return m?.[1]?.trim() || null;
}

const localityWords = (locality: string) =>
  locality.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !["road", "main", "cross", "layout", "nagar", "stage", "phase", "block", "sector", "india", "karnataka"].includes(w));

/**
 * Decide whether the business has a verified Instagram account, from the
 * listing's own link, the search results and (when Instagram answered) the profile.
 */
export function verifyInstagram(input: {
  name: string;
  locality: string;
  phone: string | null;
  listingInstagram: string | null;
  results: IgResult[];
  profiles: Record<string, IgProfile | null>;
}): IgCheck {
  const none = (reason: string): IgCheck => ({ status: "not_verified", handle: null, url: null, evidence: [], reason, followers: null, following: null, posts: null, fullName: null });
  const listed = igHandle(input.listingInstagram);
  const handles = new Map<string, IgResult[]>();
  if (listed) handles.set(listed, []);
  for (const r of input.results) {
    const h = igHandle(r.url);
    if (h) handles.set(h, [...(handles.get(h) ?? []), r]);
  }
  if (!handles.size) return none("No Instagram account found for the business.");

  const places = localityWords(input.locality);
  const digits = (input.phone ?? "").replace(/\D/g, "").slice(-8);
  const verdicts: (IgCheck & { weight: number })[] = [];
  for (const [handle, rs] of handles) {
    const evidence: string[] = [];
    const profile = input.profiles[handle] ?? null;
    if (profile?.status === 404) { verdicts.push({ ...none(`@${handle} doesn't exist on Instagram.`), handle, weight: -1 }); continue; }
    const pageText = profile && profile.status === 200 ? `${profile.title} ${profile.description}` : "";
    const ownPage = profile?.status === 200 && pageText.toLowerCase().includes(`@${handle}`);
    const indexed = rs.find((r) => r.title.toLowerCase().includes(`@${handle}`));
    const exists = ownPage || !!indexed;
    const fromListing = handle === listed;
    if (fromListing) evidence.push("The business's map listing links this Instagram account.");
    if (ownPage) evidence.push("Instagram serves the profile.");
    else if (indexed) evidence.push("Search engines index Instagram's profile page for it.");

    const titles = [profile?.title ?? "", ...rs.map((r) => r.title)].join(" ");
    const byHandle = handleNamesBusiness(handle, input.name);
    const byTitle = textNamesBusiness(titles, input.name);
    if (byHandle) evidence.push(`The handle @${handle} carries the business's name.`);
    else if (byTitle) evidence.push("The profile name matches the business.");

    const text = `${pageText} ${rs.map((r) => `${r.title} ${r.content}`).join(" ")}`.toLowerCase();
    const inArea = places.find((w) => text.includes(w));
    const byPhone = digits.length === 8 && text.replace(/\D/g, "").includes(digits);
    if (inArea) evidence.push(`The profile mentions the area (${inArea}).`);
    if (byPhone) evidence.push("The profile shows the business's phone number.");

    const counts = parseCounts(`${pageText} ${rs.map((r) => r.content).join(" ")} ${rs.map((r) => r.title).join(" ")}`);
    const ok = exists && (byHandle || byTitle) && (fromListing || !!inArea || byPhone);
    const reason = ok ? null
      : !exists ? `Couldn't confirm @${handle} exists on Instagram.`
      : !(byHandle || byTitle) ? `@${handle} doesn't clearly carry the business's name.`
      : `@${handle} couldn't be tied to this business's area or phone.`;
    verdicts.push({
      status: ok ? "verified" : "not_verified", handle, url: igUrl(handle), evidence, reason,
      followers: counts.followers, following: counts.following, posts: counts.posts,
      fullName: profileName(profile?.title || indexed?.title || "", handle),
      weight: (ok ? 100 : 0) + (fromListing ? 10 : 0) + evidence.length,
    });
  }
  verdicts.sort((a, b) => b.weight - a.weight);
  const best = verdicts[0];
  const { weight: _w, ...out } = best;
  void _w;
  return out;
}

/* ---------------- lead quality ---------------- */

/** Kinds of business where a website pays off most (bookings, enquiries, trust). */
const WEBSITE_VALUE = /hotel|guest|clinic|dent|real estate|coaching|education|academy|restaurant|cafe|salon|spa|gym|fitness|yoga|photograph|event|wedding|interior|furniture/i;

export interface IgScore { score: number; highPotential: boolean; activity: string; parts: { label: string; points: number }[] }

/** 0–100 from real signals only; unknown counts score nothing (never guessed). */
export function scoreIgLead(i: { followers: number | null; posts: number | null; phoneOk: boolean; mobile: boolean; category: string; fromListing: boolean; byHandle: boolean; rating: number | null; reviews: number | null }): IgScore {
  const parts: { label: string; points: number }[] = [];
  const add = (label: string, points: number) => { if (points) parts.push({ label, points }); };
  if (i.followers != null) add(`${i.followers.toLocaleString("en-IN")} followers`, Math.min(30, Math.round(Math.log10(i.followers + 1) * 8)));
  if (i.posts != null) add(`${i.posts} posts`, i.posts >= 50 ? 15 : i.posts >= 15 ? 10 : i.posts >= 3 ? 5 : 0);
  if (i.phoneOk) add("public phone number", 15);
  if (i.mobile) add("mobile (WhatsApp-able)", 5);
  add(WEBSITE_VALUE.test(i.category) ? "kind of business that gains most from a website" : "local business", WEBSITE_VALUE.test(i.category) ? 10 : 5);
  if (i.fromListing) add("Instagram linked from its own listing", 10);
  else if (i.byHandle) add("clear business identity on Instagram", 5);
  if (i.rating != null && i.reviews != null && i.reviews >= 10) add(`Google ${i.rating}★ (${i.reviews} reviews)`, i.rating >= 4.2 ? 15 : i.rating >= 3.8 ? 8 : 0);
  const raw = parts.reduce((s, p) => s + p.points, 0);
  const score = Math.min(100, Math.round((raw / 100) * 100));
  const activity = i.followers == null && i.posts == null ? "Counts not public"
    : [i.followers != null ? `${i.followers >= 1000 ? `${(i.followers / 1000).toFixed(i.followers >= 10_000 ? 0 : 1)}K` : i.followers} followers` : null, i.posts != null ? `${i.posts} posts` : null].filter(Boolean).join(" · ")
      + (i.followers != null ? ` — ${i.followers >= 5000 ? "strong" : i.followers >= 1000 ? "good" : i.followers >= 200 ? "growing" : "small"} audience` : "");
  return { score, highPotential: score >= 60 && i.phoneOk, activity, parts };
}
