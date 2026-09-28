import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { getDb } from "@/lib/db";
import { recordActivity, forgetActivity } from "@/lib/activity/record";
import { isDate, parseHistoryRange, validTz, yesterdayIn, dayLabel } from "@/lib/activity/dates";
import { loadBriefing } from "@/lib/briefing/server";

/**
 * activity — JARVIS's memory of what you did. Log things done outside JARVIS
 * (calls, DMs, meetings, proposals, decisions), forget an event, or read the
 * real recorded history to answer "what did I do…" questions.
 */
const schema = z.object({
  action: z.enum(["log", "forget", "history"]).describe(
    "log: record something the user did or decided (a call, DM, client meeting, proposal/quotation, sale, decision, plan). " +
    "forget: delete one event (the latest, or one matching `match`). history: recorded activity for a day or range.",
  ),
  category: z.enum(["business", "communication", "development", "marketing", "decision", "task", "conversation", "file"]).nullable().optional()
    .describe("log: business (sales, proposals, clients), communication (calls, DMs, emails), decision, development, marketing, task, conversation, file."),
  what: z.string().max(300).nullable().optional().describe("log: what happened, e.g. 'Called Iron Temple Gym about a website'."),
  outcome: z.string().max(300).nullable().optional().describe("log: the result, e.g. 'Interested — send quotation Monday'."),
  project: z.string().max(80).nullable().optional(),
  match: z.string().max(120).nullable().optional().describe("forget: words from the event to remove; omit for the most recent event."),
  id: z.string().max(40).nullable().optional().describe("forget: exact event id if known."),
  from: z.string().nullable().optional().describe("history: start date YYYY-MM-DD (default yesterday)."),
  to: z.string().nullable().optional().describe("history: end date YYYY-MM-DD (default = from)."),
  phrase: z.string().max(120).nullable().optional().describe("history: the user's own words, e.g. 'last week', 'September 25', 'yesterday'."),
});
type Input = z.infer<typeof schema>;

export const activityTool: ToolDefinition<Input> = {
  name: "activity",
  description:
    "The user's activity history, recorded automatically across JARVIS, DARWIN, EV, ULTRON and Humanoid View. " +
    "Use 'history' for ANY question about what the user did / worked on / what happened / problems / unfinished work on a past day or range " +
    "(yesterday, a date, last week, last N days) — answer only from what it returns, never invent. " +
    "Use 'log' when the user tells you about something done outside JARVIS (a call, a DM, a client meeting, a proposal or quotation sent, a sale, a decision or plan). " +
    "Never log passwords, keys, tokens or private personal details. Use 'forget' when the user says 'forget this event' (latest) or names one.",
  schema,
  activityLabel: "Checking your activity history",
  async execute(input, ctx) {
    const tz = validTz(ctx.timezone);
    if (input.action === "log") {
      if (!input.what?.trim()) throw new ToolError("Tell me what to log.");
      const category = input.category ?? "business";
      const id = await recordActivity(ctx.userId, {
        category, agent: "JARVIS", source: "user", action: input.what, result: input.outcome ?? null,
        status: "success", importance: category === "decision" ? 4 : 3, project: input.project ?? null,
      });
      if (!id) throw new ToolError("Couldn't save that to your history.");
      return { data: { logged: true, id }, summary: `Logged: ${input.what.slice(0, 80)}` };
    }
    if (input.action === "forget") {
      const db = getDb();
      let target: { id: string; action: string } | null = null;
      if (input.id) target = await db.activityEvent.findFirst({ where: { id: input.id, userId: ctx.userId }, select: { id: true, action: true } });
      else if (input.match?.trim()) {
        target = await db.activityEvent.findFirst({
          where: { userId: ctx.userId, timestamp: { gte: new Date(Date.now() - 60 * 86_400_000) }, OR: [{ action: { contains: input.match.trim(), mode: "insensitive" } }, { result: { contains: input.match.trim(), mode: "insensitive" } }] },
          orderBy: { timestamp: "desc" }, select: { id: true, action: true },
        });
      } else {
        target = await db.activityEvent.findFirst({ where: { userId: ctx.userId }, orderBy: { timestamp: "desc" }, select: { id: true, action: true } });
      }
      if (!target || !(await forgetActivity(ctx.userId, target.id))) return { data: { forgotten: false }, summary: "I couldn't find that event in your history." };
      return { data: { forgotten: true, event: target.action }, summary: `Forgotten: ${target.action.slice(0, 80)}` };
    }
    // history
    let range = input.phrase ? parseHistoryRange(`what did i do ${input.phrase}`, tz) : null;
    if (!range && input.from && isDate(input.from)) {
      const to = input.to && isDate(input.to) && input.to >= input.from ? input.to : input.from;
      range = { from: input.from, to, label: to === input.from ? dayLabel(input.from, { weekday: true }) : `${dayLabel(input.from)} – ${dayLabel(to)}`, kind: to === input.from ? "day" : "range" };
    }
    if (!range) { const y = yesterdayIn(tz); range = { from: y, to: y, label: "Yesterday", kind: "day" }; }
    ctx.activity(`Reading your history for ${range.label.toLowerCase()}…`);
    const b = await loadBriefing(ctx.userId, range, tz);
    return {
      data: {
        period: `${b.dateLabel} (${range.from}${range.to !== range.from ? ` to ${range.to}` : ""})`,
        briefing: b.paragraphs,
        metrics: Object.fromEntries(b.metrics.map((m) => [m.label, m.value])),
        activeAgents: b.agents.filter((a) => a.status === "active").map((a) => `${a.name} (${a.count})`),
        byTimeOfDay: b.timeline,
        ...b.daily,
        events: b.events.slice(0, 60).map((e) => ({ time: e.time, agent: e.agent, category: e.category, what: e.action, result: e.result, status: e.status })),
        note: b.hasData ? undefined : "No recorded activity in this period.",
      },
      summary: b.hasData ? `${b.eventCount} recorded events for ${b.dateLabel}.` : `No recorded activity for ${b.dateLabel}.`,
    };
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["log", "forget", "history"] },
      category: { type: "string", enum: ["business", "communication", "development", "marketing", "decision", "task", "conversation", "file"] },
      what: { type: "string" }, outcome: { type: "string" }, project: { type: "string" },
      match: { type: "string" }, id: { type: "string" },
      from: { type: "string" }, to: { type: "string" }, phrase: { type: "string" },
    },
    required: ["action"],
  },
};
