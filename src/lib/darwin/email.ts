import "server-only";
import { getGoogleAccessToken } from "@/lib/integrations/google";
import { isProviderConfigured } from "@/lib/integrations/providers";
import { getDb } from "@/lib/db";

/** Whether an email channel (Gmail) can actually send for this user. */
export async function emailChannelReady(userId: string): Promise<boolean> {
  if (!isProviderConfigured("google")) return false;
  const integ = await getDb().integration.findUnique({ where: { userId_provider: { userId, provider: "google" } }, select: { status: true, accessToken: true } }).catch(() => null);
  return integ?.status === "connected" && !!integ.accessToken;
}

export class EmailNotConnected extends Error {}

/**
 * Send a real email via the user's connected Gmail. Returns the provider message
 * id. Throws EmailNotConnected when no channel is connected — the caller then
 * reports "COMMUNICATION SERVICE NOT CONNECTED" instead of faking a send.
 */
export async function sendEmail(userId: string, to: string, subject: string, body: string): Promise<string> {
  if (!(await emailChannelReady(userId))) throw new EmailNotConnected("COMMUNICATION SERVICE NOT CONNECTED");
  const token = await getGoogleAccessToken(userId);
  const mime =
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
    body;
  const raw = Buffer.from(mime).toString("base64url");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(20_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Email send failed (HTTP ${res.status}).`);
  return json?.id ?? "sent";
}
