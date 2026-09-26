import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { findNewLeads } from "@/lib/darwin/discovery";
import { GeoapifyError } from "@/lib/darwin/geoapify";
import { LEAD_FILTER_IDS } from "@/lib/darwin/types";

/**
 * darwin_search — find NEW real local businesses via Geoapify Places. Leads the
 * user has already been shown are skipped (persistent history), and asking again
 * continues where the last search stopped. Reports the ACTUAL counts; never
 * pads with fabricated leads or invents phone numbers.
 */
const schema = z.object({
  category: z.string().min(2).max(80).describe("Business type, e.g. 'gyms', 'cafes', 'dentists', 'salons'."),
  location: z.string().min(2).max(120).describe("City, area, neighbourhood, postcode or 'lat,lon', e.g. 'Indiranagar, Bangalore'."),
  limit: z.number().int().min(1).max(50).optional().describe("How many NEW leads to find (default 20)."),
  filter: z.enum(LEAD_FILTER_IDS).optional()
    .describe("no_website: no website listed. no_website_phone: no website listed AND a real phone number (use this when the user wants numbers / people to call). has_website / phone / no_phone. Default all."),
});

type Input = z.infer<typeof schema>;

export const darwinSearchTool: ToolDefinition<Input> = {
  name: "darwin_search",
  description:
    "Find NEW real local businesses (Geoapify Places) for a category + location and save them to the CRM. " +
    "Previously discovered businesses are skipped automatically, and repeating the same search continues further out. " +
    "Returns the real number found — never fabricates leads or phone numbers.",
  schema,
  agentScope: "darwin",
  activityLabel: "Searching Geoapify for new leads",
  async execute(input, ctx) {
    ctx.activity(`Searching Geoapify for ${input.category} near ${input.location}…`);
    try {
      const r = await findNewLeads({
        userId: ctx.userId, category: input.category, location: input.location,
        limit: input.limit ?? 20, filter: input.filter ?? "all",
      });
      return {
        data: {
          newCount: r.newCount, skippedDuplicates: r.skippedDuplicates, exhausted: r.exhausted, stoppedReason: r.stoppedReason,
          near: r.center.label,
          leads: r.leads.slice(0, 20).map((l) => ({ id: l.id, name: l.businessName, phone: l.phone ?? "Phone unavailable", website: l.website, address: l.address })),
        },
        summary: r.message,
      };
    } catch (err) {
      if (err instanceof GeoapifyError) throw new ToolError(err.message);
      throw err;
    }
  },
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string" },
      location: { type: "string" },
      limit: { type: "number" },
      filter: { type: "string", enum: [...LEAD_FILTER_IDS] },
    },
    required: ["category", "location"],
  },
};
