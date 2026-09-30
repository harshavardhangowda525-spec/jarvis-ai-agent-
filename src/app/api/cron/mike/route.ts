import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { checkAlerts } from "@/lib/mike/alerts";
import { resolveOpenSignals } from "@/lib/mike/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled MIKE check: fire alerts and resolve open journal setups for every
 * user who has any (Vercel Cron, or the local runner every few minutes).
 * Needs `Authorization: Bearer <CRON_SECRET>`. Never trades.
 */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    const db = getDb();
    const [a, s] = await Promise.all([
      db.mikeAlert.findMany({ where: { status: "active" }, select: { userId: true }, distinct: ["userId"] }),
      db.mikeSignal.findMany({ where: { decision: "setup", status: { in: ["open", "triggered"] } }, select: { userId: true }, distinct: ["userId"] }),
    ]);
    const users = [...new Set([...a, ...s].map((x) => x.userId))].slice(0, 50);
    const results = [];
    for (const u of users) {
      const [fired, res] = await Promise.all([checkAlerts(u).catch(() => []), resolveOpenSignals(u).catch(() => ({ resolved: [] }))]);
      results.push({ user: u.slice(-6), fired: fired.length, resolved: res.resolved.length, messages: fired.map((f) => f.message) });
    }
    return ok({ users: users.length, results });
  } catch (err) {
    return handleError(err);
  }
}
