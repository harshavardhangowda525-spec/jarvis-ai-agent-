import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { env } from "@/lib/env";
import { advanceRun, adoptEmailGoal, darwinDailyView, dailyDue, ensureRun, saveConfig, todayRun, syncRunToSheet } from "@/lib/darwin/daily/run";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * DARWIN's daily search. GET = today's progress / report (starts today's run
 * once it's due). POST: tick (continue the search), start (start now even before
 * the scheduled time), settings (locations, categories, target…), ack (JARVIS
 * has told you the report).
 */
export async function GET() {
  try {
    const user = await requireUser();
    if (env.darwinDaily && dailyDue() && !(await todayRun(user.id))) await ensureRun(user.id);
    return ok(await darwinDailyView(user.id));
  } catch (err) {
    return handleError(err);
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tick") }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("ack") }),
  z.object({
    action: z.literal("settings"),
    locations: z.array(z.string().trim().min(2).max(120)).max(12).optional(),
    categories: z.array(z.string().trim().min(2).max(60)).max(24).optional(),
    target: z.number().int().min(1).max(200).optional(),
    radiusKm: z.number().min(1).max(25).optional(),
    requirePhone: z.boolean().optional(),
    strict: z.boolean().optional(),
    autoEmail: z.boolean().optional(),
    emailTarget: z.number().int().min(0).max(40).optional(),
    allBangalore: z.boolean().optional(),
    keepGoing: z.boolean().optional(),
  }),
]);

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const rl = rateLimit(`darwin-daily:${user.id}:${body.action}`, body.action === "tick" ? 20 : 10, 60_000);
    if (!rl.allowed) return fail("Too many requests — wait a moment.", 429);

    if (body.action === "settings") {
      const { action: _a, ...rest } = body;
      void _a;
      await saveConfig(user.id, rest);
      // today's run picks up new settings if it hasn't really started yet
      const run = await todayRun(user.id);
      if (run && (run.status === "needs_setup" || (run.status === "running" && run.verified === 0 && run.candidates === 0))) {
        await getDb().darwinDailyRun.delete({ where: { id: run.id } });
        if (dailyDue()) await ensureRun(user.id);
      } else if (run) await adoptEmailGoal(run); // a new email goal applies to today straight away
    } else if (body.action === "start") {
      let run = await todayRun(user.id);
      if (!run) run = await ensureRun(user.id);
      else if (run.status === "needs_setup") { await getDb().darwinDailyRun.delete({ where: { id: run.id } }); run = await ensureRun(user.id); }
      if (run.status === "running") await advanceRun(run.id, { budgetMs: 250_000 });
      await syncRunToSheet(run.id);
    } else if (body.action === "tick") {
      const run = await todayRun(user.id);
      if (run?.status === "running") await advanceRun(run.id, { budgetMs: 250_000 });
      if (run) await syncRunToSheet(run.id);
    } else if (body.action === "ack") {
      await getDb().darwinDailyRun.updateMany({ where: { userId: user.id, reportedAt: null, status: { in: ["completed", "partial"] } }, data: { reportedAt: new Date() } });
    }
    return ok(await darwinDailyView(user.id));
  } catch (err) {
    return handleError(err);
  }
}
