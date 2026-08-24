import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { env } from "@/lib/env";

/**
 * Infinity Compass tool — reads the user's Compass CRM (a Lovable app backed by
 * Supabase) so JARVIS can answer "what are the follow-ups today?", show overdue
 * follow-ups, and list contacts/leads/deals.
 *
 * SECURITY:
 *  - The Compass service_role key lives ONLY in server env, never sent to the browser.
 *  - READ-ONLY: issues GET requests against PostgREST. Never writes.
 *  - Table/column names are validated against a strict identifier pattern.
 *
 * SCHEMA-AGNOSTIC: Compass's exact table/column names aren't known ahead of
 * time, so the tool discovers them from the PostgREST OpenAPI spec and
 * auto-detects the follow-up table + follow-up-date column. The model can also
 * call list_tables to inspect the schema and pass explicit names.
 */

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertConfigured(): { url: string; key: string } {
  const url = env.compassSupabaseUrl.replace(/\/$/, "");
  const key = env.compassSupabaseServiceRoleKey;
  if (!url || !key) {
    throw new ToolError(
      "Infinity Compass isn't connected yet. Add COMPASS_SUPABASE_URL and " +
        "COMPASS_SUPABASE_SERVICE_ROLE_KEY (from the Compass project's Supabase → " +
        "Settings → API) so JARVIS can read your follow-ups.",
    );
  }
  return { url, key };
}

function ident(name: string, kind: "table" | "column"): string {
  if (!IDENT.test(name)) throw new ToolError(`Invalid ${kind} name: "${name}".`);
  return name;
}

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** Fetch the PostgREST OpenAPI spec → { table: [columns] }. */
async function fetchSchema(url: string, key: string): Promise<Record<string, string[]>> {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { ...authHeaders(key), Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new ToolError(
      "The Compass Supabase key was rejected. Use the service_role secret (not the anon key) for COMPASS_SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  if (!res.ok) throw new ToolError("Couldn't read the Compass database schema.");
  const spec: any = await res.json();
  const defs = spec.definitions ?? {};
  const out: Record<string, string[]> = {};
  for (const [table, def] of Object.entries<any>(defs)) {
    out[table] = Object.keys(def?.properties ?? {});
  }
  return out;
}

/** Score a table name by how likely it holds follow-ups / CRM rows. */
function scoreTable(name: string): number {
  const n = name.toLowerCase();
  if (/follow.?up/.test(n)) return 100;
  if (/reminder/.test(n)) return 80;
  if (/activit|task/.test(n)) return 60;
  if (/lead|deal|opportunit|pipeline/.test(n)) return 50;
  if (/contact|client|customer/.test(n)) return 40;
  return 0;
}

/** Pick the column most likely to hold the follow-up date. */
function pickFollowUpColumn(columns: string[]): string | undefined {
  const lower = columns.map((c) => ({ c, l: c.toLowerCase() }));
  const rank = (l: string): number => {
    if (/follow.?up.?(date|at|on)/.test(l)) return 100;
    if (/follow.?up/.test(l) && /(date|at|on|due)/.test(l)) return 95;
    if (/next.?(follow|contact|action|step|touch)/.test(l)) return 90;
    if (/(due|reminder|scheduled).?(date|at|on)?/.test(l)) return 70;
    if (/follow.?up/.test(l)) return 60;
    if (/\b(due|date|scheduled|next)\b/.test(l)) return 40;
    return 0;
  };
  return lower
    .map((x) => ({ ...x, r: rank(x.l) }))
    .filter((x) => x.r > 0)
    .sort((a, b) => b.r - a.r)[0]?.c;
}

/** A column that marks a follow-up as done/complete, if any (to exclude those). */
function pickStatusColumn(columns: string[]): string | undefined {
  const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const k of ["status", "state", "stage", "completed", "is_completed", "done", "is_done", "resolved"]) {
    const hit = lower.get(k);
    if (hit) return hit;
  }
  return undefined;
}

/** Today's date (YYYY-MM-DD) and tomorrow's, in the user's timezone. */
function dayBounds(timezone: string): { today: string; tomorrow: string; label: string } {
  const now = new Date();
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = fmt(now);
  const tomorrow = fmt(new Date(now.getTime() + 86_400_000));
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "long", month: "short", day: "numeric",
  }).format(now);
  return { today, tomorrow, label };
}

async function getRows(
  url: string, key: string, table: string, params: URLSearchParams,
): Promise<any[]> {
  const res = await fetch(`${url}/rest/v1/${table}?${params.toString()}`, {
    headers: authHeaders(key),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new ToolError(`Table "${table}" was not found in Compass.`);
  if (!res.ok) throw new ToolError(`Couldn't read "${table}" from Compass.`);
  return res.json();
}

const schema = z.object({
  action: z
    .enum(["follow_ups", "list_tables", "recent"])
    .describe("follow_ups: follow-ups due (default today). list_tables: discover schema. recent: latest rows in a table."),
  table: z.string().optional().describe("Override the follow-up/CRM table. Auto-detected if omitted."),
  dateColumn: z.string().optional().describe("Override the follow-up-date column. Auto-detected if omitted."),
  scope: z
    .enum(["today", "overdue", "upcoming", "week"])
    .optional()
    .describe("Which follow-ups: today (default), overdue, upcoming, or week (next 7 days)."),
  limit: z.number().int().min(1).max(100).optional().describe("Max rows. Default 50."),
});

export const compassTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "compass",
  description:
    "Read the user's Infinity Compass CRM (Supabase-backed) to answer questions " +
    "about FOLLOW-UPS and contacts/leads. Use action 'follow_ups' for 'what are my " +
    "follow-ups today?' (also supports scope: overdue, upcoming, week). " +
    "'list_tables' inspects the schema; 'recent' lists the latest rows of a table. " +
    "Read-only. The follow-up table and date column are auto-detected but can be overridden.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["follow_ups", "list_tables", "recent"] },
      table: { type: "string", description: "Override table (auto-detected if omitted)." },
      dateColumn: { type: "string", description: "Override follow-up date column." },
      scope: { type: "string", enum: ["today", "overdue", "upcoming", "week"] },
      limit: { type: "number", description: "Max rows (1-100)." },
    },
    required: ["action"],
  },
  requiresCapability: "compass",
  activityLabel: "Reading Infinity Compass",
  async execute(input, ctx) {
    const { url, key } = assertConfigured();
    const schemaMap = await fetchSchema(url, key);
    const tables = Object.keys(schemaMap);

    if (input.action === "list_tables") {
      return {
        data: { tables: tables.map((t) => ({ name: t, columns: schemaMap[t] })) },
        summary: tables.length
          ? `Compass has ${tables.length} table${tables.length === 1 ? "" : "s"}: ${tables.slice(0, 12).join(", ")}${tables.length > 12 ? "…" : ""}.`
          : "No tables found in Compass.",
      };
    }

    // Resolve the target table.
    let table = input.table ? ident(input.table, "table") : "";
    if (!table) {
      const ranked = tables.map((t) => ({ t, s: scoreTable(t) })).sort((a, b) => b.s - a.s);
      if (!ranked.length || ranked[0].s === 0) {
        throw new ToolError(
          `Couldn't identify a follow-up table automatically. Available tables: ${tables.slice(0, 15).join(", ") || "(none)"}. ` +
            `Retry with an explicit "table".`,
        );
      }
      table = ranked[0].t;
    }
    const columns = schemaMap[table];
    if (!columns) throw new ToolError(`Table "${table}" doesn't exist in Compass. Available: ${tables.slice(0, 15).join(", ")}.`);

    if (input.action === "recent") {
      const limit = input.limit ?? 20;
      const params = new URLSearchParams({ select: "*", limit: String(limit) });
      const dc = input.dateColumn ? ident(input.dateColumn, "column") : pickFollowUpColumn(columns);
      if (dc) params.set("order", `${dc}.desc`);
      ctx.activity(`Fetching latest ${table}…`);
      const rows = await getRows(url, key, table, params);
      return { data: { table, rows }, summary: `${table}: ${rows.length} recent row${rows.length === 1 ? "" : "s"}.` };
    }

    // follow_ups
    const dateColumn = input.dateColumn ? ident(input.dateColumn, "column") : pickFollowUpColumn(columns);
    if (!dateColumn) {
      throw new ToolError(
        `Couldn't find a follow-up date column in "${table}". Columns: ${columns.slice(0, 20).join(", ")}. ` +
          `Retry with an explicit "dateColumn".`,
      );
    }
    const { today, tomorrow, label } = dayBounds(ctx.timezone);
    const scope = input.scope ?? "today";
    const limit = input.limit ?? 50;

    const params = new URLSearchParams({ select: "*", limit: String(limit), order: `${dateColumn}.asc` });
    let scopeText = "";
    if (scope === "today") {
      params.set(dateColumn, `gte.${today}`);
      params.append(dateColumn, `lt.${tomorrow}`);
      scopeText = `due today (${label})`;
    } else if (scope === "overdue") {
      params.set(dateColumn, `lt.${today}`);
      scopeText = "overdue";
    } else if (scope === "upcoming") {
      params.set(dateColumn, `gte.${tomorrow}`);
      scopeText = "upcoming";
    } else {
      // week: today .. +7 days
      const weekEnd = new Intl.DateTimeFormat("en-CA", {
        timeZone: ctx.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(Date.now() + 7 * 86_400_000));
      params.set(dateColumn, `gte.${today}`);
      params.append(dateColumn, `lt.${weekEnd}`);
      scopeText = "in the next 7 days";
    }

    ctx.activity(`Finding follow-ups ${scopeText}…`);
    const rows = await getRows(url, key, table, params);

    // Best-effort: drop rows whose status column reads completed/done.
    const statusCol = pickStatusColumn(columns);
    const active = statusCol
      ? rows.filter((r) => !/^(done|complete|completed|closed|resolved|true)$/i.test(String(r?.[statusCol] ?? "")))
      : rows;

    return {
      data: {
        table, dateColumn, scope, date: today, statusColumn: statusCol ?? null,
        count: active.length, followUps: active,
      },
      summary:
        active.length === 0
          ? `No follow-ups ${scopeText}.`
          : `${active.length} follow-up${active.length === 1 ? "" : "s"} ${scopeText}.`,
    };
  },
};
