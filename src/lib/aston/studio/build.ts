import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentJob, AstonProject, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { streamWithFallback } from "@/lib/ai/complete";
import { getLiveBrain } from "@/lib/ai/brain";
import { agentConfigs, type AgentEvent, type AgentInput } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/env";
import { extractJson } from "@/lib/aston/build";
import { FileStreamParser, safeSitePath } from "./files";
import { emit } from "./live";
import { assetsTask, changeCodeTask, changePlanTask, codeSystemPrompt, fixTask, foundationTask, pageTask, planSystemPrompt } from "./prompt";
import { plannedFiles, projectSpecSchema, type ProjectSpec, type StudioState } from "./spec";
import { createProject, newVersion, previewPath, readSite, setState, setTasks, versionDir, writeMetadata, writeSiteFile, type Task } from "./store";
import { BrowserMissing, failures, testSite, type TestReport } from "./test";
import { suggestStyle } from "./styles";

/**
 * ASTON's website studio: one brief → a real, tested website.
 *   UNDERSTANDING → PLANNING → DESIGNING → CODING → RUNNING → TESTING → REFINING → READY FOR REVIEW
 * The brain writes the code (streamed live to the studio screen); every file is
 * saved as soon as it's complete; the site is served and driven in a real
 * browser; failures go back to the brain with the exact evidence, at most twice.
 * Nothing is reported working unless a test saw it work.
 */

export type StudioPayload = { mode: "studio"; action: "create" | "change" | "test" | "fix"; projectId?: string; change?: string; name?: string; client?: string };
export type Stream = (system: string, user: string, onDelta: (t: string) => void, signal?: AbortSignal, onThinking?: () => void) => Promise<string>;

const MAX_FIX_ROUNDS = 2;

/** A working name from the brief until the plan names it properly. */
export const projectName = (brief: string) => brief.replace(/^(?:(?:hey |ok )?jarvis[,!.\s]+)?(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:i (?:want|need|would like)\s+)?(?:to\s+)?(?:build|create|make|design|develop)?\s*(?:me\s+)?(?:an?\s+|the\s+)?/i, "").replace(/\s+/g, " ").trim().slice(0, 60) || "New website";
const db = () => getDb();

export async function defaultStream(userId: string): Promise<Stream> {
  const pick = agentConfigs("aston", await getLiveBrain(userId).catch(() => null));
  if (!pick.configs.length) throw new Error(pick.missing ?? "ASTON has no AI provider.");
  return async (system, user, onDelta, signal, onThinking) => (await streamWithFallback(pick.configs as AiConfig[], system, user, onDelta, { maxTokens: 32_000, timeoutMs: 295_000, signal, onThinking })).text;
}

/** A JSON answer, streamed into the editor as a virtual file; one repair round. */
async function streamJson<T>(o: { stream: Stream; system: string; user: string; projectId: string; version: number; file: string; parse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } }; signal?: AbortSignal }): Promise<T> {
  let user = o.user;
  for (let round = 0; ; round++) {
    emit(o.projectId, { type: "open", path: o.file, version: o.version });
    const text = await o.stream(o.system, user, (d) => emit(o.projectId, { type: "delta", path: o.file, text: d }), o.signal);
    emit(o.projectId, { type: "close", path: o.file });
    let problem: string;
    try {
      const r = o.parse(extractJson(text));
      if (r.success) return r.data;
      problem = r.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (e) { problem = (e as Error).message; }
    if (round >= 1) throw new Error(`ASTON's brain didn't return a usable plan (${problem.slice(0, 300)}).`);
    emit(o.projectId, { type: "log", text: `The plan didn't validate (${problem.slice(0, 160)}) — asking for a corrected one.`, kind: "error" });
    user = `${o.user}\n\nYour previous reply couldn't be used: ${problem}. Reply again with the complete, corrected JSON object only.`;
  }
}

/** Stream code; save each file the moment it's complete; returns what was written. */
async function streamFiles(o: { stream: Stream; system: string; user: string; project: AstonProject; version: number; signal?: AbortSignal; log: (t: string, k?: "info" | "ok" | "error") => void }): Promise<string[]> {
  const parser = new FileStreamParser();
  const written: string[] = [];
  const pending: Promise<unknown>[] = [];
  const handle = (evs: ReturnType<FileStreamParser["push"]>) => {
    for (const e of evs) {
      const p = safeSitePath(e.path);
      if (!p) { if (e.type === "open") o.log(`Ignored a file outside the site: ${e.path}`, "error"); continue; }
      if (e.type === "open") emit(o.project.id, { type: "open", path: p, version: o.version });
      else if (e.type === "delta") emit(o.project.id, { type: "delta", path: p, text: e.text });
      else {
        emit(o.project.id, { type: "close", path: p });
        pending.push(writeSiteFile(o.project, o.version, p, e.content).then(() => { written.push(p); o.log(`Wrote ${p} (${(Buffer.byteLength(e.content) / 1024).toFixed(1)} KB)`, "ok"); }));
      }
    }
  };
  let thinking = 0;
  const t0 = Date.now();
  try {
    await o.stream(o.system, o.user, (d) => handle(parser.push(d)), o.signal, () => {
      // "thinking" while no code has arrived yet, so the studio never looks stuck
      if (Date.now() - thinking > 10_000) { thinking = Date.now(); emit(o.project.id, { type: "log", text: `ASTON is thinking through the code… (${Math.round((Date.now() - t0) / 1000)} s)` }); }
    });
    handle(parser.end());
  } catch (e) {
    await Promise.all(pending);
    // cut off part-way: keep every file that arrived whole; the missing ones are asked for again
    if (o.signal?.aborted || !written.length) throw e;
    o.log(`The answer was cut off (${String((e as Error).message).slice(0, 120)}) — kept ${written.join(", ")}; anything missing is written again.`, "error");
    return written;
  }
  await Promise.all(pending);
  return written;
}

async function limit<T>(n: number, items: T[], fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()!); }));
}

/** Static checks before the browser: every planned file exists; every page is a whole document. */
async function staticCheck(project: AstonProject, n: number, spec: ProjectSpec) {
  const site = await readSite(project, n);
  const missing = plannedFiles(spec).filter((f) => !site.has(f));
  const broken = spec.pages.map((p) => p.file).filter((f) => site.has(f) && !/<\/html>\s*$/i.test(site.get(f)!.trim()));
  return { missing, broken, site };
}

export interface StudioResult { project: AstonProject; version: number; report: TestReport | null; spec: ProjectSpec; fixed: number; remaining: string[] }

/**
 * The whole pipeline. `o.signal` stops it (and the brain) mid-way; the version
 * stays on disk, marked failed, and the previous version is untouched.
 */
export async function runStudio(userId: string, payload: StudioPayload, o: { brief: string; jobId?: string; stream: Stream; signal?: AbortSignal; onStep?: (text: string, ok?: boolean) => void }): Promise<StudioResult> {
  let project: AstonProject | null = payload.projectId ? await db().astonProject.findFirst({ where: { id: payload.projectId, userId } }) : null;
  const tasks: Task[] = [];
  const task = async (id: string, text: string, status: Task["status"], note?: string) => {
    const t = tasks.find((x) => x.id === id);
    if (t) Object.assign(t, { text, status, note }); else tasks.push({ id, text, status, note });
    if (project) await setTasks(project.id, tasks);
  };
  const log = (t: string, k: "info" | "ok" | "error" = "info") => { if (project) emit(project.id, { type: "log", text: t, kind: k }); o.onStep?.(t, k !== "error"); };
  const state = async (s: StudioState, note?: string) => { if (project) await setState(project.id, s, note); o.onStep?.(note ?? s); };

  // ── UNDERSTANDING + PLANNING ───────────────────────────────────────────────
  let spec: ProjectSpec;
  let n: number;
  let baseVersion: number | null = null;
  if (payload.action === "create") {
    const guess = suggestStyle(o.brief);
    // the project usually exists already (created when you asked, so the studio could open at once)
    project ??= await createProject(userId, { name: payload.name || payload.client || projectName(o.brief), brief: o.brief, client: payload.client, style: guess.id });
    if (o.jobId) await db().astonProject.update({ where: { id: project.id }, data: { jobId: o.jobId } });
    await state("understanding", "Analyzing the requirements");
    await task("understand", "Understand the brief", "done", `Likely direction: ${guess.name}`);
    const v = await newVersion(project, { change: "First build" });
    n = v.n;
    await state("planning", "Planning the website");
    await task("plan", "Plan sitemap, design system, forms and tests", "todo");
    spec = await streamJson({
      stream: o.stream, system: planSystemPrompt(), projectId: project.id, version: n, file: "plan.json", signal: o.signal,
      user: `BRIEF (the only source of facts):\n${o.brief}\n\nASTON's first read: this sounds like the "${guess.name}" direction (${guess.id}) — choose a better one if the brief says otherwise.`,
      parse: (x) => projectSpecSchema.safeParse(x),
    });
    await fs.writeFile(path.join(versionDir(project, n), "plan.json"), JSON.stringify(spec, null, 1));
    project = await db().astonProject.update({ where: { id: project.id }, data: { name: spec.name, client: spec.client ?? project.client, style: spec.style, spec: spec as unknown as Prisma.InputJsonValue, envVars: spec.envVars as unknown as Prisma.InputJsonValue } });
    await task("plan", `Plan: ${spec.pages.length} pages, ${spec.forms.length} form(s), ${spec.assets.length} artwork(s)`, "done", spec.pages.map((p) => p.file).join(", "));
    log(`Plan: ${spec.pages.map((p) => p.file).join(", ")} · style ${spec.style} · ${spec.design.fonts.display.family} + ${spec.design.fonts.body.family}`, "ok");

    // ── DESIGNING (design system + behaviour + artwork) ────────────────────
    const system = codeSystemPrompt(spec);
    await state("designing", "Creating the design system and artwork");
    await task("design", "Design system (CSS), behaviour (JS) and artwork", "todo");
    // design system and artwork side by side (two shorter answers)
    await Promise.all([
      streamFiles({ stream: o.stream, system, user: foundationTask(spec), project, version: n, signal: o.signal, log }),
      spec.assets.length ? streamFiles({ stream: o.stream, system, user: assetsTask(spec), project, version: n, signal: o.signal, log }) : Promise.resolve([]),
    ]);
    await task("design", "Design system (CSS), behaviour (JS) and artwork", "done");

    // ── CODING (pages) ─────────────────────────────────────────────────────
    await state("coding", "Building the page components");
    const css = (await readSite(project, n)).get("css/styles.css") ?? "";
    for (const p of spec.pages) await task(`page:${p.file}`, `Page ${p.file}`, "todo");
    await limit(2, spec.pages, async (p) => {
      await streamFiles({ stream: o.stream, system, user: pageTask(spec, p.file, css), project: project!, version: n, signal: o.signal, log });
      await task(`page:${p.file}`, `Page ${p.file}`, "done");
    });
  } else {
    if (!project) project = await db().astonProject.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" } });
    if (!project) throw new Error("There's no website project yet — ask ASTON to build one first.");
    const parsed = projectSpecSchema.safeParse(project.spec);
    if (!parsed.success) throw new Error("This project's plan is missing — it can't be changed safely.");
    spec = parsed.data;
    baseVersion = project.currentVersion || (await db().astonProjectVersion.findFirst({ where: { projectId: project.id }, orderBy: { n: "desc" } }))?.n || null;
    if (!baseVersion) throw new Error("This project has no version to start from.");
    const v = await newVersion(project, { change: payload.action === "change" ? payload.change : payload.action === "fix" ? "Fix what the tests found" : "Re-test", from: baseVersion });
    n = v.n;
    if (o.jobId) await db().astonProject.update({ where: { id: project.id }, data: { jobId: o.jobId } });
    log(`Version ${n} started from version ${baseVersion} (version ${baseVersion} stays as it is).`);
    if (payload.action === "change") {
      await state("planning", "Planning the change");
      const files = await readSite(project, n);
      const plan = await streamJson<{ summary: string; spec: ProjectSpec; files: string[] }>({
        stream: o.stream, system: planSystemPrompt(), projectId: project.id, version: n, file: "change-plan.json", signal: o.signal,
        user: changePlanTask(spec, payload.change ?? "", [...files.keys()]),
        parse: (x) => {
          const r = projectSpecSchema.safeParse((x as { spec?: unknown })?.spec);
          const fl = (x as { files?: unknown })?.files;
          if (!r.success) return r as never;
          const list = Array.isArray(fl) ? fl.map((f) => safeSitePath(String(f))).filter((f): f is string => !!f) : [];
          if (!list.length) return { success: false, error: { issues: [{ path: ["files"], message: "list the files to write" }] } };
          return { success: true, data: { summary: String((x as { summary?: unknown }).summary ?? payload.change), spec: r.data, files: list } };
        },
      });
      spec = plan.spec;
      project = await db().astonProject.update({ where: { id: project.id }, data: { spec: spec as unknown as Prisma.InputJsonValue, style: spec.style, envVars: spec.envVars as unknown as Prisma.InputJsonValue } });
      await fs.writeFile(path.join(versionDir(project, n), "plan.json"), JSON.stringify(spec, null, 1));
      await task("change", plan.summary, "todo", plan.files.join(", "));
      await state("coding", plan.summary);
      await streamFiles({ stream: o.stream, system: codeSystemPrompt(spec), user: changeCodeTask(payload.change ?? "", plan.summary, plan.files, files), project, version: n, signal: o.signal, log });
      await task("change", plan.summary, "done", plan.files.join(", "));
    }
  }

  // ── RUNNING ───────────────────────────────────────────────────────────────
  await state("running", "Starting the preview");
  let sc = await staticCheck(project, n, spec);
  if (sc.missing.length || sc.broken.length) {
    // a page that didn't arrive whole is written again once
    const redo = [...new Set([...sc.missing, ...sc.broken])];
    log(`Missing or incomplete: ${redo.join(", ")} — writing ${redo.length === 1 ? "it" : "them"} again.`, "error");
    const css = sc.site.get("css/styles.css") ?? "";
    const system = codeSystemPrompt(spec);
    const pages = redo.filter((f) => f.endsWith(".html"));
    const other = redo.filter((f) => !f.endsWith(".html"));
    const art = other.filter((f) => f.startsWith("assets/"));
    const base = other.filter((f) => !f.startsWith("assets/"));
    if (base.length) await streamFiles({ stream: o.stream, system, user: `${foundationTask(spec)}\n\nOnly these files are missing — write just them: ${base.join(", ")}`, project, version: n, signal: o.signal, log });
    if (art.length) await streamFiles({ stream: o.stream, system, user: assetsTask({ ...spec, assets: spec.assets.filter((a) => art.includes(a.file)) }), project, version: n, signal: o.signal, log });
    for (const p of pages) await streamFiles({ stream: o.stream, system, user: pageTask(spec, p, css), project, version: n, signal: o.signal, log });
    sc = await staticCheck(project, n, spec);
    if (sc.missing.length || sc.broken.length) throw new Error(`These files couldn't be written completely: ${[...sc.missing, ...sc.broken].join(", ")}.`);
  }
  log(`Preview running at ${previewPath(project.previewToken)}v${n}/`, "ok");
  emit(project.id, { type: "version", n, status: "building" });

  // ── TESTING ⇄ REFINING ────────────────────────────────────────────────────
  let report: TestReport | null = null;
  let fixed = 0;
  for (let round = 0; ; round++) {
    await state("testing", round ? "Re-testing after fixes" : "Testing pages, links, buttons, forms and layouts");
    await task("test", "Browser tests (desktop, tablet, mobile)", "todo");
    try {
      report = await testSite(project, n, spec, { signal: o.signal, onCheck: (c) => { if (c.status === "fail") log(`✗ ${c.detail}`, "error"); } });
    } catch (e) {
      if (e instanceof BrowserMissing) { await task("test", "Browser tests", "waiting", e.message); log(e.message, "error"); report = null; break; }
      throw e;
    }
    emit(project.id, { type: "tests", summary: { passed: report.passed, failed: report.failed, warnings: report.warnings } });
    log(`Tests: ${report.passed} passed, ${report.failed} failed, ${report.warnings} warnings (${report.browser}, ${(report.ms / 1000).toFixed(0)} s).`, report.failed ? "error" : "ok");
    await task("test", `Browser tests: ${report.passed} passed, ${report.failed} failed`, report.failed ? "failed" : "done");
    const fails = failures(report);
    if (!fails.length || round >= MAX_FIX_ROUNDS) break;
    await state("refining", `Fixing ${fails.length} issue${fails.length === 1 ? "" : "s"}`);
    await task(`fix${round}`, `Fix round ${round + 1}: ${fails.length} issue(s)`, "todo");
    const before = fails.length;
    const written = await streamFiles({ stream: o.stream, system: codeSystemPrompt(spec), user: fixTask(fails, await readSite(project, n)), project, version: n, signal: o.signal, log });
    if (!written.length) { await task(`fix${round}`, `Fix round ${round + 1}`, "failed", "No files were changed."); break; }
    await task(`fix${round}`, `Fix round ${round + 1}: rewrote ${written.join(", ")}`, "done");
    fixed += before;
  }

  // ── READY FOR REVIEW ──────────────────────────────────────────────────────
  const remaining = report ? failures(report) : [];
  const files = [...(await readSite(project, n)).keys()].sort();
  await db().astonProjectVersion.update({ where: { projectId_n: { projectId: project.id, n } }, data: { status: "ready", files: files as unknown as Prisma.InputJsonValue, tests: (report ?? null) as unknown as Prisma.InputJsonValue } });
  project = await db().astonProject.update({ where: { id: project.id }, data: { currentVersion: n, lastBuildAt: new Date(), tests: report ? ({ passed: report.passed, failed: report.failed, warnings: report.warnings, at: report.at, version: n } as Prisma.InputJsonValue) : undefined, error: null } });
  for (const pl of spec.placeholders) await task(`ph:${pl.slice(0, 40)}`, `Client to supply: ${pl}`, "waiting");
  for (const ev of spec.envVars) await task(`env:${ev.name}`, `Configure ${ev.name} — ${ev.why}`, "waiting");
  await state("review", remaining.length ? `Ready for review — ${remaining.length} check(s) still failing` : report ? "Ready for review — all checks passed" : "Ready for review — not browser-tested");
  emit(project.id, { type: "version", n, status: "ready" });
  await writeMetadata(project.id);
  return { project, version: n, report, spec, fixed, remaining };
}

/** As a tracked ASTON task: progress steps, cancel stops the brain and the tests. */
export function studioRunner(job: Pick<AgentJob, "id" | "userId" | "title" | "brief" | "payload" | "request">, o: { stream?: Stream } = {}) {
  return async function* (input: AgentInput): AsyncGenerator<AgentEvent, void, unknown> {
    void input;
    const payload = job.payload as unknown as StudioPayload;
    const ctl = new AbortController();
    const watch = setInterval(() => { void db().agentJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true } }).then((j) => { if (j?.cancelRequested) ctl.abort(); }).catch(() => {}); }, 2000);
    const q: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    const push = (e: AgentEvent) => { q.push(e); const w = wake; wake = null; w?.(); };
    let done = false, result: StudioResult | null = null, error: string | null = null;
    const work = (async () => {
      const stream = o.stream ?? (await defaultStream(job.userId));
      result = await runStudio(job.userId, payload, {
        brief: job.request || (job.brief as { objective?: string })?.objective || "", jobId: job.id, stream, signal: ctl.signal,
        onStep: (text, ok) => push(/^(Wrote|Tests:|Plan:|Preview running|✗)/.test(text) || ok === false ? { type: "tool", name: "aston_studio", status: ok === false ? "error" : "ok", summary: text.slice(0, 280) } : { type: "activity", label: text.slice(0, 120) }),
      });
    })().catch(async (e) => {
      error = ctl.signal.aborted ? "Cancelled." : String((e as Error)?.message ?? e).slice(0, 400);
      const p = payload.projectId ? await db().astonProject.findUnique({ where: { id: payload.projectId } }) : await db().astonProject.findFirst({ where: { jobId: job.id } });
      if (p) {
        await db().astonProjectVersion.updateMany({ where: { projectId: p.id, status: "building" }, data: { status: "failed", error } });
        await setState(p.id, "failed", error ?? undefined).catch(() => {});
        await writeMetadata(p.id).catch(() => {});
      }
    }).finally(() => { done = true; const w = wake; wake = null; w?.(); });
    try {
      while (!done || q.length) {
        if (q.length) { yield q.shift()!; continue; }
        await new Promise<void>((r) => { wake = r; });
      }
      await work;
    } finally {
      clearInterval(watch);
      if (!done) ctl.abort();
    }
    if (error || !result) {
      yield { type: "text", delta: error === "Cancelled." ? "Cancelled — stopped where it was; earlier versions are untouched." : `I couldn't finish the website. ${error}\n\nSTATUS: BLOCKED — ${String(error).slice(0, 200)}` };
      return;
    }
    const r = result as StudioResult;
    const url = `${previewPath(r.project.previewToken)}`;
    yield { type: "artifact", kind: "studio", projectId: r.project.id, version: r.version, url: `/dashboard/aston/studio?project=${r.project.id}`, title: r.project.name };
    yield { type: "link", url: `/dashboard/aston/studio?project=${r.project.id}`, label: `Open ${r.project.name} in ASTON's studio` };
    const rep = r.report;
    yield {
      type: "done",
      text: [
        `${payload.action === "create" ? "Built" : "Updated"} ${r.project.name} — version ${r.version} (${r.spec.pages.length} pages: ${r.spec.pages.map((p) => p.nav).join(", ")}; ${r.spec.style.replace(/_/g, " ")} style).`,
        rep ? `Browser tests (${rep.browser}, desktop/tablet/mobile): ${rep.passed} passed, ${rep.failed} failed, ${rep.warnings} warnings.${r.fixed ? ` Fixed ${r.fixed} issue(s) found along the way.` : ""}` : "It wasn't browser-tested: no browser was available on this computer.",
        r.remaining.length ? `Still failing: ${r.remaining.slice(0, 5).join(" | ")}` : "",
        r.spec.forms.length ? `Forms (${r.spec.forms.map((f) => f.id).join(", ")}) save to JARVIS — submissions show in ASTON's studio.` : "",
        r.spec.placeholders.length ? `Still needed from the client: ${r.spec.placeholders.slice(0, 6).join("; ")}.` : "",
        r.spec.envVars.length ? `To configure: ${r.spec.envVars.map((e) => e.name).join(", ")}.` : "",
        `Preview: ${url} — project folder: ${r.project.dir}. Nothing has been deployed.`,
        "STATUS: DONE",
      ].filter(Boolean).join("\n"),
    };
  };
}
