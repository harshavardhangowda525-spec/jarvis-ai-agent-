/**
 * Delegated-task briefs (client-safe). JARVIS doesn't forward your sentence to
 * an agent — it writes a brief for that agent: objective, expected outcome,
 * what's known, requirements, constraints, output and acceptance criteria.
 */
import { z } from "zod";

export const JOB_AGENTS = ["darwin", "robin", "ev", "mike", "aston", "friday"] as const;
export type JobAgent = (typeof JOB_AGENTS)[number];
export const JOB_AGENT_NAME: Record<JobAgent, string> = { darwin: "DARWIN", robin: "RUBIN", ev: "EV", mike: "MIKE", aston: "ASTON", friday: "FRIDAY" };

export const JOB_STATUSES = ["planning", "assigned", "running", "waiting_approval", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  planning: "Planning", assigned: "Assigned", running: "Running", waiting_approval: "Waiting for approval",
  completed: "Completed", failed: "Failed", cancelled: "Cancelled",
};
export const FINISHED: JobStatus[] = ["completed", "failed", "cancelled"];
export const ACTIVE: JobStatus[] = ["planning", "assigned", "running"];

/*
 * Every brain writes briefs a little differently (one sentence instead of a
 * list, a list joined with newlines, an over-long line…). Tidy that up instead
 * of rejecting the hand-off: text is trimmed to size, a single string becomes a
 * one-item list, and empty items are dropped.
 */
const clip = (max: number) => z.preprocess((v) => (v == null ? v : typeof v === "string" ? v : Array.isArray(v) ? v.join("; ") : String(v)), z.string().trim().transform((s) => s.slice(0, max)));
const text = (max: number) => clip(max).pipe(z.string().min(3));
const optText = (max: number) => z.preprocess((v) => (v === "" || v == null ? undefined : v), clip(max).optional());
const list = (maxItems: number, maxLen: number) => z.preprocess(
  (v) => (v == null ? [] : typeof v === "string" ? v.split(/\n+|;\s+/).map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")) : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : [String(v)]),
  z.array(z.string()).transform((a) => a.map((s) => s.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems)),
);

export const briefSchema = z.object({
  objective: text(1000),
  expectedOutcome: text(1000),
  context: list(12, 600).default([]),
  requirements: list(15, 400).default([]),
  constraints: list(12, 400).default([]),
  outputFormat: optText(400),
  acceptance: list(10, 300).pipe(z.array(z.string()).min(1, "give at least one acceptance point")),
  deadline: optText(80),
  /** Steps that need your OK before they happen (sending, publishing …). */
  approvals: list(8, 200).default([]),
});
export type Brief = z.infer<typeof briefSchema>;

/** Always part of every brief — whatever the model wrote. */
export const STANDING_RULES = [
  "Use only real data from your tools. Mark anything unknown as unknown — never invent businesses, contacts, numbers or results.",
  "Do not send, publish or contact anyone without the user's explicit approval — prepare it and stop for approval.",
  "Report what actually happened, including what failed.",
];

/** The prompt the agent receives. `earlier` = results of the tasks this one depends on. */
export function briefPrompt(title: string, b: Brief, earlier: { title: string; agent: string; result: string }[] = []): string {
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  const parts = [
    `TASK FROM JARVIS: ${title}`,
    `Objective: ${b.objective}`,
    `Expected outcome: ${b.expectedOutcome}`,
    b.context.length ? `What we already know:\n${list(b.context)}` : "",
    earlier.length ? `Results from earlier tasks:\n${earlier.map((e) => `- ${e.agent} — ${e.title}: ${e.result.slice(0, 1500)}`).join("\n")}` : "",
    b.requirements.length ? `Requirements:\n${list(b.requirements)}` : "",
    `Constraints:\n${list([...b.constraints, ...STANDING_RULES])}`,
    b.approvals.length ? `Needs the user's approval before it happens:\n${list(b.approvals)}` : "",
    b.deadline ? `Deadline: ${b.deadline}` : "",
    b.outputFormat ? `Deliver: ${b.outputFormat}` : "",
    `Done when:\n${list(b.acceptance)}`,
    "Do the work with your tools now. Finish your reply with exactly one last line:\n" +
      "STATUS: DONE — when every 'done when' point is met\n" +
      "STATUS: NEEDS_APPROVAL — <what> — when you stopped for the user's approval\n" +
      "STATUS: BLOCKED — <why> — when it couldn't be done",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export type Outcome = { status: "completed" | "waiting_approval" | "failed"; reason: string | null; text: string };

/**
 * Decide the job's status from what really happened: the agent's own STATUS
 * line AND its tool results. "Completed" needs the agent to confirm every
 * acceptance point (STATUS: DONE) with no failed tool step — a reply alone
 * isn't proof.
 */
export function judgeOutcome(text: string, tools: { status: "ok" | "error"; summary: string }[], error: string | null): Outcome {
  const m = /\n?\s*STATUS:\s*(DONE|NEEDS[_ ]APPROVAL|BLOCKED)\b\s*(?:[—:-]\s*(.*))?\s*$/i.exec(text.trim());
  const body = (m ? text.trim().slice(0, m.index) : text).trim();
  if (error) return { status: "failed", reason: error, text: body };
  if (!body && !tools.length) return { status: "failed", reason: "The agent didn't produce an answer.", text: body };
  const failedTools = tools.filter((t) => t.status === "error");
  const kind = m?.[1].toUpperCase().replace(" ", "_");
  if (kind === "BLOCKED") return { status: "failed", reason: m?.[2]?.trim() || "The agent couldn't do it.", text: body };
  if (kind === "NEEDS_APPROVAL" || /\bapproval[_ ]required\b|waiting for (your )?approval/i.test(tools.map((t) => t.summary).join(" "))) {
    return { status: "waiting_approval", reason: m?.[2]?.trim() || "Waiting for your approval.", text: body };
  }
  if (kind === "DONE" && !failedTools.length) return { status: "completed", reason: null, text: body };
  if (failedTools.length) return { status: "failed", reason: `A step failed: ${failedTools.map((t) => t.summary).join("; ").slice(0, 300)}`, text: body };
  return { status: "failed", reason: "The agent didn't confirm the task was done (no STATUS: DONE).", text: body };
}
