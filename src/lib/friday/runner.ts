import "server-only";
import type { AgentJob, FridayProject } from "@prisma/client";
import { getDb } from "@/lib/db";
import { completeWithFallback } from "@/lib/ai/complete";
import { getLiveBrain } from "@/lib/ai/brain";
import { agentConfigs, type AgentEvent, type AgentInput } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/env";
import { extractJson } from "@/lib/aston/build";
import { briefSchema } from "@/lib/jobs/brief";
import { BlenderMissing, findBlender, installHint, type Progress } from "./blender";
import { planSchema, VIEW_IDS, VIEWS, type Plan, type ViewId } from "./plan";
import { fridayEditPrompt, fridayPlanPrompt } from "./prompt";
import { addHistory, buildVersion, exportVersion, failVersion, fileUrl, findOrCreateProject, newVersion, rerenderViews, type Specs } from "./projects";
import { emitFriday, type FridayLiveEvent, type FridayStage } from "./live";
import { streamWithFallback } from "@/lib/ai/complete";

/**
 * FRIDAY's job runner: the brain writes (or changes) the plan → Blender builds
 * it → ten verified renders + GLB → a new version. Progress comes straight from
 * Blender's own report lines; a cancel request stops Blender itself.
 */

export type { Ask as FridayAsk };
export type FridayPayload = {
  action: "create" | "edit" | "render" | "export";
  projectId?: string;
  /** the version to change / re-render / export (default: the active one) */
  version?: number;
  views?: ViewId[];
  formats?: ("stl" | "gltf")[];
  change?: string;
  name?: string;
};

/** The brain: a whole answer; `onDelta` (when given) gets it piece by piece as it's written. */
type Ask = (system: string, user: string, onDelta?: (t: string) => void) => Promise<string>;

const MARKERS = /\b(glass(?:es)?|lens|frame|wearable|hardware|device|prototype|product|design|spec|dimension|mm|battery|sensor|camera|hinge|temple)\b/i;
const STOP = new Set(["make", "model", "create", "build", "design", "render", "friday", "jarvis", "please", "with", "that", "this", "from", "into", "show", "need", "want", "the", "and", "for", "concept", "version", "views", "view", "using", "like", "should", "have", "about"]);

/**
 * What the user's own notes and memory say about the thing being modelled.
 * "EDITH" was also ULTRON's old name, so a hit on it alone isn't enough —
 * it has to read like a product/hardware note.
 */
export async function gatherSpecs(userId: string, text: string): Promise<{ lines: string[]; sources: string[] }> {
  const terms = [...new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((t) => !STOP.has(t)))].slice(0, 8);
  if (!terms.length) return { lines: [], sources: [] };
  const or = terms.flatMap((t) => [{ content: { contains: t, mode: "insensitive" as const } }]);
  const [mems, notes] = await Promise.all([
    getDb().memory.findMany({ where: { userId, OR: or }, orderBy: { updatedAt: "desc" }, take: 20, select: { key: true, content: true } }),
    getDb().note.findMany({ where: { userId, OR: [...or, ...terms.map((t) => ({ title: { contains: t, mode: "insensitive" as const } }))] }, orderBy: { updatedAt: "desc" }, take: 10, select: { title: true, content: true } }),
  ]);
  const relevant = (s: string) => {
    const hits = terms.filter((t) => s.toLowerCase().includes(t));
    if (!hits.length) return false;
    if (hits.every((t) => t === "edith") && (!MARKERS.test(s) || /\bultron\b|pc control|desktop/i.test(s))) return false;
    return true;
  };
  const lines: string[] = [];
  const sources: string[] = [];
  for (const m of mems) if (relevant(`${m.key ?? ""} ${m.content}`)) { lines.push(`Memory${m.key ? ` (${m.key})` : ""}: ${m.content.slice(0, 600)}`); sources.push(`memory${m.key ? `: ${m.key}` : ""}`); }
  for (const n of notes) if (relevant(`${n.title} ${n.content}`)) { lines.push(`Note "${n.title}": ${n.content.slice(0, 1500)}`); sources.push(`note: ${n.title}`); }
  return { lines: lines.slice(0, 12), sources: [...new Set(sources)].slice(0, 12) };
}

/** Ask the brain for a plan; one repair round with the exact validation problems. */
export async function writePlan(ask: Ask, user: string, live?: { delta: (t: string) => void; reset: () => void }): Promise<{ plan: Plan; repaired: boolean }> {
  const system = fridayPlanPrompt();
  let reply = await ask(system, user, live?.delta);
  for (let round = 0; ; round++) {
    let problem: string;
    try {
      const r = planSchema.safeParse(extractJson(reply));
      if (r.success) return { plan: r.data, repaired: round > 0 };
      problem = r.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (e) { problem = (e as Error).message; }
    if (round >= 1) throw new Error(`Friday's brain didn't return a usable model plan (${problem.slice(0, 240)}).`);
    live?.reset();
    reply = await ask(system, `${user}\n\nYour previous reply couldn't be used: ${problem}. Reply again with the complete, corrected JSON object only.`, live?.delta);
  }
}

/** A tiny async queue: Blender's progress callbacks → the job's event stream. */
function channel<T>() {
  const q: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const poke = () => { const w = wake; wake = null; w?.(); };
  return {
    push(x: T) { q.push(x); poke(); },
    close() { closed = true; poke(); },
    async *drain() {
      for (;;) {
        while (q.length) yield q.shift()!;
        if (closed) return;
        await new Promise<void>((r) => { wake = r; });
      }
    },
  };
}

const progressEvent = (p: Progress): AgentEvent =>
  /^Rendered view|^Scene checked|^Saving|^Exporting|^Reused/.test(p.text) || (p.stage === "geometry" && p.done != null && p.done === p.total)
    ? { type: "tool", name: "friday_blender", status: "ok", summary: p.text }
    : { type: "activity", label: p.text };

export function fridayRunner(job: Pick<AgentJob, "id" | "userId" | "title" | "brief" | "payload">, o: { ask?: Ask; settings?: import("./blender").RenderSettings } = {}) {
  return async function* (input: AgentInput): AsyncGenerator<AgentEvent, void, unknown> {
    void input;
    const payload = (job.payload ?? { action: "create" }) as FridayPayload;
    const brief = briefSchema.parse(job.brief);
    const db = getDb();
    if (!findBlender()) {
      const msg = `Blender isn't installed on the computer running JARVIS, so I can't model or render. ${installHint()}`;
      yield { type: "text", delta: `${msg}\n\nSTATUS: BLOCKED — Blender isn't installed` };
      return;
    }

    const out = channel<AgentEvent>();
    const ctl = new AbortController();
    // a cancel request on the task stops Blender itself, not just the reporting
    const watch = setInterval(() => {
      void db.agentJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true } }).then((j) => { if (j?.cancelRequested) ctl.abort(); }).catch(() => {});
    }, 2000);
    let finalText = "";
    let failure: string | null = null;
    // the live view: every step as it happens (see live.ts)
    const L = (e: FridayLiveEvent) => emitFriday(job.id, e);
    const log = (text: string, kind: "info" | "ok" | "error" = "info") => L({ type: "log", text, kind, at: new Date().toISOString() });
    let lastStage: FridayStage | null = null;
    const stage = (st: FridayStage, note: string) => { if (st !== lastStage) { lastStage = st; L({ type: "stage", stage: st, note }); } };
    const STAGE_NOTE: Record<string, [FridayStage, string]> = {
      materials: ["materials", "Creating the materials"], geometry: ["geometry", "Building the geometry, part by part"], modifiers: ["modifiers", "Bevels, shells, cuts and symmetry"],
      validate: ["validate", "Checking the scene"], lighting: ["lighting", "Setting up studio lighting"], cameras: ["cameras", "Placing the cameras"], "render-setup": ["cameras", "Setting up the renderer"],
      save: ["save", "Saving the Blender project"], export: ["export", "Exporting the 3D model"], exported: ["export", "Exporting the 3D model"], render: ["render", "Rendering the views"], done: ["verify", "Checking every file Blender wrote"],
    };
    /** Blender's report lines → the live view (+ the task's own progress steps). */
    const progressFor = (projectId: string, n: number) => (p: Progress) => {
      out.push(progressEvent(p));
      const sn = STAGE_NOTE[p.stage];
      if (sn) stage(sn[0], sn[1]);
      if (p.stage === "materials" && p.material) L({ type: "material", id: p.material, name: p.text.replace(/^Material \d+\/\d+: /, ""), color: p.color ?? "#888888" });
      if (p.stage === "geometry" && p.part) L({ type: "part", id: p.part, name: p.text.replace(/^(Building|Built) /, "").replace(/ — .*| ?:.*/, ""), shape: p.shape ?? "", group: p.group ?? "", status: p.building ? "building" : "built", material: p.material, faces: p.faces, cutter: p.cutter, conceptual: p.conceptual, internal: p.internal, done: p.done, total: p.total });
      if (p.stage === "exported" && (p.fmt === "glb")) L({ type: "model", url: `${fileUrl(projectId, n, "model.glb")}?t=${Date.now()}` });
      if (p.stage === "render" && p.view && /^Rendered/.test(p.text)) L({ type: "render", view: p.view, label: VIEWS.find((x) => x.id === p.view)?.label ?? p.view, url: `${fileUrl(projectId, n, p.file ?? `renders/${p.view}.png`)}?t=${Date.now()}`, seconds: p.seconds ?? null, done: p.done, total: p.total });
      if (!(p.stage === "geometry" && p.building) && p.stage !== "done") log(p.text, /^(Built|Rendered|Exported|Scene checked|Material)/.test(p.text) ? "ok" : "info");
    };

    const work = (async () => {
      const onProgress = (p: Progress) => out.push(progressEvent(p));
      let project: FridayProject | null = payload.projectId ? await db.fridayProject.findFirst({ where: { id: payload.projectId, userId: job.userId } }) : null;
      if (payload.action !== "create" && !project) project = await db.fridayProject.findFirst({ where: { userId: job.userId }, orderBy: { updatedAt: "desc" } });
      if (payload.action !== "create" && !project) throw new Error("There's no Friday project yet — ask me to model something first.");
      const baseN = payload.version ?? project?.activeVersion ?? 0;
      const base = project && baseN ? await db.fridayVersion.findUnique({ where: { projectId_n: { projectId: project.id, n: baseN } } }) : null;

      if (payload.action === "render" || payload.action === "export") {
        if (!project || !base || base.status !== "ready") throw new Error(`Version ${baseN} isn't a finished build.`);
        if (payload.action === "render") {
          const views = payload.views?.length ? payload.views : VIEW_IDS;
          out.push({ type: "activity", label: `Re-rendering ${views.length} view${views.length === 1 ? "" : "s"} of version ${base.n}` });
          log(`Re-rendering ${views.length} view${views.length === 1 ? "" : "s"} of ${project.name} version ${base.n} (same model)`);
          await rerenderViews(project, base, views, { onProgress: progressFor(project.id, base.n), signal: ctl.signal });
          finalText = `Re-rendered ${views.map((v) => VIEWS.find((x) => x.id === v)?.label ?? v).join(", ")} for ${project.name} version ${base.n} (same model).\nSTATUS: DONE`;
        } else {
          const formats = payload.formats?.length ? payload.formats : (["stl"] as ("stl" | "gltf")[]);
          log(`Exporting ${formats.map((f) => f.toUpperCase()).join(" and ")} for ${project.name} version ${base.n}`);
          await exportVersion(project, base, formats, { onProgress: progressFor(project.id, base.n), signal: ctl.signal });
          finalText = `Exported ${formats.map((f) => f.toUpperCase()).join(" and ")} for ${project.name} version ${base.n}. It's a visual concept model — check dimensions and wall thickness before printing or manufacturing.\nSTATUS: DONE`;
        }
        out.push({ type: "artifact", kind: "friday", projectId: project.id, version: base.n, url: `/dashboard/friday?project=${project.id}&v=${base.n}`, title: project.name });
        stage("done", "Done");
        L({ type: "result", projectId: project.id, version: base.n, ok: true, text: finalText.replace(/\nSTATUS: DONE$/, "") });
        return;
      }

      let ask = o.ask;
      if (!ask) {
        const pick = agentConfigs("friday", await getLiveBrain(job.userId).catch(() => null));
        if (!pick.configs.length) throw new Error(pick.missing ?? "Friday has no AI provider.");
        ask = (system, user, onDelta) => onDelta
          ? streamWithFallback(pick.configs as AiConfig[], system, user, onDelta, { maxTokens: 8000, timeoutMs: 240_000, signal: ctl.signal }).then((r) => r.text)
          : completeWithFallback(pick.configs as AiConfig[], system, user, { maxTokens: 8000, timeoutMs: 240_000 });
      }
      const request = payload.change ?? brief.objective;
      stage("specs", "Looking through your notes and memory for specs");
      log(payload.action === "edit" ? `Change requested: ${request}` : `Request: ${request}`);
      const specs = await gatherSpecs(job.userId, `${payload.name ?? ""} ${request} ${brief.context.join(" ")}`).catch(() => ({ lines: [], sources: [] }));
      if (specs.sources.length) out.push({ type: "tool", name: "friday_specs", status: "ok", summary: `Found specs in your ${specs.sources.join(", ")}` });
      log(specs.sources.length ? `Found specs in your ${specs.sources.join(", ")} — these count as verified` : "No saved specs found for this — every dimension will be an assumption", specs.sources.length ? "ok" : "info");
      stage("plan", payload.action === "edit" ? "Working out the change" : "Designing the model plan");
      const livePlan = { delta: (t: string) => L({ type: "plan", text: t }), reset: () => { L({ type: "plan_reset" }); log("The plan didn't check out — asking for a corrected one", "error"); } };

      let plan: Plan;
      out.push({ type: "activity", label: base && payload.action === "edit" ? "Friday is working out the change" : "Friday is designing the model plan" });
      if (payload.action === "edit") {
        if (!base) throw new Error("There's no version to change yet.");
        const r = await writePlan(ask, `${fridayEditPrompt(base.plan, request)}${specs.lines.length ? `\n\nTHE USER'S OWN NOTES (verified):\n${specs.lines.join("\n")}` : ""}`, livePlan);
        plan = { ...r.plan, name: project!.name };
      } else {
        const user = [
          `REQUEST: ${request}`,
          brief.context.length ? `CONTEXT:\n${brief.context.join("\n")}` : "",
          brief.requirements.length ? `REQUIREMENTS:\n${brief.requirements.join("\n")}` : "",
          specs.lines.length ? `THE USER'S OWN NOTES AND MEMORY (these are the verified specifications — use them exactly):\n${specs.lines.join("\n")}` : "No saved specifications were found for this — every dimension is an assumption; mark unknown internals conceptual.",
        ].filter(Boolean).join("\n\n");
        plan = (await writePlan(ask, user, livePlan)).plan;
        if (payload.name) plan = { ...plan, name: payload.name.slice(0, 80) };
      }
      const visible = plan.components.filter((c) => !c.cutter);
      log(`Plan: ${plan.name} — ${visible.length} parts in ${new Set(visible.map((c) => c.group)).size} groups, ${plan.materials.length} materials${plan.components.some((c) => c.cutter) ? `, ${plan.components.filter((c) => c.cutter).length} cutter(s)` : ""}${plan.components.some((c) => c.conceptual) ? `, ${plan.components.filter((c) => c.conceptual).length} conceptual` : ""}`, "ok");
      out.push({ type: "tool", name: "friday_plan", status: "ok", summary: `Plan: ${visible.length} parts, ${plan.materials.length} materials${plan.components.some((c) => c.conceptual) ? `, ${plan.components.filter((c) => c.conceptual).length} conceptual` : ""}` });

      project ??= await findOrCreateProject(job.userId, plan.name);
      const v = await newVersion(project, plan, { change: payload.action === "edit" ? request.slice(0, 300) : "First concept", parentN: base?.n ?? null, jobId: job.id });
      out.push({ type: "activity", label: `Blender is building version ${v.n}` });
      log(`Blender is building ${project.name} version ${v.n}${base && payload.action === "edit" ? ` from version ${base.n}` : ""}`);
      let res: Awaited<ReturnType<typeof buildVersion>>;
      try {
        res = await buildVersion(project, v, { reuseFrom: payload.action === "edit" ? base : null, onProgress: progressFor(project.id, v.n), signal: ctl.signal, settings: o.settings });
      } catch (e) {
        await failVersion(v, (e as Error).message);
        throw e;
      }
      const s: Specs = { verified: plan.specs.verified, assumptions: plan.specs.assumptions, questions: plan.specs.questions };
      await addHistory(project.id, { at: new Date().toISOString(), version: v.n, change: v.change ?? "" }, s);
      const r = res.result;
      const made = r.renders.filter((x) => x.reused == null).length;
      for (const x of r.renders.filter((y) => y.reused != null)) L({ type: "render", view: x.view, label: x.label, url: `${fileUrl(project.id, v.n, x.file)}?h=${x.hash}`, seconds: null, done: null, total: null, reused: true });
      log(`Verified: model.blend, model.glb and ${r.renders.length} renders (${r.renders.length - made ? `${r.renders.length - made} reused, ` : ""}each one a real, non-blank ${r.render.width}×${r.render.height} image)`, "ok");
      out.push({ type: "artifact", kind: "friday", projectId: project.id, version: v.n, url: `/dashboard/friday?project=${project.id}&v=${v.n}`, title: project.name });
      finalText = [
        `${payload.action === "edit" ? "Updated" : "Modelled"} ${project.name} — version ${v.n}.`,
        `${r.components.length} parts, ${r.size_mm.map((n) => Math.round(n)).join(" × ")} mm, rendered on ${r.device}.`,
        `Views: ${made} rendered${r.renders.length - made ? `, ${r.renders.length - made} unchanged and reused from version ${base?.n}` : ""} (${r.renders.length} total). Files: model.blend, model.glb.`,
        specs.sources.length ? `Specs used from your ${specs.sources.join(", ")}.` : "",
        plan.specs.assumptions.length ? `Assumptions: ${plan.specs.assumptions.slice(0, 6).join("; ")}.` : "",
        plan.components.some((c) => c.conceptual) ? `Conceptual placeholders: ${plan.components.filter((c) => c.conceptual).map((c) => c.name).join(", ")}.` : "",
        plan.specs.questions.length ? `Open questions: ${plan.specs.questions.join(" ")}` : "",
        r.warnings.length ? `Notes: ${r.warnings.join(" ")}` : "",
        "This is a visual concept, not an engineering-ready model.",
        "STATUS: DONE",
      ].filter(Boolean).join("\n");
      stage("done", "Done");
      L({ type: "result", projectId: project.id, version: v.n, ok: true, text: finalText.replace(/\nSTATUS: DONE$/, "") });
    })().then(() => {}, (e) => {
      failure = e instanceof BlenderMissing ? (e as Error).message : String((e as Error)?.message ?? e).slice(0, 400);
      const f = ctl.signal.aborted ? "Cancelled — Blender was stopped." : failure ?? "It failed.";
      log(f, "error");
      lastStage = null; stage("failed", f);
    }).finally(() => out.close());

    try {
      for await (const ev of out.drain()) yield ev;
      await work;
    } finally {
      clearInterval(watch);
      if (!finalText && !failure) ctl.abort(); // the engine stopped listening (cancelled) → stop Blender too
    }
    if (failure) {
      const f: string = failure;
      yield { type: "text", delta: ctl.signal.aborted ? "Cancelled — Blender was stopped." : `I couldn't finish the model. ${f}\n\nSTATUS: BLOCKED — ${f.slice(0, 200)}` };
      return;
    }
    yield { type: "done", text: finalText };
  };
}
