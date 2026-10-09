import { ok, fail, rateLimit, clientIp } from "@/lib/api";
import { env } from "@/lib/env";
import { verifyGithub } from "@/lib/aston/signature";
import { parseGithub } from "@/lib/aston/events";
import { astonError, eventUser, ingest } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GitHub webhook → ASTON. Subscribe a repository (Settings → Webhooks, content
 * type application/json, secret = ASTON_GITHUB_WEBHOOK_SECRET) to "Workflow
 * runs" (failed builds/CI) and "Deployment statuses" (failed deployments —
 * Vercel's GitHub integration reports every deployment there).
 */
export async function POST(req: Request) {
  try {
    if (!env.astonGithubWebhookSecret) return fail("ASTON GitHub webhook is off (set ASTON_GITHUB_WEBHOOK_SECRET).", 503);
    if (!rateLimit(`aston:github:${clientIp(req)}`, 120, 60_000).allowed) return fail("Too many requests.", 429);
    const raw = await req.text();
    if (raw.length > 2_000_000) return fail("Payload too large.", 413);
    if (!verifyGithub(env.astonGithubWebhookSecret, req.headers.get("x-hub-signature-256") ?? "", raw)) return fail("Invalid signature.", 401);
    const user = await eventUser();
    if ("error" in user) return fail(user.error, user.status);
    const parsed = parseGithub(req.headers.get("x-github-event") ?? "", JSON.parse(raw));
    return ok(await ingest(user.id, parsed));
  } catch (err) {
    return astonError(err);
  }
}
