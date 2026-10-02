import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { redact, redactMeta } from "./redact";
import { localDate, validTz } from "./dates";

/**
 * JARVIS's activity recorder. Every meaningful thing that happens — commands,
 * tool actions, DARWIN/EV/ULTRON work, tasks, errors, things you tell JARVIS —
 * goes through recordActivity(). Secrets are redacted before storage, repeats
 * within 90 seconds are dropped, and it never throws (recording must never
 * break the action being recorded).
 */

import type { ActivityCategory } from "./record-types";
export type { ActivityCategory };

export const AGENTS = ["JARVIS", "DARWIN", "EV", "ULTRON", "HUMANOID", "MIKE", "RUBIN"] as const;

export interface ActivityInput {
  category: ActivityCategory;
  agent: string;
  action: string;
  result?: string | null;
  status?: "success" | "failed" | "info";
  /** 1 minor · 2 normal · 3 notable · 4 important · 5 critical */
  importance?: number;
  project?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
  at?: Date;
}

const tzCache = new Map<string, { tz: string; at: number }>();
async function userTz(userId: string): Promise<string> {
  const hit = tzCache.get(userId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.tz;
  const p = await getDb().profile.findUnique({ where: { userId }, select: { timezone: true } }).catch(() => null);
  const tz = validTz(p?.timezone);
  tzCache.set(userId, { tz, at: Date.now() });
  return tz;
}
/** Called when the profile timezone changes. */
export function forgetTz(userId: string) { tzCache.delete(userId); }

const clean = (s: string | null | undefined, max: number) =>
  s == null ? null : redact(String(s)).replace(/\s+/g, " ").trim().slice(0, max) || null;

export async function recordActivity(userId: string, e: ActivityInput): Promise<string | null> {
  try {
    const action = clean(e.action, 300);
    if (!userId || !action) return null;
    const result = clean(e.result, 400);
    const status = e.status ?? "info";
    const agent = (e.agent || "JARVIS").toUpperCase().slice(0, 30);
    const at = e.at ?? new Date();
    const db = getDb();
    const fingerprint = createHash("sha1").update(`${agent}|${e.category}|${action}|${result ?? ""}|${status}`).digest("hex").slice(0, 32);
    const dup = await db.activityEvent.findFirst({
      where: { userId, fingerprint, timestamp: { gte: new Date(at.getTime() - 90_000) } }, select: { id: true },
    });
    if (dup) return dup.id;
    const tz = await userTz(userId);
    const row = await db.activityEvent.create({
      data: {
        userId, timestamp: at, date: localDate(at, tz), category: e.category, agent, action, result, status,
        importance: Math.min(5, Math.max(1, Math.round(e.importance ?? 2))),
        project: clean(e.project, 80), source: e.source.slice(0, 20),
        metadata: e.metadata ? (redactMeta(e.metadata) as object) : undefined,
        fingerprint,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error("[activity] record failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** "Forget this event": remove one event (only the owner's). */
export async function forgetActivity(userId: string, id: string): Promise<boolean> {
  const r = await getDb().activityEvent.deleteMany({ where: { id, userId } });
  return r.count > 0;
}
