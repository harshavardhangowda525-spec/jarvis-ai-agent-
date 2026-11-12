import "server-only";
import { getDb } from "@/lib/db";
import { recordActivity } from "@/lib/activity/record";
import { portalConfigured, portalInbox, type PortalEvent } from "./service";

/**
 * JARVIS watches the Client Portal (manual Part 11): every 5 minutes it looks
 * for new client messages, requests, approvals and reported payments, and puts
 * each one in your activity (important), once. It never replies by itself —
 * you ask, and JARVIS replies.
 */
const EVERY_MS = 5 * 60_000;
const g = globalThis as unknown as { __portalWatch?: { last: number; since: Date } };

export function describeEvent(e: PortalEvent): { action: string; result: string } {
  const where = e.project ? `${e.client} · ${e.project}` : e.client;
  const label = { message: "Client message", request: "Client request", approval: "Client approval", payment: "Payment reported" }[e.kind];
  return { action: `${label} — ${where}`, result: e.text.slice(0, 380) };
}

export async function portalWatchTick(now = new Date(), o: { force?: boolean; inbox?: typeof portalInbox; userId?: string } = {}) {
  if (!portalConfigured() && !o.inbox) return { skipped: "not connected" };
  const st = (g.__portalWatch ??= { last: 0, since: new Date(now.getTime() - 15 * 60_000) });
  if (!o.force && now.getTime() - st.last < EVERY_MS) return { skipped: "not due" };
  st.last = now.getTime();
  const userId = o.userId ?? (await getDb().user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  if (!userId) return { skipped: "no JARVIS user" };
  const events = await (o.inbox ?? portalInbox)(new Date(st.since.getTime() - 60_000)); // a minute of overlap; repeats are skipped below
  let added = 0;
  for (const e of events) {
    const seen = await getDb().activityEvent.findFirst({ where: { userId, source: "portal-watch", metadata: { path: ["ref"], equals: e.ref } }, select: { id: true } });
    if (seen) continue;
    const d = describeEvent(e);
    if (await recordActivity(userId, { category: "communication", agent: "JARVIS", ...d, status: "info", importance: e.kind === "payment" || e.kind === "request" ? 4 : 3, project: e.project || null, source: "portal-watch", metadata: { ref: e.ref, kind: e.kind }, at: e.at })) added++;
  }
  const latest = events.reduce((m, e) => (e.at > m ? e.at : m), st.since);
  st.since = latest;
  return { checked: events.length, added };
}

/** For tests. */
export function _resetWatch() { g.__portalWatch = undefined; }
