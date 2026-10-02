import "server-only";
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types";
import { ToolError } from "./types";
import { getDb } from "@/lib/db";
import { RobinError, moveStage, resolveLead, setPriority } from "@/lib/robin/crm";
import { addFollowUpNote, completeFollowUp, followUpQueue, logInteraction, scheduleDemo, scheduleFollowUp, fmtWhen } from "@/lib/robin/engage";
import { followUpBreakdown } from "@/lib/robin/numbers";
import { createQuotation, decideQuotation } from "@/lib/robin/quotes";
import { convertToClient } from "@/lib/robin/clients";
import { robinOverview } from "@/lib/robin/overview";
import { robinAnalytics } from "@/lib/robin/analytics";
import { robinBriefing } from "@/lib/robin/briefing";
import { leadWorkspace } from "@/lib/robin/workspace";
import { attention } from "@/lib/robin/qualify";
import { CALL_OUTCOMES, CHANNELS, FOLLOWUP_ACTIONS, DEMO_TYPES, NODES, PRIORITIES, RANGES, STAGES, STAGE_LABEL, money, nodeOf, type Range } from "@/lib/robin/types";

/**
 * ROBIN's tools. They read and write the real CRM. Nothing here contacts a
 * business: Robin records what YOU did, schedules YOUR follow-ups, prepares
 * quotations from YOUR prices. Decisions (won/lost/do-not-contact) need the
 * user's explicit yes — the server refuses them otherwise.
 */

/** JSON schema for the model, from the same zod schema the tool validates with (no drift). */
function json(schema: z.ZodTypeAny): Record<string, unknown> {
  const d = (schema as any)._def;
  const desc = schema.description ? { description: schema.description } : {};
  switch (d.typeName) {
    case "ZodOptional": case "ZodNullable": case "ZodDefault": return { ...json(d.innerType), ...desc };
    case "ZodEffects": return { ...json(d.schema), ...desc };
    case "ZodString": return { type: "string", ...desc };
    case "ZodNumber": return { type: (d.checks ?? []).some((c: any) => c.kind === "int") ? "integer" : "number", ...desc };
    case "ZodBoolean": return { type: "boolean", ...desc };
    case "ZodEnum": return { type: "string", enum: [...d.values], ...desc };
    case "ZodUnion": return { type: "string", enum: d.options.flatMap((o: any) => o._def.values ?? []), ...desc };
    case "ZodArray": return { type: "array", items: json(d.type), ...desc };
    case "ZodObject": {
      const shape = d.shape();
      const required = Object.entries(shape).filter(([, v]) => !(v as z.ZodTypeAny).isOptional()).map(([k]) => k);
      return { type: "object", properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, json(v as z.ZodTypeAny)])), ...(required.length ? { required } : {}), ...desc };
    }
    default: return { ...desc };
  }
}

/** Robin's errors become plain answers for the model ("which one?", "needs confirmation"). */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof RobinError) throw new ToolError(e.code === "needs_confirmation" ? `${e.message} If the user asked for this, call again with confirmed: true (their instruction is the approval).` : e.message);
    throw e;
  }
}
const lead = (ctx: ToolContext, name: string) => run(() => resolveLead(ctx.userId, name));
const when = (s: string) => {
  const d = new Date(s);
  if (Number.isNaN(+d)) throw new ToolError(`"${s}" isn't a date/time I can use — give an ISO date-time with timezone offset.`);
  return d;
};
const card = (l: { number?: number | null; businessName: string; category: string | null; stage: string; priority: string; score: number; potentialValue: number | null; nextFollowUpAt: Date | null; phone: string | null; email: string | null }) => ({
  number: l.number ?? null, name: l.businessName, category: l.category, stage: STAGE_LABEL[l.stage as keyof typeof STAGE_LABEL] ?? l.stage, priority: l.priority, score: l.score,
  value: l.potentialValue, nextFollowUp: l.nextFollowUpAt?.toISOString() ?? null, hasPhone: !!l.phone, hasEmail: !!l.email,
});

// ---- robin_leads -----------------------------------------------------------
const leadsSchema = z.object({
  filter: z.enum(["hottest", "all", "uncontacted", "new", "contacted", "qualified", "interested", "follow_up", "demo", "proposal", "quotation", "negotiation", "won", "lost", "high_priority"]).optional().describe("Which leads. hottest = needs your attention most (default)."),
  search: z.string().max(80).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export const robinLeadsTool: ToolDefinition<z.infer<typeof leadsSchema>> = {
  name: "robin_leads",
  description: "List CRM leads from the real database: hottest (prioritised by Robin's workflow ranking), uncontacted, by pipeline stage, high priority, won/lost, or a name search. Returns name, category, stage, priority, score (workflow ranking, NOT a buying prediction), value, next follow-up.",
  schema: leadsSchema, inputSchema: json(leadsSchema), agentScope: "robin", activityLabel: "Reading the CRM",
  async execute(input, ctx) {
    const db = getDb();
    const f = input.filter ?? "hottest";
    const rows = await db.robinLead.findMany({
      where: {
        userId: ctx.userId,
        ...(input.search ? { businessName: { contains: input.search, mode: "insensitive" as const } } : {}),
        ...(f === "uncontacted" ? { lastContactAt: null, stage: { in: ["new", "qualified"] } } : {}),
        ...(f === "high_priority" ? { priority: "high", stage: { notIn: ["won", "lost", "not_interested", "do_not_contact"] } } : {}),
      },
      take: 1000,
    });
    const now = new Date();
    let list = rows;
    // a pipeline stage, or a narrower step inside one (demo / quotation / negotiation)
    const step = ({ demo: ["demo_scheduled", "demo_completed"], quotation: ["quotation_sent"], negotiation: ["negotiating"] } as Record<string, string[]>)[f];
    if (step) list = list.filter((l) => step.includes(l.stage));
    else if ((NODES as readonly { id: string }[]).some((n) => n.id === f)) list = list.filter((l) => nodeOf(l.stage) === f);
    if (f === "hottest") list = list.filter((l) => !["won", "lost", "not_interested", "do_not_contact"].includes(l.stage));
    list.sort((a, b) => attention(b, now) - attention(a, now));
    const out = list.slice(0, input.limit ?? 10).map(card);
    return { data: { filter: f, total: list.length, leads: out }, summary: `${list.length} lead${list.length === 1 ? "" : "s"} (${f.replace("_", " ")})` };
  },
};

// ---- robin_lead ------------------------------------------------------------
const leadSchema = z.object({ lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name, as the user said it") });
export const robinLeadTool: ToolDefinition<z.infer<typeof leadSchema>> = {
  name: "robin_lead",
  description: "Open one lead: contact details, qualification with its reasons, stage, last contact, next follow-up, demos, quotations, recent timeline.",
  schema: leadSchema, inputSchema: json(leadSchema), agentScope: "robin", activityLabel: "Opening the lead",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const w = await leadWorkspace(ctx.userId, l.id);
    return {
      data: {
        ...card(l), id: l.id, phone: l.phone, whatsapp: l.whatsapp, email: l.email, website: l.website, instagram: l.instagram, city: l.city,
        qualification: w.qualification.explanation, lastContact: l.lastContactAt?.toISOString() ?? null,
        demos: w.demos.slice(0, 3).map((d) => ({ at: d.scheduledAt.toISOString(), status: d.status })),
        quotations: w.quotations.slice(0, 3).map((q) => ({ number: q.number, total: q.total, status: q.status })),
        timeline: w.activities.slice(0, 8).map((a) => `${a.createdAt.toISOString().slice(0, 16)} ${a.detail}`),
        navigate: `/dashboard/robin?lead=${l.id}`,
      },
      summary: `Opened ${l.businessName}`,
    };
  },
};

// ---- robin_update_stage ------------------------------------------------------
const stageSchema = z.object({
  lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name, as the user said it"),
  stage: z.enum(STAGES),
  note: z.string().max(300).optional(),
  confirmed: z.boolean().optional().describe("true when the USER asked for this change (their instruction is the approval). Required for won, lost, do_not_contact. Never true for a change you decided on yourself."),
});
export const robinUpdateStageTool: ToolDefinition<z.infer<typeof stageSchema>> = {
  name: "robin_update_stage",
  description: "Move a lead to a pipeline stage (new, qualified, contacted, interested, follow_up, demo_scheduled, demo_completed, quotation_sent, negotiating, won, lost, not_interested, do_not_contact) when the user tells you to. Pass confirmed: true for won / lost / do-not-contact the user asked for. Records the stage history.",
  schema: stageSchema, inputSchema: json(stageSchema), agentScope: "robin", activityLabel: "Updating the pipeline",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const r = await run(() => moveStage(ctx.userId, l.id, input.stage, { source: "voice", note: input.note, confirm: input.confirmed }));
    return { data: { lead: l.businessName, from: r.from, to: input.stage, changed: r.changed }, summary: r.changed ? `${l.businessName} → ${STAGE_LABEL[input.stage]}` : `${l.businessName} is already ${STAGE_LABEL[input.stage]}` };
  },
};

// ---- robin_set_priority ------------------------------------------------------
const prioSchema = z.object({ lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name, as the user said it"), priority: z.enum([...PRIORITIES, "auto"]).describe("auto = back to Robin's own ranking") });
export const robinSetPriorityTool: ToolDefinition<z.infer<typeof prioSchema>> = {
  name: "robin_set_priority",
  description: "Manually override a lead's priority (high, medium, low, needs_review), or null to return to Robin's ranking.",
  schema: prioSchema, inputSchema: json(prioSchema), agentScope: "robin", activityLabel: "Setting priority",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const p = input.priority === "auto" ? null : input.priority;
    await run(() => setPriority(ctx.userId, l.id, p, "voice"));
    return { data: { lead: l.businessName, priority: p ?? "robin's ranking" }, summary: `${l.businessName}: ${p ?? "Robin's ranking"}` };
  },
};

// ---- follow-ups --------------------------------------------------------------
const fuSchema = z.object({
  lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name, as the user said it"),
  when: z.string().describe("ISO 8601 date-time WITH the user's timezone offset, e.g. 2026-10-02T16:00:00+05:30"),
  action: z.enum(FOLLOWUP_ACTIONS).optional(),
  notes: z.string().max(500).optional().describe("The note the user gave for this follow-up (what it's about) — pass it whenever they said one"),
});
export const robinScheduleFollowUpTool: ToolDefinition<z.infer<typeof fuSchema>> = {
  name: "robin_schedule_followup",
  description: "Schedule a follow-up task for the user with a lead (call, WhatsApp, email, Instagram, meeting). It's a reminder for the user — Robin does not contact anyone.",
  schema: fuSchema, inputSchema: json(fuSchema), agentScope: "robin", activityLabel: "Scheduling a follow-up",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const at = when(input.when);
    const f = await run(() => scheduleFollowUp(ctx.userId, l.id, { dueAt: at, action: input.action, notes: input.notes }, "voice"));
    return { data: { leadNumber: l.number, lead: l.businessName, followUpId: f.id, due: fmtWhen(at, ctx.timezone), action: f.action, note: f.notes, askForNote: !f.notes }, summary: `Follow-up with ${l.businessName} — ${fmtWhen(at, ctx.timezone)}` };
  },
};

const fuListSchema = z.object({ which: z.enum(["all", "today", "overdue", "upcoming"]).optional().describe("Which part of the queue (default: all)") });
export const robinFollowUpsTool: ToolDefinition<z.infer<typeof fuListSchema>> = {
  name: "robin_followups",
  description: "The follow-up queue: overdue, today, upcoming — each with the lead's number, name, action, time and the NOTE the user gave. `breakdown` is the ready-to-say summary: read it out (it lists every follow-up with its note).",
  schema: fuListSchema, inputSchema: json(fuListSchema), agentScope: "robin", activityLabel: "Checking follow-ups",
  async execute(input, ctx) {
    const q = await followUpQueue(ctx.userId);
    const row = (f: (typeof q.today)[number]) => ({ id: f.id, leadNumber: f.lead.number, lead: f.lead.businessName, action: f.action, due: fmtWhen(f.dueAt, q.tz), priority: f.priority, note: f.notes, interested: ["interested", "negotiating", "quotation_sent", "demo_completed"].includes(f.lead.stage) });
    const breakdown = followUpBreakdown(q, { which: input.which ?? "all" });
    return { data: { breakdown, overdue: q.overdue.map(row), today: q.today.map(row), upcoming: q.upcoming.slice(0, 10).map(row), navigate: "/dashboard/robin?view=followups" }, summary: `${q.today.length} today · ${q.overdue.length} overdue` };
  },
};

const fuDoneSchema = z.object({ lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name, as the user said it"), notes: z.string().max(500).optional() });
export const robinCompleteFollowUpTool: ToolDefinition<z.infer<typeof fuDoneSchema>> = {
  name: "robin_complete_followup",
  description: "Mark the lead's next pending follow-up as done. Afterwards, ask whether to schedule the next one.",
  schema: fuDoneSchema, inputSchema: json(fuDoneSchema), agentScope: "robin", activityLabel: "Completing the follow-up",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const f = await getDb().robinFollowUp.findFirst({ where: { userId: ctx.userId, leadId: l.id, status: "pending" }, orderBy: { dueAt: "asc" } });
    if (!f) throw new ToolError(`${l.businessName} has no pending follow-up.`);
    await run(() => completeFollowUp(ctx.userId, f.id, { notes: input.notes }, "voice"));
    return { data: { lead: l.businessName, completed: true, askNext: "Follow-up completed. Would you like to schedule the next one?" }, summary: `Follow-up with ${l.businessName} completed` };
  },
};

// ---- notes ---------------------------------------------------------------------
const noteSchema = z.object({ lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name"), text: z.string().min(1).max(1000).describe("The note, in the user's words") });
export const robinNoteTool: ToolDefinition<z.infer<typeof noteSchema>> = {
  name: "robin_note",
  description: "Take down a note the user tells you about a lead. It's saved on the lead's next follow-up (so it's read back with the follow-ups), or on the lead when none is scheduled.",
  schema: noteSchema, inputSchema: json(noteSchema), agentScope: "robin", activityLabel: "Taking a note",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const r = await run(() => addFollowUpNote(ctx.userId, { leadId: l.id, text: input.text }, "voice"));
    return { data: { leadNumber: l.number, lead: l.businessName, savedOn: r.on, followUpDue: r.followUp ? fmtWhen(r.followUp.dueAt, ctx.timezone) : null }, summary: `Note on ${l.businessName}` };
  },
};

// ---- interactions --------------------------------------------------------------
const logSchema = z.object({
  lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name, as the user said it"),
  channel: z.enum(CHANNELS),
  outcome: z.union([z.enum(CALL_OUTCOMES), z.enum(["replied", "no_reply", "sent"])]).optional(),
  direction: z.enum(["outbound", "inbound"]).optional().describe("inbound = they replied / called you"),
  notes: z.string().max(1000).optional(),
});
export const robinLogInteractionTool: ToolDefinition<z.infer<typeof logSchema>> = {
  name: "robin_log_interaction",
  description: "Record a call/WhatsApp/Instagram/email the USER says already happened, with its outcome. Never use it for something that didn't happen. Updates stage (contacted/interested/not interested).",
  schema: logSchema, inputSchema: json(logSchema), agentScope: "robin", activityLabel: "Logging the interaction",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const r = await run(() => logInteraction(ctx.userId, l.id, { channel: input.channel, outcome: input.outcome ?? null, direction: input.direction, notes: input.notes, status: input.direction === "inbound" ? "received" : "logged" }, "voice"));
    return { data: { lead: l.businessName, logged: true, stage: STAGE_LABEL[r.lead.stage as keyof typeof STAGE_LABEL] }, summary: `${input.channel} with ${l.businessName} logged` };
  },
};

// ---- demos ---------------------------------------------------------------------
const demoSchema = z.object({ lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name, as the user said it"), when: z.string().describe("ISO 8601 with timezone offset"), demoType: z.enum(DEMO_TYPES).optional(), notes: z.string().max(500).optional() });
export const robinScheduleDemoTool: ToolDefinition<z.infer<typeof demoSchema>> = {
  name: "robin_schedule_demo",
  description: "Schedule a demo with a lead (online, in person, phone).",
  schema: demoSchema, inputSchema: json(demoSchema), agentScope: "robin", activityLabel: "Scheduling the demo",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const at = when(input.when);
    await run(() => scheduleDemo(ctx.userId, l.id, { at, demoType: input.demoType, notes: input.notes }, "voice"));
    return { data: { lead: l.businessName, at: fmtWhen(at, ctx.timezone) }, summary: `Demo with ${l.businessName} — ${fmtWhen(at, ctx.timezone)}` };
  },
};

// ---- quotations ------------------------------------------------------------------
const quoteSchema = z.object({
  lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name, as the user said it"),
  items: z.array(z.object({ service: z.string().min(1).max(120), price: z.number().min(0).optional().describe("ONLY if the user said a price; otherwise omit and the price from Settings is used"), quantity: z.number().min(1).optional(), description: z.string().max(300).optional() })).min(1).max(10),
  discount: z.number().min(0).optional(),
});
export const robinQuotationTool: ToolDefinition<z.infer<typeof quoteSchema>> = {
  name: "robin_prepare_quotation",
  description: "Prepare a DRAFT quotation for a lead from the user's services. Prices come from the user's Settings unless the user states one — never invent a price. It is not sent; the user reviews it and sends it from Robin.",
  schema: quoteSchema, inputSchema: json(quoteSchema), agentScope: "robin", activityLabel: "Preparing the quotation",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const q = await run(() => createQuotation(ctx.userId, l.id, { items: input.items.map((i) => ({ service: i.service, unitPrice: i.price ?? null, quantity: i.quantity, description: i.description })), discount: input.discount }, "voice"));
    return { data: { lead: l.businessName, number: q.number, total: money(q.total, q.currency), status: "draft — not sent", items: q.items.map((i) => `${i.service} ${money(i.amount, q.currency)}`), navigate: `/dashboard/robin?lead=${l.id}` }, summary: `Draft ${q.number} for ${l.businessName}: ${money(q.total, q.currency)}` };
  },
};

// ---- the user's decisions on a deal (their instruction is the approval)
const decideSchema = z.object({ lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name, as the user said it"), decision: z.enum(["accepted", "rejected"]), note: z.string().max(300).optional() });
export const robinQuotationDecisionTool: ToolDefinition<z.infer<typeof decideSchema>> = {
  name: "robin_quotation_decision",
  description: "Record that the lead ACCEPTED or REJECTED its latest quotation — only when the user tells you so. After an acceptance, offer to make them a client.",
  schema: decideSchema, inputSchema: json(decideSchema), agentScope: "robin", activityLabel: "Updating the quotation",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const q = await getDb().robinQuotation.findFirst({ where: { userId: ctx.userId, leadId: l.id, status: { in: ["draft", "sent", "expired", "accepted", "rejected"] } }, orderBy: { createdAt: "desc" } });
    if (!q) throw new ToolError(`${l.businessName} has no quotation yet.`);
    await run(() => decideQuotation(ctx.userId, q.id, input.decision, { confirm: true, note: input.note }, "voice"));
    return { data: { lead: l.businessName, quotation: q.number, status: input.decision, total: money(q.total, q.currency) }, summary: `${q.number} ${input.decision}` };
  },
};
const convertSchema = z.object({ lead: z.string().min(1).max(120).describe("The lead's number (e.g. \"7\") or business name, as the user said it"), amount: z.number().min(0).optional().describe("Only if the user states the deal amount; otherwise the accepted quotation's total is used") });
export const robinConvertClientTool: ToolDefinition<z.infer<typeof convertSchema>> = {
  name: "robin_convert_client",
  description: "Make a lead a client (marks it won) when the user tells you to. Uses the accepted quotation's total as the amount unless the user gives one. Keeps the lead's whole history.",
  schema: convertSchema, inputSchema: json(convertSchema), agentScope: "robin", activityLabel: "Converting to a client",
  async execute(input, ctx) {
    const l = await lead(ctx, input.lead);
    const r = await run(() => convertToClient(ctx.userId, l.id, { confirm: true, amount: input.amount ?? null }, "voice"));
    return { data: { lead: l.businessName, client: true, amount: money(r.client.amount, r.client.currency), alreadyClient: !r.created }, summary: `${l.businessName} is a client` };
  },
};

// ---- analytics / briefing ----------------------------------------------------------
const anSchema = z.object({ range: z.enum(RANGES).optional(), from: z.string().optional(), to: z.string().optional() });
export const robinAnalyticsTool: ToolDefinition<z.infer<typeof anSchema>> = {
  name: "robin_analytics",
  description: "Sales analytics for a period (today, 7d, 30d, 90d, custom from/to YYYY-MM-DD): leads, qualified, contact/response/interested/demo/quotation/conversion rates (with counts), won, lost, revenue, received, average deal, follow-up completion.",
  schema: anSchema, inputSchema: json(anSchema), agentScope: "robin", activityLabel: "Calculating analytics",
  async execute(input, ctx) {
    const a = await robinAnalytics(ctx.userId, (input.range ?? "30d") as Range, { from: input.from, to: input.to });
    return { data: { range: a.range, totals: { ...a.totals, revenue: money(a.totals.revenue, a.currency), received: money(a.totals.received, a.currency) }, rates: a.rates, funnel: a.funnel, followUps: a.followUps }, summary: `Analytics ${a.range.from} → ${a.range.to}` };
  },
};

const briefSchema = z.object({ detail: z.enum(["short", "full"]).optional().describe("short (default) or full") });
export const robinBriefingTool: ToolDefinition<z.infer<typeof briefSchema>> = {
  name: "robin_briefing",
  description: "Today's sales briefing from the CRM: new Darwin leads, high-priority leads, calls, follow-ups, demos, quotations awaiting response, the next action, yesterday's activity.",
  schema: briefSchema, inputSchema: json(briefSchema), agentScope: "robin", activityLabel: "Preparing your briefing",
  async execute(_i, ctx) {
    const b = await robinBriefing(ctx.userId);
    return { data: b, summary: "Sales briefing" };
  },
};

// ---- for JARVIS: "ask Robin …" / "open Robin" --------------------------------------
const reportSchema = z.object({ about: z.string().max(200).optional().describe("What the user asked Robin, e.g. 'qualified leads', 'won this month'") });
export const robinReportTool: ToolDefinition<z.infer<typeof reportSchema>> = {
  name: "robin_report",
  description: "Ask ROBIN (the sales & CRM agent) about the sales pipeline: lead counts per stage, follow-ups due, demos, quotations, won clients, revenue, conversion (this month). Answer as 'Robin reports …'.",
  schema: reportSchema, inputSchema: json(reportSchema), activityLabel: "Asking Robin",
  async execute(_i, ctx) {
    const [ov, month] = await Promise.all([robinOverview(ctx.userId), robinAnalytics(ctx.userId, "30d")]);
    return {
      data: {
        perStage: Object.fromEntries(ov.nodes.map((n) => [n.label, { leads: n.count, value: money(n.value, ov.currency) }])),
        counts: { ...ov.counts, pipelineValue: money(ov.counts.pipelineValue, ov.currency), revenueWon: money(ov.counts.revenueWon, ov.currency) },
        today: ov.today, next: ov.next,
        last30Days: { won: month.totals.won, revenue: money(month.totals.revenue, month.currency), conversionRate: month.rates.conversion },
        stages: NODES.map((n) => n.label),
      },
      summary: "Robin's pipeline report",
    };
  },
};

const openSchema = z.object({ lead: z.string().max(120).optional(), view: z.enum(["pipeline", "funnel", "revenue", "followups", "quotations", "clients", "analytics"]).optional() });
export const robinOpenTool: ToolDefinition<z.infer<typeof openSchema>> = {
  name: "robin_open",
  description: "Open ROBIN's sales command center (optionally a lead or a view: pipeline, funnel, revenue, followups, quotations, clients, analytics).",
  schema: openSchema, inputSchema: json(openSchema), activityLabel: "Opening Robin",
  async execute(input, ctx) {
    let q = input.view ? `?view=${input.view}` : "";
    if (input.lead) { const l = await lead(ctx, input.lead); q = `?lead=${l.id}`; }
    return { data: { navigate: `/dashboard/robin${q}` }, summary: "Opening Robin" };
  },
};
