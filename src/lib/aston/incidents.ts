import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { recordActivity } from "@/lib/activity/record";
import { redact, redactMeta } from "@/lib/activity/redact";
import {
  KIND_PRIORITY, PRIORITY_RANK, maxPriority,
  type IncidentDTO, type IncidentSignal, type Priority, type RecoveryStep,
} from "./types";

/**
 * The persistent incident store. Duplicate detection is enforced by the
 * database: an open incident holds `openKey = userId:fingerprint` (unique), so
 * a second signal for the same problem — even arriving concurrently — becomes
 * an occurrence on the existing incident, never a second incident/alert.
 */

export const fingerprintOf = (s: Pick<IncidentSignal, "source" | "kind" | "key">) =>
  createHash("sha256").update(`${s.source}|${s.kind}|${s.key.trim().toLowerCase()}`).digest("hex").slice(0, 40);

const clip = (v: string | null | undefined, n: number) => (v ? redact(v).slice(0, n) : null);
const OPEN = ["open", "acknowledged"];

type Row = Prisma.AstonIncidentGetPayload<object>;

export function toDTO(r: Row): IncidentDTO {
  const pa = r.pendingAction as { type?: string; reason?: string } | null;
  return {
    id: r.id, source: r.source, kind: r.kind, priority: r.priority as Priority, status: r.status as IncidentDTO["status"],
    project: r.project, title: r.title, detail: r.detail, summary: r.summary, recommendation: r.recommendation,
    recovery: Array.isArray(r.recovery) ? (r.recovery as unknown as RecoveryStep[]) : [],
    pendingAction: pa?.type ? { type: pa.type, reason: pa.reason ?? "" } : null,
    occurrences: r.occurrences, verified: r.verified, verifyNote: r.verifyNote,
    firstSeenAt: r.firstSeenAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null, resolution: r.resolution,
  };
}

export interface RaiseResult { incident: Row; created: boolean }

/** Record a real signal. New problem → new incident; same open problem → one more occurrence. */
export async function raiseIncident(userId: string, s: IncidentSignal): Promise<RaiseResult> {
  const db = getDb();
  const fingerprint = fingerprintOf(s);
  const openKey = `${userId}:${fingerprint}`;
  const priority = s.priority ?? KIND_PRIORITY[s.kind] ?? "normal";
  const now = new Date();
  try {
    const incident = await db.astonIncident.create({
      data: {
        userId, fingerprint, openKey, source: s.source.slice(0, 40), kind: s.kind, priority,
        project: clip(s.project, 120), title: clip(s.title, 300) ?? s.kind, detail: clip(s.detail, 4000),
        evidence: s.evidence ? (redactMeta(s.evidence) as object) : undefined,
        recovery: s.recovery?.length ? (s.recovery as unknown as object) : undefined,
        recommendation: clip(s.recommendation, 1000),
      },
    });
    await recordActivity(userId, {
      category: s.kind === "decision_required" ? "decision" : s.kind === "info" ? "notice" : "error",
      agent: "ASTON", source: "aston", project: incident.project, status: "info",
      action: `ASTON incident (${priority}): ${incident.title}`, result: incident.detail?.slice(0, 200) ?? null,
      importance: priority === "critical" ? 5 : priority === "high" ? 4 : 2, metadata: { incidentId: incident.id, kind: s.kind },
    });
    return { incident, created: true };
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  // Already open: count the repeat (and escalate priority if this signal is more severe).
  const cur = await db.astonIncident.findUnique({ where: { openKey } });
  if (!cur) return raiseIncident(userId, s); // closed in the meantime → a fresh incident
  // A repeated event re-reports the same recovery steps — keep each step once.
  const prev = Array.isArray(cur.recovery) ? (cur.recovery as unknown as RecoveryStep[]) : [];
  const stepKey = (x: RecoveryStep) => `${x.action}|${x.ok}|${x.note ?? ""}`;
  const known = new Set(prev.map(stepKey));
  const added = (s.recovery ?? []).filter((x) => !known.has(stepKey(x)));
  const recovery = [...prev, ...added].slice(-20);
  const incident = await db.astonIncident.update({
    where: { id: cur.id },
    data: {
      occurrences: { increment: 1 }, lastSeenAt: now,
      priority: maxPriority(cur.priority as Priority, priority),
      detail: clip(s.detail, 4000) ?? cur.detail,
      ...(s.evidence ? { evidence: redactMeta(s.evidence) as object } : {}),
      ...(added.length ? { recovery: recovery as unknown as object } : {}),
      ...(s.recommendation ? { recommendation: clip(s.recommendation, 1000) } : {}),
    },
  });
  return { incident, created: false };
}

/** Close an incident (resolved by a signal, the owner, or recovery). Undelivered alerts are cancelled. */
export async function closeIncident(id: string, how: { status?: "resolved" | "dismissed"; resolution: string }): Promise<Row | null> {
  const db = getDb();
  const cur = await db.astonIncident.findUnique({ where: { id } });
  if (!cur || !OPEN.includes(cur.status)) return cur;
  const row = await db.astonIncident.update({
    where: { id },
    data: { status: how.status ?? "resolved", openKey: null, resolvedAt: new Date(), resolution: clip(how.resolution, 1000), pendingAction: Prisma.DbNull },
  });
  await db.astonAlert.updateMany({
    where: { incidentId: id, status: { in: ["pending", "failed"] } },
    data: { status: "skipped", lastError: "Incident closed before delivery.", nextAttemptAt: null },
  });
  return row;
}

/** A "recovered / succeeded" signal closes the matching open incident, if any. */
export async function resolveBySignal(userId: string, s: Pick<IncidentSignal, "source" | "kind" | "key">, resolution: string): Promise<Row | null> {
  const open = await getDb().astonIncident.findUnique({ where: { openKey: `${userId}:${fingerprintOf(s)}` } });
  return open ? closeIncident(open.id, { resolution }) : null;
}

export async function addRecovery(id: string, step: Omit<RecoveryStep, "at">): Promise<void> {
  const db = getDb();
  const cur = await db.astonIncident.findUnique({ where: { id }, select: { recovery: true } });
  if (!cur) return;
  const list = [...(Array.isArray(cur.recovery) ? (cur.recovery as unknown as RecoveryStep[]) : []), { ...step, note: step.note ? redact(step.note).slice(0, 300) : undefined, at: new Date().toISOString() }].slice(-20);
  await db.astonIncident.update({ where: { id }, data: { recovery: list as unknown as object } });
}

export async function openIncidents(userId: string, where: Prisma.AstonIncidentWhereInput = {}): Promise<Row[]> {
  return getDb().astonIncident.findMany({ where: { userId, status: { in: OPEN }, ...where }, orderBy: { lastSeenAt: "desc" }, take: 200 });
}

/** Open incidents first by priority, then the most recently closed ones. */
export async function listIncidents(userId: string, o: { includeClosed?: boolean; limit?: number } = {}): Promise<IncidentDTO[]> {
  const db = getDb();
  const open = (await openIncidents(userId)).sort((a, b) => PRIORITY_RANK[b.priority as Priority] - PRIORITY_RANK[a.priority as Priority] || b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  const closed = o.includeClosed
    ? await db.astonIncident.findMany({ where: { userId, status: { notIn: OPEN } }, orderBy: { resolvedAt: "desc" }, take: 20 })
    : [];
  return [...open, ...closed].slice(0, o.limit ?? 100).map(toDTO);
}

export async function getIncident(userId: string, id: string): Promise<Row | null> {
  return getDb().astonIncident.findFirst({ where: { id, userId } });
}
