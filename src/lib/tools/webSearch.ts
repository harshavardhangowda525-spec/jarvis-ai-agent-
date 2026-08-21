import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { env } from "@/lib/env";

const schema = z.object({
  query: z.string().min(1).max(400).describe("The search query."),
  maxResults: z.number().int().min(1).max(8).optional(),
});

/**
 * Real web search via Tavily (https://tavily.com). Returns a short answer and
 * ranked sources with titles + URLs. Never fabricates results — if the API is
 * missing or fails, it surfaces an honest error.
 */
export const webSearchTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "web_search",
  description:
    "Search the live web for current information, news, facts, companies, or " +
    "research. Use this whenever the user asks about anything recent, external, " +
    "or that you are not certain about. Returns real sources with URLs.",
  schema,
  requiresCapability: "search",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
      maxResults: {
        type: "integer",
        description: "How many sources to return (1-8). Default 5.",
      },
    },
    required: ["query"],
  },
  activityLabel: "Searching the web",
  async execute({ query, maxResults = 5 }) {
    if (!env.searchApiKey) throw new ToolError("Web search is not configured.");

    let res: Response;
    try {
      res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.searchApiKey,
          query,
          max_results: maxResults,
          include_answer: true,
          search_depth: "basic",
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ToolError("The search service is unreachable right now.");
    }
    if (res.status === 401) throw new ToolError("Web search credentials are invalid.");
    if (!res.ok) throw new ToolError("The search service returned an error.");

    const j: any = await res.json();
    const results = (j.results ?? []).slice(0, maxResults).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: typeof r.content === "string" ? r.content.slice(0, 500) : "",
    }));
    return {
      data: { query, answer: j.answer ?? null, results },
      summary: `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}".`,
    };
  },
};
