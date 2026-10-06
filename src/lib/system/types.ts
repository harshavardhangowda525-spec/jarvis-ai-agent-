/**
 * JARVIS system analysis — the event stream a diagnostic run sends, as it runs.
 * Shared by the server runner and the holographic UI (client-safe: no imports).
 *
 * Every event is a real step of the run: a stage starting, a node being
 * checked, a check's real result. The UI only animates what arrives here.
 */

export type StageId = "core" | "agents" | "connections" | "performance" | "security";
export type NodeId = "core" | "ev" | "darwin" | "mike" | "rubin" | "ultron" | "voice";
export type CheckStatus = "ok" | "warn" | "fail" | "info";
/** inactive = nothing set up for it (only notes) — neither verified nor failing */
export type NodeState = "idle" | "scanning" | "healthy" | "warning" | "error" | "inactive";

export const STAGE_LABEL: Record<StageId, string> = {
  core: "SCANNING CORE",
  agents: "CHECKING AGENTS",
  connections: "VERIFYING CONNECTIONS",
  performance: "ANALYZING PERFORMANCE",
  security: "SELF-DIAGNOSTIC",
};

/** The agents shown around the core, in the order they're checked. */
export const AGENT_NODES: { id: Exclude<NodeId, "core">; label: string; role: string }[] = [
  { id: "ev", label: "EV", role: "Marketing" },
  { id: "darwin", label: "DARWIN", role: "Lead discovery" },
  { id: "mike", label: "MIKE", role: "Markets" },
  { id: "rubin", label: "RUBIN", role: "Sales CRM" },
  { id: "ultron", label: "ULTRON", role: "PC runtime" },
  { id: "voice", label: "VOICE", role: "Speech" },
];

export type ScanEvent =
  | { type: "start"; total: number; at: string }
  | { type: "stage"; stage: StageId; label: string }
  /** A node is being checked now (the UI focuses it). */
  | { type: "focus"; node: NodeId }
  | { type: "check"; node: NodeId; stage: StageId; label: string; status: CheckStatus; detail: string; ms: number }
  /** A node's checks are finished: its verdict from those checks. */
  | { type: "node"; node: NodeId; state: Exclude<NodeState, "idle" | "scanning"> }
  | { type: "done"; summary: { ok: number; warn: number; fail: number; info: number }; durationMs: number }
  | { type: "error"; message: string };

/** What the browser checks itself (ULTRON listens only on this computer). */
export interface ClientProbe {
  ultron: { known: boolean; reachable: boolean; brain?: string | null; ms?: number } | null;
}

export function nodeVerdict(statuses: CheckStatus[]): "healthy" | "warning" | "error" | "inactive" {
  if (statuses.includes("fail")) return "error";
  if (statuses.includes("warn")) return "warning";
  return statuses.includes("ok") ? "healthy" : "inactive";
}
