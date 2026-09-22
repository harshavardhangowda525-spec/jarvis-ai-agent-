import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { DARWIN_STAGES } from "@/lib/darwin/config";
import { followUpBuckets } from "@/lib/darwin/store";

/**
 * darwin_leads — read the CRM. List/filter stored REAL leads, get one lead with
 * its activity + follow-ups, or summarize the pipeline. Read-only.
 */
const schema = z.object({
  action: z.enum(["list", "get", "stats", "needs_attention"]).describe("list: filter leads. get: one lead + history. stats: pipeline overview. needs_attention: no-reply / overdue."),
  id: z.string().optional(),
  stage: z.enum(DARWIN_STAGES).optional(),
  source: z.string().max(40).optional(),
  search: z.string().max(120).optional().describe("Match business name/category/location."),
  limit: z.number().int().min(1).max(100).optional(),
});

type Input = z.infer<typeof schema>;

export const darwinLeadsTool: ToolDefinition<Input> = {
  name: "darwin_leads",
  description:
    "Read the DARWIN CRM: list/filter real leads (by stage, source, text), get one lead with its full activity + follow-up history, " +
    "get pipeline stats, or find leads needing attention (contacted-but-no-reply / overdue follow-ups). Read-only; shows only stored real leads.",
  schema,
  agentScope: "darwin",
  activityLabel: "Reading the CRM",
  async execute(input, ctx) {
    const db = getDb();
    const userId = ctx.userId;

    if (input.action === "get") {
      if (!input.id) throw new ToolError("'id' is required.");
      const lead = await db.darwinLead.findFirst({
        where: { id: input.id, userId },
        include: {
          activities: { orderBy: { createdAt: "desc" }, take: 20 },
          followUps: { orderBy: { dueAt: "asc" }, take: 10 },
          messages: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      });
      if (!lead) throw new ToolError("No lead with that id.");
      return { data: lead, summary: `${lead.businessName} — ${lead.stage.toUpperCase()}.` };
    }

    if (input.action === "stats") {
      const leads = await db.darwinLead.findMany({ where: { userId }, select: { stage: true, source: true } });
      const byStage: Record<string, number> = {};
      const bySource: Record<string, number> = {};
      for (const l of leads) { byStage[l.stage] = (byStage[l.stage] ?? 0) + 1; bySource[l.source] = (bySource[l.source] ?? 0) + 1; }
      return { data: { total: leads.length, byStage, bySource }, summary: `${leads.length} real leads in the CRM.` };
    }

    if (input.action === "needs_attention") {
      const { now } = followUpBuckets(ctx.timezone);
      const overdue = await db.darwinLead.findMany({
        where: { userId, nextFollowUpAt: { lt: now } },
        orderBy: { nextFollowUpAt: "asc" }, take: input.limit ?? 50,
        select: { id: true, businessName: true, stage: true, nextFollowUpAt: true },
      });
      const noReply = await db.darwinLead.findMany({
        where: { userId, stage: "contacted" },
        orderBy: { updatedAt: "asc" }, take: input.limit ?? 50,
        select: { id: true, businessName: true, updatedAt: true },
      });
      return {
        data: { overdueFollowUps: overdue, awaitingReply: noReply },
        summary: `${overdue.length} overdue follow-up(s), ${noReply.length} contacted awaiting reply.`,
      };
    }

    // list
    const leads = await db.darwinLead.findMany({
      where: {
        userId,
        ...(input.stage ? { stage: input.stage } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.search
          ? { OR: [
              { businessName: { contains: input.search, mode: "insensitive" } },
              { category: { contains: input.search, mode: "insensitive" } },
              { location: { contains: input.search, mode: "insensitive" } },
            ] }
          : {}),
      },
      orderBy: { discoveredAt: "desc" },
      take: input.limit ?? 25,
      select: {
        id: true, businessName: true, category: true, location: true, website: true, phone: true,
        source: true, stage: true, opportunityType: true, verifiedFields: true, nextFollowUpAt: true, discoveredAt: true,
      },
    });
    return { data: { count: leads.length, leads }, summary: `${leads.length} lead${leads.length === 1 ? "" : "s"} found.` };
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "get", "stats", "needs_attention"] },
      id: { type: "string" },
      stage: { type: "string", enum: [...DARWIN_STAGES] },
      source: { type: "string" },
      search: { type: "string" },
      limit: { type: "number" },
    },
    required: ["action"],
  },
};
