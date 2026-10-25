import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getDb } from "@/lib/db";
import { approveVersion, listSites, requestBuild, requestChanges, siteDetail } from "@/lib/aston/service";
import { listStudioProjects, requestStudio, requestStudioAction, studioDetail } from "@/lib/aston/studio/service";
import { deployProject, prepareDeploy } from "@/lib/aston/studio/deploy";
import { ensurePlan, listPlans, planView, tpPath } from "@/lib/plans/engine";
import { PLAN_TZ, planSections } from "@/lib/plans/schema";
import { todayIn } from "@/lib/activity/dates";

/**
 * ASTON's tools (and JARVIS's handle on ASTON's demos and the daily plan).
 * Builds run as tracked tasks; opening a preview only happens when you ask.
 */

const buildSchema = z.object({
  request: z.string().trim().min(5).max(2000).describe("What to build, with every business detail the user gave."),
  kind: z.enum(["website", "app"]).optional(),
  leadId: z.string().max(60).optional().describe("A CRM lead id, when it's for a lead."),
  business: z.string().trim().max(120).optional(),
});

export const astonBuildTool: ToolDefinition<z.infer<typeof buildSchema>> = {
  name: "aston_build",
  agentScope: "aston",
  activityLabel: "Starting the build",
  description: "Start building a website (ASTON's studio: plan → design system → real multi-page code → run → browser tests → fixes → preview; the studio opens so the user watches the code and preview) or an app demo (kind app). Include every detail the user gave in `request`.",
  schema: buildSchema,
  inputSchema: { type: "object", properties: { request: { type: "string" }, kind: { type: "string", enum: ["website", "app"] }, leadId: { type: "string" }, business: { type: "string" } }, required: ["request"] },
  async execute(input, ctx) {
    if (input.kind !== "app") {
      // websites: the studio plans, writes the real code, runs it and tests it — opened so the user watches
      const { project, job } = await requestStudio(ctx.userId, { request: input.request, ...(input.business ? { client: input.business } : {}) }).catch((e) => { throw new ToolError((e as Error).message); });
      return { data: { job: { id: job.id, agent: job.agent, title: job.title, status: job.status }, navigate: `/dashboard/aston/studio?project=${project.id}`, note: "The website build started in ASTON's studio (code and preview side by side). Don't claim it's done — the result is reported when it's built and tested." }, summary: `Website build started: ${project.name}` };
    }
    const job = await requestBuild(ctx.userId, input).catch((e) => { throw new ToolError((e as Error).message); });
    return { data: { job: { id: job.id, agent: job.agent, title: job.title, status: job.status }, note: "Build started. Don't claim it's done — the result is reported when it finishes." }, summary: `Build started: ${job.title}` };
  },
};

const demoSchema = z.object({
  action: z.enum(["list", "details", "open", "walkthrough", "changes", "approve"]),
  siteId: z.string().max(60).optional().describe("The demo's id, when you have it."),
  name: z.string().trim().max(120).optional().describe("The business / demo name the user mentioned (e.g. 'Bean Story'). Always pass it for changes and approve."),
  feedback: z.string().trim().max(1500).optional().describe("For changes: exactly what to change."),
  version: z.number().int().positive().optional(),
});

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Which demo the user means (pure — tested): the one whose name they said, or
 * whose name appears in what they asked. Longest name wins ("Bean Story Café"
 * over "Bean"). Null when nothing matches.
 */
export function matchSite<T extends { name: string }>(sites: T[], ...texts: (string | undefined)[]): T | null {
  const hay = texts.filter(Boolean).map((t) => ` ${norm(t!)} `);
  if (!hay.length) return null;
  const hits = sites.filter((st) => {
    const n = norm(st.name);
    return n.length >= 3 && hay.some((h) => h.includes(` ${n} `) || (h.trim().length >= 3 && ` ${n} `.includes(h)));
  });
  return hits.sort((a, b) => norm(b.name).length - norm(a.name).length)[0] ?? null;
}

/**
 * The demo to act on. A change or an approval never falls back to "the most
 * recent one" when you have several — that's how a Bean Story change once
 * landed on Iron Temple. It asks which one instead.
 */
async function pickSite(userId: string, o: { siteId?: string; name?: string; text?: string; strict: boolean }) {
  const db = getDb();
  if (o.siteId) {
    const byId = await db.astonSite.findFirst({ where: { id: o.siteId, userId } });
    if (byId) return byId;
  }
  const sites = await db.astonSite.findMany({ where: { userId, currentVersion: { gt: 0 } }, orderBy: { updatedAt: "desc" }, take: 50 });
  if (!sites.length) throw new ToolError("There are no finished demos yet.");
  const named = o.name || (o.siteId && !/^c[a-z0-9]{20,}$/.test(o.siteId) ? o.siteId : undefined); // a name passed as the id
  const said = matchSite(sites, named) ?? (named ? null : matchSite(sites, o.text));
  if (said) return said;
  const list = sites.slice(0, 8).map((x) => x.name).join(", ");
  if (named) throw new ToolError(`There's no demo called "${named}". Your demos: ${list}.`);
  if (o.siteId) throw new ToolError(`No demo with that id. Your demos: ${list}.`);
  if (!o.strict || sites.length === 1) return sites[0];
  throw new ToolError(`Which demo should I change? Your demos: ${list}. Ask again with its name.`);
}

function demoTool(name: string, scope: "aston" | "jarvis"): ToolDefinition<z.infer<typeof demoSchema>> {
  return {
    name,
    agentScope: scope,
    activityLabel: "Checking ASTON's demos",
    description:
      "ASTON's website/app demos. list · details (versions, checks, placeholders) · open (show the preview — ONLY when the user asked to see it) · " +
      "walkthrough (open it with a guided walkthrough — only when asked) · changes (a revision → a new version; the old one stays) · approve (records approval of a version; never deploys). " +
      "Say which demo with `name` (the business name the user said) — for changes and approve this is required when there's more than one demo; never guess.",
    schema: demoSchema,
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["list", "details", "open", "walkthrough", "changes", "approve"] }, siteId: { type: "string" }, name: { type: "string", description: "The business / demo name the user mentioned" }, feedback: { type: "string" }, version: { type: "integer" } }, required: ["action"] },
    async execute(input, ctx) {
      if (input.action === "list") {
        const sites = await listSites(ctx.userId, 10);
        return { data: { demos: sites }, summary: `${sites.length} demo${sites.length === 1 ? "" : "s"}` };
      }
      const site = await pickSite(ctx.userId, { siteId: input.siteId, name: input.name, text: input.feedback, strict: input.action === "changes" || input.action === "approve" });
      if (input.action === "changes") {
        if (!input.feedback) throw new ToolError("Say what to change.");
        const job = await requestChanges(ctx.userId, site.id, input.feedback).catch((e) => { throw new ToolError((e as Error).message); });
        return { data: { job: { id: job.id, agent: job.agent, title: job.title, status: job.status }, note: `ASTON is making version ${site.currentVersion + 1}; version ${site.currentVersion} stays available.` }, summary: `Changes requested: ${site.name}` };
      }
      if (input.action === "approve") {
        const v = input.version ?? site.currentVersion;
        await approveVersion(ctx.userId, site.id, v).catch((e) => { throw new ToolError((e as Error).message); });
        return { data: { approved: v, note: "Recorded as approved. Nothing was deployed or published." }, summary: `Approved ${site.name} v${v}` };
      }
      const d = (await siteDetail(ctx.userId, site.id))!;
      if (input.action === "details") return { data: { demo: { ...d, token: undefined } }, summary: `${d.name} v${d.version}` };
      if (!d.url) throw new ToolError("That demo has no finished version to show.");
      return {
        data: { astonPreview: { siteId: d.id, version: d.version, url: d.url, title: d.name, mode: input.action === "walkthrough" ? "walk" : "open" }, sections: d.walkthrough.map((w) => w.title) },
        summary: input.action === "walkthrough" ? `Walkthrough: ${d.name}` : `Preview: ${d.name} v${d.version}`,
      };
    },
  };
}
export const astonDemosTool = demoTool("aston_demos", "aston");
export const jarvisAstonDemoTool = demoTool("aston_demo", "jarvis");

const planToolSchema = z.object({ action: z.enum(["today", "open", "history", "generate"]) });

function planTool(name: string, scope: "aston" | "jarvis"): ToolDefinition<z.infer<typeof planToolSchema>> {
  return {
    name,
    agentScope: scope,
    activityLabel: "Opening today's plan",
    description: "The daily marketing plan in ASTON's teleprompter. today (read today's plan; makes it if it's due and missing) · open (open the teleprompter) · history (previous days) · generate (make today's plan now if it doesn't exist or failed).",
    schema: planToolSchema,
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["today", "open", "history", "generate"] } }, required: ["action"] },
    async execute(input, ctx) {
      if (input.action === "history") {
        const ps = await listPlans(ctx.userId, 14);
        return { data: { plans: ps.map((p) => ({ date: p.date, niche: p.niche, status: p.status })) }, summary: `${ps.length} plan(s)` };
      }
      if (input.action === "open") return { data: { navigate: "/dashboard/teleprompter" }, summary: "Opening the teleprompter" };
      const date = todayIn(PLAN_TZ);
      let row = await getDb().marketingPlan.findUnique({ where: { userId_date: { userId: ctx.userId, date } } });
      if (input.action === "generate" || !row) row = await ensurePlan(ctx.userId, { force: input.action === "generate" });
      const v = planView(row);
      if (v.status !== "ready" || !v.plan) return { data: { date, status: v.status, error: v.error }, summary: v.status === "failed" ? `Plan failed: ${v.error}` : "Plan is being written" };
      return {
        data: { date, niche: v.niche, teleprompter: tpPath(row.shareToken), sections: planSections(v.plan).map((s) => ({ title: s.title, text: s.body.slice(0, 700) })) },
        summary: `Today's niche: ${v.niche}`,
      };
    },
  };
}
export const astonPlanTool = planTool("marketing_plan", "aston");
export const jarvisPlanTool = planTool("daily_plan", "jarvis");

const projectSchema = z.object({
  action: z.enum(["list", "open", "status", "change", "test", "fix", "prepare_deploy", "deploy", "submissions"]),
  name: z.string().trim().max(120).optional().describe("The website/business name the user mentioned. Omit for their latest website."),
  change: z.string().trim().max(3000).optional().describe("change: exactly what to change (e.g. 'make the typography more editorial', 'create a separate story page', 'fix all mobile layout issues')."),
  confirm: z.boolean().optional().describe("deploy: true ONLY when the user explicitly asked to deploy/publish this website now."),
});

async function pickProject(userId: string, name?: string) {
  const all = await getDb().astonProject.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 50 });
  if (!all.length) throw new ToolError("There are no website projects yet — ask ASTON to build one.");
  if (!name) return all[0];
  const hit = matchSite(all, name);
  if (!hit) throw new ToolError(`There's no website called "${name}". Your websites: ${all.slice(0, 8).map((p) => p.name).join(", ")}.`);
  return hit;
}

function projectTool(name: string, scope: "aston" | "jarvis"): ToolDefinition<z.infer<typeof projectSchema>> {
  return {
    name,
    agentScope: scope,
    activityLabel: "Checking ASTON's website projects",
    description:
      "ASTON's website projects (real coded sites built in ASTON's studio). list · open (show it in the studio: code + live preview — for 'open my latest website' / 'continue the last website project') · status (state, tests, tasks, what's left) · " +
      "change (any edit: 'change the hero', 'make it more cinematic', 'create a separate story page', 'improve the animations' → a new tested version; the old one stays) · test (run the browser tests again) · fix (fix what the tests found, e.g. 'fix all mobile layout issues') · " +
      "prepare_deploy (production checks + a zip, deploys nothing) · deploy (publish — ONLY when the user explicitly asked; set confirm true) · submissions (what visitors sent through the forms). Omit name for the latest website.",
    schema: projectSchema,
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["list", "open", "status", "change", "test", "fix", "prepare_deploy", "deploy", "submissions"] }, name: { type: "string" }, change: { type: "string" }, confirm: { type: "boolean" } }, required: ["action"] },
    async execute(input, ctx) {
      if (input.action === "list") {
        const ps = await listStudioProjects(ctx.userId, 12);
        return { data: { websites: ps.map((p) => ({ name: p.name, state: p.stateLabel, version: p.version, tests: p.tests, updated: p.updatedAt })) }, summary: `${ps.length} website project(s)` };
      }
      const p = await pickProject(ctx.userId, input.name);
      const studio = `/dashboard/aston/studio?project=${p.id}`;
      const err = (e: unknown) => { throw new ToolError((e as Error).message); };
      if (input.action === "open") return { data: { navigate: studio, opened: p.name, state: p.state }, summary: `Opening ${p.name} in ASTON's studio` };
      if (input.action === "change" || input.action === "fix") {
        const text = input.change ?? (input.action === "fix" ? "Fix every issue the browser tests found" : "");
        const { job } = await requestStudioAction(ctx.userId, p.id, input.action === "fix" && !input.change ? "fix" : "change", text || undefined).catch(err);
        return { data: { job: { id: job.id, agent: job.agent, title: job.title, status: job.status }, navigate: studio, note: `ASTON is making version ${p.currentVersion + 1} of ${p.name}; version ${p.currentVersion} stays. The studio is open so the user can watch.` }, summary: `${input.action === "fix" ? "Fixing" : "Changing"} ${p.name}` };
      }
      if (input.action === "test") {
        const { job } = await requestStudioAction(ctx.userId, p.id, "test").catch(err);
        return { data: { job: { id: job.id, agent: job.agent, title: job.title, status: job.status }, navigate: studio }, summary: `Re-testing ${p.name}` };
      }
      if (input.action === "prepare_deploy") {
        const c = await prepareDeploy(ctx.userId, p.id).catch(err);
        return { data: { ready: c.ready, checks: c.checks.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`), package: c.zipUrl, provider: c.provider, note: "Nothing was deployed." }, summary: c.ready ? `${p.name} is ready to deploy` : `${p.name}: ${c.checks.filter((x) => !x.ok).length} thing(s) to sort out before deploying` };
      }
      if (input.action === "deploy") {
        if (!input.confirm) throw new ToolError("Deploying publishes the website — only do it when the user explicitly asks to deploy (then pass confirm: true).");
        const d = await deployProject(ctx.userId, p.id).catch(err);
        return { data: { deployed: d }, summary: `Deployed ${p.name}: ${d.url}` };
      }
      const d = (await studioDetail(ctx.userId, p.id))!;
      if (input.action === "submissions") return { data: { submissions: d.submissions.slice(0, 20) }, summary: `${d.submissions.length} submission(s) for ${p.name}` };
      return {
        data: { name: d.name, state: d.stateLabel, note: d.stateNote, version: d.currentVersion, preview: d.preview, folder: d.dir, stack: d.stack, tests: d.tests, tasks: d.tasks, envVars: d.envVars.map((e) => e.name), deploy: d.deploy ?? "not deployed", pages: d.spec?.pages.map((x) => x.file) },
        summary: `${d.name}: ${d.stateLabel}`,
      };
    },
  };
}
export const astonProjectTool = projectTool("website_projects", "aston");
export const jarvisProjectTool = projectTool("website_project", "jarvis");
