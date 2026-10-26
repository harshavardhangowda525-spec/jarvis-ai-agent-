import "server-only";
import { getDb } from "@/lib/db";
import { capabilities, env } from "@/lib/env";
import { agentConfigs } from "@/lib/ai/agent";
import { getLiveBrain } from "@/lib/ai/brain";
import { availableTools } from "@/lib/tools/registry";
import { emailChannelReady } from "@/lib/darwin/email";
import { findBlender } from "@/lib/friday/blender";
import { whatsappReady } from "@/lib/plans/notify";
import { jobView } from "@/lib/jobs/engine";
import { NEXUS_AGENTS, type AgentState, type NexusAgentId } from "./agents";

/**
 * Each agent's state, taken only from real records: its delegated tasks
 * (AgentJob), its own runs (ASTON studio builds, FRIDAY builds, EV's daily
 * package, DARWIN's daily search), whether its brain is configured, and its
 * integrations. A queued task is "ready · 1 queued", never "working".
 */

const db = () => getDb();
const LIVE_MS = 15 * 60_000;
const RECENT_MS = 10 * 60_000;
const BASICS = new Set(["calculator", "get_time", "memory", "tasks", "notes", "web_search"]);

let blenderCache: { at: number; ok: boolean } | null = null;
function blenderFound() {
  if (!blenderCache || Date.now() - blenderCache.at > 5 * 60_000) blenderCache = { at: Date.now(), ok: !!findBlender() };
  return blenderCache.ok;
}

export interface Integration { name: string; ok: boolean; detail: string }
export interface Capability { tool: string; label: string; description: string; needsApproval: boolean }

async function integrations(userId: string, id: NexusAgentId): Promise<Integration[]> {
  const email = await emailChannelReady(userId).catch(() => false);
  const mail: Integration = { name: "Gmail (sending)", ok: email, detail: email ? "Connected" : "Connect Google in Settings → Integrations" };
  switch (id) {
    case "darwin": return [
      { name: "Business discovery", ok: capabilities.leadDiscovery, detail: capabilities.leadDiscovery ? [capabilities.googlePlaces && "Google Places", capabilities.foursquare && "Foursquare", capabilities.geoapify && "Geoapify"].filter(Boolean).join(", ") : "Add GEOAPIFY_API_KEY (free) or GOOGLE_PLACES_API_KEY" },
      { name: "Web search (website checks)", ok: capabilities.search, detail: capabilities.search ? "Tavily" : "SEARCH_API_KEY not set" },
      mail,
    ];
    case "robin": return [mail, { name: "WhatsApp (notifications)", ok: whatsappReady(), detail: whatsappReady() ? "Configured" : "WHATSAPP_* not set" }, { name: "CRM", ok: true, detail: "DARWIN's CRM (the only CRM)" }];
    case "ev": return [
      { name: "Instagram", ok: capabilities.instagram, detail: capabilities.instagram ? "Connected" : "INSTAGRAM_ACCESS_TOKEN not set" },
      { name: "Images", ok: capabilities.evImage, detail: capabilities.evImage ? "Configured" : "No image provider" },
      { name: "Video", ok: capabilities.evVideo, detail: capabilities.evVideo ? "Configured" : "No video provider" },
      { name: "YouTube (live intelligence)", ok: !!env.youtubeApiKey, detail: env.youtubeApiKey ? "Configured" : "YOUTUBE_API_KEY not set" },
    ];
    case "aston": return [
      { name: "Vercel (deploy on approval)", ok: !!process.env.VERCEL_TOKEN, detail: process.env.VERCEL_TOKEN ? "Configured" : "VERCEL_TOKEN not set — previews work, deploys don't" },
      { name: "Claude on your PC (coding)", ok: !!env.claudeBridgeKey, detail: env.claudeBridgeKey ? "Bridge key set" : "Start npm run local with Claude installed" },
    ];
    case "friday": return [{ name: "Blender", ok: blenderFound(), detail: blenderFound() ? "Found on this computer" : "Not found on the computer running JARVIS" }];
    case "mike": return [{ name: "News context", ok: capabilities.search, detail: capabilities.search ? "Tavily" : "SEARCH_API_KEY not set" }];
    case "ruben": return [{ name: "Desktop app", ok: true, detail: "Runs separately on your PC (npm run rubin); it doesn't report its status to JARVIS" }];
  }
}

function capabilitiesFor(id: NexusAgentId): Capability[] {
  if (id === "ruben") return [
    { tool: "crm-pill", label: "CRM on top of your screen", description: "Leads, follow-ups and the pipeline in a small always-on-top window, read from the same database.", needsApproval: false },
    { tool: "voice", label: "Voice commands", description: "Talk to RUBIN from the desktop pill.", needsApproval: false },
  ];
  const agent = id as "darwin" | "robin" | "ev" | "aston" | "friday" | "mike";
  return availableTools(agent).filter((t) => !BASICS.has(t.name) && (t.agentScope === agent || (agent === "aston" && t.name.startsWith("aston")) || (agent === "friday" && t.name.startsWith("friday")) || (agent === "ev" && (t.name === "business_intel")) || (agent === "mike" && t.name === "trading_review") || (agent === "aston" && /website_project/.test(t.name))))
    .map((t) => ({ tool: t.name, label: t.activityLabel ?? t.name, description: t.description.split(/(?<=\.)\s/)[0].slice(0, 220), needsApproval: !!t.requiresConfirmation }));
}

/** Agent-specific runs that aren't delegated tasks (they are real records too). */
async function ownRuns(userId: string, now: Date) {
  const since = new Date(now.getTime() - LIVE_MS);
  const [studio, friday, ev, darwin] = await Promise.all([
    db().astonProject.findMany({ where: { userId, updatedAt: { gte: since }, state: { notIn: ["review", "deployed", "failed"] } }, select: { name: true, state: true, stateNote: true, updatedAt: true } }),
    db().fridayVersion.findMany({ where: { project: { userId }, status: "building", updatedAt: { gte: since } }, select: { updatedAt: true, project: { select: { name: true } } } }),
    db().evDaily.findMany({ where: { userId, status: "generating", updatedAt: { gte: since } }, select: { updatedAt: true, stage: true, date: true } }).catch(() => []),
    db().darwinDailyRun.findMany({ where: { userId, status: "running", updatedAt: { gte: since } }, select: { updatedAt: true } }).catch(() => []),
  ]);
  return {
    aston: studio.map((s) => ({ label: `Website studio: ${s.name} — ${s.state}${s.stateNote ? ` (${s.stateNote})` : ""}`, at: s.updatedAt })),
    friday: friday.map((f) => ({ label: `Building ${f.project.name}`, at: f.updatedAt })),
    ev: ev.map((e) => ({ label: `Daily content ${e.date} — ${e.stage}`, at: e.updatedAt })),
    darwin: darwin.map((d) => ({ label: "Daily lead search", at: d.updatedAt })),
  } as Partial<Record<NexusAgentId, { label: string; at: Date }[]>>;
}

export async function agentStatuses(userId: string, now = new Date()) {
  const brain = await getLiveBrain(userId).catch(() => null);
  const jobs = await db().agentJob.findMany({ where: { userId, OR: [{ status: { in: ["planning", "assigned", "running", "waiting_approval"] } }, { updatedAt: { gte: new Date(now.getTime() - 24 * 3600_000) } }] }, orderBy: { updatedAt: "desc" }, take: 200 });
  const runs = await ownRuns(userId, now);
  const out = [];
  for (const a of NEXUS_AGENTS) {
    const mine = jobs.filter((j) => j.agent === a.id);
    const running = mine.filter((j) => j.status === "running");
    const live = running.filter((j) => j.leaseUntil && j.leaseUntil > now);
    const planning = mine.filter((j) => j.status === "planning");
    const queued = mine.filter((j) => j.status === "assigned");
    const approval = mine.filter((j) => j.status === "waiting_approval");
    const finished = mine.filter((j) => ["completed", "failed", "cancelled"].includes(j.status)).sort((x, y) => (y.finishedAt?.getTime() ?? 0) - (x.finishedAt?.getTime() ?? 0));
    const own = runs[a.id] ?? [];
    const pick = a.id === "ruben" ? null : agentConfigs(a.id as "darwin", brain);
    let state: AgentState;
    let reason: string;
    if (a.id === "ruben") { state = "unknown"; reason = "RUBEN runs as a separate desktop app and doesn't report its status to JARVIS."; }
    else if (pick && !pick.configs.length) { state = "offline"; reason = pick.missing ?? "No AI brain is configured for this agent."; }
    else if (live.length || own.length) { state = "working"; reason = live[0] ? `Working on: ${live[0].title}` : own[0].label; }
    else if (running.length) { state = "working"; reason = `${running[0].title} — interrupted; it resumes on the next run`; }
    else if (planning.length) { state = "planning"; reason = `Planning: ${planning[0].title}`; }
    else if (approval.length) { state = "waiting_approval"; reason = `Waiting for your approval: ${approval[0].title}`; }
    else if (finished[0] && finished[0].finishedAt && now.getTime() - finished[0].finishedAt.getTime() < RECENT_MS) {
      state = finished[0].status === "completed" ? "completed" : finished[0].status === "failed" ? "error" : "ready";
      reason = finished[0].status === "completed" ? `Finished: ${finished[0].title}` : finished[0].status === "failed" ? `Failed: ${finished[0].error ?? finished[0].title}` : `Cancelled: ${finished[0].title}`;
    } else { state = "ready"; reason = queued.length ? `${queued.length} task${queued.length === 1 ? "" : "s"} queued` : "Ready for work"; }
    const times = [...mine.map((j) => j.updatedAt.getTime()), ...own.map((o) => o.at.getTime())];
    out.push({
      ...a, state, reason,
      updatedAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
      brain: pick ? (pick.configs.length ? pick.configs.map((c) => c.provider) : []) : null,
      counts: { running: running.length, planning: planning.length, queued: queued.length, approval: approval.length, completed24h: finished.filter((j) => j.status === "completed").length, failed24h: finished.filter((j) => j.status === "failed").length },
      current: (live[0] ?? running[0] ?? planning[0] ?? approval[0]) ? jobView((live[0] ?? running[0] ?? planning[0] ?? approval[0])!) : null,
      ownRuns: own.map((o) => ({ label: o.label, at: o.at.toISOString() })),
      queue: queued.slice(0, 8).map(jobView),
      recent: finished.slice(0, 8).map(jobView),
      errors: finished.filter((j) => j.status === "failed").slice(0, 5).map((j) => ({ id: j.id, title: j.title, error: j.error, at: j.finishedAt?.toISOString() ?? null })),
      integrations: await integrations(userId, a.id),
      capabilities: capabilitiesFor(a.id),
    });
  }
  // JARVIS itself: the orchestrator's own brain
  const jp = agentConfigs("jarvis", brain);
  return {
    at: now.toISOString(),
    jarvis: { brain: jp.configs.map((c) => c.provider), offline: !jp.configs.length, reason: jp.missing ?? null, pcBrain: !!brain?.baseUrl, claudeBridge: !!env.claudeBridgeKey, voice: capabilities.voice },
    agents: out,
  };
}
export type AgentStatus = Awaited<ReturnType<typeof agentStatuses>>["agents"][number];
