import "server-only";
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { FridayProject, FridayVersion, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { runBlender, renderSettings, type BlenderResult, type Progress, type RenderSettings } from "./blender";
import { planSchema, VIEW_IDS, VIEWS, type Plan, type ViewId } from "./plan";

/**
 * FRIDAY's projects on disk (the computer that runs Blender):
 *   FridayProjects/<slug>/project_metadata.json
 *   FridayProjects/<slug>/versions/v001/{plan.json, model.blend, model.glb, renders/*.png, manifest.json}
 * Every change is a new version; an earlier version's files are never touched.
 * Renders of a view whose model, materials, lighting and camera didn't change
 * are copied from the version before instead of rendered again.
 */

const db = () => getDb();
export const projectsRoot = () => path.resolve(process.env.FRIDAY_PROJECTS_DIR?.trim() || path.join(process.cwd(), "FridayProjects"));
export const slugify = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "project";
export const versionDir = (p: Pick<FridayProject, "dir">, n: number) => path.join(p.dir, "versions", `v${String(n).padStart(3, "0")}`);

export type Specs = { verified: string[]; assumptions: string[]; questions: string[] };
export type HistoryItem = { at: string; version: number; change: string };

/** A view's render depends on the whole model (cameras fit it), the render settings and the view. */
export function viewHash(plan: Plan, settings: RenderSettings, view: ViewId) {
  const { name: _n, summary: _s, specs: _sp, ...model } = plan;
  void _n; void _s; void _sp;
  return createHash("sha256").update(JSON.stringify({ model, settings, view, script: 1 })).digest("hex").slice(0, 24);
}

export async function findOrCreateProject(userId: string, name: string): Promise<FridayProject> {
  const slug = slugify(name);
  const existing = await db().fridayProject.findUnique({ where: { userId_slug: { userId, slug } } });
  if (existing) return existing;
  const dir = path.join(projectsRoot(), slug);
  await fs.mkdir(path.join(dir, "versions"), { recursive: true });
  return db().fridayProject.create({ data: { userId, name: name.slice(0, 80), slug, dir } });
}

async function writeMetadata(projectId: string) {
  const p = await db().fridayProject.findUnique({ where: { id: projectId }, include: { versions: { orderBy: { n: "asc" }, select: { n: true, label: true, status: true, change: true, createdAt: true } } } });
  if (!p) return;
  await fs.mkdir(p.dir, { recursive: true });
  await fs.writeFile(path.join(p.dir, "project_metadata.json"), JSON.stringify({
    name: p.name, slug: p.slug, activeVersion: p.activeVersion, specs: p.specs, history: p.history,
    versions: p.versions.map((v) => ({ ...v, folder: `versions/v${String(v.n).padStart(3, "0")}` })),
    updatedAt: new Date().toISOString(),
  }, null, 1));
}

/** Start a new version (building). Never reuses a folder. */
export async function newVersion(project: FridayProject, plan: Plan, o: { change?: string; parentN?: number | null; jobId?: string; label?: string } = {}) {
  const n = ((await db().fridayVersion.aggregate({ where: { projectId: project.id }, _max: { n: true } }))._max.n ?? 0) + 1;
  const dir = versionDir(project, n);
  if (existsSync(dir)) throw new Error(`Version folder ${dir} already exists — refusing to overwrite it.`);
  await fs.mkdir(path.join(dir, "renders"), { recursive: true });
  await fs.writeFile(path.join(dir, "plan.json"), JSON.stringify(plan, null, 1));
  return db().fridayVersion.create({ data: { projectId: project.id, n, plan: plan as unknown as Prisma.InputJsonValue, change: o.change ?? null, parentN: o.parentN ?? null, jobId: o.jobId ?? null, label: o.label ?? null } });
}

export interface VersionResult extends Omit<BlenderResult, "files" | "renders"> {
  files: Record<string, string>; // relative to the version folder
  renders: { view: ViewId; label: string; file: string; hash: string; seconds: number | null; width: number; height: number; reused: number | null; camera?: Record<string, unknown> }[];
  render: RenderSettings;
}

const rel = (dir: string, f: string) => path.relative(dir, f).split(path.sep).join("/");

/**
 * Build a version in Blender: geometry → materials → scene → .blend → GLB → the
 * requested renders (reusing unchanged ones from `reuseFrom`). Writes manifest.json.
 */
export async function buildVersion(project: FridayProject, version: FridayVersion, o: { views?: ViewId[]; reuseFrom?: FridayVersion | null; onProgress?: (p: Progress) => void; signal?: AbortSignal; settings?: RenderSettings }) {
  const plan = planSchema.parse(version.plan);
  const dir = versionDir(project, version.n);
  const settings = o.settings ?? renderSettings();
  const wanted = o.views ?? VIEW_IDS;
  // reuse renders from the earlier version when nothing that affects them changed
  const prev = (o.reuseFrom?.result ?? null) as VersionResult | null;
  const reused: VersionResult["renders"] = [];
  const toRender: ViewId[] = [];
  for (const v of wanted) {
    const h = viewHash(plan, settings, v);
    const old = prev?.renders.find((r) => r.view === v && r.hash === h);
    const src = old && o.reuseFrom ? path.join(versionDir(project, o.reuseFrom.n), old.file) : null;
    if (old && src && existsSync(src)) {
      await fs.mkdir(path.join(dir, "renders"), { recursive: true });
      await fs.copyFile(src, path.join(dir, old.file));
      reused.push({ ...old, reused: o.reuseFrom!.n, seconds: null });
    } else toRender.push(v);
  }
  if (reused.length) o.onProgress?.({ stage: "render", text: `Reused ${reused.length} unchanged view${reused.length === 1 ? "" : "s"} from version ${o.reuseFrom!.n}`, done: null, total: null });

  const r = await runBlender({ plan, outDir: dir, views: toRender, render: settings, exports: ["glb"], saveBlend: true }, { onProgress: o.onProgress, signal: o.signal });
  const result: VersionResult = {
    ...r,
    files: Object.fromEntries(Object.entries(r.files).map(([k, f]) => [k, rel(dir, f)])),
    renders: [
      ...reused,
      ...r.renders.map((x) => ({ view: x.view, label: VIEWS.find((v) => v.id === x.view)?.label ?? x.view, file: rel(dir, x.file), hash: viewHash(plan, settings, x.view), seconds: x.seconds, width: x.width, height: x.height, reused: null, camera: x.camera })),
    ].sort((a, b) => VIEW_IDS.indexOf(a.view) - VIEW_IDS.indexOf(b.view)),
    render: settings,
  };
  if (!r.exploded) {
    const ex = result.renders.find((x) => x.view === "exploded");
    if (ex) ex.label = "Hero angle (no internal parts to explode)";
  }
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ project: project.name, version: version.n, label: version.label, createdAt: version.createdAt, change: version.change, ...result }, null, 1));
  const saved = await db().fridayVersion.update({ where: { id: version.id }, data: { status: "ready", result: result as unknown as Prisma.InputJsonValue, error: null } });
  await db().fridayProject.update({ where: { id: project.id }, data: { activeVersion: version.n } });
  await writeMetadata(project.id);
  return { version: saved, result };
}

/** Re-render some views of an existing version in place (same model — e.g. "regenerate the top view"). */
export async function rerenderViews(project: FridayProject, version: FridayVersion, views: ViewId[], o: { onProgress?: (p: Progress) => void; signal?: AbortSignal } = {}) {
  const plan = planSchema.parse(version.plan);
  const dir = versionDir(project, version.n);
  const prev = (version.result ?? null) as VersionResult | null;
  const settings = prev?.render ?? renderSettings();
  const r = await runBlender({ plan, outDir: path.join(dir, ".rerender"), views, render: settings, exports: [], saveBlend: false }, o);
  const renders = [...(prev?.renders ?? []).filter((x) => !views.includes(x.view))];
  for (const x of r.renders) {
    const file = `renders/${x.view}.png`;
    await fs.copyFile(x.file, path.join(dir, file));
    renders.push({ view: x.view, label: VIEWS.find((v) => v.id === x.view)?.label ?? x.view, file, hash: viewHash(plan, settings, x.view), seconds: x.seconds, width: x.width, height: x.height, reused: null, camera: x.camera });
  }
  await fs.rm(path.join(dir, ".rerender"), { recursive: true, force: true });
  renders.sort((a, b) => VIEW_IDS.indexOf(a.view) - VIEW_IDS.indexOf(b.view));
  const result = { ...(prev ?? {}), renders } as VersionResult;
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ project: project.name, version: version.n, label: version.label, ...result }, null, 1));
  return db().fridayVersion.update({ where: { id: version.id }, data: { result: result as unknown as Prisma.InputJsonValue } });
}

/** Extra exports for an existing version (STL for printing, separate glTF). */
export async function exportVersion(project: FridayProject, version: FridayVersion, formats: ("stl" | "gltf")[], o: { onProgress?: (p: Progress) => void; signal?: AbortSignal } = {}) {
  const plan = planSchema.parse(version.plan);
  const dir = versionDir(project, version.n);
  const r = await runBlender({ plan, outDir: dir, views: [], render: renderSettings(), exports: formats, saveBlend: false }, o);
  const prev = (version.result ?? {}) as unknown as VersionResult;
  const files = { ...(prev.files ?? {}), ...Object.fromEntries(Object.entries(r.files).map(([k, f]) => [k, rel(dir, f)])) };
  return db().fridayVersion.update({ where: { id: version.id }, data: { result: { ...prev, files } as unknown as Prisma.InputJsonValue } });
}

export async function failVersion(version: FridayVersion, error: string) {
  await db().fridayVersion.update({ where: { id: version.id }, data: { status: "failed", error: error.slice(0, 2000) } });
  const p = await db().fridayProject.findUnique({ where: { id: version.projectId } });
  if (p) await writeMetadata(p.id);
}

export async function addHistory(projectId: string, item: HistoryItem, specs?: Specs) {
  const p = await db().fridayProject.findUnique({ where: { id: projectId } });
  if (!p) return;
  const history = [...((p.history as HistoryItem[]) ?? []), item].slice(-40);
  await db().fridayProject.update({ where: { id: projectId }, data: { history: history as unknown as Prisma.InputJsonValue, ...(specs ? { specs: specs as unknown as Prisma.InputJsonValue } : {}) } });
}

/** A file inside a project folder, safely (never outside it). */
export function safeProjectFile(project: Pick<FridayProject, "dir">, n: number, relPath: string): string | null {
  const base = versionDir(project, n);
  const full = path.resolve(base, relPath);
  return full.startsWith(base + path.sep) && existsSync(full) ? full : null;
}

export const fileUrl = (projectId: string, n: number, f: string) => `/api/friday/files/${projectId}/${n}/${f.split("/").map(encodeURIComponent).join("/")}`;

/** What the UI needs about a project (only verified outputs get URLs). */
export async function projectView(userId: string, projectId: string) {
  const p = await db().fridayProject.findFirst({ where: { id: projectId, userId }, include: { versions: { orderBy: { n: "desc" } } } });
  if (!p) return null;
  return {
    id: p.id, name: p.name, slug: p.slug, dir: p.dir, activeVersion: p.activeVersion, specs: (p.specs ?? null) as Specs | null,
    history: (p.history ?? []) as HistoryItem[], updatedAt: p.updatedAt.toISOString(),
    versions: p.versions.map((v) => {
      const r = (v.result ?? null) as VersionResult | null;
      const plan = v.plan as unknown as Plan;
      return {
        n: v.n, label: v.label, status: v.status, change: v.change, parentN: v.parentN, error: v.error, jobId: v.jobId, createdAt: v.createdAt.toISOString(),
        model: r?.files.glb ? fileUrl(p.id, v.n, r.files.glb) : null,
        files: r ? Object.fromEntries(Object.entries(r.files).map(([k, f]) => [k, fileUrl(p.id, v.n, f)])) : {},
        renders: (r?.renders ?? []).map((x) => ({ ...x, url: `${fileUrl(p.id, v.n, x.file)}?h=${x.hash}` })),
        components: r?.components ?? [], size: r?.size_mm ?? null, exploded: r?.exploded ?? false, device: r?.device ?? null, engine: r?.engine ?? null,
        warnings: r?.warnings ?? [],
        materials: plan.materials ?? [], planComponents: (plan.components ?? []).filter((c) => !c.cutter).map((c) => ({ id: c.id, name: c.name, group: c.group, material: c.material, position: c.position, rotation: c.rotation, scale: c.scale, conceptual: c.conceptual, internal: c.internal })),
      };
    }),
  };
}
export type ProjectView = NonNullable<Awaited<ReturnType<typeof projectView>>>;
