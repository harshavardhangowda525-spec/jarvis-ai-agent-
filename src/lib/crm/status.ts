/**
 * DARWIN CRM statuses (client-safe). The CRM stores detailed stages; people
 * work with these eight statuses. Each status is a group of stages, and
 * choosing a status moves the lead to that group's first stage.
 *
 * A status is only ever set by you or by a recorded event (a logged call, a
 * scheduled demo, a sent quotation) — never inferred.
 */
export type CrmStatus = "new" | "contacted" | "interested" | "demo" | "proposal" | "ready" | "converted" | "rejected";

export const CRM_STATUSES: { id: CrmStatus; label: string; stages: string[]; tone: string }[] = [
  { id: "new", label: "Not contacted", stages: ["new", "qualified"], tone: "gray" },
  { id: "contacted", label: "Contacted", stages: ["contacted"], tone: "slate" },
  { id: "interested", label: "Interested — Follow Up", stages: ["interested", "follow_up"], tone: "blue" },
  { id: "demo", label: "Demo Scheduled", stages: ["demo_scheduled", "demo_completed"], tone: "indigo" },
  { id: "proposal", label: "Proposal Sent", stages: ["quotation_sent", "negotiating"], tone: "violet" },
  { id: "ready", label: "Ready to Purchase", stages: ["ready_to_purchase"], tone: "teal" },
  { id: "converted", label: "Converted", stages: ["won"], tone: "green" },
  { id: "rejected", label: "Rejected", stages: ["lost", "not_interested", "do_not_contact"], tone: "red" },
];

export const statusOfStage = (stage: string): CrmStatus => CRM_STATUSES.find((s) => s.stages.includes(stage))?.id ?? "new";
export const statusLabel = (s: CrmStatus) => CRM_STATUSES.find((x) => x.id === s)?.label ?? s;
export const stagesOf = (s: CrmStatus) => CRM_STATUSES.find((x) => x.id === s)?.stages ?? [];
/** The stage a lead moves to when you pick this status. */
export const stageForStatus = (s: CrmStatus) => stagesOf(s)[0];
export const isCrmStatus = (s: unknown): s is CrmStatus => CRM_STATUSES.some((x) => x.id === s);
/** Moving here is a decision — it asks first. */
export const CONFIRM_STATUSES: CrmStatus[] = ["converted", "rejected"];

export type FollowUpFilter = "overdue" | "today" | "due" | "week" | "none" | "any";
export type WebsiteFilter = "has" | "none" | "unknown";
