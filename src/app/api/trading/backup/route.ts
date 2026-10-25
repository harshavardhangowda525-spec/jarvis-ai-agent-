import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { forgetPlaybookCache, parseBackup } from "@/lib/trading/source";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Only for a playbook running in LOCAL MODE (records in the browser, no
 * Supabase): its own backup file (Settings → Export) — read as-is, never edited.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const text = await req.text();
    if (text.length > 15_000_000) return fail("That backup is larger than 15 MB.", 413);
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return fail("That file isn't valid JSON.", 400); }
    const dump = parseBackup(raw);
    // chart screenshots aren't needed for the review — drop data: URLs to keep the row small
    const slim = JSON.parse(JSON.stringify(dump, (_k, v) => (typeof v === "string" && v.startsWith("data:") ? "[image]" : v)));
    const at = new Date();
    await getDb().tradingSettings.upsert({ where: { userId: user.id }, create: { userId: user.id, backup: slim as Prisma.InputJsonValue, backupAt: at }, update: { backup: slim as Prisma.InputJsonValue, backupAt: at } });
    forgetPlaybookCache(user.id);
    const counts = Object.fromEntries(Object.entries(dump).map(([c, d]) => [c, Object.keys(d).length]));
    return ok({ backupAt: at.toISOString(), counts });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await getDb().tradingSettings.updateMany({ where: { userId: user.id }, data: { backup: Prisma.DbNull, backupAt: null } });
    forgetPlaybookCache(user.id);
    return ok({ removed: true });
  } catch (e) {
    return handleError(e);
  }
}
