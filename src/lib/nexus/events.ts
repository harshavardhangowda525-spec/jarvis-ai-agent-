/**
 * Turning real task-record changes into Nexus signals. Only a change seen in
 * the database produces a signal; connecting to the stream replays nothing,
 * so the network never shows traffic that didn't happen. Client-safe & pure.
 */

export type SignalKind = "planned" | "queued" | "dispatch" | "step" | "approval" | "return" | "fail" | "cancel";
export interface JobRow { id: string; agent: string; title: string; status: string; dependsOn: string[]; progress: unknown; updatedAt: string }
export interface Signal { kind: SignalKind; jobId: string; agent: string; title: string; at: string; text: string | null; dependsOn: string[] }

const lastStep = (p: unknown): string | null => {
  const arr = Array.isArray(p) ? (p as { text?: string }[]) : [];
  return arr.length ? arr[arr.length - 1]?.text ?? null : null;
};
const stepCount = (p: unknown) => (Array.isArray(p) ? p.length : 0);

const KIND: Record<string, SignalKind> = { planning: "planned", assigned: "queued", running: "dispatch", waiting_approval: "approval", completed: "return", failed: "fail", cancelled: "cancel" };

export function diffJobs(prev: Map<string, { status: string; steps: number }>, rows: JobRow[]): Signal[] {
  const out: Signal[] = [];
  for (const r of rows) {
    const before = prev.get(r.id);
    const steps = stepCount(r.progress);
    const base = { jobId: r.id, agent: r.agent, title: r.title, at: r.updatedAt, dependsOn: r.dependsOn };
    if (!before || before.status !== r.status) out.push({ ...base, kind: KIND[r.status] ?? "step", text: lastStep(r.progress) });
    else if (steps > before.steps) out.push({ ...base, kind: "step", text: lastStep(r.progress) });
    prev.set(r.id, { status: r.status, steps });
  }
  return out;
}
