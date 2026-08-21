import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { noteInputSchema } from "@/lib/validation";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const notes = await getDb().note.findMany({
      where: {
        userId: user.id,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { content: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { id: true, title: true, content: true, tags: true, updatedAt: true },
    });
    return ok({ notes });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { title, content, tags } = noteInputSchema.parse(await req.json());
    const note = await getDb().note.create({
      data: {
        userId: user.id,
        title: title || content.split("\n")[0].slice(0, 60) || "Untitled note",
        content,
        tags: tags ?? [],
      },
      select: { id: true, title: true, content: true, tags: true, updatedAt: true },
    });
    return ok({ note }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
