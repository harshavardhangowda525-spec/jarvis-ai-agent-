import { z } from "zod";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { device } from "@/lib/prospects/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const n = z.number().finite().nullable().optional();
const t = (m: number) => z.string().max(m).nullable().optional();
const Body = z.object({
  action: z.enum(["next", "known", "listing", "status", "live"]), device: z.string().max(80).optional(), searchId: z.string().max(40).optional(),
  placeIds: z.array(z.string().max(80)).max(200).optional(),
  listing: z.object({ name: z.string().max(300), category: t(120), address: t(400), phone: t(40), website: t(500), rating: n, reviews: n, mapsUrl: z.string().max(2000), hours: t(400), instagram: t(300), facebook: t(300) }).optional(),
  status: z.enum(["running", "done", "blocked", "failed", "stopped"]).optional(), text: z.string().max(300).optional(), error: z.string().max(500).optional(),
});

/** The JARVIS Operator on your laptop (token in Authorization: Bearer). */
export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!token) return fail("Missing the finder token.", 401);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!rateLimit(`maps-finder:${ip}`, 400, 60_000).allowed) return fail("Too many requests.", 429); // the operator + its live CRM window
    const r = await device(token, Body.parse(await req.json()));
    if (!r.authorized) return fail("This operator isn't paired (or was unpaired). Pair it again in JARVIS → CRM → Google Maps finder.", 401);
    return ok(r);
  } catch (e) { return handleError(e); }
}
