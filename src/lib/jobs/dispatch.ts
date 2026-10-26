import "server-only";
import { createJob } from "./engine";
import type { Brief, JobAgent } from "./brief";
import { requestStudio } from "@/lib/aston/studio/service";

/**
 * The one way work reaches an agent — used by JARVIS's delegate_task and by an
 * agent's pop-up input alike, so both run the same tracked task on the server.
 * ASTON websites go to the studio (real code, run and browser-tested); app
 * demos and lead-specific demos use ASTON's demo builder; FRIDAY creates models.
 */
export interface DispatchInput {
  agent: JobAgent; title: string; request: string; brief: Brief;
  dependsOn?: string[]; kind?: "website" | "app"; leadId?: string;
}

export async function dispatchTask(userId: string, i: DispatchInput) {
  if (i.agent === "aston" && i.kind !== "app" && !i.leadId) {
    const { job, project } = await requestStudio(userId, { request: [i.request, i.brief.objective, ...i.brief.context, ...i.brief.requirements].filter(Boolean).join("\n").slice(0, 4000), dependsOn: i.dependsOn });
    return { job, studio: `/dashboard/aston/studio?project=${project.id}` };
  }
  const payload = i.agent === "aston" ? { kind: i.kind, leadId: i.leadId } : i.agent === "friday" ? { action: "create" as const } : undefined;
  const job = await createJob(userId, { agent: i.agent, title: i.title, request: i.request, brief: i.brief, dependsOn: i.dependsOn, ...(payload ? { payload } : {}) });
  return { job, studio: null };
}

/** A brief for an instruction typed straight into an agent's pop-up (the engine adds its standing rules). */
export function quickBrief(text: string): Brief {
  return {
    objective: text.slice(0, 1000),
    expectedOutcome: "Exactly what was asked, done with your own tools and real data, with a short summary of the result.",
    context: [], requirements: [], constraints: ["Nothing invented — if something can't be found or done, say so plainly."],
    acceptance: ["The request is answered with real results from the agent's own tools (or an honest explanation of what couldn't be done)."],
    approvals: ["Sending, publishing or contacting anyone outside"],
  };
}

/** A short task title from the instruction. */
export const titleOf = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 79).trimEnd()}…` : t;
};
