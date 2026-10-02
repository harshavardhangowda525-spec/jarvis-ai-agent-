import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { RobinError, createLead, findDuplicate } from "@/lib/robin/crm";
import { logInteraction } from "@/lib/robin/engage";
import { signRobinWebhook } from "@/lib/robin/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound webhook for other systems (a form, WhatsApp Business, Zapier…): a new
 * lead, or a reply from a lead. Authenticated with an HMAC-SHA256 signature of
 * `${timestamp}.${rawBody}` using ROBIN_WEBHOOK_SECRET (header
 * `x-robin-signature: sha256=<hex>`, `x-robin-timestamp: <unix seconds>`),
 * rejected if older than 5 minutes. Off until the secret is set.
 */

const schema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("lead"), userEmail: z.string().email(),
    lead: z.object({ businessName: z.string().trim().min(1).max(160), category: z.string().max(80).optional(), phone: z.string().max(40).optional(), whatsapp: z.string().max(40).optional(), email: z.string().email().optional(), website: z.string().max(300).optional(), instagram: z.string().max(200).optional(), address: z.string().max(300).optional(), city: z.string().max(120).optional(), notes: z.string().max(4000).optional() }),
  }),
  z.object({
    event: z.literal("reply"), userEmail: z.string().email(),
    reply: z.object({ channel: z.enum(["call", "whatsapp", "instagram", "email"]), phone: z.string().max(40).optional(), email: z.string().email().optional(), businessName: z.string().max(160).optional(), notes: z.string().max(4000).optional() }),
  }),
]);

export async function POST(req: Request) {
  try {
    if (!env.robinWebhookSecret) return fail("RUBIN webhook is off (set ROBIN_WEBHOOK_SECRET).", 503);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
    if (!rateLimit(`robin:webhook:${ip}`, 60, 60_000).allowed) return fail("Too many requests.", 429);
    const raw = await req.text();
    const ts = req.headers.get("x-robin-timestamp") ?? "";
    const sig = req.headers.get("x-robin-signature") ?? "";
    const age = Math.abs(Date.now() / 1000 - Number(ts));
    const want = Buffer.from(signRobinWebhook(env.robinWebhookSecret, ts, raw));
    const got = Buffer.from(sig);
    if (!ts || !Number.isFinite(age) || age > 300 || want.length !== got.length || !timingSafeEqual(want, got)) return fail("Invalid signature.", 401);
    const body = schema.parse(JSON.parse(raw));
    const user = await getDb().user.findUnique({ where: { email: body.userEmail.toLowerCase() }, select: { id: true } });
    if (!user) return fail("Unknown user.", 404);
    if (body.event === "lead") {
      const r = await createLead(user.id, { ...body.lead, source: "webhook" }, "webhook");
      return ok({ leadId: r.lead.id, duplicate: r.duplicate });
    }
    const lead = await findDuplicate(user.id, { phone: body.reply.phone, email: body.reply.email, businessName: body.reply.businessName ?? "\u0000" });
    if (!lead) return fail("No matching lead.", 404);
    await logInteraction(user.id, lead.id, { channel: body.reply.channel, direction: "inbound", outcome: "replied", notes: body.reply.notes, status: "received" }, "webhook");
    return ok({ leadId: lead.id });
  } catch (err) {
    if (err instanceof RobinError) return fail(err.message, err.status);
    if (err instanceof SyntaxError) return fail("Invalid JSON.", 400);
    return handleError(err);
  }
}
