import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getDb } from "@/lib/db";

const SENSITIVE = /(password|api[\s_-]?key|secret|token|ssn|credit\s?card|cvv|pin\b)/i;

const schema = z.object({
  action: z
    .enum(["remember", "recall", "search", "forget"])
    .describe("What to do with long-term memory."),
  content: z
    .string()
    .max(4000)
    .optional()
    .describe("For 'remember': the fact to store. For 'search': the query."),
  key: z.string().max(80).optional().describe("Optional short label, e.g. 'company'."),
  id: z.string().optional().describe("Memory id to delete (for 'forget')."),
});

export const memoryTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "memory",
  description:
    "Long-term memory about the user. Use 'remember' to store durable facts the " +
    "user tells you (their company, preferences, projects). Use 'recall' to list " +
    "everything you know, 'search' to find relevant memories, and 'forget' to " +
    "delete one. NEVER store passwords, API keys, tokens, or other secrets.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["remember", "recall", "search", "forget"] },
      content: { type: "string", description: "Fact to store, or search query." },
      key: { type: "string", description: "Optional short label." },
      id: { type: "string", description: "Memory id (for forget)." },
    },
    required: ["action"],
  },
  activityLabel: "Accessing memory",
  async execute(input, ctx) {
    const db = getDb();
    switch (input.action) {
      case "remember": {
        if (!input.content) throw new ToolError("Nothing to remember was provided.");
        if (SENSITIVE.test(input.content)) {
          throw new ToolError(
            "I won't store passwords, keys, or other secrets in memory.",
          );
        }
        const mem = await db.memory.create({
          data: {
            userId: ctx.userId,
            key: input.key || null,
            content: input.content.trim(),
            source: "user",
          },
        });
        return { data: { id: mem.id, stored: true }, summary: "Saved to memory." };
      }
      case "recall": {
        const mems = await db.memory.findMany({
          where: { userId: ctx.userId },
          orderBy: { updatedAt: "desc" },
          take: 50,
        });
        return {
          data: { memories: mems.map((m) => ({ id: m.id, key: m.key, content: m.content })) },
          summary: `${mems.length} memories.`,
        };
      }
      case "search": {
        const q = (input.content || "").trim();
        if (!q) throw new ToolError("No search query provided.");
        const mems = await db.memory.findMany({
          where: {
            userId: ctx.userId,
            OR: [
              { content: { contains: q, mode: "insensitive" } },
              { key: { contains: q, mode: "insensitive" } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: 20,
        });
        return {
          data: { memories: mems.map((m) => ({ id: m.id, key: m.key, content: m.content })) },
          summary: `${mems.length} matching memories.`,
        };
      }
      case "forget": {
        if (!input.id) throw new ToolError("No memory id provided to forget.");
        const res = await db.memory.deleteMany({
          where: { id: input.id, userId: ctx.userId },
        });
        if (res.count === 0) throw new ToolError("No matching memory found.");
        return { data: { deleted: true }, summary: "Removed from memory." };
      }
    }
  },
};
