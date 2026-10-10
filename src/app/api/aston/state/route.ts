import { ok } from "@/lib/api";
import { env } from "@/lib/env";
import { requireOwner } from "@/lib/aston/auth";
import { aiStatus } from "@/lib/aston/groq";
import { listIncidents } from "@/lib/aston/incidents";
import { pendingBrowserAlerts } from "@/lib/aston/notify";
import { phoneGuard } from "@/lib/aston/phone";
import { parseChannels, parseWatchUrls } from "@/lib/aston/types";
import { emailChannelReady } from "@/lib/darwin/email";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the ASTON screen shows. Read-only and fast (the tick runs separately). */
export async function GET(req: Request) {
  try {
    const user = await requireOwner();
    const full = new URL(req.url).searchParams.get("full") === "1";
    const [incidents, browserAlerts, ai] = await Promise.all([
      listIncidents(user.id, { includeClosed: full, limit: full ? 60 : 30 }),
      pendingBrowserAlerts(user.id),
      aiStatus(),
    ]);
    const extra = full
      ? {
          phone: (await phoneGuard(user.id)).status,
          channels: parseChannels(env.astonNotificationChannel),
          emailReady: await emailChannelReady(user.id),
          ownerConfigured: !!env.astonOwnerEmail,
          watching: parseWatchUrls(env.astonWatchUrls).map((s) => s.name),
          webhooks: { events: !!env.astonWebhookSecret, github: !!env.astonGithubWebhookSecret },
        }
      : {};
    return ok({ incidents, browserAlerts, ai, ...extra });
  } catch (err) {
    return astonError(err);
  }
}
