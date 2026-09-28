import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";

const schema = z.object({
  apps: z.array(z.string().trim().min(1).max(60)).min(1).max(4).describe("The app names, e.g. ['Spotify'] or ['VS Code', 'WhatsApp']."),
});

/**
 * Opens installed DESKTOP apps on the user's own computer (not websites). The
 * server can't touch the user's PC, so this hands the request to the browser,
 * which asks ULTRON (the local runtime) to launch it. The real outcome is
 * reported to the user by JARVIS right after.
 */
export const openAppTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "open_app",
  description:
    "Open an app installed on the user's own computer — Spotify, WhatsApp, VS Code, Word, Excel, Calculator, File Explorer, " +
    "Settings, Discord, Steam, Photoshop… Use this (not open_link) whenever the user asks to open, launch or start an app or program. " +
    "Use open_link only for websites, or when they explicitly ask for the website.",
  schema,
  inputSchema: {
    type: "object",
    properties: { apps: { type: "array", items: { type: "string" }, description: "App names to open (1–4)." } },
    required: ["apps"],
  },
  activityLabel: "Opening app",
  async execute({ apps }) {
    const names = apps.map((a) => a.trim()).filter(Boolean);
    if (!names.length) throw new ToolError("Which app should I open?");
    return {
      data: { openApp: names },
      summary: `Asked this computer to open ${names.join(", ")} — the result is shown to the user separately; don't claim it opened.`,
    };
  },
};
