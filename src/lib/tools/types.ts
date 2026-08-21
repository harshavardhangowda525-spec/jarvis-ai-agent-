/**
 * Tool abstraction for the JARVIS agent.
 *
 * A Tool is a self-describing capability the LLM can choose to invoke. The
 * agent never hard-codes command matching — it hands every tool's JSON schema
 * to the model and the model decides. Adding a new capability = adding a Tool
 * to the registry; the agent loop does not change.
 */
import type { z } from "zod";

export interface ToolContext {
  userId: string;
  /** Timezone for the user, used by time-sensitive tools. */
  timezone: string;
  /** Emits a high-level, user-safe activity string to the live activity panel. */
  activity: (label: string) => void;
}

export interface ToolResult {
  /** Structured data returned to the model to continue reasoning. */
  data: unknown;
  /**
   * Optional short, user-facing summary for the activity log / UI. Never
   * contains hidden chain-of-thought — just what happened.
   */
  summary?: string;
}

export interface ToolDefinition<Input = unknown> {
  name: string;
  /** Natural-language description the model uses to decide when to call it. */
  description: string;
  /** Zod schema validated before execution; also converted to JSON schema. */
  schema: z.ZodType<Input>;
  /** JSON schema (Anthropic `input_schema`) describing the parameters. */
  inputSchema: Record<string, unknown>;
  /**
   * If true, JARVIS must ask the user for explicit confirmation before the
   * tool runs (destructive / external / bulk actions).
   */
  requiresConfirmation?: boolean;
  /** Capability flag name this tool depends on (e.g. "search", "weather"). */
  requiresCapability?: "search" | "weather";
  /** Short label shown in the activity panel while running. */
  activityLabel: string;
  execute: (input: Input, ctx: ToolContext) => Promise<ToolResult>;
}

export class ToolError extends Error {
  constructor(
    message: string,
    public userFacing = true,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
