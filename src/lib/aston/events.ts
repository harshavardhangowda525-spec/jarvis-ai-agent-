import { z } from "zod";
import { INCIDENT_KINDS, type IncidentSignal } from "./types";

/**
 * Turning inbound events into incident signals (pure; the routes verify the
 * signature first). A "resolved"/success event closes the matching incident.
 */

export type Parsed = { action: "raise"; signal: IncidentSignal } | { action: "resolve"; signal: IncidentSignal; resolution: string } | { action: "ignore"; reason: string };

export const eventSchema = z.object({
  userEmail: z.string().email().optional(),
  source: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i).default("webhook"),
  kind: z.enum(INCIDENT_KINDS),
  status: z.enum(["failed", "resolved"]).default("failed"),
  key: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  project: z.string().trim().max(120).optional(),
  detail: z.string().max(4000).optional(),
  priority: z.enum(["critical", "high", "normal"]).optional(),
  url: z.string().url().max(500).optional(),
  recommendation: z.string().max(1000).optional(),
  recovery: z.array(z.object({ action: z.string().max(200), ok: z.boolean(), note: z.string().max(300).optional() })).max(10).optional(),
});
export type AstonEvent = z.infer<typeof eventSchema>;

export function parseGeneric(e: AstonEvent): Parsed {
  const signal: IncidentSignal = {
    source: e.source.toLowerCase(), kind: e.kind, key: e.key, title: e.title, project: e.project, detail: e.detail,
    priority: e.priority, recommendation: e.recommendation,
    evidence: { via: "signed-webhook", ...(e.url ? { url: e.url } : {}) },
    recovery: e.recovery?.map((r) => ({ ...r, at: new Date().toISOString() })),
  };
  return e.status === "resolved" ? { action: "resolve", signal, resolution: `Reported resolved by ${e.source}.` } : { action: "raise", signal };
}

/** GitHub webhooks: workflow_run (builds/CI) and deployment_status (e.g. Vercel deployments). */
export function parseGithub(event: string, p: any): Parsed {
  const repo: string = p?.repository?.full_name ?? "unknown/repo";
  const defaultBranch: string | undefined = p?.repository?.default_branch;
  if (event === "ping") return { action: "ignore", reason: "ping" };

  if (event === "workflow_run") {
    const run = p?.workflow_run;
    if (p?.action !== "completed" || !run) return { action: "ignore", reason: "workflow not completed" };
    const branch: string = run.head_branch ?? "";
    const key = `${repo}:${run.name ?? run.workflow_id}:${branch}`;
    const base = { source: "github", kind: "build_failed" as const, key, project: repo };
    if (run.conclusion === "success") return { action: "resolve", signal: { ...base, title: "" }, resolution: `A later run of ${run.name} on ${branch} succeeded.` };
    if (!["failure", "timed_out", "startup_failure"].includes(run.conclusion)) return { action: "ignore", reason: `conclusion ${run.conclusion}` };
    const onMain = !!defaultBranch && branch === defaultBranch;
    return {
      action: "raise",
      signal: {
        ...base, priority: onMain ? "high" : "normal",
        title: `Build failed: ${run.name} on ${branch || "unknown branch"}`,
        detail: `Conclusion: ${run.conclusion}. Commit: ${(run.head_commit?.message ?? "").split("\n")[0].slice(0, 200)} (${String(run.head_sha ?? "").slice(0, 7)}). Attempt ${run.run_attempt ?? 1}.`,
        evidence: { runUrl: run.html_url, sha: run.head_sha, branch },
        recovery: (run.run_attempt ?? 1) > 1 ? [{ at: new Date().toISOString(), action: `Re-run attempt ${run.run_attempt}`, ok: false, note: run.conclusion }] : undefined,
        recommendation: `Open the failed run (${run.html_url}) and fix the failing step.`,
      },
    };
  }

  if (event === "deployment_status") {
    const st = p?.deployment_status?.state;
    const envName: string = p?.deployment?.environment ?? p?.deployment_status?.environment ?? "unknown";
    const key = `${repo}:${envName}`;
    const base = { source: "github", kind: "deploy_failed" as const, key, project: repo };
    if (st === "success") return { action: "resolve", signal: { ...base, title: "" }, resolution: `A later deployment to ${envName} succeeded.` };
    if (st !== "failure" && st !== "error") return { action: "ignore", reason: `state ${st}` };
    const prod = /prod/i.test(envName);
    const target: string | undefined = p?.deployment_status?.environment_url || undefined;
    return {
      action: "raise",
      signal: {
        ...base, priority: prod ? "high" : "normal",
        title: `Deployment failed: ${envName}`,
        detail: `${p?.deployment_status?.description ?? "The deployment did not complete."} Commit ${String(p?.deployment?.sha ?? "").slice(0, 7)}${p?.deployment?.ref ? ` on ${p.deployment.ref}` : ""}.`,
        evidence: { logUrl: p?.deployment_status?.log_url ?? p?.deployment_status?.target_url, environment: envName, ...(target ? { siteUrl: target } : {}) },
        recommendation: "Open the deployment log, fix the cause, then redeploy. The live site keeps serving the previous deployment.",
      },
    };
  }
  return { action: "ignore", reason: `event ${event} not monitored` };
}
