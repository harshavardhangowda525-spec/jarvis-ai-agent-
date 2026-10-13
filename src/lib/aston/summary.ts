import "server-only";
import type { Prisma } from "@prisma/client";
import { redact } from "@/lib/activity/redact";
import { AstonAiUnavailable, groqChat, type GroqDeps } from "./groq";
import type { RecoveryStep } from "./types";

type Row = Prisma.AstonIncidentGetPayload<object>;

const NEXT_ACTION: Record<string, string> = {
  prod_incident: "Check the hosting dashboard and roll back the last deploy if needed.",
  security: "Review recent sign-ins and lock down the account if this wasn't you.",
  build_failed: "Open the failed build log and fix the error before the next release.",
  deploy_failed: "Open the deployment log; redeploy once the cause is fixed.",
  task_blocked: "Unblock the task or decide how to proceed.",
  decision_required: "Make the decision so the workflow can continue.",
  agent_failures: "Check the agent's configuration and recent errors.",
  deadline_risk: "Finish the work or move the deadline and tell the client.",
  info: "No action needed.",
};

/** The no-AI alert text: always available, built only from recorded facts. */
export function templateSummary(r: Pick<Row, "priority" | "project" | "title" | "detail" | "kind" | "recommendation">): { summary: string; recommendation: string } {
  const first = (r.detail ?? "").split(/(?<=[.!?])\s|\n/)[0]?.trim();
  const summary = `${r.priority === "critical" ? "Critical" : r.priority === "high" ? "Attention needed" : "Update"}${r.project ? ` — ${r.project}` : ""}: ${r.title}.${first ? ` ${first}` : ""}`.replace(/\.\./g, ".");
  return { summary: summary.slice(0, 500), recommendation: r.recommendation || NEXT_ACTION[r.kind] || "Take a look when you can." };
}

/**
 * A concise, speakable incident summary from Groq. Groq only rewrites the
 * recorded facts — it is told not to judge whether the incident is real.
 * Falls back to the template (with a note) when Groq is unavailable.
 */
export async function summarize(r: Row, deps?: Partial<GroqDeps>): Promise<{ summary: string; recommendation: string; aiNote: string | null }> {
  const fallback = templateSummary(r);
  const recovery = Array.isArray(r.recovery) ? (r.recovery as unknown as RecoveryStep[]) : [];
  const facts = redact(JSON.stringify({
    priority: r.priority, kind: r.kind, project: r.project, problem: r.title, detail: r.detail,
    occurrences: r.occurrences, firstSeen: r.firstSeenAt, recoveryAttempts: recovery.map((s) => `${s.action}: ${s.ok ? "ok" : "failed"}${s.note ? ` (${s.note})` : ""}`),
    suggestedNextAction: r.recommendation, evidence: r.evidence,
  })).slice(0, 3000);
  try {
    const res = await groqChat({
      messages: [
        {
          role: "system",
          content:
            "You are ASTON, the attention manager for Infinity Web & Apps. Turn the recorded incident facts into an alert the owner will HEAR (phone/speaker). " +
            "Use only the facts given; never speculate about causes or whether it is real (it has been verified by the system). " +
            'Return JSON: {"summary": "<= 45 words: project, problem, what was already tried", "next_action": "<= 20 words, one concrete step"}.',
        },
        { role: "user", content: facts },
      ],
      response_format: { type: "json_object" },
      max_tokens: 400,
      temperature: 0.2,
    }, { deps });
    const j = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { summary?: string; next_action?: string };
    if (!j.summary) throw new Error("empty summary");
    return { summary: redact(j.summary).slice(0, 500), recommendation: redact(j.next_action || fallback.recommendation).slice(0, 300), aiNote: null };
  } catch (e) {
    const note = e instanceof AstonAiUnavailable ? e.message : "Groq returned an unusable summary; using the standard alert text.";
    return { ...fallback, aiNote: note.slice(0, 300) };
  }
}
