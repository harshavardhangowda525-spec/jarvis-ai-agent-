import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { getLiveBrain } from "@/lib/ai/brain";
import { completeWithFallback } from "@/lib/ai/complete";
import { agentConfigs } from "@/lib/ai/agent";
import { learnFromChats } from "@/lib/ai/learn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Learn lasting facts & preferences from the user's past chats and save them as
 * memories (shared by every agent and every brain). Runs on JARVIS's own brain
 * (JARVIS_PROVIDER — your PC's Ollama by default).
 */
export async function POST() {
  try {
    const user = await requireUser();
    const rl = rateLimit(`learn:${user.id}`, 3, 10 * 60_000);
    if (!rl.allowed) return fail(`Already learning — try again in ${Math.ceil(rl.retryAfter / 60)} min.`, 429);

    const [profile, brain] = await Promise.all([
      getDb().profile.findUnique({ where: { userId: user.id } }),
      getLiveBrain(user.id).catch(() => null),
    ]);
    const { configs, missing } = agentConfigs("jarvis", brain, (profile as { aiProvider?: string | null } | null)?.aiProvider);
    if (!configs.length) return fail(missing ?? "No AI provider is available to read your chats.", 503);

    try {
      const result = await learnFromChats(user.id, (system, text) => completeWithFallback(configs, system, text, { maxTokens: 1200 }));
      return ok(result);
    } catch (err) {
      console.error("[learn] failed:", err);
      return fail("Couldn't reach an AI model to read your chats — try again in a minute.", 502);
    }
  } catch (err) {
    return handleError(err);
  }
}
