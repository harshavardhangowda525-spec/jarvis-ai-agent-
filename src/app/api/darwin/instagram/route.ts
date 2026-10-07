import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { dailyNow } from "@/lib/darwin/daily/run";
import { advanceIgRun, ensureIgRun, igSummary } from "@/lib/darwin/instagram/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const logOf = (l: unknown) => (Array.isArray(l) ? (l as { at: string; text: string; tone?: string }[]) : []);

/**
 * DARWIN's "Instagram + No Website" section — kept apart from the daily leads:
 * today's task (status + summary), its verified leads, and the last few days.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const db = getDb();
    const date = dailyNow().date;
    const u = new URL(req.url).searchParams;
    const q = u.get("q")?.trim();
    const contact = u.get("contact")?.trim();
    const where: Prisma.DarwinIgLeadWhereInput = {
      userId: user.id,
      ...(q ? { OR: [{ businessName: { contains: q, mode: "insensitive" } }, { instagramUsername: { contains: q.replace(/^@/, ""), mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] } : {}),
      ...(contact ? { contactStatus: contact } : {}),
      ...(u.get("high") === "1" ? { highPotential: true } : {}),
    };
    const [run, primary, leads, total, history] = await Promise.all([
      db.darwinIgRun.findUnique({ where: { userId_date: { userId: user.id, date } } }),
      db.darwinDailyRun.findUnique({ where: { userId_date: { userId: user.id, date } }, select: { status: true, verified: true, target: true } }),
      db.darwinIgLead.findMany({ where, orderBy: [{ foundDate: "desc" }, { qualityScore: "desc" }], take: 300 }),
      db.darwinIgLead.count({ where: { userId: user.id } }),
      db.darwinIgRun.findMany({ where: { userId: user.id, date: { not: date } }, orderBy: { date: "desc" }, take: 7, select: { date: true, saved: true, target: true, status: true } }),
    ]);
    return ok({
      enabled: env.darwinIg,
      date,
      primary,
      run: run ? {
        id: run.id, status: run.status, target: run.target, summary: igSummary(run), reasons: run.reasons, lastError: run.lastError,
        startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null, log: logOf(run.log).slice(-10),
      } : null,
      leads, total, history,
    });
  } catch (err) {
    return handleError(err);
  }
}

/** "Run it now": works on today's task straight away — only once today's main search is complete. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`darwin-ig:${user.id}`, 6, 60_000);
    if (!rl.allowed) return fail("Give it a moment — it's already working.", 429);
    const body = z.object({ action: z.literal("run") }).safeParse(await req.json().catch(() => ({})));
    if (!body.success) return fail("Unknown action.", 422);
    if (!env.darwinIg) return fail('"Instagram + No Website Leads" is turned off (DARWIN_INSTAGRAM=off).', 409);
    const primary = await getDb().darwinDailyRun.findUnique({ where: { userId_date: { userId: user.id, date: dailyNow().date } } });
    if (!primary || primary.status !== "completed") {
      return fail(`This starts once today's main search is complete${primary ? ` (${primary.verified}/${primary.target} so far)` : " (it hasn't started yet)"} — it never runs ahead of it.`, 409);
    }
    let run = await ensureIgRun(primary);
    if (run?.status === "running") run = await advanceIgRun(run.id, { budgetMs: 45_000 });
    return ok({ status: run?.status ?? null, summary: run ? igSummary(run) : null, lastError: run?.lastError ?? null });
  } catch (err) {
    return handleError(err);
  }
}
