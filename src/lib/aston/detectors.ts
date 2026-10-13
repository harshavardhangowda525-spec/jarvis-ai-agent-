import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { confirmDown } from "./probe";
import { parseWatchUrls, type IncidentSignal } from "./types";

/**
 * ASTON's detectors read REAL records written by the other agents — DARWIN's
 * daily runs, EV's daily content, the activity log every agent writes to,
 * JARVIS tasks, RUBIN follow-ups, the biometric gate — and live website
 * probes. No detector asks an AI whether something failed.
 *
 * Each detector returns the problems that exist right now. An open incident
 * from a detector that is no longer reported is closed as recovered (unless
 * the detector is "sticky": those wait for the owner to acknowledge them).
 */

export interface DetectorCtx { now: Date; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }
export interface Detector { source: string; sticky?: boolean; run(userId: string, ctx: DetectorCtx): Promise<IncidentSignal[]> }

const H = 3_600_000;

export const darwinDetector: Detector = {
  source: "darwin",
  async run(userId, { now }) {
    const runs = await getDb().darwinDailyRun.findMany({
      where: { userId, startedAt: { gte: new Date(now.getTime() - 36 * H) }, status: { in: ["failed", "needs_setup"] } },
      select: { id: true, date: true, status: true, lastError: true, verified: true, target: true },
    });
    return runs.map((r) => r.status === "failed"
      ? {
          source: "darwin", kind: "agent_failures", key: `run:${r.id}`, project: "DARWIN daily lead search",
          title: `DARWIN's daily lead search failed (${r.date})`,
          detail: `${r.verified}/${r.target} leads found before it stopped.${r.lastError ? ` Last error: ${r.lastError.slice(0, 400)}` : ""}`,
          evidence: { runId: r.id, status: r.status },
          recommendation: "Open DARWIN, read the run log, fix the failing data source, then restart today's search.",
        }
      : {
          source: "darwin", kind: "task_blocked", key: `setup:${r.id}`, project: "DARWIN daily lead search",
          title: `DARWIN is blocked: it needs setup (${r.date})`,
          detail: r.lastError?.slice(0, 400) ?? "No lead source is connected, so the daily search cannot run.",
          evidence: { runId: r.id, status: r.status },
          recommendation: "Connect a lead source (e.g. GEOAPIFY_API_KEY, free) in the server settings.",
        });
  },
};

export const evDetector: Detector = {
  source: "ev",
  async run(userId, { now }) {
    const rows = await getDb().evDaily.findMany({
      where: { userId, current: true, createdAt: { gte: new Date(now.getTime() - 36 * H) }, status: { in: ["failed", "ready"] } },
      select: { id: true, date: true, status: true, error: true, publishError: true, topic: true },
    });
    return rows.map((r) => r.status === "failed"
      ? {
          source: "ev", kind: "agent_failures", key: `daily:${r.id}`, project: "EV daily content",
          title: `EV could not prepare the daily post (${r.date})`,
          detail: (r.publishError || r.error || "The content pipeline stopped.").slice(0, 400),
          evidence: { evDailyId: r.id }, recommendation: "Open EV and retry today's content, or reject it.",
        }
      // Routine approval: stored and shown in ASTON, not an interruption.
      : {
          source: "ev", kind: "decision_required", priority: "normal", key: `approve:${r.id}`, project: "EV daily content",
          title: `Today's EV post is waiting for your approval (${r.date})`,
          detail: r.topic ? `Topic: ${r.topic}` : null, evidence: { evDailyId: r.id },
          recommendation: "Approve or reject it in EV.",
        });
  },
};

/** The same agent failing again and again within an hour. */
export const agentFailureDetector: Detector = {
  source: "agents",
  async run(userId, { now }) {
    const groups = await getDb().activityEvent.groupBy({
      by: ["agent"],
      where: { userId, status: "failed", agent: { not: "ASTON" }, timestamp: { gte: new Date(now.getTime() - H) } },
      _count: { _all: true },
      _max: { timestamp: true },
    });
    const out: IncidentSignal[] = [];
    for (const g of groups) {
      if (g._count._all < env.astonFailureThreshold) continue;
      const last = await getDb().activityEvent.findMany({
        where: { userId, status: "failed", agent: g.agent, timestamp: { gte: new Date(now.getTime() - H) } },
        orderBy: { timestamp: "desc" }, take: 3, select: { action: true, result: true },
      });
      out.push({
        source: "agents", kind: "agent_failures", key: `agent:${g.agent}`, project: g.agent,
        title: `${g.agent} failed ${g._count._all} times in the last hour`,
        detail: last.map((l) => `• ${l.action}${l.result ? ` — ${l.result}` : ""}`).join("\n").slice(0, 1500),
        evidence: { failures: g._count._all, lastAt: g._max.timestamp?.toISOString() ?? null },
        recommendation: `Check ${g.agent}'s configuration and the error above before it runs again.`,
      });
    }
    return out;
  },
};

/** High-priority deadlines due within 24 h (or overdue), and overdue high-priority RUBIN follow-ups. */
export const deadlineDetector: Detector = {
  source: "tasks",
  async run(userId, { now }) {
    const db = getDb();
    const tasks = await db.task.findMany({
      where: { userId, status: "pending", priority: "high", dueAt: { not: null, lte: new Date(now.getTime() + 24 * H) } },
      select: { id: true, title: true, dueAt: true }, take: 20,
    });
    const follow = await db.robinFollowUp.findMany({
      where: { userId, status: "pending", priority: "high", dueAt: { lt: now } },
      select: { id: true, action: true, dueAt: true, lead: { select: { businessName: true } } }, take: 20,
    });
    return [
      ...tasks.map((t): IncidentSignal => {
        const overdue = t.dueAt!.getTime() < now.getTime();
        return {
          source: "tasks", kind: "deadline_risk", key: `task:${t.id}`, project: "JARVIS tasks",
          title: `${overdue ? "Overdue" : "Due soon"}: ${t.title}`,
          detail: `High-priority task ${overdue ? "was due" : "is due"} ${t.dueAt!.toISOString()}.`,
          evidence: { taskId: t.id, dueAt: t.dueAt!.toISOString() },
          recommendation: overdue ? "Finish it, or move the deadline and tell the client." : "Block time for it today.",
        };
      }),
      ...follow.map((f): IncidentSignal => ({
        source: "tasks", kind: "deadline_risk", priority: "normal", key: `followup:${f.id}`, project: "RUBIN",
        title: `Overdue ${f.action} follow-up: ${f.lead.businessName}`,
        detail: `Was due ${f.dueAt.toISOString()}.`, evidence: { followUpId: f.id },
        recommendation: "Do the follow-up in RUBIN or reschedule it.",
      })),
    ];
  },
};

/** JARVIS's biometric gate locked itself after repeated failed unlock attempts. */
export const gateDetector: Detector = {
  source: "gate",
  sticky: true,
  async run(userId, { now }) {
    const g = await getDb().gateSecurity.findUnique({ where: { userId }, select: { lockouts: true, lockedUntil: true, failedCount: true } });
    if (!g?.lockedUntil || g.lockouts < 1 || g.lockedUntil.getTime() < now.getTime() - 24 * H) return [];
    return [{
      source: "gate", kind: "security", priority: "high", key: `lockout:${g.lockouts}`, project: "JARVIS security",
      title: "JARVIS locked itself after repeated failed unlock attempts",
      detail: `Lockout #${g.lockouts}; locked until ${g.lockedUntil.toISOString()}.`,
      evidence: { lockouts: g.lockouts, failedCount: g.failedCount },
      recommendation: "If this wasn't you, sign out all sessions (Settings → Security) and change your PIN.",
    }];
  },
};

/** Live checks of the production sites in ASTON_WATCH_URLS (must fail twice to count). */
export const siteDetector: Detector = {
  source: "probe",
  async run(_userId, { fetchImpl, sleep }) {
    const out: IncidentSignal[] = [];
    for (const site of parseWatchUrls(env.astonWatchUrls)) {
      const { down, checks } = await confirmDown(site.url, fetchImpl, 4_000, sleep);
      if (!down) continue;
      out.push({
        source: "probe", kind: "prod_incident", key: `site:${site.url}`, project: site.name,
        title: `${site.name} is down`,
        detail: `${site.url} failed two checks in a row: ${checks.map((c) => c.error ?? `HTTP ${c.status}`).join(", ")}.`,
        evidence: { url: site.url, checks },
        recovery: checks.map((c, i) => ({ at: new Date().toISOString(), action: `Health check ${i + 1}`, ok: c.ok, note: c.error ?? `HTTP ${c.status}` })),
        recommendation: "Check the hosting dashboard (Vercel) for a failed deploy or outage; roll back the last deploy if it started after a release.",
      });
    }
    return out;
  },
};

export const DETECTORS: Detector[] = [siteDetector, darwinDetector, evDetector, agentFailureDetector, deadlineDetector, gateDetector];
