import "server-only";
import { randomBytes } from "node:crypto";
import type { MarketingPlan, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { completeWithFallback } from "@/lib/ai/complete";
import { getLiveBrain } from "@/lib/ai/brain";
import { agentConfigs } from "@/lib/ai/agent";
import { DARWIN_BUSINESS } from "@/lib/darwin/config";
import { addDays, localMinutes, todayIn } from "@/lib/activity/dates";
import { extractJson } from "@/lib/aston/build";
import { PLAN_TZ, parseTime, planSchema, type Plan } from "./schema";

/**
 * The daily marketing plan. One per day (Asia/Kolkata), generated on the
 * server by a cloud schedule — your PC doesn't need to be on — and saved
 * before anyone is notified. A run that fails is retried at the next check,
 * at most MAX_ATTEMPTS times, and the failure is recorded as it happened.
 */

export const MAX_ATTEMPTS = 3;
const LEASE_MS = 3 * 60_000;
/** The plan is prepared up to this long before your delivery time (the schedule checks every hour at :30 IST). */
export const LEAD_MIN = 35;

const db = () => getDb();
const token = () => randomBytes(18).toString("base64url");
export const tpPath = (t: string) => `/tp/${t}`;

export const NICHES = ["gyms", "cafes", "restaurants", "clinics", "dental clinics", "salons", "coaching centres", "real estate agencies", "bakeries", "yoga studios", "boutiques", "interior designers"] as const;
const NICHE_WORDS: [string, RegExp][] = [
  ["gyms", /gym|fitness|crossfit/i], ["cafes", /caf[eé]|coffee/i], ["restaurants", /restaurant|dhaba|biryani|eatery|food court/i],
  ["dental clinics", /dent/i], ["clinics", /clinic|hospital|physio|doctor/i], ["salons", /salon|spa|beauty|parlou?r|barber/i],
  ["coaching centres", /coach|tuition|academy|institute|classes/i], ["real estate agencies", /real ?estate|realt|propert/i],
  ["bakeries", /bak(e|ery)|cake/i], ["yoga studios", /yoga|pilates/i], ["boutiques", /boutique|cloth|fashion|apparel/i], ["interior designers", /interior/i],
];
export const nicheOf = (category: string | null | undefined) => NICHE_WORDS.find(([, re]) => re.test(category ?? ""))?.[0] ?? null;

/** Real CRM numbers per niche: leads, and how many have no website listed. */
async function crmByNiche(userId: string) {
  const rows = await db().robinLead.groupBy({ by: ["category", "websiteStatus"], where: { userId }, _count: true }).catch(() => []);
  const out = new Map<string, { leads: number; noWebsite: number }>();
  for (const r of rows) {
    const n = nicheOf(r.category);
    if (!n) continue;
    const cur = out.get(n) ?? { leads: 0, noWebsite: 0 };
    cur.leads += r._count;
    if (r.websiteStatus === "no_website") cur.noWebsite += r._count;
    out.set(n, cur);
  }
  return out;
}

/** Today's niche: one not used in the last week, favouring the ones your CRM really has leads for. */
export function chooseNiche(date: string, recent: string[], crm: Map<string, { leads: number }>): string {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const fresh = NICHES.filter((n) => !recent.includes(n));
  const pool = fresh.length ? fresh : [...NICHES];
  const withLeads = pool.filter((n) => (crm.get(n)?.leads ?? 0) > 0).sort((a, b) => (crm.get(b)?.leads ?? 0) - (crm.get(a)?.leads ?? 0));
  return withLeads[0] ?? pool[day % pool.length];
}

export function planSystemPrompt() {
  return `You are ASTON, the marketing planner for ${DARWIN_BUSINESS.name}, a web & app studio in India (websites from ${DARWIN_BUSINESS.websiteFrom}, apps from ${DARWIN_BUSINESS.appFrom}; services: ${DARWIN_BUSINESS.services.join(", ")}; phone ${DARWIN_BUSINESS.phone}; Instagram ${DARWIN_BUSINESS.instagram}).
Write today's complete, practical marketing plan for the given niche.

Rules:
- Never invent statistics, market sizes, percentages, studies or business facts. Reason qualitatively. If you assume something, list it in "assumptions".
- Never claim a business has no website or app; scripts must ASK or say "I couldn't find a website for you — do you have one?".
- Use only the prices above; no discounts or offers that weren't given.
- Scripts are short, natural, Indian-English, friendly and respectful; written to be read aloud from a teleprompter. Use [Name] / [Business] where the lead's details go.
- WhatsApp and Instagram messages: under 90 words, no spammy language, one clear question.
- Follow-ups: 2–3 (e.g. "Day 2", "Day 5"), polite, and accept a no gracefully.
- The video brief is for an Instagram Reel promoting ${DARWIN_BUSINESS.name} to this niche: a hook for the first 2 seconds, 4–7 scenes with visual, on-screen text and motion, optional voice-over, a caption with 3–6 relevant hashtags, and a CTA.
- Checklist: 6–10 concrete tasks across prospecting, outreach, follow-ups, content and tracking.
- The plan may be opened from a share link: never include our CRM numbers, lead names or any customer details in it.

Reply with ONE JSON object only:
{"niche","opportunity","problems":[...],"services":[{"name","why"}],"scripts":{"call","instagram","whatsapp","followUps":[{"when","channel","text"}]},"content":{"idea","format"},"video":{"hook","scenes":[{"visual","onScreen","motion","voiceOver","seconds"}],"caption","cta"},"checklist":[{"task","block"}],"insight","assumptions":[...]}
block is one of: prospecting, outreach, follow-ups, content, tracking.`;
}

type Ask = (system: string, user: string) => Promise<string>;

export async function writePlan(ask: Ask, niche: string, ctx: { date: string; crm?: { leads: number; noWebsite: number }; recent: string[] }): Promise<Plan> {
  const weekday = new Date(`${ctx.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
  const crmLine = ctx.crm?.leads
    ? `From our real CRM: ${ctx.crm.leads} ${niche} leads, ${ctx.crm.noWebsite} of them with no website listed in our data (that is NOT proof they have none).`
    : `Our CRM has no ${niche} leads yet — today includes finding some.`;
  const user = `Date: ${weekday}, ${ctx.date} (Asia/Kolkata).\nNiche of the day: ${niche}.\n${crmLine}\nRecent niches (avoid repeating their angles): ${ctx.recent.join(", ") || "none"}.`;
  const system = planSystemPrompt();
  let reply = await ask(system, user);
  for (let round = 0; ; round++) {
    let problem: string;
    try {
      const r = planSchema.safeParse(extractJson(reply));
      if (r.success) return { ...r.data, niche }; // the niche of the day is chosen here, not by the model
      problem = r.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (e) { problem = (e as Error).message; }
    if (round >= 1) throw new Error(`The model didn't return a valid plan (${problem.slice(0, 200)}).`);
    reply = await ask(system, `${user}\n\nYour previous reply couldn't be used: ${problem}. Reply again with the complete, corrected JSON object only.`);
  }
}

async function defaultAsk(userId: string): Promise<Ask> {
  const brain = await getLiveBrain(userId).catch(() => null);
  const pick = agentConfigs("aston", brain);
  if (!pick.configs.length) throw new Error(pick.missing ?? "No AI provider is configured for ASTON.");
  return (system, user) => completeWithFallback(pick.configs, system, user, { maxTokens: 5000, timeoutMs: 120_000 });
}

/**
 * Make sure today's plan exists. Safe to call from many places at once: only
 * one caller generates (the row is the lock). `force` retries a plan that
 * already failed MAX_ATTEMPTS times.
 */
export async function ensurePlan(userId: string, o: { date?: string; now?: Date; ask?: Ask; force?: boolean } = {}): Promise<MarketingPlan> {
  const now = o.now ?? new Date();
  const date = o.date ?? todayIn(PLAN_TZ, now.getTime());
  let row = await db().marketingPlan.findUnique({ where: { userId_date: { userId, date } } });
  if (row?.status === "ready") return row;
  if (!row) {
    try {
      row = await db().marketingPlan.create({ data: { userId, date, status: "generating", attempts: 1, leaseUntil: new Date(now.getTime() + LEASE_MS), shareToken: token() } });
    } catch {
      return (await db().marketingPlan.findUnique({ where: { userId_date: { userId, date } } }))!; // someone else just started it
    }
  } else {
    if (row.status === "generating" && row.leaseUntil && row.leaseUntil > now) return row;
    if (row.attempts >= MAX_ATTEMPTS && !o.force) return row;
    const claimed = await db().marketingPlan.updateMany({
      where: { id: row.id, OR: [{ status: "failed" }, { status: "generating", leaseUntil: { lt: now } }] },
      data: { status: "generating", attempts: o.force ? 1 : { increment: 1 }, leaseUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (!claimed.count) return row;
  }
  try {
    const recentRows = await db().marketingPlan.findMany({ where: { userId, date: { gte: addDays(date, -7), lt: date }, niche: { not: null } }, select: { niche: true } });
    const recent = recentRows.map((r) => r.niche!).filter(Boolean);
    const crm = await crmByNiche(userId);
    const niche = chooseNiche(date, recent, crm);
    const plan = await writePlan(o.ask ?? (await defaultAsk(userId)), niche, { date, crm: crm.get(niche), recent });
    return await db().marketingPlan.update({ where: { id: row.id }, data: { status: "ready", niche, plan: plan as unknown as Prisma.InputJsonValue, error: null, leaseUntil: null } });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).replace(/(key|token|secret|password)=\S+/gi, "$1=…").slice(0, 400);
    return db().marketingPlan.update({ where: { id: row.id }, data: { status: "failed", error: msg, leaseUntil: null } });
  }
}

export async function planSettings(userId: string) {
  return (await db().marketingPlanSettings.findUnique({ where: { userId } })) ?? { userId, enabled: true, deliveryTime: "07:00", notifyEmail: false, notifyWhatsapp: false, updatedAt: new Date(0) };
}

/** Is it time to prepare today's plan for this delivery time? */
export function isDue(now: Date, deliveryTime: string) {
  const at = parseTime(deliveryTime) ?? 7 * 60;
  return localMinutes(now, PLAN_TZ) >= at - LEAD_MIN;
}

/**
 * The scheduled run: for each user whose plan is due, make today's plan and
 * then send the "plan ready" notification once. Never sends before the plan
 * is saved.
 */
export async function runDuePlans(o: { now?: Date; ask?: Ask; notify?: (p: MarketingPlan) => Promise<unknown>; userIds?: string[] } = {}) {
  const now = o.now ?? new Date();
  const users = await db().user.findMany({ where: o.userIds ? { id: { in: o.userIds } } : {}, select: { id: true } });
  const report: { userId: string; status: string; niche?: string | null; notified?: boolean; error?: string | null }[] = [];
  for (const u of users) {
    const st = await planSettings(u.id);
    if (!st.enabled || !isDue(now, st.deliveryTime)) { report.push({ userId: u.id, status: st.enabled ? "not_due" : "disabled" }); continue; }
    const p = await ensurePlan(u.id, { now, ask: o.ask });
    let notified = !!p.notifiedAt;
    if (p.status === "ready" && !p.notifiedAt && o.notify) { await o.notify(p).catch((e) => console.error("[plans] notify failed:", e)); notified = true; }
    report.push({ userId: u.id, status: p.status, niche: p.niche, notified, error: p.error });
  }
  return report;
}

export const planView = (p: MarketingPlan) => ({
  id: p.id, date: p.date, status: p.status, niche: p.niche, plan: p.plan as unknown as Plan | null, error: p.error, attempts: p.attempts,
  link: p.shareRevokedAt ? null : tpPath(p.shareToken), shared: !p.shareRevokedAt,
  notifiedAt: p.notifiedAt?.toISOString() ?? null, notifyLog: (p.notifyLog ?? []) as { channel: string; status: string; detail?: string; at: string }[],
  createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
});
export type PlanView = ReturnType<typeof planView>;

export async function listPlans(userId: string, take = 30) {
  const rows = await db().marketingPlan.findMany({ where: { userId }, orderBy: { date: "desc" }, take });
  return rows.map(planView);
}

/** New share link for a plan; the old one stops working. */
export async function rotatePlanLink(userId: string, id: string) {
  const p = await db().marketingPlan.findFirst({ where: { id, userId } });
  if (!p) throw new Error("That plan doesn't exist.");
  return db().marketingPlan.update({ where: { id }, data: { shareToken: token(), shareRevokedAt: null } });
}
export async function revokePlanLink(userId: string, id: string) {
  const p = await db().marketingPlan.findFirst({ where: { id, userId } });
  if (!p) throw new Error("That plan doesn't exist.");
  return db().marketingPlan.update({ where: { id }, data: { shareRevokedAt: new Date() } });
}

/** One line for ASTON's prompt. */
export async function todayPlanSummary(userId: string): Promise<string> {
  const date = todayIn(PLAN_TZ);
  const p = await db().marketingPlan.findUnique({ where: { userId_date: { userId, date } } });
  if (!p) return `Today's plan (${date}) hasn't been made yet.`;
  if (p.status === "ready") return `Today's plan (${date}) is ready — niche: ${p.niche}. Teleprompter: ${tpPath(p.shareToken)}.`;
  return p.status === "failed" ? `Today's plan (${date}) failed: ${p.error}` : `Today's plan (${date}) is being written right now.`;
}
