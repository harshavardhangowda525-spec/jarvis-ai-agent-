/** ASTON — shared types and the priority rules (pure, client-safe). */

export const INCIDENT_KINDS = [
  "build_failed", "deploy_failed", "prod_incident", "task_blocked", "decision_required",
  "agent_failures", "security", "deadline_risk", "info",
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export type Priority = "critical" | "high" | "normal";
export type IncidentStatus = "open" | "acknowledged" | "resolved" | "dismissed";
export type Channel = "browser" | "email" | "phone";

/** Default priority per kind. Critical = interrupt now; high = needs a decision soon; normal = store + show. */
export const KIND_PRIORITY: Record<IncidentKind, Priority> = {
  prod_incident: "critical",
  security: "critical",
  build_failed: "high",
  deploy_failed: "high",
  task_blocked: "high",
  decision_required: "high",
  agent_failures: "high",
  deadline_risk: "high",
  info: "normal",
};

export const PRIORITY_RANK: Record<Priority, number> = { critical: 3, high: 2, normal: 1 };

/** The higher of two priorities (a repeat may escalate an incident, never quietly downgrade it). */
export function maxPriority(a: Priority, b: Priority): Priority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}

export interface RecoveryStep { at: string; action: string; ok: boolean; note?: string }

/** A real signal from a system (webhook, probe, agent run). Never an AI guess. */
export interface IncidentSignal {
  source: string;
  kind: IncidentKind;
  /** Stable identity of the problem — the same key = the same incident. */
  key: string;
  title: string;
  project?: string | null;
  detail?: string | null;
  priority?: Priority;
  evidence?: Record<string, unknown>;
  recommendation?: string | null;
  recovery?: RecoveryStep[];
}

export interface IncidentDTO {
  id: string;
  source: string;
  kind: string;
  priority: Priority;
  status: IncidentStatus;
  project: string | null;
  title: string;
  detail: string | null;
  summary: string | null;
  recommendation: string | null;
  recovery: RecoveryStep[];
  pendingAction: { type: string; reason: string } | null;
  occurrences: number;
  verified: boolean;
  verifyNote: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

/** Parse ASTON_NOTIFICATION_CHANNEL into the alert channels to use (phone is separate). */
export function parseChannels(raw: string): Channel[] {
  const out: Channel[] = [];
  for (const p of raw.toLowerCase().split(/[\s,]+/)) {
    if ((p === "browser" || p === "email") && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Parse ASTON_WATCH_URLS ("Name|https://…, https://…") into probe targets. https/http only. */
export function parseWatchUrls(raw: string): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = [];
  for (const part of raw.split(/[,\n]+/)) {
    const t = part.trim();
    if (!t) continue;
    const [a, b] = t.includes("|") ? t.split("|", 2) : [null, t];
    const url = (b ?? "").trim();
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      out.push({ name: (a ?? "").trim() || u.hostname, url: u.toString() });
    } catch { /* not a URL — ignored */ }
  }
  return out;
}
