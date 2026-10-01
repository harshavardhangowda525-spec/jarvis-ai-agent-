/**
 * ROBIN — Sales & CRM agent. Shared (client-safe) vocabulary: pipeline stages,
 * priorities, call outcomes, chart nodes. Robin's work starts AFTER DARWIN finds
 * a business; it never searches for leads itself.
 */

export const STAGES = [
  "new", "qualified", "contacted", "interested", "follow_up", "demo_scheduled", "demo_completed",
  "quotation_sent", "negotiating", "won", "lost", "not_interested", "do_not_contact",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New", qualified: "Qualified", contacted: "Contacted", interested: "Interested", follow_up: "Follow-up",
  demo_scheduled: "Demo scheduled", demo_completed: "Demo completed", quotation_sent: "Quotation sent",
  negotiating: "Negotiating", won: "Won", lost: "Lost", not_interested: "Not interested", do_not_contact: "Do not contact",
};

/** Closed stages: a lead here is no longer in the active pipeline. */
export const CLOSED: Stage[] = ["won", "lost", "not_interested", "do_not_contact"];
/** Moving INTO these needs your explicit confirmation (they're decisions, not bookkeeping). */
export const CONFIRM_STAGES: Stage[] = ["won", "lost", "do_not_contact"];

/** The pipeline chart: one node per step of the journey, LOST as a side branch. */
/**
 * The command center's pipeline — eight stages, in the order they sit on the arc.
 * Demos are part of FOLLOW-UP; a sent quotation and negotiating are PROPOSAL SENT;
 * lost / not interested / do-not-contact are REJECTED (id "lost").
 */
export const NODES = [
  { id: "new", label: "NEW CONTACT", stages: ["new"] },
  { id: "contacted", label: "CONTACTED", stages: ["contacted"] },
  { id: "qualified", label: "QUALIFIED", stages: ["qualified"] },
  { id: "interested", label: "INTERESTED", stages: ["interested"] },
  { id: "follow_up", label: "FOLLOW-UP", stages: ["follow_up", "demo_scheduled", "demo_completed"] },
  { id: "proposal", label: "PROPOSAL SENT", stages: ["quotation_sent", "negotiating"] },
  { id: "won", label: "WON", stages: ["won"] },
  { id: "lost", label: "REJECTED", stages: ["lost", "not_interested", "do_not_contact"] },
] as const satisfies readonly { id: string; label: string; stages: readonly Stage[] }[];
export type NodeId = (typeof NODES)[number]["id"];
export const nodeOf = (stage: string): NodeId => (NODES.find((n) => (n.stages as readonly string[]).includes(stage))?.id ?? "new") as NodeId;
/** Dropping a lead on a node moves it to that node's first stage. */
export const nodeStage = (id: NodeId): Stage => NODES.find((n) => n.id === id)!.stages[0] as Stage;
/** Order of the journey (used for "forward only" automatic moves). */
export const STAGE_ORDER: Record<Stage, number> = {
  new: 0, qualified: 1, contacted: 2, interested: 3, follow_up: 4, demo_scheduled: 5, demo_completed: 6,
  quotation_sent: 7, negotiating: 8, won: 9, lost: 10, not_interested: 10, do_not_contact: 10,
};
export const isStage = (s: string): s is Stage => (STAGES as readonly string[]).includes(s);

export const PRIORITIES = ["high", "medium", "low", "needs_review"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High priority", medium: "Medium priority", low: "Low priority", needs_review: "Needs review" };

export const CHANNELS = ["call", "whatsapp", "instagram", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CALL_OUTCOMES = [
  "no_answer", "busy", "wrong_number", "spoke", "interested", "not_interested", "call_later", "wants_demo", "wants_quotation",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const OUTCOME_LABEL: Record<string, string> = {
  no_answer: "No answer", busy: "Busy", wrong_number: "Wrong number", spoke: "Spoke with owner", interested: "Interested",
  not_interested: "Not interested", call_later: "Call later", wants_demo: "Wants demo", wants_quotation: "Wants quotation",
  replied: "Replied", no_reply: "No reply yet", sent: "Sent",
};

export const FOLLOWUP_ACTIONS = ["call", "whatsapp", "email", "instagram", "meeting", "task"] as const;
export const DEMO_TYPES = ["online", "in_person", "phone"] as const;
export const DEMO_STATUSES = ["scheduled", "completed", "cancelled", "rescheduled"] as const;
export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
export const CLIENT_STATUSES = ["active", "completed", "maintenance", "inactive"] as const;
export const PAYMENT_STATUSES = ["unpaid", "partial", "paid"] as const;

/** Service names Robin starts with. Prices are NOT set — you set them in Settings. */
export const DEFAULT_SERVICES = [
  "Website", "Mobile App", "Website + App", "Maintenance", "Hosting", "Domain", "Custom Development", "AI Promotional Video",
];

export interface RobinSettings {
  /** DARWIN's new leads come over to Robin automatically. */
  autoImport: boolean;
  currency: string;
  /** Default GST / tax % on quotations. */
  taxPct: number;
  quoteValidityDays: number;
  paymentTerms: string;
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  companyAddress: string;
  /** "Good morning. Here's your sales briefing." the first time Robin opens each day. */
  morningReport: boolean;
}
export const DEFAULT_SETTINGS: RobinSettings = {
  autoImport: true, currency: "INR", taxPct: 18, quoteValidityDays: 15,
  paymentTerms: "50% advance to start, 50% on delivery.",
  companyName: "Infinity Web & Apps", companyPhone: "", companyEmail: "", companyAddress: "",
  morningReport: true,
};

/** Robin's core states (drive the hologram). */
export const CORE_STATES = ["idle", "listening", "analyzing", "processing", "qualifying", "contacting", "following_up", "demo", "quotation", "complete", "error"] as const;
export type CoreState = (typeof CORE_STATES)[number];
export const CORE_LABEL: Record<CoreState, string> = {
  idle: "IDLE", listening: "LISTENING", analyzing: "ANALYZING", processing: "PROCESSING", qualifying: "QUALIFYING LEADS", contacting: "CONTACTING",
  following_up: "FOLLOWING UP", demo: "PREPARING DEMO", quotation: "PREPARING QUOTATION", complete: "COMPLETE", error: "ERROR",
};

export const RANGES = ["today", "7d", "30d", "90d", "custom"] as const;
export type Range = (typeof RANGES)[number];

/** ₹1,10,000 / ₹9.9L / ₹1.2Cr — Indian grouping. */
export function money(v: number | null | undefined, currency = "INR", compact = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency === "EUR" ? "€" : `${currency} `;
  if (compact && currency === "INR") {
    if (Math.abs(v) >= 1e7) return `${sym}${trim(v / 1e7)}Cr`;
    if (Math.abs(v) >= 1e5) return `${sym}${trim(v / 1e5)}L`;
    if (Math.abs(v) >= 1e3) return `${sym}${trim(v / 1e3)}K`;
  } else if (compact) {
    if (Math.abs(v) >= 1e6) return `${sym}${trim(v / 1e6)}M`;
    if (Math.abs(v) >= 1e3) return `${sym}${trim(v / 1e3)}K`;
  }
  return `${sym}${Math.round(v).toLocaleString(currency === "INR" ? "en-IN" : "en-US")}`;
}
const trim = (n: number) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, "");
