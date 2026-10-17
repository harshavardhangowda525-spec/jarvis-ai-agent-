import "server-only";
import { recordActivity } from "@/lib/activity/record";
import { getDb } from "@/lib/db";
import { leadFingerprint } from "./dedup";

/** Record a real activity-log event. */
export async function logActivity(userId: string, type: string, detail: string, leadId?: string, meta?: Record<string, unknown>) {
  try {
    await getDb().darwinActivity.create({ data: { userId, type, detail, leadId: leadId ?? null, meta: (meta ?? undefined) as object | undefined } });
  } catch { /* logging must never break the flow */ }
  const m = DARWIN_EVENT[type] ?? { category: "business" as const, importance: 2 };
  await recordActivity(userId, {
    category: m.category, agent: "DARWIN", source: "darwin", project: "DARWIN",
    action: detail, status: m.status ?? "success",
    importance: type === "stage_changed" && /→ (Converted|Won)/i.test(detail) ? 4 : m.importance,
    metadata: { type, leadId: leadId ?? null, ...(typeof meta?.count === "number" ? { count: meta.count } : {}) },
  });
}

/** How DARWIN's CRM events read in the activity history. */
const DARWIN_EVENT: Record<string, { category: "business" | "communication" | "error"; importance: number; status?: "success" | "failed" | "info" }> = {
  discovered: { category: "business", importance: 3 },
  qualified: { category: "business", importance: 2 },
  stage_changed: { category: "business", importance: 3 },
  crm_updated: { category: "business", importance: 1 },
  note: { category: "business", importance: 2, status: "info" },
  message_drafted: { category: "business", importance: 2 },
  message_sent: { category: "communication", importance: 3 },
  message_failed: { category: "error", importance: 3, status: "failed" },
  reply_received: { category: "communication", importance: 4 },
  followup_scheduled: { category: "business", importance: 2 },
  followup_completed: { category: "business", importance: 3 },
};

export function followUpBuckets(tz: string) {
  const now = new Date();
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = fmt(now);
  const tomorrow = fmt(new Date(now.getTime() + 86_400_000));
  return { now, today, tomorrow };
}
