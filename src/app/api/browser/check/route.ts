import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { checkPage } from "@/lib/web-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/browser/check?url=…&origin=… → can JARVIS's glass browser frame it + preview info. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`browser-check:${user.id}`, 60, 60_000);
    if (!rl.allowed) return fail("Too many pages at once — wait a moment.", 429);
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get("url") || "").trim();
    if (!/^https?:\/\//i.test(url) || url.length > 2048) return fail("Give me a web address (http or https).");
    const origin = searchParams.get("origin") || new URL(req.url).origin;
    return ok(await checkPage(url, origin));
  } catch (err) {
    return handleError(err);
  }
}
