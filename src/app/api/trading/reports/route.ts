import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { generateNow, getReport, listReports, reportView, tradingSettings } from "@/lib/trading/reports";
import { sourceStatus } from "@/lib/trading/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The weekly reviews: the list, plus one report (latest, or ?week=YYYY-MM-DD&revision=n). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const u = new URL(req.url);
    const week = u.searchParams.get("week") ?? undefined;
    const revision = Number(u.searchParams.get("revision")) || undefined;
    const st = await tradingSettings(user.id);
    return ok({
      reports: await listReports(user.id),
      report: await getReport(user.id, week, revision),
      source: { ...sourceStatus(), backupAt: st.backupAt?.toISOString() ?? null },
      settings: { weeklyEnabled: st.weeklyEnabled, notifyEmail: st.notifyEmail, notifyWhatsapp: st.notifyWhatsapp },
    });
  } catch (e) {
    return handleError(e);
  }
}

const body = z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** "Generate Weekly Analysis" — a fresh read of the playbook; the earlier version is kept as a revision. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`trading-gen:${user.id}`, 6, 60_000).allowed) return fail("Too many requests — wait a moment.", 429);
    const b = body.parse(await req.json().catch(() => ({})));
    const r = await generateNow(user.id, b.week);
    return ok({ report: reportView(r) });
  } catch (e) {
    return handleError(e);
  }
}
