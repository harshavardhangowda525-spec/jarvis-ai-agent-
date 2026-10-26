import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { commandCenter } from "@/lib/intel/service";
import type { CategoryId } from "@/lib/intel/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The command center's data: priority feed, radar, videos, opportunities, status. Cached items only — refresh is separate. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const u = new URL(req.url);
    return ok(await commandCenter(user.id, {
      category: (u.searchParams.get("category") ?? "all") as CategoryId | "all",
      topic: u.searchParams.get("topic") ?? undefined,
      q: u.searchParams.get("q") ?? undefined,
      minRelevance: Number(u.searchParams.get("minRelevance")) || undefined,
      days: Math.min(30, Number(u.searchParams.get("days")) || 7),
      source: u.searchParams.get("source") ?? undefined,
      saved: u.searchParams.get("saved") === "1",
    }));
  } catch (e) {
    return handleError(e);
  }
}
