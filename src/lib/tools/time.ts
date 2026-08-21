import { z } from "zod";
import type { ToolDefinition } from "./types";

const schema = z.object({
  timezone: z
    .string()
    .optional()
    .describe("IANA timezone, e.g. 'America/New_York'. Defaults to the user's."),
});

export const timeTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "get_time",
  description:
    "Get the current date and time. Use this whenever the user asks about the " +
    "current time, today's date, the day of the week, or when computing " +
    "relative times like 'tomorrow'.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "IANA timezone name. Optional; defaults to the user's timezone.",
      },
    },
  },
  activityLabel: "Checking the time",
  async execute({ timezone }, ctx) {
    const tz = timezone || ctx.timezone || "UTC";
    let formatted: string;
    let iso: string;
    const now = new Date();
    iso = now.toISOString();
    try {
      formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        dateStyle: "full",
        timeStyle: "long",
      }).format(now);
    } catch {
      formatted = now.toUTCString();
    }
    return {
      data: { iso, timezone: tz, formatted },
      summary: formatted,
    };
  },
};
