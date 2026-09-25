import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { DARWIN_STAGES } from "@/lib/darwin/config";
import { googleMapsAreaUrl, googleMapsLeadUrl } from "@/lib/darwin/maps";

/**
 * darwin_map — open real CRM leads in Google Maps (a new browser tab). One lead
 * opens its own listing; several open one map of the area with a link per lead.
 * With nothing specified, it shows the leads from the latest search.
 */
const schema = z.object({
  ids: z.array(z.string()).max(20).optional().describe("Lead ids to show."),
  name: z.string().max(120).optional().describe("Business name (or part of it) to show."),
  stage: z.enum(DARWIN_STAGES).optional().describe("Show the leads in this pipeline stage."),
  limit: z.number().int().min(1).max(20).optional(),
});
type Input = z.infer<typeof schema>;

const SELECT = { id: true, businessName: true, category: true, location: true, latitude: true, longitude: true, discoveredAt: true, metadata: true } as const;

export const darwinMapTool: ToolDefinition<Input> = {
  name: "darwin_map",
  description:
    "Open leads in Google Maps in the user's browser. Use when the user says e.g. 'open these leads in Google Maps', 'show Gold's Gym on the map', " +
    "'map my interested leads'. Give ids or a business name for specific leads, a stage for a pipeline group, or nothing for the leads from the latest search.",
  schema,
  agentScope: "darwin",
  activityLabel: "Opening Google Maps",
  async execute(input, ctx) {
    const db = getDb();
    const take = input.limit ?? 10;
    let leads;
    let which = "";
    if (input.ids?.length || input.name || input.stage) {
      leads = await db.darwinLead.findMany({
        where: {
          userId: ctx.userId,
          ...(input.ids?.length ? { id: { in: input.ids } } : {}),
          ...(input.name ? { businessName: { contains: input.name.trim(), mode: "insensitive" } } : {}),
          ...(input.stage ? { stage: input.stage } : {}),
        },
        orderBy: { discoveredAt: "desc" }, take, select: SELECT,
      });
      which = input.stage ? `${input.stage.replace(/_/g, " ")} ` : "";
    } else {
      // The latest search: everything discovered in the same run as the newest lead.
      const newest = await db.darwinLead.findFirst({ where: { userId: ctx.userId }, orderBy: { discoveredAt: "desc" }, select: { discoveredAt: true } });
      leads = newest
        ? await db.darwinLead.findMany({
            where: { userId: ctx.userId, discoveredAt: { gte: new Date(newest.discoveredAt.getTime() - 2 * 60_000) } },
            orderBy: { discoveredAt: "desc" }, take, select: SELECT,
          })
        : [];
      which = "latest ";
    }
    if (!leads.length) {
      throw new ToolError(input.name ? `No lead called "${input.name}" in the CRM.` : "No matching leads in the CRM yet — run a search first.");
    }

    const links = leads.map((l) => ({ url: googleMapsLeadUrl(l)!, label: l.businessName })).filter((l) => l.url);
    if (leads.length === 1) {
      const l = leads[0];
      return {
        data: { openUrl: links[0].url, label: `${l.businessName} on Google Maps`, leads: [{ id: l.id, businessName: l.businessName }] },
        summary: `Opened ${l.businessName} in Google Maps.`,
      };
    }
    // What was searched for ("gyms in Bangalore"), else the leads' own category.
    const search = (leads[0].metadata as { search?: { category?: string; location?: string } } | null)?.search;
    const counts = new Map<string, number>();
    for (const l of leads) if (l.category) counts.set(l.category, (counts.get(l.category) ?? 0) + 1);
    const category = search?.category || [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "businesses";
    const area = googleMapsAreaUrl(leads, category, search?.location);
    return {
      data: {
        openUrl: area,
        label: `${leads.length} ${category} on Google Maps`,
        links,
        leads: leads.map((l) => ({ id: l.id, businessName: l.businessName })),
      },
      summary: `Opened Google Maps on ${category}${search?.location ? ` in ${search.location}` : ""} around your ${leads.length} ${which}leads, with a Maps link for each one.`,
    };
  },
  inputSchema: {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "string" } },
      name: { type: "string" },
      stage: { type: "string", enum: [...DARWIN_STAGES] },
      limit: { type: "number" },
    },
  },
};
