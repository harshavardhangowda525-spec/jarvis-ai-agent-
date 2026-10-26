/**
 * What an agent pop-up shows about a task, derived only from the task record
 * (client-safe, pure). Execution itself lives in the jobs engine on the server.
 */

export type DisplayState = "queued" | "planning" | "waiting_dependency" | "running" | "waiting_approval" | "completed" | "partial" | "failed" | "cancelled";

export const DISPLAY_LABEL: Record<DisplayState, string> = {
  queued: "Queued", planning: "Planning", waiting_dependency: "Waiting for dependency", running: "Running",
  waiting_approval: "Waiting for approval", completed: "Completed", partial: "Partially completed", failed: "Failed", cancelled: "Cancelled",
};

export const DISPLAY_COLOR: Record<DisplayState, string> = {
  queued: "#7f97b2", planning: "#9b7bff", waiting_dependency: "#7f97b2", running: "#5fe1ff",
  waiting_approval: "#f4c35a", completed: "#4ce0a6", partial: "#f4c35a", failed: "#ff6b7a", cancelled: "#5d7590",
};

export const ACTIVE_STATUSES = ["planning", "assigned", "running", "waiting_approval"];
export const isActive = (status: string) => ACTIVE_STATUSES.includes(status);
export const isFinished = (status: string) => ["completed", "failed", "cancelled"].includes(status);

export interface TaskLike { id: string; status: string; dependsOn: string[]; createdAt: string; agentName: string; title: string; error?: string | null; result?: string | null }

/** A task's state, with "waiting for dependency" when an earlier task it needs hasn't completed. */
export function displayState(j: Pick<TaskLike, "status" | "dependsOn">, statusOf: (id: string) => string | undefined): DisplayState {
  switch (j.status) {
    case "planning": return "planning";
    case "assigned": return j.dependsOn.some((d) => statusOf(d) !== "completed") ? "waiting_dependency" : "queued";
    case "running": return "running";
    case "waiting_approval": return "waiting_approval";
    case "completed": return "completed";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    default: return "queued";
  }
}

/**
 * Tasks that belong to one request: linked by dependencies, or created
 * back-to-back (within `gapMs` of each other) — what JARVIS dispatches for one
 * multi-agent instruction. Groups of one are left out.
 */
export function planGroups(tasks: Pick<TaskLike, "id" | "dependsOn" | "createdAt">[], gapMs = 90_000): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const join = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) parent.set(t.id, t.id);
  for (const t of tasks) for (const d of t.dependsOn) if (ids.has(d)) join(t.id, d);
  const sorted = [...tasks].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (let i = 1; i < sorted.length; i++) if (Date.parse(sorted[i].createdAt) - Date.parse(sorted[i - 1].createdAt) <= gapMs) join(sorted[i].id, sorted[i - 1].id);
  const groups = new Map<string, string[]>();
  for (const t of sorted) { const r = find(t.id); groups.set(r, [...(groups.get(r) ?? []), t.id]); }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** How a whole plan ended — "partial" when some tasks completed and others didn't. Null while any task is still going. */
export function planOutcome(statuses: string[]): "completed" | "partial" | "failed" | "cancelled" | null {
  if (statuses.some((s) => !isFinished(s))) return null;
  const done = statuses.filter((s) => s === "completed").length;
  if (done === statuses.length) return "completed";
  if (done > 0) return "partial";
  return statuses.every((s) => s === "cancelled") ? "cancelled" : "failed";
}

const firstLine = (s: string | null | undefined) => (s ?? "").replace(/[*_`#>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 140);

/** The combined report JARVIS gives in the main chat when every task of a plan has finished. */
export function planSummary(tasks: TaskLike[]): string | null {
  const outcome = planOutcome(tasks.map((t) => t.status));
  if (!outcome) return null;
  const head = outcome === "completed" ? `All ${tasks.length} tasks are complete.`
    : outcome === "partial" ? `The plan is partially complete: ${tasks.filter((t) => t.status === "completed").length} of ${tasks.length} tasks finished.`
    : outcome === "cancelled" ? "The plan was cancelled." : "None of the tasks in this plan finished.";
  const lines = tasks.map((t) => `- ${t.agentName} · ${t.title}: ${t.status === "completed" ? `done${t.result ? ` — ${firstLine(t.result)}` : ""}` : t.status === "failed" ? `failed${t.error ? ` — ${firstLine(t.error)}` : ""}` : "cancelled"}`);
  return [head, ...lines].join("\n");
}
