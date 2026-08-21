import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getDb } from "@/lib/db";

const schema = z.object({
  action: z.enum(["create", "list", "get", "edit", "delete", "search"]),
  title: z.string().max(200).optional(),
  content: z.string().max(20000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  id: z.string().optional(),
  query: z.string().max(200).optional(),
});

export const notesTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "notes",
  description:
    "Manage the user's notes. 'create' a note from content (great for saving " +
    "summaries or ideas), 'list' recent notes, 'get' one by id, 'edit', " +
    "'delete', or 'search' by text.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list", "get", "edit", "delete", "search"] },
      title: { type: "string" },
      content: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      id: { type: "string" },
      query: { type: "string" },
    },
    required: ["action"],
  },
  activityLabel: "Managing notes",
  async execute(input, ctx) {
    const db = getDb();
    switch (input.action) {
      case "create": {
        if (!input.content) throw new ToolError("A note needs content.");
        const note = await db.note.create({
          data: {
            userId: ctx.userId,
            title: input.title?.trim() || deriveTitle(input.content),
            content: input.content.trim(),
            tags: input.tags ?? [],
          },
        });
        return { data: { id: note.id, title: note.title }, summary: `Note saved: ${note.title}.` };
      }
      case "list": {
        const notes = await db.note.findMany({
          where: { userId: ctx.userId },
          orderBy: { updatedAt: "desc" },
          take: 50,
        });
        return {
          data: { notes: notes.map((n) => ({ id: n.id, title: n.title, tags: n.tags })) },
          summary: `${notes.length} notes.`,
        };
      }
      case "get": {
        if (!input.id) throw new ToolError("No note id provided.");
        const note = await db.note.findFirst({ where: { id: input.id, userId: ctx.userId } });
        if (!note) throw new ToolError("No matching note found.");
        return { data: { id: note.id, title: note.title, content: note.content, tags: note.tags } };
      }
      case "edit": {
        if (!input.id) throw new ToolError("No note id provided.");
        const res = await db.note.updateMany({
          where: { id: input.id, userId: ctx.userId },
          data: {
            ...(input.title ? { title: input.title.trim() } : {}),
            ...(input.content ? { content: input.content.trim() } : {}),
            ...(input.tags ? { tags: input.tags } : {}),
          },
        });
        if (res.count === 0) throw new ToolError("No matching note found.");
        return { data: { updated: true }, summary: "Note updated." };
      }
      case "delete": {
        if (!input.id) throw new ToolError("No note id provided.");
        const res = await db.note.deleteMany({ where: { id: input.id, userId: ctx.userId } });
        if (res.count === 0) throw new ToolError("No matching note found.");
        return { data: { deleted: true }, summary: "Note deleted." };
      }
      case "search": {
        const q = (input.query || "").trim();
        if (!q) throw new ToolError("No search query provided.");
        const notes = await db.note.findMany({
          where: {
            userId: ctx.userId,
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { content: { contains: q, mode: "insensitive" } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: 30,
        });
        return {
          data: { notes: notes.map((n) => ({ id: n.id, title: n.title })) },
          summary: `${notes.length} matching notes.`,
        };
      }
    }
  },
};

function deriveTitle(content: string): string {
  const firstLine = content.trim().split("\n")[0];
  return firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine || "Untitled note";
}
