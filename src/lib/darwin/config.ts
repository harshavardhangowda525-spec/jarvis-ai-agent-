/**
 * DARWIN — real lead-generation, CRM & follow-up agent for Infinity Web & Apps.
 * Static, non-secret configuration. REAL DATA ONLY — nothing here fabricates leads.
 */

export const DARWIN_BUSINESS = {
  name: "Infinity Web & Apps",
  services: ["Websites", "Mobile apps", "AI promotional content", "Digital growth"],
  websiteFrom: "₹4,999",
  appFrom: "₹55,000",
  phone: "8317480583",
  instagram: "@infinitywebapps",
} as const;

/** CRM pipeline stages, in order. */
export const DARWIN_STAGES = [
  "new",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "demo",
  "proposal",
  "negotiation",
  "won",
  "lost",
  "follow_up",
  "not_interested",
  "converted",
] as const;
export type DarwinStage = (typeof DARWIN_STAGES)[number];

export const STAGE_LABEL: Record<DarwinStage, string> = {
  new: "NEW",
  qualified: "QUALIFIED",
  contacted: "CONTACTED",
  replied: "REPLIED",
  interested: "INTERESTED",
  demo: "DEMO SCHEDULED",
  proposal: "PROPOSAL SENT",
  negotiation: "NEGOTIATION",
  won: "WON",
  lost: "LOST",
  follow_up: "FOLLOW-UP",
  not_interested: "NOT INTERESTED",
  converted: "CONVERTED",
};

/** The lead statuses shown in DARWIN's CRM (the others remain for the AI tools). */
export const CRM_STATUSES = ["new", "contacted", "follow_up", "interested", "not_interested", "converted"] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

/** Opportunity categories — these are AI ANALYSIS, never presented as fact. */
export const DARWIN_OPPORTUNITIES = [
  "no_website",
  "outdated_website",
  "poor_mobile",
  "no_online_ordering",
  "no_customer_app",
  "no_booking_system",
  "no_digital_menu",
  "weak_digital_presence",
  "could_benefit_from_app",
  "could_benefit_from_automation",
  "website_redesign",
] as const;
export type DarwinOpportunity = (typeof DARWIN_OPPORTUNITIES)[number];

/** Communication / message states (real delivery states only). */
export const DARWIN_MESSAGE_STATES = [
  "draft",
  "approval_required",
  "sending",
  "sent",
  "delivered",
  "failed",
  "replied",
] as const;

/** Activity log event types (real events only). */
export const DARWIN_ACTIVITY_TYPES = [
  "discovered",
  "qualified",
  "stage_changed",
  "note",
  "message_drafted",
  "message_sent",
  "message_failed",
  "reply_received",
  "followup_scheduled",
  "followup_completed",
  "lead_updated",
] as const;

/** DARWIN operating states surfaced to the dashboard hologram. */
export const DARWIN_STATES = [
  "IDLE",
  "LISTENING",
  "THINKING",
  "SEARCHING",
  "PROCESSING",
  "WAITING_FOR_APPROVAL",
  "COMPLETED",
  "ERROR",
] as const;
export type DarwinState = (typeof DARWIN_STATES)[number];
