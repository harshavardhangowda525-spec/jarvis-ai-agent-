import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { EV_CONTENT_KINDS } from "@/lib/ev/config";
import { checkDuplicate, storeItem, itemText } from "@/lib/ev/memory";

/**
 * EV's content memory + lifecycle tool. EV writes the creative itself; this
 * tool (a) checks a candidate against history so EV never repeats content,
 * (b) stores it, and (c) moves items through the approval lifecycle
 * (draft → ready → approved/rejected/scheduled → published).
 *
 * It performs NO external action. Publishing to Instagram is ev_instagram's job
 * and always needs explicit user approval first.
 */

const schema = z.object({
  action: z
    .enum(["check", "store", "list", "get", "approve", "reject", "schedule", "pending", "stats"])
    .describe(
      "check: test candidate text for duplication BEFORE finalizing. store: save a new piece. " +
      "list: recent items (filter by kind/status/niche). get: one item by id. approve/reject/schedule: " +
      "move an item's status (after the user approves). pending: items waiting for approval. stats: memory overview.",
    ),
  id: z.string().optional().describe("Item id (for get/approve/reject/schedule)."),
  kind: z.enum(EV_CONTENT_KINDS).optional().describe("Content kind (for store/list)."),
  status: z
    .enum(["draft", "ready", "approved", "rejected", "scheduled", "published", "failed"])
    .optional()
    .describe("Status filter (list) or status to set on store."),
  niche: z.string().max(60).optional().describe("Target niche, e.g. gyms, cafes."),
  theme: z.string().max(200).optional().describe("Content theme / angle."),
  title: z.string().max(200).optional(),
  caption: z.string().max(6000).optional(),
  hook: z.string().max(1000).optional(),
  cta: z.string().max(500).optional(),
  body: z.string().max(12000).optional().describe("Full script / preview / message body."),
  text: z.string().max(12000).optional().describe("Raw candidate text for action 'check'."),
  scheduledAt: z.string().datetime().optional().describe("ISO time for action 'schedule'."),
  limit: z.number().int().min(1).max(100).optional(),
});

type Input = z.infer<typeof schema>;

const OWN = (userId: string, id: string) =>
  getDb().evContent.findFirst({ where: { id, userId } });

export const evContentTool: ToolDefinition<Input> = {
  name: "ev_content",
  description:
    "EV's content memory and approval lifecycle for Infinity Web & Apps. Use 'check' to ensure a new " +
    "idea/caption isn't a repeat BEFORE finalizing; 'store' to save content EV wrote; 'list'/'pending' to " +
    "review; 'approve'/'reject'/'schedule' to move status AFTER the user approves. No external publishing here.",
  schema,
  agentScope: "ev",
  activityLabel: "Working with EV content memory",
  async execute(input, ctx) {
    const db = getDb();
    const userId = ctx.userId;

    switch (input.action) {
      case "check": {
        const candidate = input.text || itemText(input);
        if (!candidate.trim()) throw new ToolError("Provide 'text' (or content fields) to check.");
        ctx.activity("Checking against EV's memory for repeats…");
        const dup = await checkDuplicate(userId, candidate, { niche: input.niche });
        return {
          data: dup,
          summary: dup.isDuplicate
            ? `⚠️ Too similar to ${dup.exact ? `"${dup.exact.title}"` : `${dup.similar.length} prior item(s)`} — change the angle.`
            : "Fresh — no substantial overlap with past content.",
        };
      }

      case "store": {
        if (!input.kind) throw new ToolError("'kind' is required to store content.");
        const candidate = itemText(input);
        if (!candidate.trim()) throw new ToolError("Nothing to store — provide caption/hook/body/title.");
        // Guard the no-repeat rule at the storage boundary too.
        const dup = await checkDuplicate(userId, candidate, { niche: input.niche });
        if (dup.isDuplicate) {
          return {
            data: { stored: false, reason: "duplicate", ...dup },
            summary: `Not stored — substantially similar to existing content. Revise the hook/angle and try again.`,
          };
        }
        ctx.activity("Saving to EV's content memory…");
        const item = await storeItem(userId, {
          kind: input.kind,
          status: input.status ?? "draft",
          niche: input.niche ?? null,
          theme: input.theme ?? null,
          title: input.title ?? "",
          caption: input.caption ?? null,
          hook: input.hook ?? null,
          cta: input.cta ?? null,
          body: input.body ?? null,
        });
        return {
          data: { stored: true, id: item.id, status: item.status },
          summary: `Stored ${item.kind}${item.niche ? " for " + item.niche : ""} (${item.status}).`,
        };
      }

      case "list": {
        const items = await db.evContent.findMany({
          where: {
            userId,
            ...(input.kind ? { kind: input.kind } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(input.niche ? { niche: input.niche } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: input.limit ?? 20,
          select: { id: true, kind: true, status: true, niche: true, theme: true, title: true, caption: true, createdAt: true },
        });
        return {
          data: { count: items.length, items },
          summary: `${items.length} item${items.length === 1 ? "" : "s"} found.`,
        };
      }

      case "get": {
        if (!input.id) throw new ToolError("'id' is required.");
        const item = await OWN(userId, input.id);
        if (!item) throw new ToolError("No EV content with that id.");
        return { data: item, summary: `${item.kind} — ${item.status}.` };
      }

      case "pending": {
        const items = await db.evContent.findMany({
          where: { userId, status: "ready" },
          orderBy: { createdAt: "desc" },
          take: input.limit ?? 20,
          select: { id: true, kind: true, niche: true, title: true, caption: true, cta: true, createdAt: true },
        });
        return {
          data: { count: items.length, pending: items },
          summary: items.length ? `${items.length} item(s) waiting for approval.` : "No content is waiting for approval.",
        };
      }

      case "approve":
      case "reject": {
        if (!input.id) throw new ToolError("'id' is required.");
        const item = await OWN(userId, input.id);
        if (!item) throw new ToolError("No EV content with that id.");
        const status = input.action === "approve" ? "approved" : "rejected";
        await db.evContent.update({ where: { id: item.id }, data: { status } });
        return { data: { id: item.id, status }, summary: `Marked ${item.kind} as ${status}.` };
      }

      case "schedule": {
        if (!input.id) throw new ToolError("'id' is required.");
        if (!input.scheduledAt) throw new ToolError("'scheduledAt' (ISO time) is required.");
        const item = await OWN(userId, input.id);
        if (!item) throw new ToolError("No EV content with that id.");
        await db.evContent.update({
          where: { id: item.id },
          data: { status: "scheduled", scheduledAt: new Date(input.scheduledAt) },
        });
        return {
          data: { id: item.id, status: "scheduled", scheduledAt: input.scheduledAt },
          summary: `Scheduled ${item.kind} for ${new Date(input.scheduledAt).toLocaleString()}.`,
        };
      }

      case "stats": {
        const items = await db.evContent.findMany({
          where: { userId },
          select: { kind: true, status: true, niche: true },
          take: 1000,
        });
        const byStatus: Record<string, number> = {};
        const byKind: Record<string, number> = {};
        const byNiche: Record<string, number> = {};
        for (const i of items) {
          byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
          byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
          if (i.niche) byNiche[i.niche] = (byNiche[i.niche] ?? 0) + 1;
        }
        return {
          data: { total: items.length, byStatus, byKind, byNiche },
          summary: `EV memory: ${items.length} items across ${Object.keys(byKind).length} kinds, ${Object.keys(byNiche).length} niches.`,
        };
      }
    }
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["check", "store", "list", "get", "approve", "reject", "schedule", "pending", "stats"] },
      id: { type: "string" },
      kind: { type: "string", enum: [...EV_CONTENT_KINDS] },
      status: { type: "string", enum: ["draft", "ready", "approved", "rejected", "scheduled", "published", "failed"] },
      niche: { type: "string" },
      theme: { type: "string" },
      title: { type: "string" },
      caption: { type: "string" },
      hook: { type: "string" },
      cta: { type: "string" },
      body: { type: "string" },
      text: { type: "string" },
      scheduledAt: { type: "string" },
      limit: { type: "number" },
    },
    required: ["action"],
  },
};
