import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getDb } from "@/lib/db";

const schema = z.object({
  action: z.enum(["create", "list", "complete", "update", "delete", "search"]),
  title: z.string().max(300).optional(),
  details: z.string().max(4000).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  dueAt: z
    .string()
    .optional()
    .describe("ISO 8601 datetime for when the task is due, e.g. '2026-08-22T09:00:00Z'."),
  id: z.string().optional().describe("Task id for complete/update/delete."),
  query: z.string().max(200).optional().describe("Search text for 'search'."),
});

export const tasksTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "tasks",
  description:
    "Manage the user's tasks and reminders. 'create' a task (optionally with a " +
    "dueAt for reminders), 'list' open tasks, 'complete' one by id, 'update' " +
    "fields, 'delete' one, or 'search'. Only claim a reminder exists after " +
    "'create' succeeds. Deleting requires the caller to have confirmed.",
  schema,
  requiresConfirmation: false, // create/list/complete are safe; delete-all handled by agent confirmation
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list", "complete", "update", "delete", "search"] },
      title: { type: "string" },
      details: { type: "string" },
      priority: { type: "string", enum: ["low", "normal", "high"] },
      dueAt: { type: "string", description: "ISO 8601 datetime." },
      id: { type: "string" },
      query: { type: "string" },
    },
    required: ["action"],
  },
  activityLabel: "Managing tasks",
  async execute(input, ctx) {
    const db = getDb();
    switch (input.action) {
      case "create": {
        if (!input.title) throw new ToolError("A task needs a title.");
        let dueAt: Date | null = null;
        if (input.dueAt) {
          const d = new Date(input.dueAt);
          if (Number.isNaN(d.getTime())) throw new ToolError("Invalid due date.");
          dueAt = d;
        }
        const task = await db.task.create({
          data: {
            userId: ctx.userId,
            title: input.title.trim(),
            details: input.details ?? null,
            priority: input.priority ?? "normal",
            dueAt,
          },
        });
        return {
          data: { id: task.id, title: task.title, dueAt: task.dueAt },
          summary: `Task created: ${task.title}.`,
        };
      }
      case "list": {
        const tasks = await db.task.findMany({
          where: { userId: ctx.userId, status: "pending" },
          orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
          take: 100,
        });
        return {
          data: {
            tasks: tasks.map((t) => ({
              id: t.id, title: t.title, priority: t.priority, dueAt: t.dueAt,
            })),
          },
          summary: `${tasks.length} open task${tasks.length === 1 ? "" : "s"}.`,
        };
      }
      case "complete": {
        if (!input.id) throw new ToolError("No task id provided.");
        const res = await db.task.updateMany({
          where: { id: input.id, userId: ctx.userId },
          data: { status: "done", completedAt: new Date() },
        });
        if (res.count === 0) throw new ToolError("No matching task found.");
        return { data: { completed: true }, summary: "Task completed." };
      }
      case "update": {
        if (!input.id) throw new ToolError("No task id provided.");
        const res = await db.task.updateMany({
          where: { id: input.id, userId: ctx.userId },
          data: {
            ...(input.title ? { title: input.title.trim() } : {}),
            ...(input.details !== undefined ? { details: input.details } : {}),
            ...(input.priority ? { priority: input.priority } : {}),
            ...(input.dueAt ? { dueAt: new Date(input.dueAt) } : {}),
          },
        });
        if (res.count === 0) throw new ToolError("No matching task found.");
        return { data: { updated: true }, summary: "Task updated." };
      }
      case "delete": {
        if (!input.id) throw new ToolError("No task id provided.");
        const res = await db.task.deleteMany({
          where: { id: input.id, userId: ctx.userId },
        });
        if (res.count === 0) throw new ToolError("No matching task found.");
        return { data: { deleted: true }, summary: "Task deleted." };
      }
      case "search": {
        const q = (input.query || "").trim();
        if (!q) throw new ToolError("No search query provided.");
        const tasks = await db.task.findMany({
          where: {
            userId: ctx.userId,
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { details: { contains: q, mode: "insensitive" } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return {
          data: { tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })) },
          summary: `${tasks.length} matching tasks.`,
        };
      }
    }
  },
};
