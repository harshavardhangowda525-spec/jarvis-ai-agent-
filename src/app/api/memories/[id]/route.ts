import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const res = await getDb().memory.deleteMany({
      where: { id: params.id, userId: user.id },
    });
    if (res.count === 0) return fail("Memory not found.", 404);
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
