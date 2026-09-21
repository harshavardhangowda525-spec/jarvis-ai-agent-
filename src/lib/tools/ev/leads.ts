import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { darwinConfigured, darwinFetchLeads, DarwinError } from "@/lib/ev/darwin";

/**
 * EV ↔ DARWIN bridge. DARWIN discovers REAL leads; EV analyzes, categorizes and
 * prioritizes them. If DARWIN isn't configured, this tool says so honestly and
 * returns NO leads — EV must never invent businesses or phone numbers.
 */

const schema = z.object({
  action: z.enum(["status", "fetch"]).describe("status: is DARWIN connected? fetch: get real leads from DARWIN."),
  niche: z.string().max(60).optional().describe("Target niche filter, e.g. gyms, cafes."),
  location: z.string().max(120).optional().describe("Location filter."),
  limit: z.number().int().min(1).max(100).optional(),
});

type Input = z.infer<typeof schema>;

export const evLeadsTool: ToolDefinition<Input> = {
  name: "ev_leads",
  description:
    "Get REAL business leads from DARWIN (lead discovery) for EV to analyze, categorize and prioritize for outreach. " +
    "Use 'status' to check if DARWIN is connected, 'fetch' to pull leads. If DARWIN isn't connected, this returns none — " +
    "EV must NOT fabricate businesses or numbers.",
  schema,
  agentScope: "ev",
  activityLabel: "Requesting leads from DARWIN",
  async execute(input, ctx) {
    if (input.action === "status" || !darwinConfigured()) {
      return {
        data: { connected: darwinConfigured() },
        summary: darwinConfigured()
          ? "DARWIN is connected — I can fetch real leads."
          : "DARWIN lead discovery is not connected. I can't invent businesses; connect DARWIN (set DARWIN_API_URL) or give me a specific business and I'll draft outreach.",
      };
    }

    try {
      ctx.activity("Fetching real leads from DARWIN…");
      const leads = await darwinFetchLeads({ niche: input.niche, location: input.location, limit: input.limit });
      // EV-side prioritization signal (contactability), computed from real fields only.
      const enriched = leads.map((l) => {
        let score = 0;
        if (l.instagram) score += 2;
        if (l.phone) score += 2;
        if (l.website) score += 1; // already has a site → still a candidate for apps/growth
        return { ...l, _evPriority: score };
      });
      enriched.sort((a, b) => (b._evPriority as number) - (a._evPriority as number));
      return {
        data: { count: enriched.length, leads: enriched, source: "darwin" },
        summary: enriched.length
          ? `DARWIN returned ${enriched.length} real lead(s)${input.niche ? " for " + input.niche : ""}.`
          : "DARWIN returned no matching leads.",
      };
    } catch (err) {
      const msg = err instanceof DarwinError ? err.message : "Couldn't fetch leads from DARWIN.";
      return { data: { connected: true, error: msg, leads: [] }, summary: msg };
    }
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["status", "fetch"] },
      niche: { type: "string" },
      location: { type: "string" },
      limit: { type: "number" },
    },
    required: ["action"],
  },
};
