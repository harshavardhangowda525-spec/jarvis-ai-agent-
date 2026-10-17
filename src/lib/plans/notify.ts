import "server-only";
import type { MarketingPlan, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { publicBase } from "@/lib/public-url";
import { sendEmail, emailChannelReady } from "@/lib/darwin/email";
import { DARWIN_BUSINESS } from "@/lib/darwin/config";
import { planSettings, tpPath } from "./engine";

/**
 * "Your plan is ready" — sent once per plan, only after it's saved, only on
 * the channels you switched on. Each channel's real outcome is logged:
 * "sent" means the provider accepted the message (WhatsApp/Gmail return an
 * id); it is never reported as delivered or read.
 */

export type NotifyEntry = { channel: "whatsapp" | "email"; status: "sent" | "not_configured" | "failed" | "off"; detail?: string; at: string };

export function whatsappReady() {
  return !!(env.whatsappPhoneNumberId && env.whatsappAccessToken && env.whatsappNotifyTo);
}

export function planMessage(niche: string, url: string | null) {
  return [
    `Your ${DARWIN_BUSINESS.name} daily marketing plan is ready!`,
    `Today's niche: ${niche}`,
    "Your call scripts, Instagram outreach, WhatsApp scripts, and content creation idea are saved in your ASTON teleprompter.",
    url ? `Open today's plan: ${url}` : "Open it in JARVIS → Teleprompter.",
    "Your daily plan is ready whenever you are.",
  ].join("\n");
}

/** WhatsApp Cloud API: an approved template when one is set, else a plain text (works only inside a 24-hour chat window). */
export async function sendWhatsapp(text: string, params: string[], f: typeof fetch = fetch): Promise<string> {
  const to = env.whatsappNotifyTo.replace(/\D/g, "");
  const body = env.whatsappPlanTemplate
    ? { messaging_product: "whatsapp", to, type: "template", template: { name: env.whatsappPlanTemplate, language: { code: env.whatsappTemplateLang }, components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }] } }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: true } };
  const r = await f(`https://graph.facebook.com/v21.0/${encodeURIComponent(env.whatsappPhoneNumberId)}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${env.whatsappAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
  if (!r.ok || !j.messages?.[0]?.id) throw new Error(j.error?.message ? `${j.error.message}${j.error.code ? ` (code ${j.error.code})` : ""}` : `WhatsApp answered HTTP ${r.status}`);
  return j.messages[0].id;
}

export async function notifyPlan(plan: MarketingPlan, o: { fetch?: typeof fetch; email?: typeof sendEmail } = {}): Promise<NotifyEntry[]> {
  const db = getDb();
  // claim: one notification per plan, ever
  const claimed = await db.marketingPlan.updateMany({ where: { id: plan.id, notifiedAt: null, status: "ready" }, data: { notifiedAt: new Date() } });
  if (!claimed.count) return [];
  const st = await planSettings(plan.userId);
  const base = await publicBase(plan.userId).catch(() => null);
  const url = !plan.shareRevokedAt && base ? `${base}${tpPath(plan.shareToken)}` : null;
  const text = planMessage(plan.niche ?? "today's niche", url);
  const at = () => new Date().toISOString();
  const log: NotifyEntry[] = [];

  if (!st.notifyWhatsapp) log.push({ channel: "whatsapp", status: "off", at: at() });
  else if (!whatsappReady()) log.push({ channel: "whatsapp", status: "not_configured", detail: "Set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and WHATSAPP_NOTIFY_TO (and WHATSAPP_PLAN_TEMPLATE for messages outside a 24-hour chat).", at: at() });
  else {
    try { log.push({ channel: "whatsapp", status: "sent", detail: `Accepted by WhatsApp (message ${await sendWhatsapp(text, [plan.niche ?? "", url ?? "JARVIS → Teleprompter"], o.fetch)}) — delivery not confirmed`, at: at() }); }
    catch (e) { log.push({ channel: "whatsapp", status: "failed", detail: String((e as Error).message).slice(0, 300), at: at() }); }
  }

  if (!st.notifyEmail) log.push({ channel: "email", status: "off", at: at() });
  else {
    const user = await db.user.findUnique({ where: { id: plan.userId }, select: { email: true } });
    if (!user?.email || !(await emailChannelReady(plan.userId))) log.push({ channel: "email", status: "not_configured", detail: "Connect Google (Gmail) in Settings → Integrations.", at: at() });
    else {
      try { log.push({ channel: "email", status: "sent", detail: `Accepted by Gmail (message ${await (o.email ?? sendEmail)(plan.userId, user.email, `Daily plan ready — ${plan.niche}`, text)})`, at: at() }); }
      catch (e) { log.push({ channel: "email", status: "failed", detail: String((e as Error).message).slice(0, 300), at: at() }); }
    }
  }
  await db.marketingPlan.update({ where: { id: plan.id }, data: { notifyLog: log as unknown as Prisma.InputJsonValue } });
  return log;
}

/** "Send a test" from the plan settings: today's message on the channels you switched on, right now (your own click authorises it). */
export async function testNotify(plan: MarketingPlan, o: { fetch?: typeof fetch; email?: typeof sendEmail } = {}): Promise<NotifyEntry[]> {
  const st = await planSettings(plan.userId);
  const base = await publicBase(plan.userId).catch(() => null);
  const url = !plan.shareRevokedAt && base ? `${base}${tpPath(plan.shareToken)}` : null;
  const text = `[Test] ${planMessage(plan.niche ?? "today's niche", url)}`;
  const at = () => new Date().toISOString();
  const out: NotifyEntry[] = [];
  if (st.notifyWhatsapp) {
    if (!whatsappReady()) out.push({ channel: "whatsapp", status: "not_configured", detail: "WhatsApp isn't configured on the server.", at: at() });
    else try { out.push({ channel: "whatsapp", status: "sent", detail: `Accepted by WhatsApp (message ${await sendWhatsapp(text, [plan.niche ?? "", url ?? "JARVIS → Teleprompter"], o.fetch)}) — delivery not confirmed`, at: at() }); }
    catch (e) { out.push({ channel: "whatsapp", status: "failed", detail: String((e as Error).message).slice(0, 300), at: at() }); }
  }
  if (st.notifyEmail) {
    const user = await getDb().user.findUnique({ where: { id: plan.userId }, select: { email: true } });
    if (!user?.email || !(await emailChannelReady(plan.userId))) out.push({ channel: "email", status: "not_configured", detail: "Connect Google (Gmail) in Settings → Integrations.", at: at() });
    else try { out.push({ channel: "email", status: "sent", detail: `Accepted by Gmail (message ${await (o.email ?? sendEmail)(plan.userId, user.email, `[Test] Daily plan ready — ${plan.niche}`, text)})`, at: at() }); }
    catch (e) { out.push({ channel: "email", status: "failed", detail: String((e as Error).message).slice(0, 300), at: at() }); }
  }
  return out;
}
