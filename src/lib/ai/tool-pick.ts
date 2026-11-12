/**
 * For AI plans with a small per-minute allowance (Groq's free tier): send only the tools that fit this
 * message — a core set, plus groups the message (or the recent conversation) is about. Pure (tested).
 */
const CORE = ["get_time", "calculator", "memory", "tasks", "notes", "navigate", "open_link", "computer_task", "call_me", "call_person", "save_contact", "personal_calls", "delegate_task", "task_status"];
const GROUPS: [RegExp, string[]][] = [
  [/\b(leads?|crm|prospects?|google maps|gyms?|salons?|caf[eé]s?|clinics?|restaurants?|call (my |the |today'?s )?(leads|clients|list)|calling hours|follow.?ups?)\b/i, ["crm_find_leads", "crm_leads", "crm_update", "crm_add", "crm_plan_calls"]],
  [/\b(portal|projects?|clients?|invoices?|owes?|owed|payments?|milestones?|proposals?|client messages?)\b/i, ["portal_overview", "portal_project", "portal_reply"]],
  [/\b(stocks?|shares?|markets?|nifty|sensex|trading|trades?|charts?|crypto|bitcoin|mike)\b/i, ["mike_market_summary", "mike_chart", "trading_review"]],
  [/\b(news|business (environment|intel)|intel|opportunit(y|ies)|briefing)\b/i, ["business_intel"]],
  [/\b(websites?|demos?|aston|landing page|site)\b/i, ["aston_demo", "website_project"]],
  [/\b(3d|friday|blender|model of)\b/i, ["friday_model"]],
  [/\b(nios|exams?|notices?|admission)\b/i, ["nios"]],
  [/\b(marketing plan|daily plan|today'?s plan|posts? plan)\b/i, ["daily_plan"]],
  [/\b(activity|what (did|have) you (do|done)|history|log)\b/i, ["activity"]],
  [/\b(rubin|robin|sales report)\b/i, ["robin_report"]],
  [/\b(tasks?|jobs?|agents?|stop|pause|cancel)\b/i, ["task_control"]],
  [/\b(open|launch|start)\b/i, ["open_app"]],
];

export function pickTools<T extends { name: string }>(tools: T[], message: string, recent: string[] = []): T[] {
  const text = [message, ...recent.slice(-2)].join("\n");
  const want = new Set(CORE);
  for (const [re, names] of GROUPS) if (re.test(text)) for (const n of names) want.add(n);
  const picked = tools.filter((t) => want.has(t.name));
  return picked.length ? picked : tools;
}

/** Tool parameters without their long descriptions (names, types and enums stay). Pure (tested). */
export function stripSchema(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripSchema);
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k]) => k !== "description" && k !== "examples").map(([k, v]) => [k, stripSchema(v)]));
  return o;
}
