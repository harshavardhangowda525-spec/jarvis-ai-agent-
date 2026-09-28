import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import {
  advance, applyAction, currentPackage, dailyConfig, dailyView, defaultDeps, ensurePackage, DailyError,
} from "@/lib/ev/daily/pipeline";
import { autostartDue, localClock } from "@/lib/ev/daily/schedule";
import { spokenStatus } from "@/lib/ev/daily/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * EV's daily content package. GET = today's package + its true status (and it
 * starts today's run if the morning cron hasn't). POST = an action: tick
 * (advance the pipeline), generate, approve, reject, regenerate, another,
 * caption, tone, video, retry.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const cfg = dailyConfig();
    const deps = defaultDeps();
    const now = deps.now();
    if (cfg.enabled && autostartDue(now, cfg.tz, cfg.start)) {
      const today = localClock(now, cfg.tz).date;
      if (!(await currentPackage(user.id, today))) await ensurePackage(user.id, today, "schedule");
    }
    const view = await dailyView(user.id, deps);
    return ok({ ...view, spoken: spokenStatus(view) });
  } catch (err) {
    return handleError(err);
  }
}

const schema = z.object({
  action: z.enum(["tick", "generate", "approve", "reject", "regenerate", "another", "caption", "tone", "video", "retry"]),
  instruction: z.string().trim().max(600).optional(),
  caption: z.string().trim().min(3).max(2000).optional(),
  tone: z.string().trim().max(60).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const rl = rateLimit(`ev-daily:${user.id}:${body.action === "tick" ? "tick" : "act"}`, body.action === "tick" ? 30 : 12, 60_000);
    if (!rl.allowed) return fail("Too many requests — wait a moment.", 429);
    const cfg = dailyConfig();
    const deps = defaultDeps();
    const today = localClock(deps.now(), cfg.tz).date;

    let message = "";
    if (body.action === "tick") {
      const p = await currentPackage(user.id, today);
      if (p && (p.status === "generating" || (p.status === "approved" && p.stage === "publishing" && !p.publishError) || (p.status === "ready" && cfg.autoPublish))) {
        await advance(p.id, { budgetMs: 250_000, deps });
      }
    } else {
      try {
        const r = await applyAction(user.id, today, body as Parameters<typeof applyAction>[2], deps);
        message = r.message;
      } catch (e) {
        if (e instanceof DailyError) return fail(e.message, 409);
        throw e;
      }
    }
    const view = await dailyView(user.id, deps);
    return ok({ ...view, message, spoken: spokenStatus(view) });
  } catch (err) {
    return handleError(err);
  }
}
