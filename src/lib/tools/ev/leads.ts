import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { getDb } from "@/lib/db";
import { darwinConfigured, darwinFetchLeads, DarwinError } from "@/lib/ev/darwin";

/**
 * EV ↔ DARWIN bridge. DARWIN discovers and stores REAL leads; EV reads them from
 * the internal DARWIN CRM (and, if configured, an external DARWIN service) to
 * analyze / prioritize for outreach. Never fabricates businesses or numbers.
 */

const schema = z.object({
  action: z.enum(["status", "fetch"]).describe("status: is DARWIN available? fetch: get real leads from the DARWIN CRM."),
  niche: z.string().max(60).optional().describe("Filter by category/niche, e.g. gyms, cafes."),
  location: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

type Input = z.infer<typeof schema>;

export const evLeadsTool: ToolDefinition<Input> = {
  name: "ev_leads",
  description:
    "Get REAL business leads from DARWIN (the internal lead-gen/CRM agent) for EV to analyze and prioritize for outreach. " +
    "'status' reports availability; 'fetch' pulls stored real leads. If there are none, EV must NOT fabricate businesses.",
  schema,
  agentScope: "ev",
  activityLabel: "Reading DARWIN leads",
  async execute(input, ctx) {
    const db = getDb();
    const internalCount = await db.darwinLead.count({ where: { userId: ctx.userId } }).catch(() => 0);

    if (input.action === "status") {
      return {
        data: { internalLeads: internalCount, externalService: darwinConfigured() },
        summary: internalCount
          ? `DARWIN CRM has ${internalCount} real lead(s) EV can work with.`
          : "DARWIN has no leads yet. Ask DARWIN to search a connected source (Google Places) first — I won't invent businesses.",
      };
    }

    // fetch — prefer the internal DARWIN CRM (real, stored leads).
    if (internalCount > 0) {
      ctx.activity("Reading real leads from the DARWIN CRM…");
      const leads = await db.darwinLead.findMany({
        where: {
          userId: ctx.userId,
          ...(input.niche ? { category: { contains: input.niche, mode: "insensitive" } } : {}),
          ...(input.location ? { location: { contains: input.location, mode: "insensitive" } } : {}),
        },
        orderBy: { discoveredAt: "desc" },
        take: input.limit ?? 25,
        select: { id: true, businessName: true, category: true, location: true, website: true, phone: true, email: true, instagram: true, stage: true, source: true, opportunityType: true },
      });
      return {
        data: { count: leads.length, source: "darwin_crm", leads },
        summary: leads.length ? `${leads.length} real lead(s) from the DARWIN CRM.` : "No matching leads in the DARWIN CRM (nothing invented).",
      };
    }

    // Optional external DARWIN service fallback.
    if (darwinConfigured()) {
      try {
        ctx.activity("Fetching leads from the DARWIN service…");
        const leads = await darwinFetchLeads({ niche: input.niche, location: input.location, limit: input.limit });
        return { data: { count: leads.length, source: "darwin_service", leads }, summary: `DARWIN service returned ${leads.length} lead(s).` };
      } catch (err) {
        const msg = err instanceof DarwinError ? err.message : "Couldn't reach the DARWIN service.";
        return { data: { count: 0, error: msg, leads: [] }, summary: msg };
      }
    }

    return {
      data: { count: 0, leads: [] },
      summary: "No leads yet. Ask DARWIN to find real businesses first (needs a connected source like Google Places). I won't invent leads.",
    };
  },
  inputSchema: {
    type: "object",
    properties: { action: { type: "string", enum: ["status", "fetch"] }, niche: { type: "string" }, location: { type: "string" }, limit: { type: "number" } },
    required: ["action"],
  },
};
