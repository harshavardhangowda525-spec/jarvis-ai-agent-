import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { taskInputSchema } from "@/lib/validation";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const status = req.nextUrl.searchParams.get("status");
    const tasks = await getDb().task.findMany({
      where: {
        userId: user.id,
        ...(status === "pending" || status === "done" ? { status } : {}),
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true, title: true, details: true, status: true,
        priority: true, dueAt: true, createdAt: true,
      },
    });
    return ok({ tasks });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const input = taskInputSchema.parse(await req.json());
    const task = await getDb().task.create({
      data: {
        userId: user.id,
        title: input.title,
        details: input.details ?? null,
        priority: input.priority ?? "normal",
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
      },
      select: { id: true, title: true, status: true, priority: true, dueAt: true },
    });
    return ok({ task }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
