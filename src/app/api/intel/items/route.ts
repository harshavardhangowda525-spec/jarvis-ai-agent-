import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().min(1), saved: z.boolean() });

/** Save / unsave a story (saved stories are kept past the 30-day clean-up). */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const b = schema.parse(await req.json());
    const r = await getDb().intelItem.updateMany({ where: { id: b.id, userId: user.id }, data: { saved: b.saved } });
    if (!r.count) return fail("Not found.", 404);
    return ok(b);
  } catch (e) {
    return handleError(e);
  }
}
