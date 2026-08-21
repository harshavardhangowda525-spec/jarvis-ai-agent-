/**
 * The tool registry. Adding a capability to JARVIS = registering a Tool here.
 * The agent loop reads this list, hands the model each tool's JSON schema, and
 * lets the model decide what to call. No command matching lives in the agent.
 */
import type { ToolDefinition } from "./types";
import { capabilities } from "@/lib/env";

import { calculatorTool } from "./calculator";
import { timeTool } from "./time";
import { weatherTool } from "./weather";
import { webSearchTool } from "./webSearch";
import { memoryTool } from "./memory";
import { tasksTool } from "./tasks";
import { notesTool } from "./notes";
import { navigationTool } from "./navigation";

const ALL_TOOLS: ToolDefinition[] = [
  calculatorTool as ToolDefinition,
  timeTool as ToolDefinition,
  weatherTool as ToolDefinition,
  webSearchTool as ToolDefinition,
  memoryTool as ToolDefinition,
  tasksTool as ToolDefinition,
  notesTool as ToolDefinition,
  navigationTool as ToolDefinition,
];

/** Tools available given the current capability configuration. */
export function availableTools(): ToolDefinition[] {
  return ALL_TOOLS.filter((t) => {
    if (t.requiresCapability === "search") return capabilities.search;
    if (t.requiresCapability === "weather") return capabilities.weather;
    return true;
  });
}

export function getTool(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

/** Metadata for the UI (Settings → capabilities, system status). */
export function toolCatalog() {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    requiresConfirmation: !!t.requiresConfirmation,
    requiresCapability: t.requiresCapability ?? null,
    available: availableTools().some((a) => a.name === t.name),
  }));
}
