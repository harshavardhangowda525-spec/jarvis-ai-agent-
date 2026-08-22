import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getGoogleAccessToken } from "@/lib/integrations/google";

const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

const PERIODS: Record<string, string> = {
  "7d": "7daysAgo",
  "28d": "28daysAgo",
  "30d": "30daysAgo",
  "90d": "90daysAgo",
};

const schema = z.object({
  action: z
    .enum(["overview", "trend", "top_pages", "by_country", "by_source", "list_properties"])
    .describe("What analytics to fetch."),
  period: z.enum(["7d", "28d", "30d", "90d"]).optional().describe("Date range. Default 28d."),
  propertyId: z
    .string()
    .optional()
    .describe("GA4 numeric property id. If omitted, the user's first property is used."),
});

/** Resolve a GA4 property id: use the given one, else the first the user owns. */
async function resolveProperty(token: string, given?: string): Promise<{ id: string; name: string }> {
  if (given) return { id: given.replace(/^properties\//, ""), name: `property ${given}` };
  const res = await fetch(`${ADMIN_API}/accountSummaries`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 403) {
    throw new ToolError(
      "Google Analytics access isn't enabled. Enable the Analytics Admin & Data APIs in Google Cloud and reconnect Google in Settings.",
    );
  }
  if (!res.ok) throw new ToolError("Couldn't list your Analytics properties.");
  const j: any = await res.json();
  const prop = j.accountSummaries?.[0]?.propertySummaries?.[0];
  if (!prop?.property) {
    throw new ToolError("No GA4 property found on your Google account.");
  }
  return { id: String(prop.property).replace(/^properties\//, ""), name: prop.displayName ?? "your site" };
}

async function runReport(token: string, propertyId: string, body: unknown) {
  const res = await fetch(`${DATA_API}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 403) {
    throw new ToolError(
      "Access to that Analytics property was denied. Make sure the Google Analytics Data API is enabled and you reconnected Google with analytics access.",
    );
  }
  if (!res.ok) throw new ToolError("The Analytics report request failed.");
  return res.json() as Promise<any>;
}

const rows = (r: any) => r.rows ?? [];
const dim = (row: any, i = 0) => row.dimensionValues?.[i]?.value ?? "";
const met = (row: any, i = 0) => row.metricValues?.[i]?.value ?? "0";

export const analyticsTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "google_analytics",
  description:
    "Get Google Analytics (GA4) website traffic for the user's site (e.g. Infinity " +
    "Web & Apps): 'overview' (users, sessions, page views, engagement), 'trend' " +
    "(daily), 'top_pages', 'by_country', 'by_source'. Use 'list_properties' to see " +
    "which sites are available. Requires Google connected with analytics access.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["overview", "trend", "top_pages", "by_country", "by_source", "list_properties"],
      },
      period: { type: "string", enum: ["7d", "28d", "30d", "90d"] },
      propertyId: { type: "string", description: "GA4 numeric property id (optional)." },
    },
    required: ["action"],
  },
  activityLabel: "Reading analytics",
  async execute(input, ctx) {
    const token = await getGoogleAccessToken(ctx.userId);

    if (input.action === "list_properties") {
      const res = await fetch(`${ADMIN_API}/accountSummaries`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 403) {
        throw new ToolError(
          "Analytics access isn't enabled. Enable the Analytics Admin & Data APIs in Google Cloud and reconnect Google.",
        );
      }
      if (!res.ok) throw new ToolError("Couldn't list Analytics properties.");
      const j: any = await res.json();
      const props = (j.accountSummaries ?? []).flatMap((a: any) =>
        (a.propertySummaries ?? []).map((p: any) => ({
          id: String(p.property).replace(/^properties\//, ""),
          name: p.displayName,
        })),
      );
      return { data: { properties: props }, summary: `${props.length} GA4 propert${props.length === 1 ? "y" : "ies"}.` };
    }

    const { id, name } = await resolveProperty(token, input.propertyId);
    const startDate = PERIODS[input.period ?? "28d"];
    const dateRanges = [{ startDate, endDate: "today" }];

    if (input.action === "overview") {
      const r = await runReport(token, id, {
        dateRanges,
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
      });
      const row = rows(r)[0];
      const data = row
        ? {
            property: name,
            period: input.period ?? "28d",
            activeUsers: Number(met(row, 0)),
            sessions: Number(met(row, 1)),
            pageViews: Number(met(row, 2)),
            avgSessionSeconds: Math.round(Number(met(row, 3))),
            bounceRate: `${(Number(met(row, 4)) * 100).toFixed(1)}%`,
          }
        : { property: name, period: input.period ?? "28d", activeUsers: 0, sessions: 0, pageViews: 0 };
      return { data, summary: `${name}: ${data.activeUsers} users, ${data.sessions} sessions, ${data.pageViews} views (${data.period}).` };
    }

    const configs: Record<string, any> = {
      trend: { dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }, { name: "sessions" }], orderBys: [{ dimension: { dimensionName: "date" } }] },
      top_pages: { dateRanges, dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 10 },
      by_country: { dateRanges, dimensions: [{ name: "country" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], limit: 10 },
      by_source: { dateRanges, dimensions: [{ name: "sessionSource" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 10 },
    };
    const r = await runReport(token, id, configs[input.action]);
    const items = rows(r).map((row: any) => ({ label: dim(row), value: Number(met(row)) }));
    return {
      data: { property: name, period: input.period ?? "28d", action: input.action, items },
      summary: `${name}: ${items.length} rows for ${input.action}.`,
    };
  },
};
