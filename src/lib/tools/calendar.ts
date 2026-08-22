import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getGoogleAccessToken } from "@/lib/integrations/google";

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const schema = z.object({
  action: z.enum(["list", "create", "search"]),
  query: z.string().max(200).optional().describe("Search text (for 'search')."),
  title: z.string().max(300).optional().describe("Event title (for 'create')."),
  start: z
    .string()
    .optional()
    .describe("ISO 8601 start datetime for 'create', e.g. '2026-08-23T15:00:00+05:30'."),
  end: z
    .string()
    .optional()
    .describe("ISO 8601 end datetime for 'create'. Defaults to start + 1 hour."),
  location: z.string().max(300).optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
});

export const calendarTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "google_calendar",
  description:
    "Read and manage the user's Google Calendar. 'list' upcoming events, " +
    "'search' events by text, or 'create' a new event. Requires the user to " +
    "have connected Google in Settings → Integrations. Confirm details before creating.",
  schema,
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "create", "search"] },
      query: { type: "string" },
      title: { type: "string" },
      start: { type: "string", description: "ISO 8601 datetime." },
      end: { type: "string", description: "ISO 8601 datetime." },
      location: { type: "string" },
      maxResults: { type: "integer" },
    },
    required: ["action"],
  },
  activityLabel: "Accessing calendar",
  async execute(input, ctx) {
    const token = await getGoogleAccessToken(ctx.userId);
    const auth = { Authorization: `Bearer ${token}` };

    if (input.action === "list" || input.action === "search") {
      const url = new URL(CAL);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("timeMin", new Date().toISOString());
      url.searchParams.set("maxResults", String(input.maxResults ?? 10));
      if (input.action === "search" && input.query) url.searchParams.set("q", input.query);

      const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new ToolError("Couldn't read your calendar.");
      const j: any = await res.json();
      const events = (j.items ?? []).map((e: any) => ({
        id: e.id,
        title: e.summary ?? "(no title)",
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        location: e.location ?? null,
      }));
      return {
        data: { events },
        summary: `${events.length} event${events.length === 1 ? "" : "s"}.`,
      };
    }

    // create
    if (!input.title) throw new ToolError("An event needs a title.");
    if (!input.start) throw new ToolError("An event needs a start time.");
    const startDate = new Date(input.start);
    if (Number.isNaN(startDate.getTime())) throw new ToolError("Invalid start time.");
    const endDate = input.end ? new Date(input.end) : new Date(startDate.getTime() + 3600_000);

    const res = await fetch(CAL, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.title,
        location: input.location,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new ToolError("Couldn't create the calendar event.");
    const e: any = await res.json();
    return {
      data: { id: e.id, htmlLink: e.htmlLink, title: e.summary },
      summary: `Event created: ${e.summary}.`,
    };
  },
};
