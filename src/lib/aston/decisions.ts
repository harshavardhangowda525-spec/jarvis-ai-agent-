import "server-only";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { redact } from "@/lib/activity/redact";
import { recordActivity } from "@/lib/activity/record";
import { addRecovery, closeIncident, getIncident, toDTO } from "./incidents";
import { probe } from "./probe";
import type { IncidentDTO } from "./types";

/**
 * Owner decisions and the actions ASTON may take.
 *
 * SAFE actions (read-only, e.g. re-checking a website) ASTON runs on its own.
 * CONSEQUENTIAL actions (e.g. triggering a redeploy) are only ever *proposed*:
 * they run when the owner explicitly approves with `confirm: true`.
 */

export const DECISIONS = ["acknowledge", "resolve", "dismiss", "approve", "reject", "recheck"] as const;
export type Decision = (typeof DECISIONS)[number];

export interface ActionDef { label: string; safe: boolean; available(): boolean; run(evidence: Record<string, unknown> | null, fetchImpl: typeof fetch): Promise<{ ok: boolean; note: string }> }

export const ACTIONS: Record<string, ActionDef> = {
  recheck_site: {
    label: "Re-check the website",
    safe: true,
    available: () => true,
    async run(ev, f) {
      const url = typeof ev?.url === "string" ? ev.url : null;
      if (!url) return { ok: false, note: "No website URL on this incident." };
      const r = await probe(url, f);
      return { ok: r.ok, note: r.ok ? `${url} answered HTTP ${r.status} in ${r.ms} ms.` : `${url}: ${r.error}` };
    },
  },
  redeploy: {
    label: "Trigger a production redeploy (Vercel deploy hook)",
    safe: false,
    available: () => env.astonRedeployHookUrl.startsWith("https://"),
    async run(_ev, f) {
      const res = await f(env.astonRedeployHookUrl, { method: "POST", signal: AbortSignal.timeout(15_000) });
      return { ok: res.ok, note: res.ok ? "Redeploy started via the deploy hook." : `The deploy hook answered HTTP ${res.status}.` };
    },
  },
};

export class DecisionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** ASTON asks for permission: records an action the owner must approve. */
export async function requestApproval(userId: string, id: string, type: string, reason: string): Promise<IncidentDTO> {
  const inc = await getIncident(userId, id);
  if (!inc) throw new DecisionError("Incident not found.", 404);
  const def = ACTIONS[type];
  if (!def) throw new DecisionError(`Unknown action "${type}".`);
  if (!def.available()) throw new DecisionError(`"${def.label}" is not configured on this server.`);
  const row = await getDb().astonIncident.update({ where: { id }, data: { pendingAction: { type, reason: redact(reason).slice(0, 300), requestedAt: new Date().toISOString() } } });
  return toDTO(row);
}

/** Suggest the redeploy action on failed deployments when a deploy hook is configured. */
export async function proposeActions(userId: string): Promise<void> {
  if (!ACTIONS.redeploy.available()) return;
  const rows = await getDb().astonIncident.findMany({ where: { userId, status: { in: ["open", "acknowledged"] }, kind: "deploy_failed", pendingAction: { equals: Prisma.DbNull } }, select: { id: true } });
  for (const r of rows) await requestApproval(userId, r.id, "redeploy", "Redeploy production once the cause of the failed deployment is fixed.").catch(() => {});
}

export async function decide(
  userId: string, id: string, action: Decision,
  o: { note?: string | null; confirm?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<{ incident: IncidentDTO; result: string }> {
  const db = getDb();
  const inc = await getIncident(userId, id);
  if (!inc) throw new DecisionError("Incident not found.", 404);
  const open = inc.status === "open" || inc.status === "acknowledged";
  const f = o.fetchImpl ?? fetch;
  let result = "";

  switch (action) {
    case "acknowledge":
      if (!open) throw new DecisionError(`The incident is already ${inc.status}.`, 409);
      await db.astonIncident.update({ where: { id }, data: { status: "acknowledged", acknowledgedAt: new Date() } });
      // Seen = stop further alerts for it.
      await db.astonAlert.updateMany({ where: { incidentId: id, status: { in: ["pending", "failed"] } }, data: { status: "skipped", lastError: "Acknowledged by the owner.", nextAttemptAt: null } });
      result = "Acknowledged. ASTON won't alert you about it again.";
      break;
    case "resolve":
    case "dismiss":
      if (!open) throw new DecisionError(`The incident is already ${inc.status}.`, 409);
      await closeIncident(id, { status: action === "resolve" ? "resolved" : "dismissed", resolution: o.note?.trim() || (action === "resolve" ? "Resolved by the owner." : "Dismissed by the owner.") });
      result = action === "resolve" ? "Marked as resolved." : "Dismissed.";
      break;
    case "recheck": {
      const r = await ACTIONS.recheck_site.run(inc.evidence as Record<string, unknown> | null, f);
      await addRecovery(id, { action: "Owner-requested re-check", ok: r.ok, note: r.note });
      result = r.note;
      break;
    }
    case "approve": {
      const pa = inc.pendingAction as { type?: string } | null;
      if (!pa?.type || !ACTIONS[pa.type]) throw new DecisionError("There is no action waiting for approval.", 409);
      if (o.confirm !== true) throw new DecisionError("Approval must be confirmed explicitly (confirm: true).", 428);
      const def = ACTIONS[pa.type];
      if (!def.available()) throw new DecisionError(`"${def.label}" is no longer configured.`, 409);
      let r: { ok: boolean; note: string };
      try { r = await def.run(inc.evidence as Record<string, unknown> | null, f); }
      catch (e) { r = { ok: false, note: redact(e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
      await addRecovery(id, { action: `Approved: ${def.label}`, ok: r.ok, note: r.note });
      await db.astonIncident.update({ where: { id }, data: { pendingAction: Prisma.DbNull } });
      result = r.note;
      break;
    }
    case "reject":
      await db.astonIncident.update({ where: { id }, data: { pendingAction: Prisma.DbNull } });
      result = "Okay — ASTON won't do it.";
      break;
  }

  await db.astonDecision.create({ data: { incidentId: id, userId, action, note: o.note ? redact(o.note).slice(0, 1000) : null, result: result.slice(0, 1000) } });
  await recordActivity(userId, { category: "decision", agent: "ASTON", source: "aston", status: "info", action: `ASTON: ${action} — ${inc.title}`, result, project: inc.project, importance: 3 });
  const fresh = await getIncident(userId, id);
  return { incident: toDTO(fresh!), result };
}
