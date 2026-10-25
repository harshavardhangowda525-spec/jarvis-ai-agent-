import "server-only";
import { getDb } from "@/lib/db";
import { sendEmail, emailChannelReady } from "@/lib/darwin/email";
import { sendWhatsapp, whatsappReady, type NotifyEntry } from "@/lib/plans/notify";

/**
 * Your own notification channels (the ones the daily plan already uses):
 * WhatsApp to WHATSAPP_NOTIFY_TO and Gmail to your account address. Only the
 * channels you switched on are used, and each real outcome is logged — "sent"
 * means the provider accepted it, never that it was read.
 */
export async function notifySelf(
  userId: string,
  on: { whatsapp: boolean; email: boolean },
  subject: string,
  text: string,
  o: { fetch?: typeof fetch; email?: typeof sendEmail } = {},
): Promise<NotifyEntry[]> {
  const at = () => new Date().toISOString();
  const log: NotifyEntry[] = [];
  if (!on.whatsapp) log.push({ channel: "whatsapp", status: "off", at: at() });
  else if (!whatsappReady()) log.push({ channel: "whatsapp", status: "not_configured", detail: "Set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and WHATSAPP_NOTIFY_TO.", at: at() });
  else {
    try { log.push({ channel: "whatsapp", status: "sent", detail: `Accepted by WhatsApp (message ${await sendWhatsapp(text, [subject, text.slice(0, 200)], o.fetch)}) — delivery not confirmed`, at: at() }); }
    catch (e) { log.push({ channel: "whatsapp", status: "failed", detail: String((e as Error).message).slice(0, 300), at: at() }); }
  }
  if (!on.email) log.push({ channel: "email", status: "off", at: at() });
  else {
    const user = await getDb().user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user?.email || !(await emailChannelReady(userId))) log.push({ channel: "email", status: "not_configured", detail: "Connect Google (Gmail) in Settings → Integrations.", at: at() });
    else {
      try { log.push({ channel: "email", status: "sent", detail: `Accepted by Gmail (message ${await (o.email ?? sendEmail)(userId, user.email, subject, text)})`, at: at() }); }
      catch (e) { log.push({ channel: "email", status: "failed", detail: String((e as Error).message).slice(0, 300), at: at() }); }
    }
  }
  return log;
}
