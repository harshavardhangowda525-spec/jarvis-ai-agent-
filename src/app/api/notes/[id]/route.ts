import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().min(1).max(20000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = patchSchema.parse(await req.json());
    const res = await getDb().note.updateMany({
      where: { id: params.id, userId: user.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.content ? { content: body.content } : {}),
        ...(body.tags ? { tags: body.tags } : {}),
      },
    });
    if (res.count === 0) return fail("Note not found.", 404);
    return ok({ updated: true });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const res = await getDb().note.deleteMany({
      where: { id: params.id, userId: user.id },
    });
    if (res.count === 0) return fail("Note not found.", 404);
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
