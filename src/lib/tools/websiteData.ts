import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { env } from "@/lib/env";

/**
 * Website data tool — reads the user's own app database (Infinity Web & Apps,
 * hosted on Supabase) to analyze real business data: client leads, website
 * visitors, signups, orders, etc.
 *
 * SECURITY:
 *  - The Supabase service_role key lives ONLY in server env and is never sent
 *    to the browser.
 *  - This tool is strictly READ-ONLY: it issues GET/HEAD requests against the
 *    PostgREST endpoint. It never inserts, updates, or deletes.
 *  - Table/column names are validated against a strict identifier pattern before
 *    being placed in a URL, so the model cannot smuggle in query operators.
 */

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const PERIOD_DAYS: Record<string, number | null> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

function assertConfigured(): { url: string; key: string } {
  const url = env.supabaseUrl.replace(/\/$/, "");
  const key = env.supabaseServiceRoleKey;
  if (!url || !key) {
    throw new ToolError(
      "Website data isn't connected yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Settings/deployment to let JARVIS read your site's database.",
    );
  }
  return { url, key };
}

function ident(name: string, kind: "table" | "column"): string {
  if (!IDENT.test(name)) {
    throw new ToolError(`Invalid ${kind} name: "${name}".`);
  }
  return name;
}

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

function periodSince(period: string): string | null {
  const days = PERIOD_DAYS[period] ?? null;
  if (days === null) return null;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Fetch the PostgREST OpenAPI spec → { table: [columns] }. */
async function fetchSchema(url: string, key: string): Promise<Record<string, string[]>> {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { ...authHeaders(key), Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new ToolError(
      "The Supabase service key was rejected. Check SUPABASE_SERVICE_ROLE_KEY (must be the service_role secret, not the anon key).",
    );
  }
  if (!res.ok) throw new ToolError("Couldn't read your database schema.");
  const spec: any = await res.json();
  const defs = spec.definitions ?? {};
  const out: Record<string, string[]> = {};
  for (const [table, def] of Object.entries<any>(defs)) {
    out[table] = Object.keys(def?.properties ?? {});
  }
  return out;
}

/** Pick a plausible timestamp column from a table's columns. */
function guessDateColumn(columns: string[]): string | undefined {
  const prefs = ["created_at", "inserted_at", "createdat", "created", "timestamp", "date", "updated_at"];
  const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const p of prefs) {
    const hit = lower.get(p);
    if (hit) return hit;
  }
  return columns.find((c) => /(_at$|date|time)/i.test(c));
}

/** Count rows in a table via the Content-Range header (no row payload needed). */
async function countRows(
  url: string,
  key: string,
  table: string,
  filter?: { column: string; since: string },
): Promise<number> {
  const params = new URLSearchParams({ select: "*", limit: "1" });
  if (filter) params.set(filter.column, `gte.${filter.since}`);
  const res = await fetch(`${url}/rest/v1/${table}?${params.toString()}`, {
    method: "GET",
    headers: { ...authHeaders(key), Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new ToolError(`Table "${table}" was not found in your database.`);
  if (!res.ok) throw new ToolError(`Couldn't count rows in "${table}".`);
  const range = res.headers.get("content-range") ?? "";
  const total = range.split("/")[1];
  return total && total !== "*" ? Number(total) : 0;
}

const schema = z.object({
  action: z
    .enum(["list_tables", "count", "recent", "breakdown"])
    .describe("What to do against the website database."),
  table: z
    .string()
    .optional()
    .describe("Table to query (e.g. leads, visitors, signups). Omit for list_tables."),
  period: z
    .enum(["24h", "7d", "30d", "90d", "all"])
    .optional()
    .describe("Time window for counts/recent, filtered on the table's date column. Default 30d."),
  dateColumn: z
    .string()
    .optional()
    .describe("Timestamp column to filter/sort on. Auto-detected if omitted."),
  groupBy: z
    .string()
    .optional()
    .describe("Column to group by for 'breakdown' (e.g. status, source, country)."),
  limit: z.number().int().min(1).max(50).optional().describe("Max rows for 'recent'. Default 10."),
});

export const websiteDataTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "website_data",
  description:
    "Read and analyze the user's own website/app database (Infinity Web & Apps, " +
    "on Supabase): client leads, website visitors, signups, orders, and any other " +
    "tables. 'list_tables' discovers what data exists (call this first if unsure of " +
    "table names); 'count' totals rows over a time window (e.g. new leads this week); " +
    "'recent' lists the latest rows; 'breakdown' groups counts by a column (e.g. leads " +
    "by status, visitors by source). Read-only.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list_tables", "count", "recent", "breakdown"] },
      table: { type: "string", description: "Table name, e.g. leads or visitors." },
      period: { type: "string", enum: ["24h", "7d", "30d", "90d", "all"] },
      dateColumn: { type: "string", description: "Timestamp column (auto-detected if omitted)." },
      groupBy: { type: "string", description: "Column to group by for breakdown." },
      limit: { type: "number", description: "Max rows for recent (1-50)." },
    },
    required: ["action"],
  },
  requiresCapability: "websiteData",
  activityLabel: "Reading website data",
  async execute(input, ctx) {
    const { url, key } = assertConfigured();
    const schemaMap = await fetchSchema(url, key);
    const tables = Object.keys(schemaMap);

    if (input.action === "list_tables") {
      const summary = tables.length
        ? `Found ${tables.length} table${tables.length === 1 ? "" : "s"}: ${tables.slice(0, 12).join(", ")}${tables.length > 12 ? "…" : ""}.`
        : "No tables found in the public schema.";
      return {
        data: {
          tables: tables.map((t) => ({ name: t, columns: schemaMap[t] })),
        },
        summary,
      };
    }

    if (!input.table) throw new ToolError("Which table? (e.g. leads, visitors). Use list_tables to see options.");
    const table = ident(input.table, "table");
    const columns = schemaMap[table];
    if (!columns) {
      throw new ToolError(
        `Table "${table}" doesn't exist. Available: ${tables.slice(0, 15).join(", ") || "(none)"}.`,
      );
    }

    const period = input.period ?? "30d";
    const dateCol = input.dateColumn ? ident(input.dateColumn, "column") : guessDateColumn(columns);
    const since = periodSince(period);

    if (input.action === "count") {
      ctx.activity(`Counting rows in ${table}…`);
      const filter = since && dateCol ? { column: dateCol, since } : undefined;
      const total = await countRows(url, key, table, filter);
      const allTime = filter ? await countRows(url, key, table) : total;
      const scope = filter ? `in the last ${period}` : "(all time)";
      return {
        data: { table, period: filter ? period : "all", dateColumn: dateCol ?? null, count: total, totalAllTime: allTime },
        summary: `${table}: ${total} ${scope}${filter ? ` · ${allTime} all time` : ""}.`,
      };
    }

    if (input.action === "recent") {
      const limit = input.limit ?? 10;
      const params = new URLSearchParams({ select: "*", limit: String(limit) });
      if (dateCol) params.set("order", `${dateCol}.desc`);
      if (since && dateCol) params.set(dateCol, `gte.${since}`);
      ctx.activity(`Fetching latest ${table}…`);
      const res = await fetch(`${url}/rest/v1/${table}?${params.toString()}`, {
        headers: authHeaders(key),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new ToolError(`Couldn't fetch rows from "${table}".`);
      const items: any[] = await res.json();
      return {
        data: { table, period: since && dateCol ? period : "all", dateColumn: dateCol ?? null, rows: items },
        summary: `${table}: ${items.length} most recent row${items.length === 1 ? "" : "s"}.`,
      };
    }

    // breakdown
    if (!input.groupBy) throw new ToolError("breakdown needs a groupBy column (e.g. status, source).");
    const groupBy = ident(input.groupBy, "column");
    if (!columns.includes(groupBy)) {
      throw new ToolError(`Column "${groupBy}" isn't in "${table}". Columns: ${columns.slice(0, 20).join(", ")}.`);
    }
    const sel = dateCol && dateCol !== groupBy ? `${groupBy},${dateCol}` : groupBy;
    const params = new URLSearchParams({ select: sel, limit: "2000" });
    if (since && dateCol) params.set(dateCol, `gte.${since}`);
    ctx.activity(`Grouping ${table} by ${groupBy}…`);
    const res = await fetch(`${url}/rest/v1/${table}?${params.toString()}`, {
      headers: authHeaders(key),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new ToolError(`Couldn't group "${table}" by ${groupBy}.`);
    const sampled: any[] = await res.json();
    const counts = new Map<string, number>();
    for (const row of sampled) {
      const raw = row?.[groupBy];
      const label = raw === null || raw === undefined || raw === "" ? "(none)" : String(raw);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const groups = [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
    const capped = sampled.length >= 2000;
    return {
      data: { table, groupBy, period: since && dateCol ? period : "all", sampled: sampled.length, capped, groups },
      summary: `${table} by ${groupBy}: ${groups.length} group${groups.length === 1 ? "" : "s"}${capped ? " (sampled 2000 rows)" : ""}.`,
    };
  },
};
