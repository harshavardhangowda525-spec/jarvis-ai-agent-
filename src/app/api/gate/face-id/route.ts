import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { gateContext, setDeviceHint } from "@/lib/gate/server";
import { isFresh } from "@/lib/gate/token";

export const runtime = "nodejs";

/** Delete your JARVIS Face ID enrolment (on every server). Needs a recent unlock. */
export async function DELETE() {
  try {
    const { user, gate } = await gateContext();
    if (!user) return fail("Authentication required.", 401);
    if (!isFresh(gate)) return fail("Unlock JARVIS again to change Face ID.", 403, { reverify: true });
    const db = getDb();
    const { count } = await db.faceTemplate.deleteMany({ where: { userId: user.id } });
    if (!(await db.gateCredential.count({ where: { userId: user.id } }))) await setDeviceHint(null);
    return ok({ removed: count });
  } catch (err) {
    return handleError(err);
  }
}
