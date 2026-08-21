import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

/** Get a conversation with its messages (ownership enforced). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const db = getDb();
    const convo = await db.conversation.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, title: true, archived: true },
    });
    if (!convo) return fail("Conversation not found.", 404);

    const messages = await db.message.findMany({
      where: { conversationId: convo.id, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, toolResults: true, createdAt: true },
    });
    return ok({ conversation: convo, messages });
  } catch (err) {
    return handleError(err);
  }
}

/** Rename or archive/restore. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = patchSchema.parse(await req.json());
    const res = await getDb().conversation.updateMany({
      where: { id: params.id, userId: user.id },
      data: body,
    });
    if (res.count === 0) return fail("Conversation not found.", 404);
    return ok({ updated: true });
  } catch (err) {
    return handleError(err);
  }
}

/** Delete a conversation and its messages (cascade). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const res = await getDb().conversation.deleteMany({
      where: { id: params.id, userId: user.id },
    });
    if (res.count === 0) return fail("Conversation not found.", 404);
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
