/**
 * Which tool calls are worth remembering, and how to phrase them. Routine
 * lookups (time, weather, listing, searching, reading) are skipped — the chat
 * turn already records that you asked. Creations, completions, sends,
 * publishes and every failure are kept. Client-safe (pure).
 */
import type { ActivityCategory } from "./record-types";

export interface ToolEvent {
  category: ActivityCategory;
  action: string;
  result?: string | null;
  status: "success" | "failed" | "info";
  importance: number;
  project?: string | null;
}

type In = Record<string, unknown>;
const str = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

export function describeToolEvent(
  name: string, input: In | undefined, agent: string, ok: boolean, summary: string | null, error: string | null,
): ToolEvent | null {
  const i = input ?? {};
  const a = str(i.action, 30);
  if (!ok) {
    return {
      category: "error", status: "failed", importance: /publish|send|message/i.test(`${name} ${a}`) ? 4 : 3,
      action: `${label(name)} failed${a ? ` (${a})` : ""}`, result: str(error, 300) || null,
      project: agent === "JARVIS" ? null : agent,
    };
  }
  const okE = (category: ActivityCategory, action: string, importance: number, project: string | null = null): ToolEvent =>
    ({ category, action, result: str(summary, 300) || null, status: "success", importance, project });

  switch (name) {
    case "tasks":
      if (a === "create") return okE("task", `Task created: ${str(i.title) || "untitled"}`, 3);
      if (a === "complete") return okE("task", str(summary, 200).startsWith("Task completed: ") ? str(summary, 200) : `Task completed: ${str(i.title) || "a task"}`, 3);
      if (a === "update") return okE("task", `Task updated: ${str(i.title) || str(i.id, 40)}`, 2);
      if (a === "delete") return okE("task", "Task deleted", 2);
      return null;
    case "notes":
      if (a === "create") return okE("file", `Note saved: ${str(i.title) || str(i.content, 60) || "untitled"}`, 2);
      if (a === "edit") return okE("file", `Note edited: ${str(i.title) || str(i.id, 40)}`, 2);
      if (a === "delete") return okE("file", "Note deleted", 1);
      return null;
    case "google_calendar":
      return a === "create" ? okE("task", `Calendar event created: ${str(i.title) || "untitled"}`, 3) : null;
    case "gmail":
      return a === "send" ? okE("communication", `Email sent to ${str(i.to, 80) || "someone"}${str(i.subject) ? `: ${str(i.subject)}` : ""}`, 3) : null;
    case "ev_content":
      if (a === "store") return okE("marketing", `Content created: ${str(i.kind, 20) || "piece"}${str(i.title) ? ` — ${str(i.title)}` : ""}`, 3, "EV");
      if (a === "approve" || a === "reject" || a === "schedule") return okE("marketing", `Content ${a === "schedule" ? "scheduled" : `${a}d`}`, 3, "EV");
      return null;
    case "ev_ideas":
      return a === "store_batch" ? okE("marketing", "Fresh content ideas generated", 2, "EV") : null;
    case "ev_image":
      return a === "check" ? null : okE("marketing", `Marketing image generated${str(i.prompt, 80) ? `: ${str(i.prompt, 80)}` : ""}`, 3, "EV");
    case "ev_video":
      return a === "check" ? null : okE("marketing", `Marketing video started${str(i.prompt, 80) ? `: ${str(i.prompt, 80)}` : ""}`, 3, "EV");
    case "ev_instagram":
      return a === "publish_image" || a === "publish_reel" ? okE("marketing", `Published a ${a === "publish_reel" ? "reel" : "post"} to Instagram`, 4, "EV") : null;
    case "ev_outreach":
      return okE("business", `Outreach drafted for ${str(i.businessName) || "a business"}`, 3, "EV");
    case "nios":
      return a === "settings" ? okE("agent", "NIOS watch settings changed", 1) : null;
    default:
      return null; // DARWIN logs its own CRM activity; lookups aren't events
  }
}

function label(name: string) {
  return ({
    gmail: "Email", google_calendar: "Calendar", tasks: "Task", notes: "Notes", web_search: "Web search",
    ev_instagram: "Instagram publish", ev_image: "Image generation", ev_video: "Video generation", ev_content: "EV content",
    darwin_search: "Lead search", darwin_message: "Outreach email", darwin_followup: "Follow-up", darwin_outreach: "Outreach draft",
  } as Record<string, string>)[name] ?? name.replace(/_/g, " ");
}

/** Chat messages that aren't worth remembering as commands. */
export function isTrivialCommand(text: string) {
  const t = text.trim().toLowerCase().replace(/[.!?,]+/g, "").trim();
  return t.length < 4 || /^(hi|hey|hello|hola|yo|thanks|thank you|thx|ok|okay|cool|nice|great|yes|no|yep|nope|sure|good ?(morning|night|evening|afternoon)|jarvis|hey jarvis|how are you|what'?s up|test|testing)$/.test(t);
}
