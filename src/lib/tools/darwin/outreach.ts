import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/darwin/store";
import { emailChannelReady } from "@/lib/darwin/email";

/**
 * darwin_outreach — store a personalized outreach DRAFT for a lead, built from
 * the lead's REAL info. It never sends anything; it saves the draft as
 * approval_required. DARWIN's brain writes the message (distinguishing verified
 * facts from AI observations); this persists it for review.
 */
const schema = z.object({
  leadId: z.string(),
  channel: z.enum(["email", "instagram_dm"]).optional().describe("Intended channel (default email)."),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(6000).describe("The personalized outreach message DARWIN wrote."),
});

type Input = z.infer<typeof schema>;

export const darwinOutreachTool: ToolDefinition<Input> = {
  name: "darwin_outreach",
  description:
    "Save a personalized outreach DRAFT for a lead (built from its real info). It is stored as approval_required and NEVER sent here. " +
    "Present it to the user to edit/approve/reject/regenerate; sending happens only via darwin_message after approval.",
  schema,
  agentScope: "darwin",
  activityLabel: "Drafting outreach",
  async execute(input, ctx) {
    const lead = await getDb().darwinLead.findFirst({ where: { id: input.leadId, userId: ctx.userId } });
    if (!lead) throw new ToolError("No lead with that id.");
    const channel = input.channel ?? "email";
    const canSend = channel === "email" ? await emailChannelReady(ctx.userId) : false;

    const msg = await getDb().darwinMessage.create({
      data: { userId: ctx.userId, leadId: lead.id, channel, subject: input.subject ?? null, body: input.body, status: "approval_required" },
      select: { id: true },
    });
    await logActivity(ctx.userId, "message_drafted", `Outreach drafted for ${lead.businessName} (${channel}).`, lead.id);

    const channelNote = channel === "email"
      ? (canSend ? "Email channel is connected — approve to send." : "Email channel is NOT connected (COMMUNICATION SERVICE NOT CONNECTED) — connect Google to send, or copy the draft.")
      : "Instagram DM sending isn't wired — this is a copy-ready draft.";
    return {
      data: { messageId: msg.id, leadId: lead.id, channel, status: "approval_required", canSend, to: channel === "email" ? lead.email : lead.instagram },
      summary: `Draft ready for ${lead.businessName}. ${channelNote}`,
    };
  },
  inputSchema: {
    type: "object",
    properties: { leadId: { type: "string" }, channel: { type: "string", enum: ["email", "instagram_dm"] }, subject: { type: "string" }, body: { type: "string" } },
    required: ["leadId", "body"],
  },
};
