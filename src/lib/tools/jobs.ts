import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { JOB_AGENTS, JOB_AGENT_NAME, JOB_STATUS_LABEL, briefSchema } from "@/lib/jobs/brief";
import { cancelJob, createJob, listJobs, retryJob, jobView } from "@/lib/jobs/engine";
import { getDb } from "@/lib/db";

/**
 * JARVIS's delegation tools — JARVIS only (agents can't delegate onwards).
 * JARVIS writes a brief for the agent that can actually do the work; the job
 * then runs on the server and is tracked until it really finishes.
 */

// tolerant of how different brains fill it in ("ASTON", "Rubin", a long title, kind "landing page"…)
const AGENT_ALIAS: Record<string, string> = { rubin: "robin", ruben: "robin", reuben: "robin", evie: "ev", eve: "ev", austin: "aston" };
const delegateSchema = z.object({
  agent: z.preprocess((v) => { const s = String(v ?? "").trim().toLowerCase(); return AGENT_ALIAS[s] ?? s; }, z.enum(JOB_AGENTS)),
  title: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 120) : v), z.string().min(3)),
  request: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 2000) : v ?? ""), z.string()).describe("What the user asked, in their words."),
  brief: briefSchema,
  dependsOn: z.preprocess((v) => (v == null || v === "" ? undefined : typeof v === "string" ? [v] : v), z.array(z.string()).max(5).optional()).describe("Ids of tasks (from earlier delegate_task results) that must finish first; their results are handed over."),
  kind: z.preprocess((v) => { const s = String(v ?? "").toLowerCase(); return !s ? undefined : /app|application|mobile/.test(s) && !/web ?app/.test(s) ? "app" : "website"; }, z.enum(["website", "app"]).optional()).describe("ASTON only: a website or an app demo."),
  leadId: z.preprocess((v) => (v == null || v === "" ? undefined : String(v)), z.string().max(60).optional()).describe("ASTON only: the CRM lead it's for (its verified details are used)."),
});

export const delegateTaskTool: ToolDefinition<z.infer<typeof delegateSchema>> = {
  name: "delegate_task",
  agentScope: "jarvis",
  activityLabel: "Assigning the task",
  description:
    "Hand a piece of work to the agent that can do it, as a tracked task that runs in the background and reports back. " +
    "DARWIN: finding/verifying businesses, lead generation, the CRM. RUBIN: outreach drafts, follow-ups, quotations, sales numbers. " +
    "EV: Instagram content, captions, reels, marketing ideas. MIKE: market analysis (never trades). " +
    "ASTON: website and app demos — builds the page, checks it and returns a private preview link (to change an existing demo use aston_demo instead). " +
    "Write a real brief for that agent — don't just forward the user's sentence: a clear objective, the expected outcome, what's already known, " +
    "requirements, constraints, the output format and concrete acceptance criteria. Use sensible defaults and say they're assumptions in the brief. " +
    "For multi-step work make one task per agent and chain them with dependsOn (e.g. DARWIN verifies, then RUBIN drafts outreach). " +
    "Never assign the same work to two agents. Tell the user the task was assigned and that you'll report when it finishes — never claim it's done.",
  schema: delegateSchema as unknown as z.ZodType<z.infer<typeof delegateSchema>>,
  inputSchema: {
    type: "object",
    properties: {
      agent: { type: "string", enum: [...JOB_AGENTS] },
      title: { type: "string", description: "Short task title, e.g. '50 gyms in Bangalore without a website'." },
      request: { type: "string" },
      brief: {
        type: "object",
        properties: {
          objective: { type: "string" },
          expectedOutcome: { type: "string" },
          context: { type: "array", items: { type: "string" }, description: "Facts already known (business details, earlier results)." },
          requirements: { type: "array", items: { type: "string" } },
          constraints: { type: "array", items: { type: "string" } },
          outputFormat: { type: "string" },
          acceptance: { type: "array", items: { type: "string" }, description: "Checkable points that make it done." },
          deadline: { type: "string" },
          approvals: { type: "array", items: { type: "string" }, description: "Steps that must wait for the user's OK (sending, publishing…)." },
        },
        required: ["objective", "expectedOutcome", "acceptance"],
      },
      dependsOn: { type: "array", items: { type: "string" } },
      kind: { type: "string", enum: ["website", "app"] },
      leadId: { type: "string" },
    },
    required: ["agent", "title", "request", "brief"],
  },
  async execute(input, ctx) {
    const { kind, leadId, ...rest } = input;
    const job = await createJob(ctx.userId, { ...rest, brief: input.brief, ...(input.agent === "aston" ? { payload: { kind, leadId } } : {}) });
    return {
      data: { job: { id: job.id, agent: job.agent, title: job.title, status: job.status }, note: "Assigned. It runs in the background; JARVIS reports when it finishes. Don't claim results yet." },
      summary: `Assigned to ${JOB_AGENT_NAME[input.agent]}: ${job.title}`,
    };
  },
};

const statusSchema = z.object({
  id: z.string().optional().describe("One task's id; omit for the recent list."),
  which: z.enum(["active", "finished", "all"]).optional(),
});

export const taskStatusTool: ToolDefinition<z.infer<typeof statusSchema>> = {
  name: "task_status",
  agentScope: "jarvis",
  activityLabel: "Checking the tasks",
  description: "Status of tasks you delegated (\"how's the gym search going?\", \"what are the agents doing?\"): status, real progress steps, result or error. Only report what this returns.",
  schema: statusSchema,
  inputSchema: { type: "object", properties: { id: { type: "string" }, which: { type: "string", enum: ["active", "finished", "all"] } } },
  async execute(input, ctx) {
    if (input.id) {
      const j = await getDb().agentJob.findFirst({ where: { id: input.id, userId: ctx.userId } });
      if (!j) throw new ToolError("No task with that id.");
      const v = jobView(j);
      return { data: { task: { ...v, brief: undefined, progress: v.progress.slice(-8) } }, summary: `${v.title}: ${JOB_STATUS_LABEL[v.status]}` };
    }
    const list = await listJobs(ctx.userId, { status: input.which ?? "all", take: 15 });
    return {
      data: { tasks: list.map((v) => ({ id: v.id, agent: v.agentName, title: v.title, status: JOB_STATUS_LABEL[v.status], lastStep: v.progress.at(-1)?.text ?? null, result: v.result?.slice(0, 400) ?? null, error: v.error, createdAt: v.createdAt, finishedAt: v.finishedAt })) },
      summary: `${list.length} task${list.length === 1 ? "" : "s"}`,
    };
  },
};

const actSchema = z.object({ id: z.string(), action: z.enum(["cancel", "retry"]) });

export const taskControlTool: ToolDefinition<z.infer<typeof actSchema>> = {
  name: "task_control",
  agentScope: "jarvis",
  activityLabel: "Updating the task",
  description: "Cancel a delegated task, or retry a failed/cancelled one (same brief, new attempt).",
  schema: actSchema,
  inputSchema: { type: "object", properties: { id: { type: "string" }, action: { type: "string", enum: ["cancel", "retry"] } }, required: ["id", "action"] },
  async execute(input, ctx) {
    if (input.action === "cancel") {
      const r = await cancelJob(ctx.userId, input.id);
      return { data: { status: r.job.status, stopping: r.job.status === "running" }, summary: r.changed ? (r.job.status === "running" ? `Stopping: ${r.job.title}` : `Cancelled: ${r.job.title}`) : `Already ${r.job.status}` };
    }
    const j = await retryJob(ctx.userId, input.id).catch((e) => { throw new ToolError((e as Error).message); });
    return { data: { job: { id: j.id, agent: j.agent, title: j.title, status: j.status } }, summary: `Retrying: ${j.title}` };
  },
};
