import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { getDb } from "@/lib/db";
import { todayIn } from "@/lib/activity/dates";
import { emailChannelReady } from "@/lib/darwin/email";
import { ensurePlan, isDue, listPlans, planSettings, planView, revokePlanLink, rotatePlanLink } from "@/lib/plans/engine";
import { testNotify, whatsappReady } from "@/lib/plans/notify";
import { PLAN_TZ, parseTime } from "@/lib/plans/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Today's plan, the history, your schedule/notification settings and which channels are really set up. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const date = new URL(req.url).searchParams.get("date") ?? todayIn(PLAN_TZ);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Bad date.", 400);
    const [row, history, settings, emailReady] = await Promise.all([
      getDb().marketingPlan.findUnique({ where: { userId_date: { userId: user.id, date } } }),
      listPlans(user.id, 60),
      planSettings(user.id),
      emailChannelReady(user.id).catch(() => false),
    ]);
    return ok({
      date, today: todayIn(PLAN_TZ), plan: row ? planView(row) : null,
      history: history.map((h) => ({ id: h.id, date: h.date, niche: h.niche, status: h.status })),
      settings: { enabled: settings.enabled, deliveryTime: settings.deliveryTime, notifyEmail: settings.notifyEmail, notifyWhatsapp: settings.notifyWhatsapp, due: isDue(new Date(), settings.deliveryTime) },
      channels: { whatsapp: whatsappReady(), email: emailReady },
    });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate") }),
  z.object({ action: z.literal("settings"), enabled: z.boolean().optional(), deliveryTime: z.string().optional(), notifyEmail: z.boolean().optional(), notifyWhatsapp: z.boolean().optional() }),
  z.object({ action: z.literal("rotate"), id: z.string().max(60) }),
  z.object({ action: z.literal("revoke"), id: z.string().max(60) }),
  z.object({ action: z.literal("test_notify") }),
]);

/** generate (today's plan now, or retry a failed one) · settings · rotate / revoke a share link · test_notify */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`plans:${user.id}`, 20, 60_000);
    if (!rl.allowed) return fail("Too many requests — wait a moment.", 429);
    const b = schema.parse(await req.json());
    try {
      if (b.action === "generate") return ok({ plan: planView(await ensurePlan(user.id, { force: true })) });
      if (b.action === "settings") {
        if (b.deliveryTime !== undefined && parseTime(b.deliveryTime) === null) return fail("Use a time like 07:30.", 400);
        const data = { ...(b.enabled !== undefined ? { enabled: b.enabled } : {}), ...(b.deliveryTime ? { deliveryTime: b.deliveryTime.padStart(5, "0") } : {}), ...(b.notifyEmail !== undefined ? { notifyEmail: b.notifyEmail } : {}), ...(b.notifyWhatsapp !== undefined ? { notifyWhatsapp: b.notifyWhatsapp } : {}) };
        const s = await getDb().marketingPlanSettings.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
        return ok({ settings: { enabled: s.enabled, deliveryTime: s.deliveryTime, notifyEmail: s.notifyEmail, notifyWhatsapp: s.notifyWhatsapp } });
      }
      if (b.action === "rotate") return ok({ plan: planView(await rotatePlanLink(user.id, b.id)) });
      if (b.action === "revoke") return ok({ plan: planView(await revokePlanLink(user.id, b.id)) });
      const row = await getDb().marketingPlan.findUnique({ where: { userId_date: { userId: user.id, date: todayIn(PLAN_TZ) } } });
      if (!row || row.status !== "ready") return fail("Today's plan isn't ready yet — make it first.", 409);
      const log = await testNotify(row);
      return ok({ log, note: log.length ? undefined : "Both channels are switched off." });
    } catch (e) {
      return fail((e as Error).message, 409);
    }
  } catch (e) {
    return handleError(e);
  }
}
