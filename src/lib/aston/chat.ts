import "server-only";
import type OpenAI from "openai";
import { getDb } from "@/lib/db";
import { redact } from "@/lib/activity/redact";
import { AstonAiUnavailable, groqChat, type GroqDeps } from "./groq";
import { getIncident, listIncidents, toDTO } from "./incidents";
import { decide, requestApproval, ACTIONS, DecisionError } from "./decisions";
import { probe, probeAllowed } from "./probe";
import { createSite, SiteError } from "./site/builder";
import type { IncidentDTO } from "./types";

/**
 * Talking to ASTON. Groq plans and picks tools; the tools read real records.
 * ASTON may acknowledge incidents and run safe checks itself, but it can only
 * REQUEST consequential actions — approving them is a separate, explicit owner
 * step in the interface (never something the model can do).
 */

type Msg = OpenAI.Chat.ChatCompletionMessageParam;
export interface ChatTurn { role: "user" | "assistant"; content: string }
export interface ChatResult { reply: string; ai: boolean; aiNote: string | null; changed: boolean; site?: string | null }

const MAX_STEPS = 4;

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  { type: "function", function: { name: "list_incidents", description: "List incidents (open first). Use to answer 'what needs my attention'.", parameters: { type: "object", properties: { include_closed: { type: "boolean" } } } } },
  { type: "function", function: { name: "get_incident", description: "Full details of one incident.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
  { type: "function", function: { name: "acknowledge_incident", description: "Mark an incident as seen by the owner (stops further alerts). Only when the owner says so.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
  { type: "function", function: { name: "check_website", description: "Safe, read-only health check of a public website URL.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "request_approval", description: `Ask the owner to approve a consequential action on an incident. It is NOT executed until the owner approves it in ASTON. Actions: ${Object.entries(ACTIONS).filter(([, a]) => !a.safe).map(([k, a]) => `${k} (${a.label})`).join(", ")}.`, parameters: { type: "object", properties: { id: { type: "string" }, action: { type: "string" }, reason: { type: "string" } }, required: ["id", "action", "reason"] } } },
  { type: "function", function: { name: "build_website", description: "Start building a one-page website from a brief (business, location, style, sections). Opens ASTON's live builder window, which writes the code in front of the owner.", parameters: { type: "object", properties: { brief: { type: "string", description: "Everything known about the site: business, audience, style, sections, any real contact details." } }, required: ["brief"] } } },
  { type: "function", function: { name: "agent_status", description: "Latest real status of the other agents (DARWIN daily search, EV daily content) and failures logged in the last 24 h.", parameters: { type: "object", properties: {} } } },
];

const SYSTEM =
  "You are ASTON, the calm, concise voice-first attention manager for Infinity Web & Apps. You coordinate the agents JARVIS, ULTRON (formerly EDITH), DARWIN, EV, MIKE and RUBIN. " +
  "Your replies are spoken aloud: 1-3 short sentences, no markdown, no lists unless asked. " +
  "Only state facts that come from your tools; if you don't know, say so. Never claim you fixed, deployed, called or emailed anything unless a tool result says so. " +
  "You may acknowledge an incident only when the owner asks. For consequential actions (like a redeploy) use request_approval and tell the owner to approve it in ASTON.";

const brief = (i: IncidentDTO) => ({ id: i.id, priority: i.priority, status: i.status, project: i.project, title: i.title, summary: i.summary, next: i.recommendation, pendingApproval: i.pendingAction, seen: i.occurrences, since: i.firstSeenAt });

async function runTool(userId: string, name: string, args: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<{ out: unknown; changed?: boolean; site?: string }> {
  switch (name) {
    case "build_website": {
      const site = await createSite(userId, String(args.brief ?? ""));
      return { out: { ok: true, building: true, note: "The builder window is open and writing the site live (about 5 minutes)." }, site: site.id };
    }
    case "list_incidents":
      return { out: (await listIncidents(userId, { includeClosed: !!args.include_closed, limit: 15 })).map(brief) };
    case "get_incident": {
      const r = await getIncident(userId, String(args.id ?? ""));
      return { out: r ? toDTO(r) : { error: "not found" } };
    }
    case "acknowledge_incident": {
      const r = await decide(userId, String(args.id ?? ""), "acknowledge");
      return { out: { ok: true, result: r.result }, changed: true };
    }
    case "check_website": {
      const url = String(args.url ?? "");
      if (!probeAllowed(url)) return { out: { error: "Only public http(s) URLs can be checked." } };
      return { out: await probe(url, fetchImpl) };
    }
    case "request_approval": {
      const r = await requestApproval(userId, String(args.id ?? ""), String(args.action ?? ""), String(args.reason ?? ""));
      return { out: { ok: true, waitingForOwner: r.pendingAction }, changed: true };
    }
    case "agent_status": {
      const db = getDb();
      const since = new Date(Date.now() - 24 * 3_600_000);
      const [darwin, ev, failures] = await Promise.all([
        db.darwinDailyRun.findFirst({ where: { userId }, orderBy: { startedAt: "desc" }, select: { date: true, status: true, verified: true, target: true, lastError: true } }),
        db.evDaily.findFirst({ where: { userId, current: true }, orderBy: { createdAt: "desc" }, select: { date: true, status: true, stage: true, error: true } }),
        db.activityEvent.groupBy({ by: ["agent"], where: { userId, status: "failed", timestamp: { gte: since } }, _count: { _all: true } }),
      ]);
      return { out: { darwin: darwin ?? "no runs yet", ev: ev ?? "no daily content yet", failuresLast24h: Object.fromEntries(failures.map((f) => [f.agent, f._count._all])) } };
    }
    default:
      return { out: { error: `unknown tool ${name}` } };
  }
}

/** What ASTON says when Groq can't be reached — built only from stored incidents. */
async function offlineReply(userId: string, note: string): Promise<string> {
  const open = (await listIncidents(userId, { limit: 5 })).filter((i) => i.status === "open" || i.status === "acknowledged");
  const head = `My AI is unavailable right now: ${note.replace(/\.?$/, ".")}`;
  if (!open.length) return `${head} Nothing needs your attention.`;
  const top = open.slice(0, 3).map((i) => `${i.priority}: ${i.project ? `${i.project}, ` : ""}${i.title}`).join(". ");
  return `${head} ${open.length} open item${open.length === 1 ? "" : "s"}. ${top}.`;
}

export async function chat(userId: string, history: ChatTurn[], o: { groq?: Partial<GroqDeps>; fetchImpl?: typeof fetch } = {}): Promise<ChatResult> {
  const open = (await listIncidents(userId, { limit: 8 })).filter((i) => i.status !== "resolved" && i.status !== "dismissed");
  const messages: Msg[] = [
    { role: "system", content: `${SYSTEM}\nNow: ${new Date().toISOString()}. Open incidents: ${JSON.stringify(open.map(brief))}` },
    ...history.slice(-12).map((t) => ({ role: t.role, content: redact(t.content).slice(0, 2000) }) as Msg),
  ];
  let changed = false;
  let site: string | null = null;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await groqChat({ messages, tools: TOOLS, tool_choice: "auto", max_tokens: 600, temperature: 0.3 }, { deps: o.groq });
      const m = res.choices[0]?.message;
      if (!m) break;
      const calls = m.tool_calls ?? [];
      if (!calls.length) return { reply: (m.content ?? "").trim() || "Done.", ai: true, aiNote: null, changed, site };
      messages.push({ role: "assistant", content: m.content ?? "", tool_calls: calls });
      for (const c of calls) {
        let out: unknown;
        try {
          const args = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
          const r = await runTool(userId, c.function.name, args, o.fetchImpl);
          out = r.out; changed ||= !!r.changed; site = r.site ?? site;
        } catch (e) {
          out = { error: e instanceof DecisionError || e instanceof SiteError ? e.message : "The tool failed." };
        }
        messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out).slice(0, 6000) });
      }
    }
    return { reply: "I looked into it but couldn't finish in time. Ask me again in a moment.", ai: true, aiNote: null, changed, site };
  } catch (e) {
    const note = e instanceof AstonAiUnavailable ? e.message : "Groq request failed";
    return { reply: await offlineReply(userId, note), ai: false, aiNote: note, changed };
  }
}
