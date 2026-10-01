import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { morningReport, robinBriefing } from "@/lib/robin/briefing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "What's my day?" — or ?morning=1: the once-a-day morning report (due: false after the first time). */
export async function GET(req: Request) {
  return robinApi(req, "briefing", async (user) => {
    if (new URL(req.url).searchParams.get("morning") === "1") return ok(await morningReport(user.id));
    return ok(await robinBriefing(user.id));
  });
}
