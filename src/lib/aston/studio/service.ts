import "server-only";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { createJob } from "@/lib/jobs/engine";
import type { Brief } from "@/lib/jobs/brief";
import { projectName, type StudioPayload } from "./build";
import { createProject, previewPath, readSite, setState, versionDir } from "./store";
import { projectSpecSchema, STATE_LABEL, type StudioState } from "./spec";
import { suggestStyle } from "./styles";
import type { TestReport } from "./test";

const db = () => getDb();

/** "Build me a website for …" → the project exists at once (so the studio can open), then the build runs as a tracked ASTON task. */
export async function requestStudio(userId: string, p: { request: string; name?: string; client?: string }) {
  const guess = suggestStyle(p.request);
  const project = await createProject(userId, { name: p.name || p.client || projectName(p.request), brief: p.request, client: p.client ?? null, style: guess.id });
  await setState(project.id, "understanding", "Queued — ASTON is starting");
  const brief: Brief = {
    objective: `Plan, design, code, run and test a complete website: ${p.request}`.slice(0, 1000),
    expectedOutcome: "A working multi-page website with a live preview and browser test results",
    context: [], requirements: ["Real working forms and navigation", "Verified facts only; placeholders marked", "Responsive and accessible"],
    constraints: ["Never deploy without the user asking"], acceptance: ["Browser tests pass or remaining failures are reported"], approvals: [],
  };
  const payload: StudioPayload = { mode: "studio", action: "create", projectId: project.id, ...(p.name ? { name: p.name } : {}), ...(p.client ? { client: p.client } : {}) };
  const job = await createJob(userId, { agent: "aston", title: `Website — ${project.name}`.slice(0, 120), request: p.request.slice(0, 4000), brief, payload });
  await db().astonProject.update({ where: { id: project.id }, data: { jobId: job.id } });
  return { project, job };
}

/** Change / re-test / fix an existing project — each makes a new version. */
export async function requestStudioAction(userId: string, projectId: string, action: "change" | "test" | "fix", change?: string) {
  const p = await db().astonProject.findFirst({ where: { id: projectId, userId } });
  if (!p) throw new Error("That website project doesn't exist.");
  if (!p.currentVersion) throw new Error("This website hasn't finished its first build yet.");
  const running = p.jobId ? await db().agentJob.findFirst({ where: { id: p.jobId, status: { in: ["assigned", "running", "planning"] } } }) : null;
  if (running) throw new Error(`ASTON is still working on ${p.name} — wait for it to finish (or cancel it) first.`);
  if (action === "change" && !change?.trim()) throw new Error("Say what to change.");
  const title = action === "change" ? `Change — ${p.name}: ${change!.slice(0, 60)}` : action === "fix" ? `Fix — ${p.name}` : `Re-test — ${p.name}`;
  const brief: Brief = { objective: (action === "change" ? `Change ${p.name}: ${change}` : title).slice(0, 1000), expectedOutcome: "A new tested version; the previous one stays", context: [], requirements: [], constraints: [], acceptance: ["Browser tests run on the new version"], approvals: [] };
  const job = await createJob(userId, { agent: "aston", title: title.slice(0, 120), request: (change ?? title).slice(0, 4000), brief, payload: { mode: "studio", action, projectId: p.id, ...(change ? { change } : {}) } });
  await db().astonProject.update({ where: { id: p.id }, data: { jobId: job.id } });
  await setState(p.id, action === "change" ? "planning" : "testing", "Queued");
  return { project: p, job };
}

export async function listStudioProjects(userId: string, take = 30) {
  const ps = await db().astonProject.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take });
  return ps.map((p) => ({
    id: p.id, name: p.name, client: p.client, style: p.style, state: p.state as StudioState, stateLabel: STATE_LABEL[p.state as StudioState] ?? p.state, stateNote: p.stateNote,
    version: p.currentVersion, preview: p.currentVersion ? previewPath(p.previewToken) : null, tests: p.tests, updatedAt: p.updatedAt.toISOString(), jobId: p.jobId,
  }));
}

/** Everything the studio screen shows (secrets never: env vars by name only). */
export async function studioDetail(userId: string, id: string) {
  const p = await db().astonProject.findFirst({ where: { id, userId }, include: { versions: { orderBy: { n: "desc" } }, submissions: { where: { test: false }, orderBy: { createdAt: "desc" }, take: 50 } } });
  if (!p) return null;
  const spec = projectSpecSchema.safeParse(p.spec);
  const latest = p.versions[0]?.n ?? 0;
  const job = p.jobId ? await db().agentJob.findUnique({ where: { id: p.jobId }, select: { id: true, status: true, progress: true, title: true } }) : null;
  return {
    id: p.id, name: p.name, client: p.client, style: p.style, stack: p.stack === "static" ? "Static HTML · CSS · JavaScript (+ JARVIS form handler)" : p.stack,
    state: p.state as StudioState, stateLabel: STATE_LABEL[p.state as StudioState] ?? p.state, stateNote: p.stateNote, error: p.error,
    dir: p.dir, brief: p.brief, preview: previewPath(p.previewToken), previewToken: p.previewToken, currentVersion: p.currentVersion, latestVersion: latest,
    lastBuildAt: p.lastBuildAt?.toISOString() ?? null, tasks: p.tasks, tests: p.tests, deploy: p.deploy,
    envVars: ((p.envVars ?? []) as { name: string; why: string }[]).map((e) => ({ name: e.name, why: e.why })),
    spec: spec.success ? spec.data : null, job,
    versions: p.versions.map((v) => ({ n: v.n, status: v.status, change: v.change, error: v.error, files: v.files as string[], createdAt: v.createdAt.toISOString(), tests: v.tests ? summary(v.tests as unknown as TestReport) : null })),
    submissions: p.submissions.map((s) => ({ id: s.id, form: s.form, data: s.data, slot: s.slot, at: s.createdAt.toISOString() })),
  };
}
const summary = (r: TestReport) => ({ at: r.at, browser: r.browser, passed: r.passed, failed: r.failed, warnings: r.warnings, checks: r.checks, screenshots: r.screenshots });
export type StudioDetail = NonNullable<Awaited<ReturnType<typeof studioDetail>>>;

/** A version's file (code view) or a test screenshot. */
export async function studioFile(userId: string, id: string, n: number, rel: string) {
  const p = await db().astonProject.findFirst({ where: { id, userId }, select: { dir: true } });
  if (!p) return null;
  const base = versionDir(p, n);
  const full = path.resolve(base, rel);
  if (!full.startsWith(base + path.sep) || !existsSync(full)) return null;
  return { full, body: await fs.readFile(full) };
}

export async function siteFilesFor(userId: string, id: string, n: number) {
  const p = await db().astonProject.findFirst({ where: { id, userId } });
  return p ? readSite(p, n) : null;
}
