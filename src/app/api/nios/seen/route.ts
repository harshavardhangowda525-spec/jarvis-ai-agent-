import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { markSeen } from "@/lib/nios/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mark notices as shown in JARVIS so they aren't announced again. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { ids } = z.object({ ids: z.array(z.string().max(40)).max(100) }).parse(await req.json());
    return ok({ marked: await markSeen(user.id, ids) });
  } catch (err) {
    return handleError(err);
  }
}
