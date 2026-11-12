import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";

/**
 * The Client Portal (Infinity Web & Apps): JARVIS reads it as the user's
 * portal admin, and posts a message to a client only when the user asks.
 */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  const { PortalError } = await import("@/lib/portal/service");
  try { return await fn(); } catch (e) {
    if (e instanceof PortalError) throw new ToolError(e.message);
    const m = (e as Error)?.message ?? "";
    if (/ENOTFOUND|ECONNREFUSED|timeout|password authentication|getaddrinfo/i.test(m)) throw new ToolError("I couldn't reach the Client Portal's database right now (check the internet / CLIENT_PORTAL_DATABASE_URL).");
    throw e;
  }
}

const overviewSchema = z.object({ focus: z.enum(["all", "money", "messages", "projects"]).optional().describe("What the user asked about, if specific.") });
export const portalOverviewTool: ToolDefinition<z.infer<typeof overviewSchema>> = {
  name: "portal_overview",
  description: "The Client Portal at a glance: every client project with progress %, next milestone and due date, overdue items, unread client messages, open client requests, approvals waiting, payments to confirm, and money still owed (by invoice). Use for 'how are my projects?', 'who owes me money?', 'any client messages?'.",
  schema: overviewSchema,
  inputSchema: { type: "object", properties: { focus: { type: "string", enum: ["all", "money", "messages", "projects"] } } },
  agentScope: "jarvis",
  activityLabel: "Checking the Client Portal",
  async execute() {
    const { portalOverview, inr } = await import("@/lib/portal/service");
    const o = await guard(() => portalOverview());
    return {
      data: { ...o, outstandingText: inr(o.outstanding), projects: o.projects.map((p) => ({ ...p, balanceText: p.balance ? inr(p.balance) : null })) },
      summary: `${o.projects.length} projects · ${o.unreadMessages} unread messages · ${inr(o.outstanding)} outstanding.`,
    };
  },
};

const projectSchema = z.object({ project: z.string().min(1).max(100).describe("Project or client name, e.g. 'FitZone', 'Bloom Coaching website'.") });
export const portalProjectTool: ToolDefinition<z.infer<typeof projectSchema>> = {
  name: "portal_project",
  description: "One client's project from the Client Portal in detail: milestones and their status/dates, the latest messages with the client, invoices with what's paid and still due, and open requests. Use before answering about or replying to a specific client.",
  schema: projectSchema,
  inputSchema: { type: "object", properties: { project: { type: "string" } }, required: ["project"] },
  agentScope: "jarvis",
  activityLabel: "Opening a portal project",
  async execute(i) {
    const { portalProject } = await import("@/lib/portal/service");
    const r = await guard(() => portalProject(i.project));
    return { data: r, summary: `${r.project.name} (${r.project.client}) — ${r.project.progress}% done.` };
  },
};

const replySchema = z.object({
  project: z.string().min(1).max(100).describe("Project or client name."),
  message: z.string().min(1).max(4000).describe("The exact message to post to the client, written as Harsha's team (friendly, professional)."),
});
export const portalReplyTool: ToolDefinition<z.infer<typeof replySchema>> = {
  name: "portal_reply",
  description: "Post a message to a client in their Client Portal project (Messages) — the client is notified. ONLY after the user has seen the exact text and said yes (show it first: '🟡 OK to send? → …'). Never on your own, never with prices, dates or promises the user didn't give.",
  schema: replySchema,
  inputSchema: { type: "object", properties: { project: { type: "string" }, message: { type: "string" } }, required: ["project", "message"] },
  agentScope: "jarvis",
  activityLabel: "Replying in the Client Portal",
  async execute(i) {
    const { portalReply } = await import("@/lib/portal/service");
    const r = await guard(() => portalReply(i.project, i.message));
    return { data: r, summary: `Posted to ${r.client} (${r.project}); ${r.notified} client user${r.notified === 1 ? "" : "s"} notified.` };
  },
};
