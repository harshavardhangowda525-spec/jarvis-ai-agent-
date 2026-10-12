import { ok, rateLimit, fail } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { claudeStatus } from "@/lib/aston/site/claude-code";
import { aiStatus } from "@/lib/aston/groq";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which website engines can run here: Groq, and the owner's local Claude Code. `?fresh=1` re-checks Claude Code now. */
export async function GET(req: Request) {
  try {
    const user = await requireOwner();
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    if (fresh && !rateLimit(`aston:engines:${user.id}`, 10, 60_000).allowed) return fail("Checked a lot just now — try again in a minute.", 429);
    const [claude, groq] = await Promise.all([claudeStatus({ fresh }), aiStatus()]);
    const model = (process.env.ASTON_CLAUDE_MODEL ?? "sonnet").toLowerCase();
    return ok({
      claude: { ...claude, defaultModel: ["opus", "sonnet", "haiku"].includes(model) ? model : "sonnet" },
      groq: { available: groq.configured, status: groq.status },
      defaultEngine: (process.env.ASTON_SITE_ENGINE ?? "auto").toLowerCase(),
    });
  } catch (err) {
    return astonError(err);
  }
}
