import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  details: z.string().max(4000).nullable().optional(),
  status: z.enum(["pending", "done"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = patchSchema.parse(await req.json());
    const res = await getDb().task.updateMany({
      where: { id: params.id, userId: user.id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.details !== undefined ? { details: body.details } : {}),
        ...(body.priority ? { priority: body.priority } : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
        ...(body.status
          ? { status: body.status, completedAt: body.status === "done" ? new Date() : null }
          : {}),
      },
    });
    if (res.count === 0) return fail("Task not found.", 404);
    return ok({ updated: true });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const res = await getDb().task.deleteMany({
      where: { id: params.id, userId: user.id },
    });
    if (res.count === 0) return fail("Task not found.", 404);
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
