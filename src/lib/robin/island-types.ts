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
