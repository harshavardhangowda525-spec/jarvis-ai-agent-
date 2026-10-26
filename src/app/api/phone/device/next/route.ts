import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { deviceNext } from "@/lib/phone/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The spare phone checking in (pairing token in the Authorization header). Returns the call to make, if any. */
export async function GET(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!token) return fail("Missing pairing token.", 401);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!rateLimit(`phone-next:${ip}`, 30, 60_000).allowed) return fail("Too many requests.", 429);
    const r = await deviceNext(token, new URL(req.url).searchParams.get("device"));
    if (!r.authorized) return fail("This phone isn't paired (or was unpaired). Pair it again in JARVIS → Settings → Phone calls.", 401);
    return ok({ pollSeconds: r.pollSeconds, call: r.call });
  } catch (e) {
    return handleError(e);
  }
}
