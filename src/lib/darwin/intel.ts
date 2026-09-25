/**
 * DARWIN lead intelligence — what the map shows for a lead, derived ONLY from
 * real data: what the source listed (website, phone, email, Instagram), what
 * DARWIN's AI analysis recorded (opportunityType), and the CRM stage. Nothing is
 * guessed; a check DARWIN hasn't made shows as "not analysed". Client-safe.
 */
import type { LeadDTO } from "./types";

export type NodeKind =
  | "discovered" | "verified" | "no_website" | "weak_website" | "high_potential"
  | "contacted" | "follow_up" | "client" | "not_interested";

export const KIND_LABEL: Record<NodeKind, string> = {
  discovered: "DISCOVERED", verified: "VERIFIED", no_website: "NO WEBSITE", weak_website: "WEAK WEBSITE",
  high_potential: "HIGH POTENTIAL", contacted: "CONTACTED", follow_up: "FOLLOW-UP", client: "CLIENT",
  not_interested: "NOT INTERESTED",
};

export interface IntelCheck {
  key: "website" | "contact" | "presence" | "quality" | "opportunity";
  label: string;
  /** 0..1 contribution, or null when DARWIN has no data for it. */
  value: number | null;
  note: string;
}

export interface LeadIntel {
  kind: NodeKind;
  checks: IntelCheck[];
  /** Fit score 0–100 computed from the listed data above (not an AI opinion). */
  score: number;
}

/** AI analysis outcomes that mean the business HAS a website that needs work. */
export const WEAK_WEBSITE = new Set(["outdated_website", "poor_mobile", "website_redesign", "weak_digital_presence"]);
const CLOSED_WON = new Set(["converted", "won"]);
const CLOSED_LOST = new Set(["not_interested", "lost"]);

export function leadIntel(l: LeadDTO, now = Date.now()): LeadIntel {
  const hasSite = !!l.website?.trim();
  const weak = !!l.opportunityType && WEAK_WEBSITE.has(l.opportunityType);
  const phone = !!l.phone?.trim(), email = !!l.email?.trim(), insta = !!l.instagram?.trim();
  const analysed = !!l.opportunityType && l.opportunityType !== "no_website";

  const website = !hasSite ? 1 : weak ? 0.7 : 0.25;
  const contact = phone && email ? 1 : phone || email ? 0.75 : 0;
  const presence = insta ? 1 : hasSite ? 0.5 : 0.2;
  const quality = weak ? 1 : analysed ? 0.3 : null;
  const score = Math.round(100 * (0.45 * website + 0.35 * contact + 0.12 * presence + 0.08 * (quality ?? 0.5)));

  const checks: IntelCheck[] = [
    { key: "website", label: "WEBSITE", value: website, note: !hasSite ? "No website listed" : weak ? "Website needs work (AI)" : "Website listed" },
    { key: "contact", label: "CONTACT", value: contact, note: phone && email ? "Phone + email listed" : phone ? "Phone listed" : email ? "Email listed" : "No contact listed" },
    { key: "presence", label: "PRESENCE", value: presence, note: insta ? "Instagram listed" : hasSite ? "Web presence" : "Little online presence listed" },
    { key: "quality", label: "QUALITY", value: quality, note: weak ? "AI flagged the website" : analysed ? "AI analysed" : "Not analysed yet" },
    { key: "opportunity", label: "OPPORTUNITY", value: score / 100, note: `Fit ${score}/100 from listed data` },
  ];

  const stage = l.stage;
  let kind: NodeKind;
  if (CLOSED_WON.has(stage)) kind = "client";
  else if (CLOSED_LOST.has(stage)) kind = "not_interested";
  else if (stage === "follow_up" || (l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() > now - 86_400_000 * 30)) kind = "follow_up";
  else if (stage === "contacted" || stage === "interested") kind = "contacted";
  else if ((!hasSite || weak) && (phone || email)) kind = "high_potential";
  else if (!hasSite) kind = "no_website";
  else if (weak) kind = "weak_website";
  else if (phone || email || hasSite) kind = "verified";
  else kind = "discovered";
  return { kind, checks, score };
}

/** The lead-flow pipeline, counted from real leads. */
export const PIPELINE = ["DISCOVERED", "VERIFIED", "ANALYZED", "HIGH POTENTIAL", "CONTACTED", "FOLLOW-UP", "CLIENT"] as const;
export type PipelineStage = (typeof PIPELINE)[number];

export function pipelineStageOf(l: LeadDTO): PipelineStage {
  const k = leadIntel(l).kind;
  if (k === "client") return "CLIENT";
  if (k === "follow_up") return "FOLLOW-UP";
  if (k === "contacted") return "CONTACTED";
  if (k === "high_potential") return "HIGH POTENTIAL";
  if (l.opportunityType || typeof l.leadScore === "number") return "ANALYZED";
  if (l.phone || l.email || l.website) return "VERIFIED";
  return "DISCOVERED";
}

/** How many leads are at each stage right now (not-interested leads are left out). */
export function pipelineCounts(leads: LeadDTO[]): Record<PipelineStage, number> {
  const out = Object.fromEntries(PIPELINE.map((p) => [p, 0])) as Record<PipelineStage, number>;
  for (const l of leads) if (!CLOSED_LOST.has(l.stage)) out[pipelineStageOf(l)]++;
  return out;
}

export interface MapFilters {
  website: "any" | "has" | "none";
  phone: "any" | "has" | "none";
  instagram: "any" | "has" | "none";
  quality: "any" | "weak";
  potential: "any" | "high";
}
export const DEFAULT_FILTERS: MapFilters = { website: "any", phone: "any", instagram: "any", quality: "any", potential: "any" };

export function matchesFilters(l: LeadDTO, f: MapFilters): boolean {
  const site = !!l.website?.trim(), phone = !!l.phone?.trim(), insta = !!l.instagram?.trim();
  if (f.website === "has" && !site) return false;
  if (f.website === "none" && site) return false;
  if (f.phone === "has" && !phone) return false;
  if (f.phone === "none" && phone) return false;
  if (f.instagram === "has" && !insta) return false;
  if (f.instagram === "none" && insta) return false;
  if (f.quality === "weak" && !(l.opportunityType && WEAK_WEBSITE.has(l.opportunityType))) return false;
  if (f.potential === "high" && leadIntel(l).kind !== "high_potential") return false;
  return true;
}

/** Metres east/north of a centre point (equirectangular — accurate at city scale). */
export function toLocalMeters(lat: number, lon: number, center: { lat: number; lon: number }) {
  const x = (lon - center.lon) * Math.cos((center.lat * Math.PI) / 180) * 111_320;
  const y = (lat - center.lat) * 110_540;
  return { x, y };
}
