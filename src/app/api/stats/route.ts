import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real dashboard stats for the mission-control panels: task breakdown (powers
 * the Quick Actions donut) and recent tool activity (powers Recent Activity).
 * All per-user.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const db = getDb();

    const [all, done, high, recentLogs, upcoming, counts] = await Promise.all([
      db.task.count({ where: { userId: user.id } }),
      db.task.count({ where: { userId: user.id, status: "done" } }),
      db.task.count({ where: { userId: user.id, status: "pending", priority: "high" } }),
      db.toolLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { tool: true, status: true, createdAt: true },
      }),
      db.task.findMany({
        where: { userId: user.id, status: "pending", dueAt: { not: null } },
        orderBy: { dueAt: "asc" },
        take: 5,
        select: { id: true, title: true, dueAt: true, priority: true },
      }),
      db.$transaction([
        db.note.count({ where: { userId: user.id } }),
        db.memory.count({ where: { userId: user.id } }),
        db.conversation.count({ where: { userId: user.id } }),
      ]),
    ]);

    const pending = all - done;
    return ok({
      tasks: { all, completed: done, pending, high },
      totals: { notes: counts[0], memories: counts[1], conversations: counts[2] },
      recentActivity: recentLogs.map((l) => ({
        tool: l.tool,
        status: l.status,
        at: l.createdAt,
      })),
      upcoming,
    });
  } catch (err) {
    return handleError(err);
  }
}
