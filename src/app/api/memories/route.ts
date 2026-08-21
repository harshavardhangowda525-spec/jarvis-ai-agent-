import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { memoryInputSchema } from "@/lib/validation";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const memories = await getDb().memory.findMany({
      where: {
        userId: user.id,
        ...(q ? { content: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { id: true, key: true, content: true, source: true, updatedAt: true },
    });
    return ok({ memories });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { key, content } = memoryInputSchema.parse(await req.json());
    const memory = await getDb().memory.create({
      data: { userId: user.id, key: key || null, content, source: "user" },
      select: { id: true, key: true, content: true, updatedAt: true },
    });
    return ok({ memory }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
