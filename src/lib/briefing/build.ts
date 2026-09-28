/**
 * The previous-day briefing, built ONLY from recorded activity. Every number,
 * timeline point, agent status, insight and sentence here is computed from the
 * events and tasks passed in — nothing is estimated, padded or invented. When
 * there isn't enough data for something, it's left out (or marked missing).
 * Client-safe (pure) so it's easy to test.
 */
import { addDays, dayLabel, localDate, localHour, localMinutes } from "@/lib/activity/dates";

export interface Ev {
  id: string;
  timestamp: string | Date;
  category: string;
  agent: string;
  action: string;
  result: string | null;
  status: string;
  importance: number;
  project: string | null;
  source?: string;
  metadata?: unknown;
}
export interface TaskLite { title: string; priority: string; dueAt?: string | Date | null; completedAt?: string | Date | null }
export interface BriefingInput {
  from: string; to: string; label: string; kind: "day" | "range";
  tz: string; now: number;
  events: Ev[];
  tasks: { completed: TaskLite[]; remaining: TaskLite[]; used: boolean };
  followUpsSoon?: { business: string; dueAt: string | Date }[];
  evAwaitingApproval?: number;
  recordedSince?: string | null;
  userName?: string | null;
}

export interface Metric { key: string; label: string; value: number }
export interface TimelinePart { part: string; count: number; lead: string | null }
export interface TimelinePoint { at: number; category: string; importance: number; label: string }
export interface AgentStatus { name: string; status: "active" | "opened" | "inactive"; count: number }
export interface DailyData {
  date: string;
  accomplishments: string[];
  projects: string[];
  business_progress: string[];
  development_progress: string[];
  problems: string[];
  solutions: string[];
  unfinished_tasks: string[];
  important_decisions: string[];
  next_actions: string[];
}
export interface BriefingEvent { id: string; time: string; agent: string; category: string; action: string; result: string | null; status: string; importance: number }
export interface Briefing {
  from: string; to: string; label: string; kind: "day" | "range";
  title: string; dateLabel: string; greeting: string;
  hasData: boolean; eventCount: number;
  metrics: Metric[];
  completion: { done: number; remaining: number; pct: number } | null;
  timeline: TimelinePart[];
  points: TimelinePoint[];
  agents: AgentStatus[];
  projects: { name: string; count: number }[];
  insights: string[];
  paragraphs: string[];
  spoken: string;
  unfinished: string[];
  events: BriefingEvent[];
  daily: DailyData;
  missing: string[];
}

export const KNOWN_AGENTS = ["JARVIS", "DARWIN", "EV", "ULTRON", "HUMANOID"];
const CAT_LABEL: Record<string, string> = {
  command: "Commands", task: "Tasks", development: "Development", business: "Business", marketing: "Marketing",
  communication: "Communication", agent: "Agents", file: "Files", error: "Problems", solution: "Fixes",
  decision: "Decisions", notice: "NIOS", conversation: "Conversations",
};
const PARTS: { part: string; from: number; to: number }[] = [
  { part: "Morning", from: 5, to: 12 }, { part: "Afternoon", from: 12, to: 17 }, { part: "Evening", from: 17, to: 22 }, { part: "Night", from: 22, to: 29 },
];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quote = (s: string, max = 70) => { const t = s.trim().replace(/[.\s]+$/, ""); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };
const listText = (items: string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const meta = (e: Ev) => (e.metadata && typeof e.metadata === "object" ? e.metadata as Record<string, unknown> : {});
const afterColon = (s: string) => s.includes(":") ? s.slice(s.indexOf(":") + 1).trim() : s;

export function buildBriefing(input: BriefingInput): Briefing {
  const { tz, now } = input;
  const all = [...input.events].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  // Meaningful = importance ≥ 2, and the same action repeated in a day counts once.
  const seen = new Set<string>();
  const ev = all.filter((e) => {
    if (e.importance < 2) return false;
    const k = `${localDate(new Date(e.timestamp), tz)}|${e.agent}|${e.category}|${e.action.toLowerCase()}|${e.status}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const by = (f: (e: Ev) => boolean) => ev.filter(f);
  const isYesterday = input.kind === "day" && input.from === addDays(localDate(now, tz), -1);
  const isToday = input.kind === "day" && input.from === localDate(now, tz);
  const when = isYesterday ? "yesterday" : isToday ? "today" : input.kind === "day" ? `on ${dayLabel(input.from, { weekday: true })}` : input.label.toLowerCase().startsWith("last") ? `over the ${input.label.toLowerCase()}` : `from ${dayLabel(input.from)} to ${dayLabel(input.to)}`;

  // ---------------------------------------------------------------- groups
  const commands = by((e) => e.category === "command");
  const darwin = by((e) => e.agent === "DARWIN");
  const discovered = darwin.filter((e) => meta(e).type === "discovered");
  const leads = discovered.reduce((s, e) => s + (typeof meta(e).count === "number" ? meta(e).count as number : 1), 0);
  const stageMoves = darwin.filter((e) => meta(e).type === "stage_changed");
  const converted = stageMoves.filter((e) => /→\s*(converted|won)/i.test(e.action));
  const followUps = darwin.filter((e) => meta(e).type === "followup_scheduled" || meta(e).type === "followup_completed");
  const outreachSent = darwin.filter((e) => meta(e).type === "message_sent");
  const business = by((e) => e.category === "business" || (e.category === "communication" && e.agent === "DARWIN"));
  const userLogged = by((e) => e.source === "user" && e.category !== "decision");
  const ev_ = by((e) => e.agent === "EV" && e.category === "marketing");
  const evCreated = ev_.filter((e) => /^Content created/i.test(e.action));
  const evImages = ev_.filter((e) => /^Marketing (image|video)/i.test(e.action));
  const evPublished = ev_.filter((e) => /^Published/i.test(e.action));
  const marketing = by((e) => e.category === "marketing");
  const dev = by((e) => e.category === "development");
  const ultronDone = dev.filter((e) => /^ULTRON completed:/i.test(e.action));
  const deployed = dev.filter((e) => /^Deployed:/i.test(e.action));
  const emails = by((e) => e.category === "communication" && /^Email sent/i.test(e.action));
  const notices = by((e) => e.category === "notice");
  const decisions = by((e) => e.category === "decision");
  const errors = by((e) => e.category === "error");
  const solutions = by((e) => e.category === "solution");
  const agentEvents = by((e) => e.agent !== "JARVIS");

  // A problem counts as resolved when a later event fixes it: an explicit
  // solution from the same agent, or a later success of the same thing.
  const subjectOf = (e: Ev) => (meta(e).tool as string | undefined) ?? afterColon(e.action).toLowerCase();
  const resolved = errors.filter((err) => {
    const t = +new Date(err.timestamp);
    return ev.some((e) => +new Date(e.timestamp) > t && e.agent === err.agent && (
      e.category === "solution" ||
      (e.status === "success" && ((meta(err).tool && meta(e).tool === meta(err).tool) || afterColon(e.action).toLowerCase() === subjectOf(err)))
    ));
  });
  const unresolved = errors.filter((e) => !resolved.includes(e));

  // ---------------------------------------------------------------- metrics (real values only)
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const add = (key: string, label: string, value: number, show = value > 0) => { if (show) metrics.push({ key, label, value }); };
  const tasksDone = input.tasks.completed.length, tasksLeft = input.tasks.remaining.length;
  if (input.tasks.used) { add("tasksCompleted", "Tasks Completed", tasksDone, true); add("tasksRemaining", "Tasks Remaining", tasksLeft, true); }
  else missing.push("tasks");
  const projectCounts = new Map<string, number>();
  for (const e of ev) if (e.project) projectCounts.set(e.project, (projectCounts.get(e.project) ?? 0) + 1);
  add("projects", "Projects", projectCounts.size);
  add("business", "Business Activities", business.length + userLogged.filter((e) => e.category === "business" || e.category === "communication").length);
  add("leads", "Leads Generated", leads, discovered.length > 0);
  add("followUps", "Client Follow-ups", followUps.length);
  add("development", "Development", dev.length);
  add("content", "Content Created", evCreated.length + evImages.length);
  add("problems", "Problems", errors.length);
  add("resolved", "Resolved", resolved.length, errors.length > 0);
  add("agents", "Agent Activities", agentEvents.length);
  add("commands", "Commands", commands.length);
  add("notices", "NIOS Notices", notices.length);
  const completion = input.tasks.used && tasksDone + tasksLeft > 0
    ? { done: tasksDone, remaining: tasksLeft, pct: Math.round((100 * tasksDone) / (tasksDone + tasksLeft)) }
    : null;
  if (!completion) missing.push("completion");

  // ---------------------------------------------------------------- timeline
  const hourOf = (e: Ev) => { const h = localHour(new Date(e.timestamp), tz); return h < 5 ? h + 24 : h; };
  const timeline: TimelinePart[] = PARTS.map((p) => {
    const inPart = ev.filter((e) => { const h = hourOf(e); return h >= p.from && h < p.to; });
    const counts = new Map<string, number>();
    for (const e of inPart) if (e.category !== "command" || inPart.every((x) => x.category === "command")) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    const lead = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { part: p.part, count: inPart.length, lead: lead ? CAT_LABEL[lead] ?? lead : null };
  }).filter((p) => p.count > 0);
  const points: TimelinePoint[] = ev.map((e) => {
    const d = new Date(e.timestamp);
    const minutes = localMinutes(d, tz);
    const dayIdx = input.kind === "range" ? Math.max(0, Math.round((Date.parse(localDate(d, tz)) - Date.parse(input.from)) / 86_400_000)) : 0;
    return { at: dayIdx * 1440 + minutes, category: e.category, importance: e.importance, label: e.action.slice(0, 80) };
  });

  // ---------------------------------------------------------------- agents & projects
  const agentNames = [...new Set([...KNOWN_AGENTS, ...all.map((e) => e.agent)])];
  const agents: AgentStatus[] = agentNames.map((name) => {
    const count = ev.filter((e) => e.agent === name).length;
    const opened = all.some((e) => e.agent === name);
    return { name, count, status: count > 0 ? "active" : opened ? "opened" : "inactive" };
  });
  const projects = [...projectCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));

  // ---------------------------------------------------------------- insights (only what the data shows)
  const insights: string[] = [];
  const nonJarvis = ev.filter((e) => e.agent !== "JARVIS");
  const agentTop = [...new Set(nonJarvis.map((e) => e.agent))].map((a) => ({ a, n: nonJarvis.filter((e) => e.agent === a).length })).sort((x, y) => y.n - x.n)[0];
  if (agentTop && agentTop.n >= 3 && agentTop.n / nonJarvis.length >= 0.5) {
    insights.push(`${agentTop.a} handled most of the agent work ${when} — ${agentTop.n} of ${nonJarvis.length} agent events.`);
  }
  const work = ev.filter((e) => e.category !== "command");
  const catTop = [...new Set(work.map((e) => e.category))].map((c) => ({ c, n: work.filter((e) => e.category === c).length })).sort((x, y) => y.n - x.n)[0];
  if (catTop && catTop.n >= 3 && catTop.n / work.length >= 0.4 && insights.length < 2) {
    const name = CAT_LABEL[catTop.c] ?? catTop.c;
    if (!insights[0] || !insights[0].startsWith(name)) insights.push(`${name} made up the largest share of the work ${when} (${catTop.n} of ${work.length} events).`);
  }
  if (insights.length < 2 && input.kind === "day" && ev.length >= 6) {
    const busiest = [...timeline].sort((a, b) => b.count - a.count)[0];
    if (busiest && busiest.count / ev.length >= 0.4) insights.push(`Your busiest stretch was the ${busiest.part.toLowerCase()} — ${busiest.count} of ${ev.length} recorded events.`);
  }
  if (insights.length < 2 && errors.length >= 2) insights.push(`${resolved.length} of ${errors.length} problems were resolved ${when === "yesterday" ? "the same day" : "in this period"}.`);

  // ---------------------------------------------------------------- narrative
  const hour = localHour(now, tz);
  const greeting = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = input.userName?.trim().split(/\s+/)[0];
  const intro = `${greeting}${name ? `, ${name}` : ""}. ${isYesterday ? "Here's your briefing from yesterday." : input.kind === "day" ? `Here's your briefing for ${isToday ? "today so far" : dayLabel(input.from, { weekday: true })}.` : `Here's your briefing ${when}.`}`;
  const paragraphs: string[] = [intro];
  const hasData = ev.length > 0 || tasksDone > 0;

  if (!hasData) {
    paragraphs.push(`I don't have any recorded activity ${when}.`);
    if (input.recordedSince && input.recordedSince > input.to) paragraphs.push(`I started keeping your activity history on ${dayLabel(input.recordedSince)}, so your next briefing will cover the work since then.`);
    else if (!input.recordedSince) paragraphs.push("I've just started keeping your activity history — tomorrow's briefing will cover today.");
  } else {
    const work1: string[] = [];
    if (dev.length) {
      const parts: string[] = [];
      if (ultronDone.length) parts.push(`ULTRON completed ${ultronDone.length === 1 ? `"${quote(afterColon(ultronDone[0].action))}"` : `${ultronDone.length} builds, including "${quote(afterColon(ultronDone[0].action), 50)}"`}`);
      if (deployed.length) parts.push(`${plural(deployed.length, "deployment")} went out`);
      const otherDev = dev.length - ultronDone.length - deployed.length - dev.filter((e) => /^ULTRON started:/i.test(e.action)).length;
      if (!parts.length && otherDev > 0) parts.push(`${plural(otherDev, "development activity", "development activities")} were recorded`);
      if (parts.length) work1.push(`On the development side, ${listText(parts)}.`);
    }
    if (discovered.length || stageMoves.length || followUps.length || outreachSent.length) {
      const parts: string[] = [];
      if (discovered.length) parts.push(`found ${plural(leads, "new lead")}${discovered.length > 1 ? ` across ${discovered.length} searches` : ""}`);
      if (stageMoves.length) parts.push(`moved ${plural(stageMoves.length, "lead")} through the pipeline${converted.length ? ` (${converted.length} converted)` : ""}`);
      if (outreachSent.length) parts.push(`sent ${plural(outreachSent.length, "outreach email")}`);
      if (followUps.length) parts.push(`handled ${plural(followUps.length, "follow-up")}`);
      work1.push(`For Infinity Web & Apps, DARWIN ${listText(parts)}.`);
    }
    if (evCreated.length || evImages.length || evPublished.length) {
      const parts: string[] = [];
      if (evCreated.length) parts.push(`created ${plural(evCreated.length, "piece")} of content`);
      if (evImages.length) parts.push(`generated ${plural(evImages.length, "visual")}`);
      if (evPublished.length) parts.push(`published ${plural(evPublished.length, "post")} to Instagram`);
      work1.push(`EV ${listText(parts)}.`);
    }
    if (userLogged.length) work1.push(`You also logged ${listText(userLogged.slice(0, 3).map((e) => quote(e.action, 60).replace(/^./, (c) => c.toLowerCase())))}${userLogged.length > 3 ? `, plus ${userLogged.length - 3} more` : ""}.`);
    if (emails.length) work1.push(`${plural(emails.length, "email")} went out from JARVIS.`);
    if (notices.length) work1.push(`${plural(notices.length, "new NIOS notice")} appeared${notices.length === 1 ? `: ${quote(afterColon(notices[0].action), 80)}` : ""}.`);
    if (decisions.length) work1.push(`Decision${decisions.length > 1 ? "s" : ""} made: ${listText(decisions.slice(0, 2).map((e) => quote(afterColon(e.action), 70)))}.`);
    if (!work1.length && commands.length) work1.push(`You gave JARVIS ${plural(commands.length, "command")}, including "${quote(commands[commands.length - 1].action, 60)}".`);
    else if (commands.length) work1.push(`In all, you gave JARVIS ${plural(commands.length, "command")}.`);
    if (work1.length) paragraphs.push(work1.join(" "));

    if (errors.length) {
      paragraphs.push(`${plural(errors.length, "problem")} came up${resolved.length ? `, and ${resolved.length === errors.length ? (errors.length === 1 ? "it was" : "all were") : `${resolved.length} ${resolved.length === 1 ? "was" : "were"}`} resolved` : ""}.${unresolved.length ? ` Still open: ${quote(unresolved[0].action, 70)}${unresolved[0].result ? ` — ${quote(unresolved[0].result, 70)}` : ""}.` : ""}`);
    }
    if (input.tasks.used && (tasksDone || tasksLeft)) {
      const main = [...input.tasks.remaining].sort((a, b) => (b.priority === "high" ? 1 : 0) - (a.priority === "high" ? 1 : 0))[0];
      paragraphs.push(`You completed ${plural(tasksDone, "task")}${tasksLeft ? ` and ${tasksLeft} ${tasksLeft === 1 ? "remains" : "remain"}` : ", with nothing left open"}.${main ? ` Your main unfinished item is ${quote(main.title, 70)}.` : ""}`);
    }
    paragraphs.push(`That's everything important ${isYesterday ? "from yesterday" : isToday ? "so far today" : when}.`);
  }

  // ---------------------------------------------------------------- structured day
  const acts = (xs: Ev[], n = 10) => [...new Set(xs.map((e) => quote(e.action, 140)))].slice(0, n);
  const unfinished = [
    ...input.tasks.remaining.map((t) => t.title),
    ...unresolved.filter((e) => e.agent === "ULTRON").map((e) => afterColon(e.action)),
  ].slice(0, 8);
  const nextActions = [
    ...input.tasks.remaining.filter((t) => t.priority === "high").map((t) => `Finish: ${t.title}`),
    ...(input.followUpsSoon ?? []).map((f) => `Follow up with ${f.business}`),
    ...(input.evAwaitingApproval ? [`Review ${plural(input.evAwaitingApproval, "EV piece")} awaiting approval`] : []),
    ...unresolved.slice(0, 2).map((e) => `Look into: ${quote(e.action, 90)}`),
  ].slice(0, 8);
  const daily: DailyData = {
    date: input.from,
    accomplishments: [...input.tasks.completed.map((t) => `Completed task: ${t.title}`), ...acts(by((e) => e.status === "success" && e.importance >= 3 && e.category !== "command" && e.category !== "task"))].slice(0, 15),
    projects: projects.map((p) => p.name),
    business_progress: acts([...business, ...userLogged.filter((e) => e.category === "business" || e.category === "communication")]),
    development_progress: acts(dev.filter((e) => e.status === "success")),
    problems: errors.map((e) => `${quote(e.action, 100)}${e.result ? ` — ${quote(e.result, 100)}` : ""}`).slice(0, 10),
    solutions: [...acts(solutions), ...resolved.map((e) => `Resolved: ${quote(e.action, 100)}`)].slice(0, 10),
    unfinished_tasks: unfinished,
    important_decisions: acts(decisions),
    next_actions: nextActions,
  };

  const events: BriefingEvent[] = ev.slice(-200).reverse().map((e) => ({
    id: e.id, time: new Date(e.timestamp).toISOString(), agent: e.agent, category: e.category,
    action: e.action, result: e.result, status: e.status, importance: e.importance,
  }));

  return {
    from: input.from, to: input.to, label: input.label, kind: input.kind,
    title: isYesterday ? "Yesterday's Intelligence Briefing" : input.kind === "day" ? "Intelligence Briefing" : `${input.label} — Intelligence Briefing`,
    dateLabel: input.kind === "day" ? dayLabel(input.from, { weekday: true }) : `${dayLabel(input.from)} – ${dayLabel(input.to)}`,
    greeting, hasData, eventCount: ev.length, metrics, completion, timeline, points, agents, projects, insights,
    paragraphs, spoken: paragraphs.join(" "), unfinished, events, daily, missing,
  };
}
