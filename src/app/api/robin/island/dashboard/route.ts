import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { islandDashboard, islandLeadFull } from "@/lib/robin/island-dashboard";
import type { IslandStatus } from "@/lib/robin/island-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: IslandStatus[] = ["all", "open", "ready", "interested", "rejected", "won"];

/** The island's CRM dashboard: ?status=ready|interested|rejected|open|won|all &q=search, or ?lead=<id> for one lead in full. */
export async function GET(req: Request) {
  return robinApi(req, "island-dashboard", async (user) => {
    const u = new URL(req.url).searchParams;
    const lead = u.get("lead");
    if (lead) return ok({ lead: await islandLeadFull(user.id, lead) });
    const s = u.get("status") as IslandStatus | null;
    return ok(await islandDashboard(user.id, { status: s && STATUSES.includes(s) ? s : "open", q: (u.get("q") ?? "").slice(0, 80) }));
  }, 120);
}
