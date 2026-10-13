import { ok, fail, rateLimit } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { placeTestCall } from "@/lib/aston/phone";
import { recordActivity } from "@/lib/activity/record";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Place one REAL sample call to the owner (live mode only; same caps as alert calls). */
export async function POST() {
  try {
    const user = await requireOwner();
    if (!rateLimit(`aston:phonecall:${user.id}`, 3, 10 * 60_000).allowed) return fail("A sample call was just requested — try again in a few minutes.", 429);
    const r = await placeTestCall(user.id);
    await recordActivity(user.id, { category: "communication", agent: "ASTON", source: "aston", status: "success", action: "ASTON placed a sample phone call to the owner", importance: 2 });
    return ok(r);
  } catch (err) {
    return astonError(err);
  }
}
