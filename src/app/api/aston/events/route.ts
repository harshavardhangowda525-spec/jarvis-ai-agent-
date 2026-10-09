import { ok, fail, rateLimit, clientIp } from "@/lib/api";
import { env } from "@/lib/env";
import { verifyAstonEvent } from "@/lib/aston/signature";
import { eventSchema, parseGeneric } from "@/lib/aston/events";
import { astonError, eventUser, ingest } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Signed inbound events for ASTON from any system (CI, uptime monitor, another
 * agent, a script). HMAC-SHA256 of `${timestamp}.${rawBody}` with
 * ASTON_WEBHOOK_SECRET in `x-aston-signature: sha256=<hex>`, and
 * `x-aston-timestamp: <unix seconds>` (max 5 minutes old). Off until the secret is set.
 */
export async function POST(req: Request) {
  try {
    if (!env.astonWebhookSecret) return fail("ASTON events are off (set ASTON_WEBHOOK_SECRET).", 503);
    if (!rateLimit(`aston:events:${clientIp(req)}`, 60, 60_000).allowed) return fail("Too many requests.", 429);
    const raw = await req.text();
    if (raw.length > 64_000) return fail("Payload too large.", 413);
    if (!verifyAstonEvent(env.astonWebhookSecret, req.headers.get("x-aston-timestamp") ?? "", req.headers.get("x-aston-signature") ?? "", raw)) return fail("Invalid signature.", 401);
    const body = eventSchema.parse(JSON.parse(raw));
    const user = await eventUser(body.userEmail);
    if ("error" in user) return fail(user.error, user.status);
    return ok(await ingest(user.id, parseGeneric(body)));
  } catch (err) {
    return astonError(err);
  }
}
