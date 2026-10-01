import { categoryBucket, verifyPhone } from "@/lib/darwin/daily/verify";
import type { Priority } from "./types";

/**
 * ROBIN's qualification engine. PURE. It ranks leads for YOUR workflow from the
 * facts the CRM holds — it is not a prediction that anyone will buy, and every
 * point it gives comes with the reason, so the priority is never a black box.
 */

export interface QualifyInput {
  businessName: string;
  category?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  instagram?: string | null;
  city?: string | null;
  address?: string | null;
  websiteStatus?: string | null; // no_website | has_website | outdated | poor | unknown
  rating?: number | null;
  reviews?: number | null;
  darwinScore?: number | null;
}

export interface Reason { label: string; points: number }
export interface Qualification { score: number; priority: Priority; reasons: Reason[]; contactable: boolean }

/** Categories where a website clearly fits (and an app often does). */
const SITE_FIT = ["Gyms", "Restaurants/Cafes", "Salons/Spas", "Clinics", "Coaching Centers", "Retail Stores"];
const APP_FIT = ["Gyms", "Restaurants/Cafes", "Salons/Spas", "Clinics", "Coaching Centers"];

export const HIGH_AT = 60;
export const MEDIUM_AT = 38;

export function qualify(l: QualifyInput): Qualification {
  const reasons: Reason[] = [];
  const add = (label: string, points: number) => { if (points) reasons.push({ label, points }); };
  const phone = verifyPhone(l.phone);
  const wa = l.whatsapp ? verifyPhone(l.whatsapp) : null;
  const bucket = categoryBucket(l.category);
  const status = (l.websiteStatus ?? (l.website ? "has_website" : "unknown")).toLowerCase();

  if (status === "no_website") add("No website", 30);
  else if (status === "outdated") add("Outdated website", 20);
  else if (status === "poor") add("Poor website", 18);
  else if (status === "has_website") add("Already has a website", 0);

  if (phone.ok) add(phone.mobile ? "Mobile number available" : "Phone available", phone.mobile ? 14 : 10);
  if (wa?.ok) add("WhatsApp available", 8);
  if (l.email) add("Email available", 8);
  if (l.instagram) add("Instagram profile listed", 8);
  if ((l.reviews ?? 0) >= 10) add(`Active business (${l.reviews} Google reviews${l.rating ? `, ${l.rating}★` : ""})`, (l.reviews ?? 0) >= 50 ? 10 : 6);
  if (l.city || l.address) add("Local business", 4);
  if (SITE_FIT.includes(bucket)) add(status === "no_website" || status === "outdated" || status === "poor" ? "Website service appears relevant" : `${bucket} business`, status === "has_website" ? 2 : 8);
  if (APP_FIT.includes(bucket)) add("Booking / ordering app could fit", 4);
  if (l.darwinScore != null && l.darwinScore >= 70) add(`DARWIN rated it ${l.darwinScore}`, 4);

  const score = Math.max(0, Math.min(100, reasons.reduce((s, r) => s + r.points, 0)));
  const contactable = phone.ok || !!wa?.ok || !!l.email || !!l.instagram;
  // no way to reach them, or we don't know if they have a website → a human should look first
  const priority: Priority = !contactable || status === "unknown"
    ? "needs_review"
    : score >= HIGH_AT ? "high" : score >= MEDIUM_AT ? "medium" : "low";
  return { score, priority, reasons: reasons.filter((r) => r.points > 0 || r.label === "Already has a website"), contactable };
}

/** "High Priority because: • No website • Phone available …" */
export function explain(q: Pick<Qualification, "priority" | "reasons">): string {
  const head = { high: "High Priority", medium: "Medium Priority", low: "Low Priority", needs_review: "Needs Review" }[q.priority];
  const lines = q.reasons.filter((r) => r.points > 0).map((r) => `• ${r.label}`);
  if (q.priority === "needs_review") lines.unshift("• Not enough information to rank it yet");
  return `${head} because:\n${lines.join("\n") || "• No supporting signals yet"}`;
}

/**
 * How much a lead needs your attention RIGHT NOW (the chart makes these
 * prominent). Workflow ordering only — never changes the lead's stage.
 */
export function attention(l: { priority: string; score: number; stage: string; nextFollowUpAt?: Date | string | null; lastContactAt?: Date | string | null }, now = new Date()): number {
  let a = l.score;
  if (l.priority === "high") a += 15;
  if (["interested", "demo_completed", "quotation_sent", "negotiating"].includes(l.stage)) a += 35; // already engaged
  if (l.nextFollowUpAt) {
    const due = new Date(l.nextFollowUpAt).getTime();
    if (due <= now.getTime()) a += 35; // due or overdue
    else if (due - now.getTime() < 86_400_000) a += 15;
  }
  if (["lost", "not_interested", "do_not_contact", "won"].includes(l.stage)) a -= 60;
  return a;
}
