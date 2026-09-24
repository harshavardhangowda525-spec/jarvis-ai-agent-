import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { resolveAiConfigs } from "@/lib/env";
import { getLiveBrain } from "@/lib/ai/brain";
import { completeWithFallback } from "@/lib/ai/complete";
import { learnFromChats } from "@/lib/ai/learn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Learn lasting facts & preferences from the user's past chats and save them as
 * memories (shared by every agent and every brain). Cloud models go first here —
 * reading many old messages is much quicker for them — with the PC brain as the
 * fallback, so it works with Ollama alone too.
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
    const chain = resolveAiConfigs((profile as { aiProvider?: string | null } | null)?.aiProvider ?? undefined, brain);
    const configs = [...chain.filter((c) => c.provider !== "ollama"), ...chain.filter((c) => c.provider === "ollama")];
    if (!configs.length) return fail("No AI provider is available to read your chats.", 503);

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
