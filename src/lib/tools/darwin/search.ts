import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { discoverLeads, LeadSourceError } from "@/lib/darwin/sources";
import { upsertLeads } from "@/lib/darwin/store";

/**
 * darwin_search — find REAL businesses from a connected source (Google Places),
 * dedupe them, and store them in the CRM. Reports the ACTUAL number found; never
 * pads with fabricated leads.
 */
const schema = z.object({
  query: z.string().min(2).max(300).describe("Natural search, e.g. 'cafes in Bengaluru with a website'. Include business type + location."),
  limit: z.number().int().min(1).max(60).optional().describe("Max leads to find (default 20). Google returns up to 60."),
});

type Input = z.infer<typeof schema>;

export const darwinSearchTool: ToolDefinition<Input> = {
  name: "darwin_search",
  description:
    "Find REAL businesses from connected lead sources (Google Places or Foursquare Places) and store them in the CRM with duplicate protection. " +
    "Returns the actual number of real businesses found — never fabricates or pads results. If no source is connected it says so.",
  schema,
  agentScope: "darwin",
  activityLabel: "Searching real lead sources",
  async execute(input, ctx) {
    ctx.activity(`Searching connected sources for “${input.query}”…`);
    let raws;
    try {
      raws = await discoverLeads({ query: input.query, limit: input.limit ?? 20 });
    } catch (err) {
      if (err instanceof LeadSourceError) throw new ToolError(err.message);
      throw err;
    }
    if (raws.length === 0) {
      return { data: { found: 0, created: 0, duplicates: 0 }, summary: `No real businesses matched “${input.query}”. Nothing was added (no fabricated leads).` };
    }
    ctx.activity(`Found ${raws.length} — de-duplicating and saving…`);
    const r = await upsertLeads(ctx.userId, raws);
    return {
      data: {
        found: raws.length, created: r.created, duplicates: r.duplicates,
        source: raws[0]?.source, leadIds: r.leadIds.slice(0, 50),
      },
      summary: `Found ${raws.length} real business${raws.length === 1 ? "" : "es"} (source: ${raws[0]?.source}). Added ${r.created} new, skipped ${r.duplicates} duplicate${r.duplicates === 1 ? "" : "s"}.`,
    };
  },
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "number" } },
    required: ["query"],
  },
};
