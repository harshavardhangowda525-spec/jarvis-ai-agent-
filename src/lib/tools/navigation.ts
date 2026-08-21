import { z } from "zod";
import type { ToolDefinition } from "./types";

const DESTINATIONS = {
  home: "/dashboard",
  chat: "/dashboard",
  tasks: "/dashboard/tasks",
  notes: "/dashboard/notes",
  memory: "/dashboard/memory",
  settings: "/dashboard/settings",
  integrations: "/dashboard/settings#integrations",
} as const;

const schema = z.object({
  destination: z
    .enum(["home", "chat", "tasks", "notes", "memory", "settings", "integrations"])
    .describe("Which section of the app to open."),
});

/**
 * Internal navigation. Returns a route the client should navigate to. The
 * agent route surfaces this as a `navigate` action for the UI to act on —
 * JARVIS never claims to have opened a page it cannot reach.
 */
export const navigationTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "navigate",
  description:
    "Open a section of the JARVIS app for the user (home, chat, tasks, notes, " +
    "memory, settings, integrations). Use when the user asks to go to or open a page.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      destination: {
        type: "string",
        enum: ["home", "chat", "tasks", "notes", "memory", "settings", "integrations"],
      },
    },
    required: ["destination"],
  },
  activityLabel: "Navigating",
  async execute({ destination }) {
    const path = DESTINATIONS[destination];
    return {
      data: { navigate: path, destination },
      summary: `Opening ${destination}.`,
    };
  },
};
