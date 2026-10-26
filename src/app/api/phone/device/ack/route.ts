import { z } from "zod";
import { ok, fail, handleError } from "@/lib/api";
import { deviceAck } from "@/lib/phone/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The spare phone reporting whether it texted and rang you. */
export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    const body = z.object({ id: z.string().min(1).max(40), ok: z.boolean(), error: z.string().max(500).nullable().optional() }).parse(await req.json());
    if (!token || !(await deviceAck(token, body))) return fail("This phone isn't paired.", 401);
    return ok({ saved: true });
  } catch (e) {
    return handleError(e);
  }
}
