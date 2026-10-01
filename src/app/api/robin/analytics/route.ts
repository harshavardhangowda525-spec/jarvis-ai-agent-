import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { robinAnalytics } from "@/lib/robin/analytics";
import { RANGES, type Range } from "@/lib/robin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?range=today|7d|30d|90d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: Request) {
  return robinApi(req, "analytics", async (user) => {
    const u = new URL(req.url).searchParams;
    const r = (RANGES as readonly string[]).includes(u.get("range") ?? "") ? (u.get("range") as Range) : "30d";
    const date = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
    return ok(await robinAnalytics(user.id, r, { from: date(u.get("from")), to: date(u.get("to")) }));
  });
}
