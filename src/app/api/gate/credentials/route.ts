import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { gateContext, setDeviceHint } from "@/lib/gate/server";
import { isFresh } from "@/lib/gate/token";

export const runtime = "nodejs";

/** Enrolled devices — names and dates only (no key material, nothing biometric). */
export async function GET() {
  try {
    const { user, gate } = await gateContext();
    if (!user) return fail("Authentication required.", 401);
    if (!gate) return fail("JARVIS is locked.", 423);
    const list = await getDb().gateCredential.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, createdAt: true, lastUsedAt: true } });
    return ok({ credentials: list, fresh: isFresh(gate) });
  } catch (err) {
    return handleError(err);
  }
}

/** Remove an enrolled device (?id=…, or ?all=1). Needs a recent unlock. */
export async function DELETE(req: NextRequest) {
  try {
    const { user, gate } = await gateContext();
    if (!user) return fail("Authentication required.", 401);
    if (!isFresh(gate)) return fail("Unlock JARVIS again to change face unlock.", 403, { reverify: true });
    const id = req.nextUrl.searchParams.get("id");
    const all = req.nextUrl.searchParams.get("all") === "1";
    if (!id && !all) return fail("Invalid request.", 422);
    const db = getDb();
    const { count } = await db.gateCredential.deleteMany({ where: { userId: user.id, ...(all ? {} : { id: id! }) } });
    if (!(await db.gateCredential.count({ where: { userId: user.id } })) && !(await db.faceTemplate.count({ where: { userId: user.id } }))) await setDeviceHint(null);
    return ok({ removed: count });
  } catch (err) {
    return handleError(err);
  }
}
