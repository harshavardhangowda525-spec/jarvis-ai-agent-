import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { logActivity, followUpBuckets } from "@/lib/darwin/store";

/**
 * darwin_followup — schedule, list and complete follow-ups. Surfaces due / today
 * / overdue. Scheduling never claims a message was sent; it just sets the task.
 */
const schema = z.object({
  action: z.enum(["schedule", "list", "complete"]).describe("schedule a follow-up, list due ones, or complete one."),
  leadId: z.string().optional().describe("Lead id (for schedule)."),
  followUpId: z.string().optional().describe("Follow-up id (for complete)."),
  dueAt: z.string().datetime().optional().describe("ISO time the follow-up is due (for schedule)."),
  reason: z.string().max(300).optional(),
  message: z.string().max(4000).optional().describe("Draft message/notes for the follow-up (not sent)."),
  priority: z.enum(["low", "normal", "high"]).optional(),
  scope: z.enum(["due", "today", "overdue", "upcoming"]).optional().describe("Which follow-ups to list (default due = today+overdue)."),
  limit: z.number().int().min(1).max(100).optional(),
});

type Input = z.infer<typeof schema>;

export const darwinFollowUpTool: ToolDefinition<Input> = {
  name: "darwin_followup",
  description:
    "Manage DARWIN follow-ups: 'schedule' a follow-up on a lead (sets nextFollowUpAt), 'list' due/today/overdue/upcoming follow-ups, " +
    "or 'complete' one. Scheduling does NOT send anything — it only creates the reminder.",
  schema,
  agentScope: "darwin",
  activityLabel: "Managing follow-ups",
  async execute(input, ctx) {
    const db = getDb();
    const userId = ctx.userId;

    if (input.action === "schedule") {
      if (!input.leadId) throw new ToolError("'leadId' is required.");
      if (!input.dueAt) throw new ToolError("'dueAt' (ISO time) is required.");
      const lead = await db.darwinLead.findFirst({ where: { id: input.leadId, userId } });
      if (!lead) throw new ToolError("No lead with that id.");
      const due = new Date(input.dueAt);
      const fu = await db.darwinFollowUp.create({
        data: { userId, leadId: lead.id, dueAt: due, reason: input.reason ?? null, message: input.message ?? null, priority: input.priority ?? "normal" },
      });
      await db.darwinLead.update({ where: { id: lead.id }, data: { nextFollowUpAt: due } });
      await logActivity(userId, "followup_scheduled", `Follow-up for ${lead.businessName} on ${due.toLocaleString()}${input.reason ? ` — ${input.reason}` : ""}.`, lead.id);
      return { data: { followUpId: fu.id, leadId: lead.id, dueAt: input.dueAt }, summary: `Follow-up scheduled for ${lead.businessName} on ${due.toLocaleString()}.` };
    }

    if (input.action === "complete") {
      if (!input.followUpId) throw new ToolError("'followUpId' is required.");
      const fu = await db.darwinFollowUp.findFirst({ where: { id: input.followUpId, userId }, include: { lead: { select: { id: true, businessName: true } } } });
      if (!fu) throw new ToolError("No follow-up with that id.");
      await db.darwinFollowUp.update({ where: { id: fu.id }, data: { status: "completed", completedAt: new Date() } });
      await logActivity(userId, "followup_completed", `Follow-up completed for ${fu.lead.businessName}.`, fu.lead.id);
      return { data: { followUpId: fu.id }, summary: `Marked follow-up for ${fu.lead.businessName} complete.` };
    }

    // list
    const { now } = followUpBuckets(ctx.timezone);
    const scope = input.scope ?? "due";
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
    const where: any = { userId, status: "pending" };
    if (scope === "overdue") where.dueAt = { lt: now };
    else if (scope === "today") where.dueAt = { lte: dayEnd, gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
    else if (scope === "upcoming") where.dueAt = { gt: dayEnd };
    else where.dueAt = { lte: dayEnd }; // due = today + overdue

    const rows = await db.darwinFollowUp.findMany({
      where, orderBy: { dueAt: "asc" }, take: input.limit ?? 50,
      include: { lead: { select: { id: true, businessName: true, stage: true, phone: true, email: true } } },
    });
    const items = rows.map((r) => ({
      followUpId: r.id, leadId: r.leadId, business: r.lead.businessName, stage: r.lead.stage,
      dueAt: r.dueAt, priority: r.priority, reason: r.reason,
      state: r.dueAt < now ? "OVERDUE" : "DUE",
    }));
    return { data: { scope, count: items.length, followUps: items }, summary: items.length ? `${items.length} follow-up(s) ${scope}.` : `No follow-ups ${scope}.` };
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["schedule", "list", "complete"] },
      leadId: { type: "string" }, followUpId: { type: "string" }, dueAt: { type: "string" },
      reason: { type: "string" }, message: { type: "string" }, priority: { type: "string", enum: ["low", "normal", "high"] },
      scope: { type: "string", enum: ["due", "today", "overdue", "upcoming"] }, limit: { type: "number" },
    },
    required: ["action"],
  },
};
