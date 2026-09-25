/**
 * EV — the dedicated AI marketing & growth agent for Infinity Web & Apps.
 *
 * Static, NON-SECRET business facts EV represents. Secrets (Instagram tokens,
 * API keys) never live here — they come from server-side env / the Integration
 * table. This module is safe to import anywhere.
 */

export const EV_BUSINESS = {
  name: "Infinity Web & Apps",
  tagline: "websites. mobile apps. digital growth",
  instagram: "@infinitywebapps",
  phone: "8317480583",
  websiteFrom: "₹4,999",
  appFrom: "₹55,000",
  services: [
    "Websites",
    "Mobile apps",
    "AI-generated promotional content",
    "Digital growth solutions",
  ] as const,
} as const;

/** EV's speaking voice (used by the prompt and shown as the brand's TONE). */
export const EV_VOICE = ["Confident", "energetic", "concise"] as const;

/** Target niches EV grows Infinity Web & Apps into (used by the idea engine). */
export const EV_NICHES = [
  "gyms",
  "cafes",
  "restaurants",
  "salons",
  "spas",
  "clinics",
  "coaching centers",
  "clothing stores",
  "mobile stores",
  "hotels",
  "real estate",
  "yoga studios",
  "physiotherapists",
  "local retailers",
] as const;

/** EV operating states exposed to the JARVIS UI (must match the frontend union). */
export const EV_STATES = [
  "IDLE",
  "LISTENING",
  "THINKING",
  "GENERATING",
  "WAITING_FOR_APPROVAL",
  "EXECUTING",
  "SUCCESS",
  "ERROR",
] as const;
export type EvState = (typeof EV_STATES)[number];

/** Content kinds EV produces. Kept in sync with the EvContent.kind column. */
export const EV_CONTENT_KINDS = [
  "post",
  "reel",
  "story",
  "caption",
  "hook",
  "cta",
  "ad",
  "educational",
  "growth",
  "website",
  "app",
  "idea",
  "outreach",
  "campaign",
  "note",
] as const;
export type EvContentKind = (typeof EV_CONTENT_KINDS)[number];

/** Content lifecycle statuses. Kept in sync with the EvContent.status column. */
export const EV_STATUSES = [
  "draft",
  "ready", // prepared, waiting for the user's approval
  "approved",
  "rejected",
  "scheduled",
  "published",
  "failed",
] as const;
export type EvStatus = (typeof EV_STATUSES)[number];
