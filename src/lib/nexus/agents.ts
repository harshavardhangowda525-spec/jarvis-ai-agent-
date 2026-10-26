/**
 * The agent team as the Nexus shows it (client-safe). Names map to the real
 * agents in this codebase; nothing here is a capability — those come from each
 * agent's registered tools on the server.
 */
export type NexusAgentId = "darwin" | "robin" | "ev" | "aston" | "friday" | "mike" | "ruben";

export interface NexusAgent {
  id: NexusAgentId;
  name: string;
  /** what you may call it ("EVIE" is EV) */
  aliases: string[];
  title: string;
  purpose: string;
  color: string;
  /** visual behaviour of the node */
  motif: "scan" | "pulse" | "geometry" | "wave" | "mesh" | "chart" | "outline";
  chat: string | null;
}

export const NEXUS_AGENTS: NexusAgent[] = [
  { id: "darwin", name: "DARWIN", aliases: ["darwin"], title: "Lead Intelligence", purpose: "Finds businesses, checks their web presence, verifies contacts, qualifies and scores leads, and owns the CRM.", color: "#38d6ff", motif: "scan", chat: "/dashboard/chat/darwin" },
  { id: "robin", name: "RUBIN", aliases: ["rubin", "robin"], title: "Sales Operations", purpose: "Follow-ups, call and message scripts, demos, quotations and conversions — working on DARWIN's CRM, never a second one.", color: "#4f7dff", motif: "pulse", chat: "/dashboard/chat/robin" },
  { id: "ev", name: "EVIE", aliases: ["ev", "evie", "eve"], title: "Growth & Business Intelligence", purpose: "Instagram content and analytics, campaigns, and the business-environment intelligence for Infinity Web & Apps.", color: "#b07cff", motif: "wave", chat: "/dashboard/chat/ev" },
  { id: "aston", name: "ASTON", aliases: ["aston"], title: "Development Intelligence", purpose: "Builds websites and app demos, writes and tests the code, previews and (when you approve) deploys.", color: "#ffb84d", motif: "geometry", chat: "/dashboard/chat/aston" },
  { id: "friday", name: "FRIDAY", aliases: ["friday"], title: "3D Production", purpose: "Blender automation: 3D models, scenes, renders and exports, with a holographic viewer.", color: "#3ee6d0", motif: "mesh", chat: "/dashboard/friday" },
  { id: "mike", name: "MIKE", aliases: ["mike"], title: "Market Intelligence", purpose: "Market analysis and the weekly review of your trading playbook. Never places trades.", color: "#46d483", motif: "chart", chat: "/dashboard/chat/mike" },
  { id: "ruben", name: "RUBEN", aliases: ["ruben"], title: "Desktop Command Island", purpose: "RUBIN's CRM as a small always-on-top desktop pill (npm run rubin). It runs as its own app on your PC.", color: "#7fb2ff", motif: "outline", chat: null },
];

export const AGENT_STATES = ["idle", "ready", "listening", "planning", "working", "waiting_approval", "completed", "error", "offline"] as const;
export type AgentState = (typeof AGENT_STATES)[number] | "unknown";
export const STATE_LABEL: Record<AgentState, string> = {
  idle: "Idle", ready: "Ready", listening: "Listening", planning: "Planning", working: "Working", waiting_approval: "Waiting for approval",
  completed: "Completed", error: "Error", offline: "Offline", unknown: "Not reported",
};
