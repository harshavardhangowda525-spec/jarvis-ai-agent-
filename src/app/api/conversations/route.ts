import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";

const AGENTS = ["jarvis", "ev", "darwin", "mike", "robin", "aston"];
export const dynamic = "force-dynamic";

/** List conversations (search via ?q=), newest first. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = req.nextUrl.searchParams.get("q")?.trim();
    // ?agent=darwin → only that agent's chats (no agent → every chat, as before)
    const agent = req.nextUrl.searchParams.get("agent");
    const conversations = await getDb().conversation.findMany({
      where: {
        userId: user.id,
        archived: false,
        ...(agent && AGENTS.includes(agent) ? { agent } : {}),
        ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true, updatedAt: true, agent: true },
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
