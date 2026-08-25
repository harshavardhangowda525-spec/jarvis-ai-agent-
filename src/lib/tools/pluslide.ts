import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { env } from "@/lib/env";

/**
 * Pluslide tool — builds a presentation into an existing Pluslide project via
 * POST /v1/project/export (Bearer token).
 *
 * Contract (from Pluslide API docs):
 *   POST {base}/v1/project/export
 *   { "projectId": "...", "presentation": { "slideList": [
 *       { "templateKey": "title-slide", "content": { "title": "...", "subtitle": "..." } },
 *       ...
 *   ] } }
 *
 * JARVIS's model composes the slideList (choosing a templateKey and filling the
 * content per slide) from the user's request; this tool posts it to the user's
 * project. The projectId comes from the tool input or PLUSLIDE_PROJECT_ID.
 *
 * Env: PLUSLIDE_API_KEY (required), PLUSLIDE_BASE_URL, PLUSLIDE_EXPORT_PATH,
 *      PLUSLIDE_PROJECT_ID (default project).
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

const slideSchema = z.object({
  templateKey: z.string().describe('Slide template, e.g. "title-slide". Use "title-slide" for the opening slide.'),
  content: z.record(z.any()).describe('Fields for the template, e.g. { "title": "...", "subtitle": "..." } or { "title": "...", "bullets": ["..."] }.'),
});

const schema = z.object({
  slideList: z.array(slideSchema).min(1).max(40)
    .describe("The slides to build, each with a templateKey and its content fields."),
  projectId: z.string().optional()
    .describe("Pluslide project to export into. Omit to use the default (PLUSLIDE_PROJECT_ID)."),
});

export const pluslideTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "pluslide",
  description:
    "Build a slide presentation in the user's Pluslide account. Compose a slideList — " +
    "one entry per slide, each with a templateKey (e.g. \"title-slide\") and a content object " +
    "holding that slide's fields (title, subtitle, bullets, body, etc.). Use this when the user " +
    "asks to create/make a presentation or deck. Returns a link to open the result. Requires a " +
    "Pluslide project id (from input or PLUSLIDE_PROJECT_ID).",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      slideList: {
        type: "array",
        description: "Slides to build, in order.",
        items: {
          type: "object",
          properties: {
            templateKey: { type: "string", description: 'Slide template, e.g. "title-slide".' },
            content: { type: "object", description: 'Template fields, e.g. { "title": "...", "subtitle": "..." }.' },
          },
          required: ["templateKey", "content"],
        },
      },
      projectId: { type: "string", description: "Project to export into (defaults to PLUSLIDE_PROJECT_ID)." },
    },
    required: ["slideList"],
  },
  requiresCapability: "pluslide",
  requiresConfirmation: true, // creating/exporting a deck is an external write
  activityLabel: "Building a Pluslide presentation",
  async execute(input, ctx) {
    const { base, headers } = auth();
    const projectId = input.projectId || env.pluslideProjectId;
    if (!projectId) {
      throw new ToolError(
        "Which Pluslide project? Set PLUSLIDE_PROJECT_ID (from your project's URL / Playground) " +
          "or tell me the project id.",
      );
    }

    ctx.activity(`Building ${input.slideList.length} slide${input.slideList.length === 1 ? "" : "s"} in Pluslide…`);

    let res: Response;
    try {
      res = await fetch(`${base}${env.pluslideExportPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ projectId, presentation: { slideList: input.slideList } }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new ToolError("Couldn't reach Pluslide. Check PLUSLIDE_BASE_URL / your connection.");
    }

    if (res.status === 401 || res.status === 403) {
      throw new ToolError("Pluslide rejected the API key. Check PLUSLIDE_API_KEY.");
    }
    if (res.status === 404) {
      throw new ToolError(
        `Pluslide returned 404 — the project id "${projectId}" may be wrong, or PLUSLIDE_EXPORT_PATH is off. ` +
          "Confirm the project id and export path.",
      );
    }
    if (res.status === 402 || res.status === 429) {
      throw new ToolError("Pluslide couldn't process this (plan or rate limit reached).");
    }

    const text = await res.text();
    const data = text ? safeJson(text) : {};
    if (!res.ok) {
      const msg = (data?.error?.message || data?.message || text || "").toString().slice(0, 220);
      throw new ToolError(`Pluslide error (HTTP ${res.status})${msg ? `: ${msg}` : ""}.`);
    }

    const url = pickUrl(data);
    return {
      data: {
        projectId,
        slides: input.slideList.length,
        result: data,
        ...(url ? { openUrl: url, label: "presentation" } : {}),
      },
      summary: `Built a ${input.slideList.length}-slide presentation in Pluslide${url ? " — link ready." : "."}`,
    };
  },
};

function pickUrl(d: any): string | undefined {
  if (!d || typeof d !== "object") return undefined;
  const v = [d.url, d.shareUrl, d.editUrl, d.viewUrl, d.downloadUrl, d.exportUrl, d.link, d.presentation?.url]
    .find((x) => typeof x === "string" && /^https?:\/\//.test(x));
  return v as string | undefined;
}

function safeJson(t: string): any {
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 500) }; }
}
