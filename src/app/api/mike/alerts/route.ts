import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { getDb } from "@/lib/db";
import { recordActivity } from "@/lib/activity/record";
import { findAsset } from "@/lib/mike/search";
import { ALERT_KINDS, ALERT_LABEL, NEEDS_LEVEL, checkAlerts, type AlertKind } from "@/lib/mike/alerts";
import { resolveOpenSignals } from "@/lib/mike/journal";
import { TIMEFRAMES } from "@/lib/mike/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const user = await requireUser();
    const alerts = await getDb().mikeAlert.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 60 });
    return ok({ alerts });
  } catch (err) {
    return handleError(err);
  }
}

const create = z.object({
  action: z.literal("create"),
  asset: z.string().min(1).max(40),
  kind: z.enum(ALERT_KINDS),
  level: z.number().finite().optional(),
  timeframe: z.enum(TIMEFRAMES).default("1h"),
  note: z.string().max(200).optional(),
});
const check = z.object({ action: z.literal("check") });

/** create an alert, or check every active alert (+ resolve open journal setups). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const raw = await req.json();
    if (raw?.action === "check") {
      check.parse(raw);
      if (!rateLimit(`mike:check:${user.id}`, 6, 60_000).allowed) return ok({ fired: [], resolved: [] });
      const [fired, res] = await Promise.all([checkAlerts(user.id), resolveOpenSignals(user.id).catch(() => ({ resolved: [] }))]);
      return ok({ fired, resolved: res.resolved });
    }
    const b = create.parse(raw);
    if (!rateLimit(`mike:alert:${user.id}`, 20, 60_000).allowed) return fail("Too many alerts at once.", 429);
    if (NEEDS_LEVEL.includes(b.kind as AlertKind) && b.level == null) return fail(`${ALERT_LABEL[b.kind as AlertKind]} needs a level.`, 422);
    const asset = await findAsset(b.asset);
    if (!asset) return fail(`MIKE doesn't recognise "${b.asset}".`, 422);
    const n = await getDb().mikeAlert.count({ where: { userId: user.id, status: "active" } });
    if (n >= 40) return fail("You already have 40 active alerts — remove some first.", 422);
    const alert = await getDb().mikeAlert.create({
      data: { userId: user.id, asset: asset.display, symbol: asset.symbol, provider: asset.provider, timeframe: b.timeframe, kind: b.kind, level: b.level ?? null, note: b.note ?? null },
    });
    await recordActivity(user.id, { category: "decision", agent: "MIKE", source: "mike", action: `MIKE alert set: ${asset.display} ${ALERT_LABEL[b.kind as AlertKind]}${b.level != null ? ` ${b.level}` : ""}`, status: "success", importance: 2 });
    return ok({ alert });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const r = await getDb().mikeAlert.deleteMany({ where: { id, userId: user.id } });
    if (r.count) await recordActivity(user.id, { category: "decision", agent: "MIKE", source: "mike", action: "MIKE alert removed", status: "info", importance: 1 });
    return ok({ removed: r.count });
  } catch (err) {
    return handleError(err);
  }
}
