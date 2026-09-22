import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { ToolError } from "../types";
import { getDb } from "@/lib/db";
import { DARWIN_STAGES, DARWIN_OPPORTUNITIES, STAGE_LABEL } from "@/lib/darwin/config";
import { logActivity } from "@/lib/darwin/store";

const own = (userId: string, id: string) => getDb().darwinLead.findFirst({ where: { id, userId } });

// --- darwin_stage --------------------------------------------------------
const stageSchema = z.object({
  id: z.string().describe("Lead id."),
  stage: z.enum(DARWIN_STAGES).describe("New pipeline stage."),
});
export const darwinStageTool: ToolDefinition<z.infer<typeof stageSchema>> = {
  name: "darwin_stage",
  description: "Move a lead to a new pipeline stage (new→qualified→contacted→…→won/lost). Records the change in the activity log.",
  schema: stageSchema,
  agentScope: "darwin",
  activityLabel: "Updating pipeline stage",
  async execute(input, ctx) {
    const lead = await own(ctx.userId, input.id);
    if (!lead) throw new ToolError("No lead with that id.");
    if (lead.stage === input.stage) return { data: { id: lead.id, stage: lead.stage }, summary: `Already ${STAGE_LABEL[input.stage]}.` };
    await getDb().darwinLead.update({ where: { id: lead.id }, data: { stage: input.stage } });
    await logActivity(ctx.userId, "stage_changed", `${lead.businessName}: ${STAGE_LABEL[lead.stage as keyof typeof STAGE_LABEL] ?? lead.stage} → ${STAGE_LABEL[input.stage]}.`, lead.id, { from: lead.stage, to: input.stage });
    return { data: { id: lead.id, from: lead.stage, to: input.stage }, summary: `${lead.businessName}: ${STAGE_LABEL[lead.stage as keyof typeof STAGE_LABEL] ?? lead.stage} → ${STAGE_LABEL[input.stage]}.` };
  },
  inputSchema: { type: "object", properties: { id: { type: "string" }, stage: { type: "string", enum: [...DARWIN_STAGES] } }, required: ["id", "stage"] },
};

// --- darwin_qualify (records AI analysis, clearly labeled) ----------------
const qualSchema = z.object({
  id: z.string(),
  opportunityType: z.enum(DARWIN_OPPORTUNITIES).optional().describe("AI-assessed opportunity category."),
  analysis: z.string().max(2000).describe("Your AI opportunity analysis (clearly an opinion, based on the lead's real info)."),
  leadScore: z.number().int().min(0).max(100).optional().describe("AI lead score 0-100 (AI analysis, NOT a verified fact)."),
  markQualified: z.boolean().optional().describe("Also move the lead to 'qualified'."),
});
export const darwinQualifyTool: ToolDefinition<z.infer<typeof qualSchema>> = {
  name: "darwin_qualify",
  description: "Attach an AI opportunity analysis (+ optional AI lead score) to a lead. This is AI ANALYSIS, never presented as verified fact. Optionally moves the lead to 'qualified'.",
  schema: qualSchema,
  agentScope: "darwin",
  activityLabel: "Qualifying lead (AI analysis)",
  async execute(input, ctx) {
    const lead = await own(ctx.userId, input.id);
    if (!lead) throw new ToolError("No lead with that id.");
    await getDb().darwinLead.update({
      where: { id: lead.id },
      data: {
        opportunityType: input.opportunityType ?? lead.opportunityType,
        aiAnalysis: input.analysis,
        leadScore: input.leadScore ?? lead.leadScore,
        ...(input.markQualified ? { stage: "qualified" } : {}),
      },
    });
    await logActivity(ctx.userId, "qualified", `AI analysis added for ${lead.businessName}${input.opportunityType ? ` (${input.opportunityType})` : ""}.`, lead.id);
    return { data: { id: lead.id, opportunityType: input.opportunityType ?? lead.opportunityType, leadScore: input.leadScore ?? lead.leadScore }, summary: `Recorded AI analysis for ${lead.businessName}${input.markQualified ? " and marked QUALIFIED" : ""}.` };
  },
  inputSchema: { type: "object", properties: { id: { type: "string" }, opportunityType: { type: "string", enum: [...DARWIN_OPPORTUNITIES] }, analysis: { type: "string" }, leadScore: { type: "number" }, markQualified: { type: "boolean" } }, required: ["id", "analysis"] },
};

// --- darwin_note ---------------------------------------------------------
const noteSchema = z.object({ id: z.string(), note: z.string().min(1).max(4000) });
export const darwinNoteTool: ToolDefinition<z.infer<typeof noteSchema>> = {
  name: "darwin_note",
  description: "Add a note to a lead (appends to the lead's notes and the activity log).",
  schema: noteSchema,
  agentScope: "darwin",
  activityLabel: "Adding a note",
  async execute(input, ctx) {
    const lead = await own(ctx.userId, input.id);
    if (!lead) throw new ToolError("No lead with that id.");
    const notes = [lead.notes, `• ${input.note}`].filter(Boolean).join("\n");
    await getDb().darwinLead.update({ where: { id: lead.id }, data: { notes } });
    await logActivity(ctx.userId, "note", `Note on ${lead.businessName}: ${input.note.slice(0, 120)}`, lead.id);
    return { data: { id: lead.id }, summary: `Note added to ${lead.businessName}.` };
  },
  inputSchema: { type: "object", properties: { id: { type: "string" }, note: { type: "string" } }, required: ["id", "note"] },
};
