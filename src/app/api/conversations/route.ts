import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List conversations (search via ?q=), newest first. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const conversations = await getDb().conversation.findMany({
      where: {
        userId: user.id,
        archived: false,
        ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true, updatedAt: true },
    });
    return ok({ conversations });
  } catch (err) {
    return handleError(err);
  }
}

/** Create a new empty conversation. */
export async function POST() {
  try {
    const user = await requireUser();
    const convo = await getDb().conversation.create({
      data: { userId: user.id, title: "New conversation" },
      select: { id: true, title: true, updatedAt: true },
    });
    return ok({ conversation: convo }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
