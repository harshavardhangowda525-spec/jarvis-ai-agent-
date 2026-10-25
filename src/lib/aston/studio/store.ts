import "server-only";
import { randomBytes } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { AstonProject, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { safeSitePath } from "./files";
import { STATE_LABEL, type StudioState } from "./spec";
import { emit } from "./live";

/**
 * Website projects on the PC:
 *   AstonProjects/<slug>/project_metadata.json
 *   AstonProjects/<slug>/versions/v001/site/…      ← the website itself
 *   AstonProjects/<slug>/versions/v001/tests/…     ← test report + screenshots
 * A change copies the last version into a new folder first, so an earlier
 * working version is never overwritten.
 */
const db = () => getDb();
export const projectsRoot = () => path.resolve(process.env.ASTON_PROJECTS_DIR?.trim() || path.join(process.cwd(), "AstonProjects"));
export const slugify = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "website";
export const versionDir = (p: Pick<AstonProject, "dir">, n: number) => path.join(p.dir, "versions", `v${String(n).padStart(3, "0")}`);
export const siteDir = (p: Pick<AstonProject, "dir">, n: number) => path.join(versionDir(p, n), "site");
export const previewPath = (token: string, n?: number) => `/s/${token}/${n ? `?v=${n}` : ""}`;
export const newToken = () => randomBytes(18).toString("base64url");

export async function createProject(userId: string, o: { name: string; brief: string; client?: string | null; style?: string | null }) {
  const base = slugify(o.name);
  let slug = base;
  for (let i = 2; await db().astonProject.findUnique({ where: { userId_slug: { userId, slug } } }); i++) slug = `${base}-${i}`;
  const dir = path.join(projectsRoot(), slug);
  await fs.mkdir(path.join(dir, "versions"), { recursive: true });
  const p = await db().astonProject.create({ data: { userId, name: o.name.slice(0, 80), client: o.client ?? null, slug, dir, brief: o.brief.slice(0, 6000), style: o.style ?? null, previewToken: newToken(), testKey: randomBytes(12).toString("hex") } });
  await writeMetadata(p.id);
  return p;
}

export async function setState(projectId: string, state: StudioState, note?: string) {
  await db().astonProject.update({ where: { id: projectId }, data: { state, stateNote: note?.slice(0, 300) ?? null } });
  emit(projectId, { type: "state", state, note: note ?? STATE_LABEL[state] });
}

/** A new version folder (copied from `from` when changing an existing site). */
export async function newVersion(project: AstonProject, o: { change?: string; from?: number | null }) {
  const n = ((await db().astonProjectVersion.aggregate({ where: { projectId: project.id }, _max: { n: true } }))._max.n ?? 0) + 1;
  const dir = versionDir(project, n);
  if (existsSync(dir)) throw new Error(`Version folder ${dir} already exists — refusing to overwrite it.`);
  await fs.mkdir(path.join(dir, "site"), { recursive: true });
  await fs.mkdir(path.join(dir, "tests"), { recursive: true });
  if (o.from) await fs.cp(siteDir(project, o.from), path.join(dir, "site"), { recursive: true });
  return db().astonProjectVersion.create({ data: { projectId: project.id, n, change: o.change ?? null } });
}

export async function writeSiteFile(project: AstonProject, n: number, rel: string, content: string) {
  const p = safeSitePath(rel);
  if (!p) throw new Error(`Refused to write "${rel}" — not a site file.`);
  const full = path.join(siteDir(project, n), p);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
  return p;
}

export async function readSite(project: Pick<AstonProject, "dir">, n: number): Promise<Map<string, string>> {
  const root = siteDir(project, n);
  const out = new Map<string, string>();
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else if (/\.(html|css|js|svg|json|txt|xml|webmanifest)$/i.test(e.name)) out.set(path.relative(root, f).split(path.sep).join("/"), await fs.readFile(f, "utf8"));
    }
  };
  await walk(root);
  return out;
}

/** A file inside a version's site folder, safely (never outside it). */
export function siteFile(project: Pick<AstonProject, "dir">, n: number, rel: string): string | null {
  const base = siteDir(project, n);
  const full = path.resolve(base, rel || "index.html");
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

export type Task = { id: string; text: string; status: "done" | "failed" | "waiting" | "todo"; note?: string };
export async function setTasks(projectId: string, tasks: Task[]) {
  await db().astonProject.update({ where: { id: projectId }, data: { tasks: tasks as unknown as Prisma.InputJsonValue } });
}

export async function writeMetadata(projectId: string) {
  const p = await db().astonProject.findUnique({ where: { id: projectId }, include: { versions: { orderBy: { n: "asc" }, select: { n: true, status: true, change: true, createdAt: true } } } });
  if (!p) return;
  await fs.mkdir(p.dir, { recursive: true });
  const tests = p.tests as { passed?: number; failed?: number; warnings?: number; at?: string } | null;
  await fs.writeFile(path.join(p.dir, "project_metadata.json"), JSON.stringify({
    name: p.name, client: p.client, directory: p.dir, stack: p.stack, style: p.style, state: p.state,
    preview: previewPath(p.previewToken), currentVersion: p.currentVersion, lastSuccessfulBuild: p.lastBuildAt,
    environmentVariables: ((p.envVars ?? []) as { name: string }[]).map((e) => e.name), // names only, never values
    tests: tests ? { passed: tests.passed, failed: tests.failed, warnings: tests.warnings, at: tests.at } : null,
    tasks: p.tasks, deployment: p.deploy ?? { status: "not deployed" },
    versions: p.versions.map((v) => ({ ...v, folder: `versions/v${String(v.n).padStart(3, "0")}` })),
    updatedAt: new Date().toISOString(),
  }, null, 1));
}
