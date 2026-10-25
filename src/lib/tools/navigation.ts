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
  mike: "/dashboard/chat/mike",
  darwin: "/dashboard/chat/darwin",
  rubin: "/dashboard/chat/robin",
  ev: "/dashboard/chat/ev",
  aston: "/dashboard/chat/aston",
  demos: "/dashboard/aston",
  friday: "/dashboard/friday",
  teleprompter: "/dashboard/teleprompter",
  intel: "/dashboard/intel",
  trading: "/dashboard/trading",
  crm: "/dashboard/crm",
  agent_tasks: "/dashboard/jobs",
} as const;

const schema = z.object({
  destination: z
    .enum(["home", "chat", "tasks", "notes", "memory", "settings", "integrations", "mike", "darwin", "rubin", "ev", "aston", "friday", "demos", "teleprompter", "crm", "agent_tasks", "intel", "trading"])
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
    "memory, settings, integrations, mike / darwin / rubin / ev = that agent's chat: MIKE market analysis, DARWIN lead generation, RUBIN sales & CRM, EV Instagram marketing, ASTON website/app demos, FRIDAY 3D modelling workspace; demos = ASTON's demo previews; teleprompter = today's marketing plan; crm = DARWIN CRM; agent_tasks = delegated tasks; intel = the Business Environment Command Center; trading = MIKE's Trading Intelligence weekly review). Use when the user asks to go to or open a page.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      destination: {
        type: "string",
        enum: ["home", "chat", "tasks", "notes", "memory", "settings", "integrations", "mike", "darwin", "rubin", "ev", "aston", "friday", "demos", "teleprompter", "crm", "agent_tasks", "intel", "trading"],
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
