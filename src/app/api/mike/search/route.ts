import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { searchAssets } from "@/lib/mike/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Find any market by name or ticker (for MIKE's asset box and "pull up …"). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!rateLimit(`mike:search:${user.id}`, 60, 60_000).allowed) return fail("Too many searches.", 429);
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return ok({ results: await searchAssets(q) });
  } catch (err) {
    return handleError(err);
  }
}
