/**
 * RUBEN's desktop island — what one command returns (client-safe).
 * The pop-up shows only the card for the current command, never the whole CRM.
 */
import type { Stage } from "./types";

export interface IslandLead {
  id: string; number: number | null; name: string; category: string | null; city: string | null;
  stage: string; stageLabel: string; phone: string | null; lastContact: string | null; nextFollowUp: string | null;
}
export interface IslandLeadDetail extends IslandLead {
  email: string | null; whatsapp: string | null; instagram: string | null; website: string | null; address: string | null;
  priority: string; score: number; notes: string | null;
  recent: { when: string; text: string }[];
  followUps: { id: string; when: string; action: string }[];
}
export interface IslandFollowUp { id: string; leadId: string; number: number | null; name: string; when: string; action: string; overdue: boolean; notes: string | null }

export type IslandCard =
  | { type: "leads"; title: string; leads: IslandLead[] }
  | { type: "lead"; lead: IslandLeadDetail }
  | { type: "followups"; title: string; items: IslandFollowUp[] }
  | { type: "confirm"; question: string }
  | { type: "done"; text: string; lead?: IslandLead }
  | { type: "error"; text: string }
  | { type: "text"; title?: string; text: string };

/** A decision waiting for your "yes" (kept by the island, re-checked by the server). */
export type IslandPending = { kind: "move"; leadId: string; stage: Stage; name: string };

export interface IslandReply {
  /** One short line RUBEN says. */
  say: string;
  card: IslandCard | null;
  /** Open the pop-up (true) / collapse it to the outline (false) / leave it (undefined). */
  open?: boolean;
  /** The lead "this lead" now means. */
  leadId?: string | null;
  pending?: IslandPending | null;
}

/** The CRM dashboard inside the island pop-up (one request, all real data). */
export type IslandStatus = "all" | "ready" | "interested" | "rejected" | "open" | "won";
export interface IslandDashboard {
  counts: { total: number; open: number; ready: number; interested: number; rejected: number; won: number; dueToday: number; overdue: number; new: number; qualified: number; inProgress: number };
  /** Most recently touched businesses, with their contact details. */
  recent: { id: string; name: string; number: number | null; email: string | null; phone: string | null; instagram: string | null; website: string | null; stage: string; stageLabel: string }[];
  /** The three sales statuses, most important leads first. */
  columns: { ready: IslandLead[]; interested: IslandLead[]; rejected: IslandLead[] };
  /** Won ÷ (won + rejected) — null until something has been decided. */
  winRate: { won: number; decided: number; pct: number | null };
  /** Latest interactions across all leads. */
  interactions: { id: string; leadId: string; name: string; when: string; channel: string; direction: string; outcome: string | null; notes: string | null }[];
  pipeline: { id: string; label: string; count: number }[];
  progress: { demosUpcoming: number; demosDone: number; proposalsOut: number; proposalsAccepted: number; clients: number };
  followups: IslandFollowUp[];
  activity: { id: string; when: string; text: string; leadId: string | null }[];
  today: string;
  list: { status: IslandStatus; q: string; total: number; leads: IslandLead[] };
}

/** Everything about one lead, for the dashboard's detail pane. */
export interface IslandLeadFull extends IslandLeadDetail {
  mapsUrl: string | null; potentialValue: number | null; serviceInterest: string | null;
  interactions: { id: string; when: string; channel: string; direction: string; outcome: string | null; notes: string | null }[];
  followUpsAll: { id: string; when: string; action: string; status: string; overdue: boolean; notes: string | null }[];
  stageHistory: { when: string; from: string | null; to: string }[];
  demos: { id: string; when: string; type: string; status: string }[];
  quotations: { id: string; number: string; status: string; total: number; currency: string; when: string }[];
  client: { status: string; paymentStatus: string; amount: number; currency: string; project: string | null } | null;
}
