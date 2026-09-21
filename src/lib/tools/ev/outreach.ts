import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { storeItem, checkDuplicate } from "@/lib/ev/memory";

/**
 * EV's outreach drafting. EV writes a personalized message for ONE real business
 * (provided by the user or a DARWIN lead) and stores it as a "ready" outreach
 * draft awaiting approval. This tool NEVER sends anything and NEVER does bulk /
 * unsolicited outreach — sending happens only via an approved channel after the
 * user says go.
 */

const schema = z.object({
  businessName: z.string().min(1).max(160).describe("The real business this message targets."),
  niche: z.string().max(60).optional(),
  channel: z.enum(["instagram_dm", "email", "whatsapp", "call_script"]).optional().describe("Intended channel (draft only)."),
  message: z.string().min(1).max(4000).describe("The personalized outreach message EV wrote."),
  notes: z.string().max(1000).optional().describe("Why this angle fits the business (context, not sent)."),
});

type Input = z.infer<typeof schema>;

export const evOutreachTool: ToolDefinition<Input> = {
  name: "ev_outreach",
  description:
    "Store a personalized outreach DRAFT for one real business (Infinity Web & Apps → the business). EV writes the message; " +
    "this saves it as 'ready' pending approval. It never sends and never does bulk outreach — sending requires explicit approval " +
    "through an approved channel.",
  schema,
  agentScope: "ev",
  activityLabel: "Preparing outreach draft",
  async execute(input, ctx) {
    const candidate = `${input.businessName} ${input.message}`;
    const dup = await checkDuplicate(ctx.userId, candidate, { niche: input.niche, threshold: 0.8 });
    if (dup.exact) {
      throw new ToolError(`You already have a near-identical outreach draft ("${dup.exact.title}"). Personalize it further.`);
    }
    ctx.activity(`Saving outreach draft for ${input.businessName}…`);
    const item = await storeItem(ctx.userId, {
      kind: "outreach",
      status: "ready", // waiting for approval before it's sent anywhere
      niche: input.niche ?? null,
      theme: input.channel ?? "outreach",
      title: `Outreach → ${input.businessName}`,
      body: input.message,
      metadata: { businessName: input.businessName, channel: input.channel ?? null, notes: input.notes ?? null },
    });
    return {
      data: { id: item.id, status: "ready", businessName: input.businessName, channel: input.channel ?? null },
      summary: `Outreach draft for ${input.businessName} is ready for your approval — I won't send anything until you approve.`,
    };
  },
  inputSchema: {
    type: "object",
    properties: {
      businessName: { type: "string" },
      niche: { type: "string" },
      channel: { type: "string", enum: ["instagram_dm", "email", "whatsapp", "call_script"] },
      message: { type: "string" },
      notes: { type: "string" },
    },
    required: ["businessName", "message"],
  },
};
