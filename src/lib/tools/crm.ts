import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getDb } from "@/lib/db";
import { CrmError, createProspect, findProspects, queueSearch, updateProspect, finderStatus } from "@/lib/prospects/service";
import { STATUSES, STATUS_LABEL, LOST_REASONS, MAX_SCORE_NOTE } from "@/lib/prospects/rules";

/**
 * JARVIS's own CRM tools (no separate agent). JARVIS finds leads on Google
 * Maps through the JARVIS Operator on the user's laptop, and keeps the CRM up
 * to date itself.
 */
const wrap = async <T,>(f: () => Promise<T>) => { try { return await f(); } catch (e) { if (e instanceof CrmError) throw new ToolError(e.message); throw e; } };

const findSchema = z.object({
  category: z.string().min(1).max(80).describe("What kind of business, e.g. gyms, cafés, dental clinics."),
  area: z.string().min(1).max(80).describe("The area, e.g. Indiranagar, HSR Layout."),
  city: z.string().max(60).optional().describe("City; defaults to the CRM's city (Bengaluru)."),
  limit: z.number().int().min(1).max(30).optional().describe("How many NEW leads to add (max 30 a day)."),
});
export const crmFindLeadsTool: ToolDefinition<z.infer<typeof findSchema>> = {
  name: "crm_find_leads",
  description:
    "Find new leads on Google Maps and put them in JARVIS's CRM by itself. JARVIS opens Google Maps in the visible browser on the user's laptop " +
    "(with a 'JARVIS is working' label), reads each listing, and keeps only businesses with no website (or a broken/outdated one). " +
    "Use for 'find gyms without websites in Indiranagar', 'get me 20 salon leads in HSR'. It runs in the background; results appear in the CRM live.",
  schema: findSchema,
  inputSchema: { type: "object", properties: { category: { type: "string" }, area: { type: "string" }, city: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 30 } }, required: ["category", "area"] },
  agentScope: "jarvis",
  activityLabel: "Starting a Google Maps search",
  async execute(i, ctx) {
    const r = await wrap(() => queueSearch(ctx.userId, { ...i, trigger: "jarvis" }));
    const s = r.search;
    const where = `${s.category} in ${s.area}, ${s.city}`;
    const note = !r.paired
      ? "The laptop isn't connected yet: the user needs to open JARVIS → CRM and press 'Connect this laptop' once (with npm run local running). The search waits until then."
      : !r.finderOnline
        ? "The JARVIS Operator on the laptop isn't running right now (it starts with npm run local). The search waits and starts when it's back."
        : "The operator on the laptop is picking it up now.";
    return { data: { searchId: s.id, query: where, limit: s.limit, note, openCrm: "/dashboard/crm" }, summary: `Google Maps search queued: ${where} (up to ${s.limit} new leads). ${note}` };
  },
};

const listSchema = z.object({
  query: z.string().max(120).optional().describe("Business name, area, category or phone."),
  status: z.enum(STATUSES).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export const crmLeadsTool: ToolDefinition<z.infer<typeof listSchema>> = {
  name: "crm_leads",
  description: "Look up leads in JARVIS's CRM: by name/area/category/phone, or by pipeline status (new, called, not_reachable, callback, interested, demo_booked, demo_done, quotation_sent, negotiating, won, lost). Also answers 'who do I call today?' (status new + next action due).",
  schema: listSchema,
  inputSchema: { type: "object", properties: { query: { type: "string" }, status: { type: "string", enum: [...STATUSES] }, limit: { type: "integer", minimum: 1, maximum: 50 } } },
  agentScope: "jarvis",
  activityLabel: "Checking the CRM",
  async execute(i, ctx) {
    const rows = await findProspects(ctx.userId, { q: i.query, status: i.status, take: i.limit ?? 15 });
    const f = await finderStatus(ctx.userId);
    return {
      data: {
        total: rows.length, laptopConnected: f.paired, operatorOnline: f.online, scoreNote: MAX_SCORE_NOTE,
        leads: rows.map((p) => ({ id: p.id, name: p.businessName, category: p.category, area: p.area, phone: p.phone, status: STATUS_LABEL[p.status as keyof typeof STATUS_LABEL] ?? p.status,
          score: p.leadScore, website: p.websiteStatus, rating: p.rating, reviews: p.reviews, next: p.nextAction, nextAt: p.nextActionAt, lostReason: p.lostReason, mapsUrl: p.mapsUrl })),
      },
      summary: rows.length ? `${rows.length} lead${rows.length === 1 ? "" : "s"} in the CRM.` : "No matching leads in the CRM.",
    };
  },
};

const updSchema = z.object({
  id: z.string().optional().describe("Lead id (from crm_leads)."),
  name: z.string().max(200).optional().describe("Or the business name, if the id isn't known."),
  status: z.enum(STATUSES).optional(),
  lostReason: z.enum(LOST_REASONS).optional().describe("Required when status is lost."),
  nextAction: z.string().max(200).optional(), nextActionAt: z.string().max(40).optional().describe("ISO date/time of the next action."),
  note: z.string().max(4000).optional(),
  contactPerson: z.string().max(120).optional(), whatsapp: z.string().max(30).optional(), decisionMaker: z.string().max(120).optional(),
  budgetRange: z.string().max(80).optional(), interestedServices: z.array(z.string().max(80)).max(20).optional(), value: z.number().nonnegative().optional(),
});
export const crmUpdateTool: ToolDefinition<z.infer<typeof updSchema>> = {
  name: "crm_update",
  description:
    "Update a lead in JARVIS's CRM: move it through the pipeline, add a note, set the next action/date, contact person, interested services, budget, value. " +
    "Rules: Lost needs a reason; 'not reachable' 3 times moves it to Lost; open leads always keep a next action. Use after calls, messages or meetings, or when the user tells you about a lead.",
  schema: updSchema,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" }, name: { type: "string" }, status: { type: "string", enum: [...STATUSES] }, lostReason: { type: "string", enum: [...LOST_REASONS] },
      nextAction: { type: "string" }, nextActionAt: { type: "string" }, note: { type: "string" }, contactPerson: { type: "string" }, whatsapp: { type: "string" },
      decisionMaker: { type: "string" }, budgetRange: { type: "string" }, interestedServices: { type: "array", items: { type: "string" } }, value: { type: "number" },
    },
  },
  agentScope: "jarvis",
  activityLabel: "Updating the CRM",
  async execute(i, ctx) {
    let id = i.id;
    if (!id && i.name) {
      const hits = await getDb().prospect.findMany({ where: { userId: ctx.userId, businessName: { contains: i.name.trim(), mode: "insensitive" } }, take: 3, select: { id: true, businessName: true } });
      if (hits.length > 1) throw new ToolError(`More than one lead matches "${i.name}": ${hits.map((h) => h.businessName).join("; ")}. Which one?`);
      id = hits[0]?.id;
    }
    if (!id) throw new ToolError(i.name ? `No lead called "${i.name}" in the CRM.` : "Which lead? Give its name or id.");
    const at = i.nextActionAt ? new Date(i.nextActionAt) : undefined;
    if (at && Number.isNaN(at.getTime())) throw new ToolError("That next-action date isn't a date.");
    const { id: _i, name: _n, nextActionAt: _a, ...rest } = i;
    const p = await wrap(() => updateProspect(ctx.userId, id!, { ...rest, ...(at ? { nextActionAt: at } : {}) }, "jarvis"));
    return { data: { id: p.id, name: p.businessName, status: p.status, lostReason: p.lostReason, next: p.nextAction, nextAt: p.nextActionAt }, summary: `Updated ${p.businessName} (${STATUS_LABEL[p.status as keyof typeof STATUS_LABEL] ?? p.status}).` };
  },
};

const addSchema = z.object({
  businessName: z.string().min(1).max(200), category: z.string().max(80).optional(), phone: z.string().max(30).optional(), contactPerson: z.string().max(120).optional(),
  area: z.string().max(80).optional(), city: z.string().max(60).optional(), website: z.string().max(300).optional(), instagram: z.string().max(200).optional(), notes: z.string().max(2000).optional(),
});
export const crmAddTool: ToolDefinition<z.infer<typeof addSchema>> = {
  name: "crm_add",
  description: "Add one lead to JARVIS's CRM by hand (when the user tells you about a business). Duplicates by phone number are refused. For finding leads, use crm_find_leads.",
  schema: addSchema,
  inputSchema: { type: "object", properties: { businessName: { type: "string" }, category: { type: "string" }, phone: { type: "string" }, contactPerson: { type: "string" }, area: { type: "string" }, city: { type: "string" }, website: { type: "string" }, instagram: { type: "string" }, notes: { type: "string" } }, required: ["businessName"] },
  agentScope: "jarvis",
  activityLabel: "Adding to the CRM",
  async execute(i, ctx) {
    const p = await wrap(() => createProspect(ctx.userId, i, "jarvis"));
    return { data: { id: p.id, name: p.businessName, score: p.leadScore, status: p.status }, summary: `Added ${p.businessName} to the CRM.` };
  },
};

const planSchema = z.object({
  names: z.array(z.string().max(200)).max(30).optional().describe("Business names to call; omit for today's call list."),
  limit: z.number().int().min(1).max(60).optional(),
});
export const crmPlanCallsTool: ToolDefinition<z.infer<typeof planSchema>> = {
  name: "crm_plan_calls",
  description:
    "Plan prospect calls (JARVIS phones them from the user's own number through Windows Phone Link, as an AI assistant). This only PLANS a batch: nothing is dialled until the user presses Approve in CRM → Calls — you cannot approve it. " +
    "Use for 'call today's leads', 'call the 12 new gyms', 'ring Posh & Pixie'. Respects calling hours, the daily limit, do-not-contact, one try a day and 3 tries total.",
  schema: planSchema,
  inputSchema: { type: "object", properties: { names: { type: "array", items: { type: "string" } }, limit: { type: "integer", minimum: 1, maximum: 60 } } },
  agentScope: "jarvis",
  activityLabel: "Planning calls",
  async execute(i, ctx) {
    let ids: string[] | undefined;
    if (i.names?.length) {
      const rows = await getDb().prospect.findMany({ where: { userId: ctx.userId, OR: i.names.map((n) => ({ businessName: { contains: n.trim(), mode: "insensitive" as const } })) }, select: { id: true }, take: 60 });
      if (!rows.length) throw new ToolError(`None of those businesses are in the CRM.`);
      ids = rows.map((r) => r.id);
    }
    const { planCalls, getSettings } = await import("@/lib/calls/service");
    const r = await planCalls(ctx.userId, { prospectIds: ids, limit: i.limit });
    const s = await getSettings(ctx.userId);
    const note = r.batchId
      ? `Waiting for the user's approval in CRM → Calls.${s.enabled ? "" : " Calling is switched off there too — they need to turn it on."} Then JARVIS's calls window on the laptop (it opens by itself) dials during ${s.hoursFrom}–${s.hoursTo}.`
      : "Nothing to call.";
    return { data: { planned: r.calls.map((c) => c.name), skipped: r.skipped.slice(0, 15), note }, summary: r.batchId ? `Planned ${r.calls.length} call${r.calls.length === 1 ? "" : "s"} — approve them in CRM → Calls.` : "No leads can be called right now." };
  },
};

const callMeSchema = z.object({
  about: z.string().max(200).optional().describe("Optional: what the call is about, if the user said (e.g. 'today's status')."),
});
export const callMeTool: ToolDefinition<z.infer<typeof callMeSchema>> = {
  name: "call_me",
  description:
    "Phone the USER now: 'give me a test call', 'call me', 'ring me', 'call me and tell me the status'. Uses how they set up Phone calls in Settings " +
    "(through the laptop = JARVIS talks with them on the call; spare Android = WhatsApp message + call; spare iPhone = email + Shortcut call). Never for calling anyone else.",
  schema: callMeSchema,
  inputSchema: { type: "object", properties: { about: { type: "string" } } },
  agentScope: "jarvis",
  activityLabel: "Calling you",
  async execute(i, ctx) {
    const { queueCallMe, PhoneError } = await import("@/lib/phone/service");
    let r;
    try { r = await queueCallMe(ctx.userId, i.about ?? null); }
    catch (e) { if (e instanceof PhoneError) throw new ToolError(`${e.message} (Settings → Phone calls)`); throw e; }
    const how = r.mode === "laptop"
      ? "The laptop rings them through Phone Link within about 20 seconds — JARVIS speaks first if they stay quiet. JARVIS opens its Calls window on the laptop by itself (JARVIS must be running there)."
      : r.mode === "iphone"
        ? "JARVIS emails the spare iPhone within a minute and its Shortcut rings them."
        : r.online ? "The spare phone rings them within about 15 seconds." : "The spare phone isn't checking in right now, so the call waits until it does (Termux script running, Wireless debugging on).";
    return { data: { queued: true, mode: r.mode, enabled: r.enabled, note: r.enabled ? how : "Phone calls are switched off in Settings → Phone calls — turn them on." }, summary: "Calling you." };
  },
};

const computerSchema = z.object({
  goal: z.string().min(3).max(1000).describe("Exactly what to do on the laptop, with the details the user gave (app, site, words to type)."),
});
export const computerTaskTool: ToolDefinition<z.infer<typeof computerSchema>> = {
  name: "computer_task",
  description:
    "Do something on the user's LAPTOP SCREEN for them: JARVIS (its helper on the laptop) looks at the screen and clicks / types / scrolls in any app or the browser, step by step, " +
    "with a 'JARVIS is working' frame on screen and a Stop button. Use for 'in Chrome, search YouTube for lo-fi and play the first video', 'open Notepad and write …', " +
    "'go to my Gmail and open the latest email from Ravi', 'change the wallpaper', 'in Excel, add a column…'. It asks the user before sending, posting, paying or deleting, " +
    "and never types passwords or OTPs. Needs JARVIS running on the Windows laptop.",
  schema: computerSchema,
  inputSchema: { type: "object", properties: { goal: { type: "string" } }, required: ["goal"] },
  agentScope: "jarvis",
  activityLabel: "Working on your laptop",
  async execute(i, ctx) {
    const { queueTask, laptopOnline, DesktopError } = await import("@/lib/desktop/service");
    if (!(await laptopOnline(ctx.userId))) throw new ToolError("JARVIS's helper on the laptop isn't online, so I can't work on the screen. Start JARVIS on the laptop (start-jarvis.cmd) and make sure it's connected (CRM → Google Maps finder → Connect this laptop).");
    try {
      const t = await queueTask(ctx.userId, i.goal);
      return { data: { taskId: t.id, note: "Started on your laptop — JARVIS picks it up within a few seconds and works on screen (Stop on the bar or Ctrl+Alt+Backspace stops it). If nothing happens, JARVIS isn't running on the laptop (start-jarvis.cmd) or the laptop isn't connected (CRM → Connect this laptop)." }, summary: "Working on your laptop." };
    } catch (e) { if (e instanceof DesktopError) throw new ToolError(e.message); throw e; }
  },
};
