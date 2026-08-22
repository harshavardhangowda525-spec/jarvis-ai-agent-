import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";

/** Named external destinations JARVIS can open in the browser. */
const SITES: Record<string, { url: string; label: string }> = {
  gmail: { url: "https://mail.google.com/", label: "Gmail" },
  google_calendar: { url: "https://calendar.google.com/", label: "Google Calendar" },
  google_drive: { url: "https://drive.google.com/", label: "Google Drive" },
  google_docs: { url: "https://docs.google.com/", label: "Google Docs" },
  youtube: { url: "https://www.youtube.com/", label: "YouTube" },
  maps: { url: "https://maps.google.com/", label: "Google Maps" },
  github: { url: "https://github.com/", label: "GitHub" },
  google: { url: "https://www.google.com/", label: "Google" },
};

const schema = z.object({
  site: z
    .enum([
      "gmail",
      "google_calendar",
      "google_drive",
      "google_docs",
      "youtube",
      "maps",
      "github",
      "google",
    ])
    .optional()
    .describe("A known site to open."),
  url: z
    .string()
    .url()
    .optional()
    .describe("An arbitrary https URL to open, if no named site fits."),
});

/**
 * Opens an external website in the user's browser (new tab). The agent surfaces
 * this as an `open` action; the client attempts window.open and always shows a
 * clickable link (browsers block silent pop-ups outside a user gesture).
 */
export const openLinkTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "open_link",
  description:
    "Open a website in the user's browser — e.g. Gmail, Google Calendar, Drive, " +
    "YouTube, Maps, GitHub, or any https URL. Use when the user says 'open …' a " +
    "site. For reading/sending email or managing calendar events, use the gmail " +
    "or google_calendar tools instead — this only opens the web page.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      site: {
        type: "string",
        enum: [
          "gmail",
          "google_calendar",
          "google_drive",
          "google_docs",
          "youtube",
          "maps",
          "github",
          "google",
        ],
      },
      url: { type: "string", description: "An https URL to open." },
    },
  },
  activityLabel: "Opening website",
  async execute(input) {
    let target: { url: string; label: string } | null = null;
    if (input.site) target = SITES[input.site];
    else if (input.url) {
      if (!input.url.startsWith("https://")) throw new ToolError("Only https links can be opened.");
      target = { url: input.url, label: input.url.replace(/^https:\/\//, "").split("/")[0] };
    }
    if (!target) throw new ToolError("Tell me which site or URL to open.");
    return {
      data: { openUrl: target.url, label: target.label },
      summary: `Opening ${target.label}.`,
    };
  },
};
