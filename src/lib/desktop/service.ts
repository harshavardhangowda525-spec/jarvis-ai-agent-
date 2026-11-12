import "server-only";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { getVisionConfigs, getAnthropicClient, getOpenAiClient } from "@/lib/ai/client";
import { parseStep, systemPrompt, stepPrompt, MAX_STEPS, type UiElement, type Step } from "./act";

/**
 * Jobs JARVIS does on your laptop's screen. You (or JARVIS in chat) queue one;
 * JARVIS's helper on the laptop picks it up, and for every step sends a screenshot +
 * the on-screen elements here; a vision model picks the next step.
 */
const db = () => getDb();
export class DesktopError extends Error {}
const STALE_MS = 3 * 60_000;

export async function queueTask(userId: string, goal: string) {
  const g = goal.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!g) throw new DesktopError("Say what to do on the laptop.");
  const open = await db().desktopTask.count({ where: { userId, status: { in: ["queued", "running"] } } });
  if (open >= 3) throw new DesktopError("3 laptop jobs are already waiting — let those finish first.");
  return db().desktopTask.create({ data: { userId, goal: g } });
}

/** The laptop asks for the next job (and closes jobs whose laptop went quiet). */
export async function nextTask(userId: string, now = new Date()) {
  await db().desktopTask.updateMany({ where: { userId, status: "running", heartbeatAt: { lt: new Date(now.getTime() - STALE_MS) } }, data: { status: "failed", result: "The laptop stopped answering in the middle of this job.", finishedAt: now } });
  if (await db().desktopTask.findFirst({ where: { userId, status: "running" } })) return null;
  const t = await db().desktopTask.findFirst({ where: { userId, status: "queued" }, orderBy: { createdAt: "asc" } });
  if (!t) return null;
  const c = await db().desktopTask.updateMany({ where: { id: t.id, status: "queued" }, data: { status: "running", startedAt: now, heartbeatAt: now } });
  return c.count ? { id: t.id, goal: t.goal, maxSteps: MAX_STEPS } : null;
}

export async function reportTask(userId: string, id: string, i: { step?: { say: string; action: string } | null; status?: "running" | "done" | "failed" | "stopped"; result?: string | null }, now = new Date()) {
  const t = await db().desktopTask.findFirst({ where: { id, userId } });
  if (!t) throw new DesktopError("That job isn't there.");
  const steps = (t.steps as unknown as { at: string; say: string; action: string }[]) ?? [];
  const final = i.status && i.status !== "running";
  await db().desktopTask.update({
    where: { id },
    data: {
      heartbeatAt: now,
      ...(i.step ? { steps: [...steps, { at: now.toISOString(), say: i.step.say.slice(0, 200), action: i.step.action.slice(0, 200) }].slice(-60) as unknown as Prisma.InputJsonValue } : {}),
      ...(final ? { status: i.status, finishedAt: now, result: (i.result ?? "").slice(0, 1000) || null } : {}),
    },
  });
  return { stop: t.status === "stopped" };
}

export async function stopTask(userId: string, id: string) {
  await db().desktopTask.updateMany({ where: { id, userId, status: { in: ["queued", "running"] } }, data: { status: "stopped", finishedAt: new Date(), result: "Stopped." } });
}

/** Is JARVIS's helper on the laptop running and connected? (it checks in every ~20 s) */
export async function laptopOnline(userId: string, now = new Date()) {
  const f = await db().mapsFinder.findUnique({ where: { userId }, select: { tokenHash: true, lastSeenAt: true } });
  return !!f?.tokenHash && !!f.lastSeenAt && now.getTime() - f.lastSeenAt.getTime() < 2 * 60_000;
}

export async function recentTasks(userId: string) {
  return db().desktopTask.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 });
}

export type AskVision = (system: string, text: string, dataUrl: string) => Promise<string>;

export async function askVision(system: string, text: string, dataUrl: string): Promise<string> {
  let configs;
  try { configs = getVisionConfigs(); } catch { throw new DesktopError("Controlling the screen needs an AI that can see images — add GEMINI_API_KEY (free) in .env.local."); }
  const raw = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const mime = dataUrl.slice(5, dataUrl.indexOf(";")) || "image/jpeg";
  let last: unknown = null;
  for (const cfg of configs) {
    try {
      if (cfg.kind === "anthropic") {
        const m = await getAnthropicClient(cfg).messages.create({ model: cfg.model, max_tokens: 400, system, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: raw } }, { type: "text", text }] }] }, { timeout: 30_000, maxRetries: 0 });
        return m.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      }
      const r = await getOpenAiClient(cfg).chat.completions.create({ model: cfg.model, max_tokens: 400, messages: [{ role: "system", content: system }, { role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: dataUrl } }] }] }, { timeout: 30_000, maxRetries: 0 });
      return r.choices[0]?.message?.content ?? "";
    } catch (e) { last = e; console.error(`[desktop] ${cfg.provider} vision failed:`, (e as Error)?.message); }
  }
  throw last instanceof Error ? last : new DesktopError("The vision AI didn't answer.");
}

/** One step: what to do next on this screen. */
export async function nextStep(userId: string, id: string, i: { image: string; elements: UiElement[]; history: string[]; screen: { w: number; h: number } }, ask: AskVision = askVision): Promise<Step> {
  const t = await db().desktopTask.findFirst({ where: { id, userId } });
  if (!t) throw new DesktopError("That job isn't there.");
  if (t.status !== "running") return { action: { type: "fail", reason: t.status === "stopped" ? "Stopped." : "This job has ended." }, say: "Stopped.", confirm: null, blocked: null };
  if (i.history.length >= MAX_STEPS) return { action: { type: "fail", reason: `Stopped after ${MAX_STEPS} steps without finishing.` }, say: "Too many steps.", confirm: null, blocked: null };
  await db().desktopTask.update({ where: { id }, data: { heartbeatAt: new Date() } });
  const raw = await ask(systemPrompt(), stepPrompt(t.goal, i.elements, i.history, i.screen), i.image);
  return parseStep(raw, i.elements, i.screen);
}
