import "server-only";
import type { AgentJob, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { runAgent, type AgentEvent, type AgentInput } from "@/lib/ai/agent";
import { astonRunner, type AstonPayload } from "@/lib/aston/build";
import { studioRunner, type StudioPayload } from "@/lib/aston/studio/build";
import { fridayRunner, type FridayPayload } from "@/lib/friday/runner";
import { ACTIVE, FINISHED, JOB_AGENT_NAME, briefPrompt, briefSchema, judgeOutcome, type Brief, type JobAgent, type JobStatus } from "./brief";

/**
 * JARVIS's delegated tasks. Each job is a row with an id, the responsible
 * agent, a status, timestamps, progress, the result and the error. A job runs
 * on the server through the agent's own brain and tools (runAgent), so a
 * refresh, a closed tab or a restart doesn't lose it:
 *
 * - a running job holds a lease that it renews as it works; a job whose lease
 *   ran out (the server stopped) goes back to "assigned" and runs again, at
 *   most MAX_ATTEMPTS times;
 * - cancelling an assigned job cancels it; a running job stops at its next
 *   step and keeps what it had;
 * - a job with dependencies waits until they're completed and receives their
 *   results; if one fails or is cancelled, it fails too;
 * - "completed" needs the agent's own STATUS: DONE and no failed step.
 */

export const LEASE_MS = 90_000;
/** Errors worth one more attempt: the network, a timeout, a rate limit, an overloaded or restarting service. */
export const isTransient = (reason: string | null | undefined) =>
  !!reason && /timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|network|\b429\b|rate.?limit|too many requests|overloaded|\b50[234]\b|temporarily unavailable|try again later/i.test(reason);
export const MAX_ATTEMPTS = 3;
type Step = { at: string; text: string; kind: "info" | "tool" | "error" | "approval" };

type Runner = (input: AgentInput) => AsyncGenerator<AgentEvent, void, unknown>;

const db = () => getDb();
const step = (text: string, kind: Step["kind"] = "info"): Step => ({ at: new Date().toISOString(), text: text.slice(0, 300), kind });
const pushSteps = (j: Pick<AgentJob, "progress">, ...s: Step[]) => [...((Array.isArray(j.progress) ? j.progress : []) as Step[]), ...s].slice(-60) as unknown as Prisma.InputJsonValue;

export async function createJob(userId: string, p: { agent: JobAgent; title: string; request: string; brief: Brief; dependsOn?: string[]; payload?: AstonPayload | FridayPayload | StudioPayload }) {
  const brief = briefSchema.parse(p.brief);
  const deps = p.dependsOn?.length ? await db().agentJob.findMany({ where: { userId, id: { in: p.dependsOn } }, select: { id: true } }) : [];
  if (p.dependsOn?.length && deps.length !== p.dependsOn.length) throw new Error("A task it depends on doesn't exist.");
  return db().agentJob.create({
    data: {
      userId, agent: p.agent, title: p.title.trim().slice(0, 160), request: p.request.slice(0, 4000), brief: brief as unknown as Prisma.InputJsonValue,
      dependsOn: deps.map((d) => d.id), status: "assigned", ...(p.payload ? { payload: p.payload as Prisma.InputJsonValue } : {}),
      progress: [step(`Assigned to ${JOB_AGENT_NAME[p.agent]}${deps.length ? ` — starts after ${deps.length} other task${deps.length === 1 ? "" : "s"}` : ""}`)] as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Jobs whose runner stopped (restart, crash, timeout) run again — or fail after MAX_ATTEMPTS. */
export async function recoverStale(now = new Date()) {
  const stale = await db().agentJob.findMany({ where: { status: "running", leaseUntil: { lt: now } } });
  for (const j of stale) {
    const again = !j.cancelRequested && j.attempts < MAX_ATTEMPTS;
    await db().agentJob.updateMany({
      where: { id: j.id, status: "running", leaseUntil: { lt: now } },
      data: again
        ? { status: "assigned", leaseUntil: null, progress: pushSteps(j, step(`Interrupted (JARVIS stopped while it ran) — attempt ${j.attempts} of ${MAX_ATTEMPTS}; it will run again`, "error")) }
        : { status: j.cancelRequested ? "cancelled" : "failed", leaseUntil: null, finishedAt: now, error: j.cancelRequested ? null : `Interrupted ${j.attempts} times — stopped trying.`, progress: pushSteps(j, step(j.cancelRequested ? "Cancelled" : "Stopped after repeated interruptions", "error")) },
    });
  }
  return stale.length;
}

/** Fail jobs whose prerequisites failed or were cancelled; report which assigned jobs can run now. */
async function settleDependencies(userId?: string) {
  const waiting = await db().agentJob.findMany({ where: { status: "assigned", dependsOn: { isEmpty: false }, ...(userId ? { userId } : {}) } });
  const runnable: string[] = [];
  for (const j of waiting) {
    const deps = await db().agentJob.findMany({ where: { id: { in: j.dependsOn } }, select: { status: true, title: true } });
    const broken = deps.find((d) => d.status === "failed" || d.status === "cancelled");
    if (broken) {
      await db().agentJob.update({ where: { id: j.id }, data: { status: "failed", finishedAt: new Date(), error: `"${broken.title}" ${broken.status}, so this task couldn't start.`, progress: pushSteps(j, step(`Not started: "${broken.title}" ${broken.status}`, "error")) } });
    } else if (deps.length === j.dependsOn.length && deps.every((d) => d.status === "completed")) runnable.push(j.id);
  }
  return runnable;
}

/** Assigned jobs that can run now (no dependencies, or all of them completed). */
export async function runnableJobs(userId?: string): Promise<string[]> {
  await recoverStale();
  const ready = await settleDependencies(userId);
  const free = await db().agentJob.findMany({ where: { status: "assigned", dependsOn: { isEmpty: true }, ...(userId ? { userId } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return [...free.map((f) => f.id), ...ready];
}

/**
 * Run one job to its end. Safe to call twice: only one caller claims it.
 * Returns the job as it ended, or null when it wasn't runnable.
 */
export async function runJob(id: string, o: { runner?: Runner; now?: () => Date; leaseMs?: number } = {}): Promise<AgentJob | null> {
  const now = o.now ?? (() => new Date());
  const LEASE = o.leaseMs ?? LEASE_MS;
  const j0 = await db().agentJob.findUnique({ where: { id } });
  if (!j0 || j0.status !== "assigned" || j0.cancelRequested) return null;
  const deps = j0.dependsOn.length ? await db().agentJob.findMany({ where: { id: { in: j0.dependsOn } } }) : [];
  if (deps.some((d) => d.status !== "completed")) return null;
  // claim it — one runner only
  const claimed = await db().agentJob.updateMany({
    where: { id, status: "assigned", cancelRequested: false },
    data: { status: "running", attempts: { increment: 1 }, startedAt: j0.startedAt ?? now(), leaseUntil: new Date(now().getTime() + LEASE), progress: pushSteps(j0, step(`${JOB_AGENT_NAME[j0.agent as JobAgent] ?? j0.agent} started (attempt ${j0.attempts + 1})`)) },
  });
  if (!claimed.count) return null;
  let job = (await db().agentJob.findUnique({ where: { id } }))!;

  const profile = await db().profile.findUnique({ where: { userId: job.userId } });
  const brief = briefSchema.parse(job.brief);
  const prompt = briefPrompt(job.title, brief, deps.map((d) => ({ title: d.title, agent: JOB_AGENT_NAME[d.agent as JobAgent] ?? d.agent, result: d.result ?? "" })));

  // the run is also a chat in the agent's own history ("open in DARWIN's chat")
  const convo = job.conversationId
    ? await db().conversation.findUnique({ where: { id: job.conversationId } })
    : null;
  const conversation = convo ?? await db().conversation.create({ data: { userId: job.userId, agent: job.agent, title: `Task: ${job.title}`.slice(0, 60) } });
  if (!convo) await db().agentJob.update({ where: { id }, data: { conversationId: conversation.id } });
  await db().message.create({ data: { conversationId: conversation.id, userId: job.userId, role: "user", content: prompt } });

  let text = "", error: string | null = null, cancelled = false, lastWrite = 0;
  let lastLive: string | null = null;
  const tools: { name: string; status: "ok" | "error"; summary: string }[] = [];
  const links: { url: string; label: string }[] = [];
  const artifacts: Extract<AgentEvent, { type: "artifact" }>[] = [];
  const pending: Step[] = [];
  const flush = async (force = false) => {
    if (!force && Date.now() - lastWrite < 2500 && !pending.length) return;
    lastWrite = Date.now();
    const cur = await db().agentJob.findUnique({ where: { id }, select: { progress: true, cancelRequested: true } });
    if (cur?.cancelRequested) cancelled = true;
    const live = text.trim() ? text.slice(-4000) : null;
    const liveChanged = live !== lastLive; lastLive = live;
    await db().agentJob.update({ where: { id }, data: { leaseUntil: new Date(now().getTime() + LEASE), ...(liveChanged ? { liveText: live } : {}), ...(pending.length ? { progress: pushSteps(cur ?? job, ...pending.splice(0)) } : {}) } });
  };
  // Heartbeat: an agent can be silent for minutes (ASTON waiting for Claude to write
  // a site) — keep the lease alive while this runner is really working, so a long
  // step is never mistaken for a dead runner and started again.
  const heartbeat = setInterval(() => {
    void db().agentJob.updateMany({ where: { id, status: "running" }, data: { leaseUntil: new Date(now().getTime() + LEASE) } }).catch(() => {});
  }, Math.max(200, Math.floor(LEASE / 3)));

  try {
    const runner: Runner = o.runner ?? (job.agent === "aston" ? ((job.payload as { mode?: string } | null)?.mode === "studio" ? studioRunner(job) : astonRunner(job)) : job.agent === "friday" ? fridayRunner(job) : runAgent);
    const run = runner({
      userId: job.userId, timezone: profile?.timezone ?? "UTC", assistantName: profile?.assistantName ?? "JARVIS",
      displayName: profile?.displayName ?? null, history: [], message: prompt,
      preferredProvider: (profile as { aiProvider?: string | null } | null)?.aiProvider ?? null,
      agent: job.agent as AgentInput["agent"],
    });
    for await (const ev of run) {
      if (ev.type === "text") { text += ev.delta; await flush(); continue; }
      else if (ev.type === "done") text = ev.text;
      else if (ev.type === "error") error = ev.message;
      else if (ev.type === "tool") {
        tools.push({ name: ev.name, status: ev.status, summary: ev.summary });
        pending.push(step(`${ev.status === "ok" ? "✓" : "✗"} ${ev.summary || ev.name}`, ev.status === "ok" ? "tool" : "error"));
      } else if (ev.type === "link" || ev.type === "open") links.push({ url: ev.url, label: ev.label });
      else if (ev.type === "artifact") artifacts.push(ev);
      else if (ev.type === "activity") { /* live label only */ }
      await flush(pending.length > 0);
      if (cancelled) break;
    }
  } catch (e) {
    error = `The agent hit an error: ${String((e as Error)?.message ?? e).replace(/(key|token|secret|password)=\S+/gi, "$1=…").slice(0, 200)}`;
  }
  clearInterval(heartbeat);
  await flush(true);

  const outcome = cancelled ? { status: "cancelled" as const, reason: null, text: text.trim() } : judgeOutcome(text, tools, error);
  job = (await db().agentJob.findUnique({ where: { id } }))!;
  const shown = outcome.text || (cancelled ? "" : text.trim());
  await db().message.create({ data: { conversationId: conversation.id, userId: job.userId, role: "assistant", content: (shown || outcome.reason || "(no answer)") + (cancelled ? "\n\n_(cancelled)_" : "") } });
  const status: JobStatus = outcome.status;
  // a recoverable failure (network, timeout, rate limit, overloaded) runs again, within MAX_ATTEMPTS
  if (status === "failed" && job.attempts < MAX_ATTEMPTS && !job.cancelRequested && isTransient(outcome.reason)) {
    return db().agentJob.update({
      where: { id },
      data: { status: "assigned", leaseUntil: null, liveText: null, error: null, progress: pushSteps(job, step(`Recoverable error (${(outcome.reason ?? "").slice(0, 120)}) — trying again, attempt ${job.attempts + 1} of ${MAX_ATTEMPTS}`, "error")) },
    });
  }
  return db().agentJob.update({
    where: { id },
    data: {
      status, leaseUntil: null, liveText: null, result: shown || null,
      resultData: { tools, links, artifacts } as unknown as Prisma.InputJsonValue,
      error: status === "failed" ? outcome.reason : null,
      finishedAt: status === "waiting_approval" ? null : new Date(),
      progress: pushSteps(job, step(
        status === "completed" ? "Completed — the agent confirmed every acceptance point" : status === "waiting_approval" ? `Waiting for your approval: ${outcome.reason}` : status === "cancelled" ? "Cancelled — stopped at the next step" : `Failed: ${outcome.reason}`,
        status === "failed" ? "error" : status === "waiting_approval" ? "approval" : "info",
      )),
    },
  });
}

/** Run everything that's runnable for this user (oldest first) within a time budget. */
export async function runPending(userId: string | undefined, budgetMs = 240_000, o: { runner?: Runner } = {}) {
  const t0 = Date.now();
  const done: string[] = [];
  for (let round = 0; round < 10 && Date.now() - t0 < budgetMs; round++) {
    const ids = await runnableJobs(userId);
    if (!ids.length) break;
    let ran = false;
    for (const id of ids) {
      if (Date.now() - t0 >= budgetMs) break;
      const r = await runJob(id, o);
      if (r) { done.push(id); ran = true; }
    }
    if (!ran) break;
  }
  return done;
}

export async function cancelJob(userId: string, id: string) {
  const j = await db().agentJob.findFirst({ where: { id, userId } });
  if (!j) throw new Error("That task doesn't exist.");
  if ((FINISHED as string[]).includes(j.status)) return { job: j, changed: false };
  if (j.status === "running") {
    const job = await db().agentJob.update({ where: { id }, data: { cancelRequested: true, progress: pushSteps(j, step("Cancel requested — stopping at the next step")) } });
    return { job, changed: true };
  }
  const job = await db().agentJob.update({ where: { id }, data: { status: "cancelled", cancelRequested: true, finishedAt: new Date(), progress: pushSteps(j, step("Cancelled")) } });
  return { job, changed: true };
}

/** Run a failed or cancelled job again with the same brief (a new attempt, history kept). */
export async function retryJob(userId: string, id: string) {
  const j = await db().agentJob.findFirst({ where: { id, userId } });
  if (!j) throw new Error("That task doesn't exist.");
  if (!["failed", "cancelled"].includes(j.status)) throw new Error(`It's ${j.status} — only a failed or cancelled task can be retried.`);
  return db().agentJob.update({ where: { id }, data: { status: "assigned", error: null, cancelRequested: false, finishedAt: null, announcedAt: null, attempts: 0, progress: pushSteps(j, step("Retry requested")) } });
}

/** You approved what it was waiting for: run it again so the agent can carry on. */
export async function resumeJob(userId: string, id: string, note: string) {
  const j = await db().agentJob.findFirst({ where: { id, userId } });
  if (!j || j.status !== "waiting_approval") throw new Error("That task isn't waiting for approval.");
  const b = briefSchema.parse(j.brief);
  const brief: Brief = { ...b, context: [...b.context, `The user approved: ${note.slice(0, 300)}`].slice(-12) };
  return db().agentJob.update({ where: { id }, data: { status: "assigned", brief: brief as unknown as Prisma.InputJsonValue, attempts: 0, announcedAt: null, progress: pushSteps(j, step(`Approved: ${note}`, "approval")) } });
}

export const jobView = (j: AgentJob) => ({
  id: j.id, agent: j.agent, agentName: JOB_AGENT_NAME[j.agent as JobAgent] ?? j.agent, title: j.title, status: j.status as JobStatus,
  request: j.request, brief: j.brief as unknown as Brief, dependsOn: j.dependsOn, progress: j.progress as unknown as Step[],
  result: j.result, resultData: j.resultData as { tools?: { name: string; status: string; summary: string }[]; links?: { url: string; label: string }[]; artifacts?: ({ kind: "aston"; siteId: string; version: number; url: string; title: string } | { kind: "friday" | "studio"; projectId: string; version: number; url: string; title: string })[] } | null,
  payload: (j.payload ?? null) as (AstonPayload & Partial<FridayPayload> & Partial<Omit<StudioPayload, "action">>) | null,
  liveText: j.liveText,
  error: j.error, attempts: j.attempts, cancelRequested: j.cancelRequested, conversationId: j.conversationId,
  createdAt: j.createdAt.toISOString(), startedAt: j.startedAt?.toISOString() ?? null, finishedAt: j.finishedAt?.toISOString() ?? null,
  updatedAt: j.updatedAt.toISOString(), announced: !!j.announcedAt,
});
export type JobView = ReturnType<typeof jobView>;

export async function listJobs(userId: string, o: { status?: "active" | "finished" | "all"; take?: number } = {}) {
  await recoverStale();
  const where: Prisma.AgentJobWhereInput = { userId };
  if (o.status === "active") where.status = { in: [...ACTIVE, "waiting_approval"] };
  if (o.status === "finished") where.status = { in: FINISHED };
  const rows = await db().agentJob.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(o.take ?? 50, 200) });
  return rows.map(jobView);
}

/** Finished jobs you haven't been told about yet (JARVIS announces them once). */
export async function unannounced(userId: string) {
  const rows = await db().agentJob.findMany({ where: { userId, announcedAt: null, status: { in: [...FINISHED, "waiting_approval"] } }, orderBy: { updatedAt: "asc" }, take: 10 });
  return rows.map(jobView);
}
export async function markAnnounced(userId: string, ids: string[]) {
  await db().agentJob.updateMany({ where: { userId, id: { in: ids } }, data: { announcedAt: new Date() } });
}
