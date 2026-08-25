import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { env } from "@/lib/env";

/**
 * Pluslide tool — generate and list AI slide decks / presentations via the
 * Pluslide API (Bearer token). The base URL and endpoint paths are read from
 * env so the exact contract can be pinned without a code change:
 *   PLUSLIDE_API_KEY       (required)
 *   PLUSLIDE_BASE_URL      (default https://api.pluslide.com)
 *   PLUSLIDE_CREATE_PATH   (default /v1/presentations)
 *   PLUSLIDE_LIST_PATH     (default /v1/presentations)
 *
 * Read/write to the user's own Pluslide account only. Creating a deck is an
 * external action, so it's marked requiresConfirmation.
 */

function auth(): { base: string; headers: Record<string, string> } {
  if (!env.pluslideApiKey) {
    throw new ToolError("Pluslide isn't connected. Add PLUSLIDE_API_KEY in Settings/deployment.");
  }
  return {
    base: env.pluslideBaseUrl.replace(/\/$/, ""),
    headers: {
      Authorization: `Bearer ${env.pluslideApiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
}

/** Pull the most useful fields out of whatever shape the API returns. */
function summarizePresentation(p: any): Record<string, unknown> {
  if (!p || typeof p !== "object") return { raw: p };
  const pick = (...keys: string[]) => keys.map((k) => p[k]).find((v) => v != null);
  return {
    id: pick("id", "presentationId", "projectId", "uuid"),
    title: pick("title", "name", "prompt"),
    status: pick("status", "state"),
    url: pick("url", "shareUrl", "editUrl", "viewUrl", "link", "webUrl"),
    createdAt: pick("createdAt", "created_at", "updatedAt"),
  };
}

async function call(url: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ToolError("Couldn't reach Pluslide. Check PLUSLIDE_BASE_URL / your connection.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new ToolError("Pluslide rejected the API key. Check PLUSLIDE_API_KEY (a valid API token).");
  }
  if (res.status === 404) {
    throw new ToolError(
      "Pluslide endpoint not found (404). The API path may differ — set PLUSLIDE_CREATE_PATH / PLUSLIDE_LIST_PATH to the exact paths from Pluslide's API docs.",
    );
  }
  if (res.status === 402 || res.status === 429) {
    throw new ToolError("Pluslide couldn't process this (plan limit or rate limit reached).");
  }
  const text = await res.text();
  const data = text ? safeJson(text) : {};
  if (!res.ok) {
    const msg = (data?.error?.message || data?.message || text || "").toString().slice(0, 200);
    throw new ToolError(`Pluslide error (HTTP ${res.status})${msg ? `: ${msg}` : ""}.`);
  }
  return data;
}

function safeJson(t: string): any {
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 500) }; }
}

const schema = z.object({
  action: z.enum(["create", "list"]).describe("create a new presentation, or list existing ones."),
  prompt: z.string().max(4000).optional().describe("For 'create': what the presentation should be about."),
  title: z.string().max(300).optional().describe("Optional title for the presentation."),
});

export const pluslideTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "pluslide",
  description:
    "Generate AI slide decks / presentations with the user's Pluslide account. " +
    "action 'create' makes a new presentation from a prompt (e.g. 'a 10-slide deck on our Q4 results'); " +
    "action 'list' shows the user's existing presentations. Returns links to open them.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list"] },
      prompt: { type: "string", description: "What the deck should be about (for create)." },
      title: { type: "string", description: "Optional presentation title." },
    },
    required: ["action"],
  },
  requiresCapability: "pluslide",
  requiresConfirmation: true, // creating a deck is an external write
  activityLabel: "Working with Pluslide",
  async execute(input, ctx) {
    const { base, headers } = auth();

    if (input.action === "list") {
      ctx.activity("Fetching your Pluslide presentations…");
      const data = await call(`${base}${env.pluslideListPath}`, { method: "GET", headers });
      const arr: any[] = Array.isArray(data) ? data : data.presentations ?? data.projects ?? data.data ?? data.items ?? [];
      const items = arr.slice(0, 25).map(summarizePresentation);
      return {
        data: { count: items.length, presentations: items },
        summary: `You have ${items.length} Pluslide presentation${items.length === 1 ? "" : "s"}.`,
      };
    }

    // create
    if (!input.prompt && !input.title) {
      throw new ToolError("What should the presentation be about? Provide a prompt.");
    }
    ctx.activity("Generating a presentation with Pluslide…");
    const body: Record<string, unknown> = {};
    if (input.prompt) body.prompt = input.prompt;
    if (input.title) body.title = input.title;
    const data = await call(`${base}${env.pluslideCreatePath}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const p = summarizePresentation(data.presentation ?? data.project ?? data);
    const openUrl = typeof p.url === "string" ? p.url : undefined;
    return {
      data: {
        presentation: p,
        ...(openUrl ? { openUrl, label: "presentation" } : {}),
      },
      summary: p.title ? `Created "${p.title}" in Pluslide.` : "Created a presentation in Pluslide.",
    };
  },
};
