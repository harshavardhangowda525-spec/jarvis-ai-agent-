import "server-only";
import { getDb } from "@/lib/db";
import { createJob } from "@/lib/jobs/engine";
import type { Brief } from "@/lib/jobs/brief";
import type { FridayPayload } from "./runner";
import { VIEWS } from "./plan";
import { fileUrl, type VersionResult } from "./projects";

/** Start Friday's work as a tracked task (it runs like any delegated task). */
export async function requestFriday(userId: string, p: FridayPayload & { request?: string }) {
  const project = p.projectId
    ? await getDb().fridayProject.findFirst({ where: { id: p.projectId, userId } })
    : p.action === "create" ? null : await getDb().fridayProject.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" } });
  if (p.projectId && !project) throw new Error("That Friday project doesn't exist.");
  if (p.action !== "create" && !project) throw new Error("There's no Friday project yet — ask Friday to model something first.");
  const text = (p.action === "edit" ? p.change : p.request) ?? "";
  if ((p.action === "create" || p.action === "edit") && text.trim().length < 3) throw new Error(p.action === "edit" ? "Say what to change." : "Describe what to model.");
  const what = project?.name ?? ((p.name || text.replace(/^(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:friday,?\s+)?(?:model|build|create|make|design|render|generate)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:3d\s+model\s+of\s+(?:an?\s+|the\s+)?)?/i, "").replace(/\s+/g, " ").trim().slice(0, 60)) || "3D model");
  const title = p.action === "create" ? `3D model — ${what}` : p.action === "edit" ? `Change — ${what}` : p.action === "render" ? `Re-render — ${what}${p.views?.length ? ` (${p.views.map((v) => VIEWS.find((x) => x.id === v)?.label ?? v).join(", ")})` : ""}` : `Export — ${what} (${(p.formats ?? ["stl"]).join(", ").toUpperCase()})`;
  const brief: Brief = {
    objective: (p.action === "create" ? `Model this as a 3D concept in Blender and render the ten standard views: ${text}` : p.action === "edit" ? `Change ${what}: ${text}` : title).slice(0, 1000),
    expectedOutcome: p.action === "export" ? "Verified export files" : "A new verified version: model.blend, model.glb and the renders",
    context: [], requirements: ["Verified specs kept apart from assumptions", "Unknown parts marked conceptual"],
    constraints: ["Visual concept — not engineering-ready"], acceptance: ["Every requested output exists and checks out"], approvals: [],
  };
  return createJob(userId, { agent: "friday", title: title.slice(0, 120), request: (text || title).slice(0, 2000), brief, payload: { ...p, ...(project ? { projectId: project.id } : {}) } });
}

export async function listProjects(userId: string, take = 20) {
  const ps = await getDb().fridayProject.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take, include: { versions: { orderBy: { n: "desc" }, take: 1, select: { n: true, status: true, label: true } } } });
  const actives = await getDb().fridayVersion.findMany({ where: { OR: ps.map((p) => ({ projectId: p.id, n: p.activeVersion })) }, select: { projectId: true, n: true, result: true } });
  return ps.map((p) => {
    const a = actives.find((v) => v.projectId === p.id);
    const r = (a?.result ?? null) as VersionResult | null;
    const thumb = r?.renders.find((x) => x.view === "front_34") ?? r?.renders[0];
    return { id: p.id, name: p.name, activeVersion: p.activeVersion, latest: p.versions[0] ?? null, updatedAt: p.updatedAt.toISOString(), folder: p.dir, thumb: thumb && a ? `${fileUrl(p.id, a.n, thumb.file)}?h=${thumb.hash}` : null };
  });
}
