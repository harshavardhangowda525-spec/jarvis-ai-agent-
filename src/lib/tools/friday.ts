import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getDb } from "@/lib/db";
import { requestFriday, listProjects } from "@/lib/friday/service";
import { matchSite } from "./aston";
import { projectView } from "@/lib/friday/projects";
import { findBlender, installHint } from "@/lib/friday/blender";
import { VIEW_IDS, VIEWS, type ViewId } from "@/lib/friday/plan";

/**
 * FRIDAY's tools (and JARVIS's handle on Friday). Modelling, changes, re-renders
 * and exports run as tracked tasks with Blender's real progress; nothing is
 * reported finished until its files have been checked.
 */

const VIEW_ALIAS: Record<string, ViewId> = {
  front: "front", back: "rear", rear: "rear", left: "left", "left side": "left", right: "right", "right side": "right", top: "top", bottom: "bottom", underside: "bottom",
  "front 3/4": "front_34", "front three-quarter": "front_34", "three quarter": "front_34", "3/4": "front_34", front_34: "front_34", "rear 3/4": "rear_34", "rear three-quarter": "rear_34", rear_34: "rear_34",
  detail: "detail", "close-up": "detail", closeup: "detail", exploded: "exploded", internal: "exploded", "exploded view": "exploded",
};
const views = z.preprocess(
  (v) => (v == null ? undefined : (Array.isArray(v) ? v : [v]).map((x) => VIEW_ALIAS[String(x).trim().toLowerCase().replace(/_/g, " ")] ?? VIEW_ALIAS[String(x).trim().toLowerCase()] ?? x)),
  z.array(z.enum(VIEW_IDS as [ViewId, ...ViewId[]])).max(10).optional(),
);

const schema = z.object({
  action: z.enum(["create", "change", "render", "export", "list", "status", "open", "save_as", "compare"]),
  request: z.string().trim().max(3000).optional().describe("create: the invention/product to model, with every detail and dimension the user gave."),
  change: z.string().trim().max(1500).optional().describe("change: exactly what to change (makes a new version; the old one stays)."),
  name: z.string().trim().max(80).optional().describe("create: the project name (e.g. 'EDITH Smart Glasses'). save_as: the version label."),
  projectId: z.string().max(60).optional(),
  project: z.string().trim().max(120).optional().describe("The project name the user mentioned (e.g. 'EDITH Smart Glasses'). Pass it whenever they name one."),
  version: z.coerce.number().int().positive().optional(),
  other: z.coerce.number().int().positive().optional().describe("compare: the second version."),
  views: views.describe("render: which views to re-render (front, rear, left, right, top, bottom, front_34, rear_34, detail, exploded). Omit for all ten."),
  formats: z.preprocess((v) => (v == null ? undefined : (Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase().replace(/^\./, ""))), z.array(z.enum(["stl", "gltf"])).max(2).optional()).describe("export: stl and/or gltf (GLB and .blend are always made)."),
});
type Input = z.infer<typeof schema>;

/** The project the user named (or whose name is in the request); the most recent only when there's no name and just one fits. */
async function pickProject(userId: string, o: { id?: string; name?: string; text?: string; strict?: boolean }) {
  if (o.id) { const p = await getDb().fridayProject.findFirst({ where: { id: o.id, userId } }); if (p) return p; }
  const all = await getDb().fridayProject.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 50 });
  if (!all.length) throw new ToolError("There are no Friday projects yet.");
  const named = o.name || (o.id && !/^c[a-z0-9]{20,}$/.test(o.id) ? o.id : undefined);
  const hit = matchSite(all, named) ?? (named ? null : matchSite(all, o.text));
  if (hit) return hit;
  const list = all.slice(0, 8).map((p) => p.name).join(", ");
  if (named) throw new ToolError(`There's no project called "${named}". Your projects: ${list}.`);
  if (!o.strict || all.length === 1) return all[0];
  throw new ToolError(`Which project? Your projects: ${list}. Ask again with its name.`);
}
const jobData = (job: { id: string; agent: string; title: string; status: string }, note: string) => ({ job: { id: job.id, agent: job.agent, title: job.title, status: job.status }, note });

export function fridayTool(name: string, scope: "friday" | "jarvis"): ToolDefinition<Input> {
  return {
    name,
    agentScope: scope,
    activityLabel: "Working with Friday",
    description:
      "FRIDAY — 3D modelling in Blender. create (model an invention → plan → real geometry → ten verified renders + GLB; a tracked task) · " +
      "change (a follow-up edit → a new version; the old one stays) · render (re-render some views of a version) · export (STL / glTF) · " +
      "list · status (versions, parts, specs, assumptions) · open (show it in Friday's 3D workspace — only when the user asks to see it) · save_as (label a version) · compare (two versions). " +
      "Never say a model or render is done until the task reports it.",
    schema: schema as unknown as z.ZodType<Input>,
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "change", "render", "export", "list", "status", "open", "save_as", "compare"] },
        request: { type: "string" }, change: { type: "string" }, name: { type: "string" }, projectId: { type: "string" }, project: { type: "string", description: "The project name the user mentioned" },
        version: { type: "integer" }, other: { type: "integer" },
        views: { type: "array", items: { type: "string", enum: [...VIEW_IDS] } },
        formats: { type: "array", items: { type: "string", enum: ["stl", "gltf"] } },
      },
      required: ["action"],
    },
    async execute(input, ctx) {
      const needsBlender = ["create", "change", "render", "export"].includes(input.action);
      if (needsBlender && !findBlender()) throw new ToolError(`Blender isn't installed on the computer running JARVIS, so Friday can't model or render. ${installHint()}`);
      const start = async (p: Parameters<typeof requestFriday>[1]) => requestFriday(ctx.userId, p).catch((e) => { throw new ToolError((e as Error).message); });
      if (input.action === "create") {
        if (!input.request) throw new ToolError("Describe what to model.");
        const job = await start({ action: "create", request: input.request, name: input.name });
        return { data: jobData(job, "Friday is modelling it in Blender (plan → geometry → ten renders → GLB). Report only when the task finishes."), summary: `Modelling started: ${job.title}` };
      }
      const project = await pickProject(ctx.userId, { id: input.projectId, name: input.project, text: input.change, strict: input.action === "change" || input.action === "export" });
      if (input.action === "change") {
        if (!input.change) throw new ToolError("Say what to change.");
        const job = await start({ action: "edit", projectId: project.id, version: input.version, change: input.change });
        return { data: jobData(job, `Friday is making version ${project.activeVersion + 1}; version ${input.version ?? project.activeVersion} stays as it is.`), summary: `Change started: ${project.name}` };
      }
      if (input.action === "render") {
        const job = await start({ action: "render", projectId: project.id, version: input.version, views: input.views });
        return { data: jobData(job, "Re-rendering. Report only when it finishes."), summary: `Re-render started: ${input.views?.length ? input.views.map((v) => VIEWS.find((x) => x.id === v)?.label).join(", ") : "all views"}` };
      }
      if (input.action === "export") {
        const job = await start({ action: "export", projectId: project.id, version: input.version, formats: input.formats ?? ["stl"] });
        return { data: jobData(job, "Exporting. Report only when it finishes; remind the user it's a concept model."), summary: `Export started: ${(input.formats ?? ["stl"]).join(", ").toUpperCase()}` };
      }
      if (input.action === "list") {
        const ps = await listProjects(ctx.userId, 10);
        return { data: { projects: ps.map(({ folder: _f, ...p }) => { void _f; return p; }) }, summary: `${ps.length} project${ps.length === 1 ? "" : "s"}` };
      }
      const view = (await projectView(ctx.userId, project.id))!;
      const n = input.version ?? view.activeVersion;
      const v = view.versions.find((x) => x.n === n);
      if (input.action === "save_as") {
        if (!v) throw new ToolError(`There's no version ${n}.`);
        await getDb().fridayVersion.update({ where: { projectId_n: { projectId: project.id, n } }, data: { label: (input.name || `Saved ${new Date().toISOString().slice(0, 10)}`).slice(0, 60) } });
        return { data: { saved: n, label: input.name, note: "Labelled. Every version's files are kept." }, summary: `Saved version ${n} as "${input.name ?? "saved"}"` };
      }
      if (input.action === "compare") {
        const b = view.versions.find((x) => x.n === (input.other ?? (n > 1 ? n - 1 : n)));
        if (!v || !b) throw new ToolError("Name two versions that exist.");
        const ids = (x: typeof v) => new Set(x.components.map((c) => c.id));
        const added = [...ids(v)].filter((i) => !ids(b).has(i)), removed = [...ids(b)].filter((i) => !ids(v).has(i));
        return { data: { a: { n: v.n, change: v.change, size: v.size, parts: v.components.length }, b: { n: b.n, change: b.change, size: b.size, parts: b.components.length }, added, removed, navigate: `/dashboard/friday?project=${project.id}&v=${v.n}&compare=${b.n}` }, summary: `Compared v${v.n} with v${b.n}` };
      }
      if (input.action === "open") {
        if (!v || v.status !== "ready") throw new ToolError(`Version ${n} isn't a finished build.`);
        return { data: { navigate: `/dashboard/friday?project=${project.id}&v=${n}&view=agentic`, opened: `${view.name} v${n}` }, summary: `Opening ${view.name} v${n} in Friday` };
      }
      // status
      return {
        data: {
          project: { id: view.id, name: view.name, activeVersion: view.activeVersion, folder: view.dir, specs: view.specs, history: view.history.slice(-8) },
          versions: view.versions.slice(0, 6).map((x) => ({ n: x.n, label: x.label, status: x.status, change: x.change, error: x.error, parts: x.components.length, size_mm: x.size, renders: x.renders.length, device: x.device, conceptual: x.components.filter((c) => c.conceptual).map((c) => c.name) })),
        },
        summary: `${view.name} — v${view.activeVersion}`,
      };
    },
  };
}

export const fridayAgentTool = fridayTool("friday", "friday");
export const jarvisFridayTool = fridayTool("friday_model", "jarvis");
