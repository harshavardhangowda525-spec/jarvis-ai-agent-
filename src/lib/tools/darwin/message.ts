import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/darwin/store";
import { sendEmail, emailChannelReady, EmailNotConnected } from "@/lib/darwin/email";

/**
 * darwin_message — actually SEND a prepared outreach draft through a connected
 * channel (email/Gmail). Requires explicit user approval. It only reports "sent"
 * when the provider confirms it, and marks failures honestly. Never fabricates a
 * delivery result.
 */
const schema = z.object({
  messageId: z.string().describe("The DarwinMessage draft to send (from darwin_outreach)."),
  subject: z.string().max(200).optional().describe("Override subject (email)."),
});

type Input = z.infer<typeof schema>;

export const darwinMessageTool: ToolDefinition<Input> = {
  name: "darwin_message",
  description:
    "SEND a prepared outreach draft to a lead through a connected channel (email/Gmail). Requires user approval. Reports the REAL delivery " +
    "status — only 'sent' when the provider confirms it, 'failed' with the reason otherwise, and 'COMMUNICATION SERVICE NOT CONNECTED' if no channel. Never fakes a send.",
  schema,
  agentScope: "darwin",
  requiresConfirmation: true, // external send — confirm before acting
  activityLabel: "Sending outreach",
  async emailPreview(input, ctx) {
    const msg = await getDb().darwinMessage.findFirst({ where: { id: input.messageId, userId: ctx.userId }, include: { lead: true } });
    if (!msg || msg.channel !== "email" || !msg.lead.email || msg.status === "sent" || msg.status === "delivered") return null;
    return {
      to: msg.lead.email,
      subject: input.subject || msg.subject || `A quick idea for ${msg.lead.businessName}`,
      body: msg.body,
      label: msg.lead.businessName,
    };
  },
  async execute(input, ctx) {
    const db = getDb();
    const msg = await db.darwinMessage.findFirst({ where: { id: input.messageId, userId: ctx.userId }, include: { lead: true } });
    if (!msg) throw new ToolError("No message draft with that id.");
    if (msg.status === "sent" || msg.status === "delivered") {
      return { data: { messageId: msg.id, status: msg.status }, summary: "That message was already sent." };
    }
    const lead = msg.lead;

    if (msg.channel !== "email") {
      return { data: { messageId: msg.id, status: "approval_required", note: "COMMUNICATION SERVICE NOT CONNECTED" }, summary: `Sending on ${msg.channel} isn't connected. The draft is ready to copy.` };
    }
    if (!lead.email) throw new ToolError(`${lead.businessName} has no email on record — can't send an email. Add one or use another channel.`);
    if (!(await emailChannelReady(ctx.userId))) {
      return { data: { messageId: msg.id, status: "approval_required", note: "COMMUNICATION SERVICE NOT CONNECTED" }, summary: "Email isn't connected. Connect Google in Settings to send; the draft stays ready." };
    }

    ctx.activity(`Sending email to ${lead.businessName}…`);
    await db.darwinMessage.update({ where: { id: msg.id }, data: { status: "sending" } });
    try {
      const subject = input.subject || msg.subject || `A quick idea for ${lead.businessName}`;
      const externalId = await sendEmail(ctx.userId, lead.email, subject, msg.body);
      await db.darwinMessage.update({ where: { id: msg.id }, data: { status: "sent", externalId, sentAt: new Date(), subject } });
      // Advance the pipeline + log the REAL send.
      if (lead.stage === "new" || lead.stage === "qualified") {
        await db.darwinLead.update({ where: { id: lead.id }, data: { stage: "contacted" } });
      }
      await logActivity(ctx.userId, "message_sent", `Emailed ${lead.businessName} (${lead.email}).`, lead.id, { externalId });
      return { data: { messageId: msg.id, status: "sent", externalId, gmailId: externalId }, summary: `✅ Sent email to ${lead.businessName} (${lead.email}).` };
    } catch (err) {
      const reason = err instanceof EmailNotConnected ? "COMMUNICATION SERVICE NOT CONNECTED" : (err as Error).message;
      await db.darwinMessage.update({ where: { id: msg.id }, data: { status: "failed", error: reason } }).catch(() => {});
      await logActivity(ctx.userId, "message_failed", `Email to ${lead.businessName} failed: ${reason}`, lead.id);
      throw new ToolError(`Send failed: ${reason}`);
    }
  },
  inputSchema: { type: "object", properties: { messageId: { type: "string" }, subject: { type: "string" } }, required: ["messageId"] },
};
