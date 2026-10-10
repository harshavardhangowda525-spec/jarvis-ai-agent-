import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { redact } from "@/lib/activity/redact";
import { DETECTORS, type Detector, type DetectorCtx } from "./detectors";
import { closeIncident, raiseIncident } from "./incidents";
import { dispatch, type NotifyDeps } from "./notify";
import { proposeActions } from "./decisions";

/**
 * One ASTON cycle for a user: run the detectors (raise new problems, close the
 * ones that went away), propose approval-gated actions, then dispatch alerts.
 * Runs from the cron (/api/cron/aston), the local runner, and while ASTON is
 * open. Throttled per user; the throttle lives in the database.
 */

export const TICK_EVERY_MS = 2 * 60_000;

export interface TickResult { ran: boolean; raised: number; closed: number; queued: number; delivered: number; failed: number; errors: string[] }

export async function runDetectors(userId: string, ctx: DetectorCtx, detectors: Detector[] = DETECTORS) {
  let raised = 0, closed = 0;
  const errors: string[] = [];
  for (const det of detectors) {
    let signals;
    try { signals = await det.run(userId, ctx); }
    catch (e) {
      // A detector that couldn't look must not "resolve" anything.
      errors.push(`${det.source}: ${redact(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      continue;
    }
    const seen = new Set<string>();
    for (const s of signals) {
      const r = await raiseIncident(userId, s);
      seen.add(r.incident.fingerprint);
      if (r.created) raised++;
    }
    if (det.sticky) continue;
    const open = await getDb().astonIncident.findMany({ where: { userId, source: det.source, status: { in: ["open", "acknowledged"] } }, select: { id: true, fingerprint: true } });
    for (const o of open) {
      if (seen.has(o.fingerprint)) continue;
      await closeIncident(o.id, { resolution: `Recovered — ASTON re-checked ${det.source.toUpperCase()} and the problem is no longer present.` });
      closed++;
    }
  }
  return { raised, closed, errors };
}

async function claimTick(userId: string, now: Date, force: boolean): Promise<boolean> {
  const db = getDb();
  const row = await db.integration.findUnique({ where: { userId_provider: { userId, provider: "aston" } } });
  const last = Date.parse(((row?.metadata ?? {}) as { lastTickAt?: string }).lastTickAt ?? "") || 0;
  if (!force && now.getTime() - last < TICK_EVERY_MS) return false;
  const metadata = { ...((row?.metadata ?? {}) as object), lastTickAt: now.toISOString() };
  await db.integration.upsert({
    where: { userId_provider: { userId, provider: "aston" } },
    create: { userId, provider: "aston", status: "connected", metadata },
    update: { metadata },
  });
  return true;
}

export async function tick(userId: string, o: { force?: boolean; deps?: Partial<NotifyDeps>; detectors?: Detector[] } = {}): Promise<TickResult> {
  const now = o.deps?.now?.() ?? new Date();
  if (!(await claimTick(userId, now, !!o.force))) return { ran: false, raised: 0, closed: 0, queued: 0, delivered: 0, failed: 0, errors: [] };
  const det = await runDetectors(userId, { now, fetchImpl: o.deps?.fetchImpl, sleep: o.deps?.sleep }, o.detectors);
  await proposeActions(userId);
  const d = await dispatch(userId, o.deps);
  return { ran: true, raised: det.raised, closed: det.closed, ...d, errors: det.errors };
}

/** The owner's user id (ASTON_OWNER_EMAIL), or null when unset / not signed up. */
export async function ownerUserId(): Promise<string | null> {
  if (!env.astonOwnerEmail) return null;
  const u = await getDb().user.findUnique({ where: { email: env.astonOwnerEmail }, select: { id: true } });
  return u?.id ?? null;
}

/** Cron: the owner, or (no owner configured) everyone who has opened ASTON. */
export async function tickAll(): Promise<{ users: number; results: TickResult[] }> {
  const owner = await ownerUserId();
  const ids = owner
    ? [owner]
    : (await getDb().integration.findMany({ where: { provider: "aston" }, select: { userId: true }, take: 50 })).map((r) => r.userId);
  const results: TickResult[] = [];
  for (const id of ids) results.push(await tick(id, { force: true }));
  return { users: ids.length, results };
}
