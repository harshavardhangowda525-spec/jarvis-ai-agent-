/**
 * RUBEN's own backend: the island's API answered inside the desktop app, so
 * RUBEN runs without JARVIS. It uses the same CRM code and the same database
 * (DATABASE_URL from .env.local).
 *
 * Nothing listens on the network. Electron hands requests for rubin://app/api/…
 * to handle() (see main.cjs), and only RUBEN's own window can make them.
 *
 * Bundled by desktop/rubin/build.mjs into dist/server.cjs.
 */
import { z } from "zod";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { STAGES } from "@/lib/robin/types";
import { RobinError, moveStage } from "@/lib/robin/crm";
import { islandNotices, runIslandCommand } from "@/lib/robin/island";
import { islandDashboard, islandLeadFull } from "@/lib/robin/island-dashboard";
import { addFollowUpNote, cancelFollowUp, completeFollowUp, logInteraction } from "@/lib/robin/engage";
import { CHANNELS, CALL_OUTCOMES } from "@/lib/robin/types";
import type { IslandStatus } from "@/lib/robin/island-types";
import { getVoiceProvider } from "@/lib/voice/elevenlabs";
import { groqSttAvailable, groqTranscribe } from "@/lib/voice/groq-stt";
import { robinVoiceFor } from "@/lib/robin/voice";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ok = (data: unknown) => json(200, { ok: true, data });
const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) => json(status, { ok: false, error, ...extra });

// ---------------- whose CRM ----------------

let userCache: { id: string; email: string } | null = null;
/**
 * The CRM owner on this PC: RUBIN_USER_EMAIL from .env.local if set; else the
 * only account; else the account with the most RUBIN leads.
 */
export async function currentUser(): Promise<{ id: string; email: string }> {
  if (userCache) return userCache;
  const db = getDb();
  const wanted = process.env.RUBIN_USER_EMAIL?.trim().toLowerCase();
  if (wanted) {
    const u = await db.user.findUnique({ where: { email: wanted }, select: { id: true, email: true } });
    if (!u) throw new RobinError(`No JARVIS account with the email in RUBIN_USER_EMAIL (${wanted}).`, 404);
    return (userCache = u);
  }
  const users = await db.user.findMany({ select: { id: true, email: true, _count: { select: { robinLeads: true } } }, take: 50 });
  if (!users.length) throw new RobinError("There's no JARVIS account in this database yet — sign up in JARVIS once.", 404);
  users.sort((a, b) => b._count.robinLeads - a._count.robinLeads);
  return (userCache = { id: users[0].id, email: users[0].email });
}

// ---------------- RUBIN's brain for pitches and questions (Groq, text only) ----------------

async function ask(_userId: string, text: string, leadContext: string | null): Promise<{ text: string; error?: string }> {
  if (!env.groqApiKey) return { text: "", error: "RUBEN's AI needs GROQ_API_KEY in .env.local." };
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(45_000),
    headers: { Authorization: `Bearer ${env.groqApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.groqModel || "llama-3.3-70b-versatile", temperature: 0.6, max_tokens: 700,
      messages: [
        { role: "system", content: "You are RUBIN, a friendly, organised sales assistant for a small web-design business. Be concise and practical. Never invent prices, facts about the business, or results; say what you don't know. You never contact anyone yourself." },
        { role: "user", content: leadContext ? `${text}\n\n(The lead open in the CRM: ${leadContext})` : text },
      ],
    }),
  }).catch(() => null);
  if (!r) return { text: "", error: "Couldn't reach Groq." };
  if (!r.ok) return { text: "", error: r.status === 401 ? "Groq rejected GROQ_API_KEY." : `Groq answered ${r.status}.` };
  const j = (await r.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  return { text: String(j?.choices?.[0]?.message?.content ?? "").trim() };
}

// ---------------- the routes the island uses ----------------

const commandSchema = z.object({
  text: z.string().trim().min(1).max(600),
  leadId: z.string().max(40).nullable().optional(),
  pending: z.object({ kind: z.literal("move"), leadId: z.string().max(40), stage: z.enum(STAGES), name: z.string().max(200) }).nullable().optional(),
});
const stageSchema = z.object({ stage: z.enum(STAGES), confirm: z.boolean().optional(), note: z.string().max(300).nullable().optional(), source: z.enum(["user", "voice"]).optional() });
const followSchema = z.object({ action: z.enum(["complete", "cancel", "note"]), notes: z.string().max(2000).optional().nullable(), source: z.enum(["user", "voice"]).optional() });
const interactionSchema = z.object({
  channel: z.enum(CHANNELS), direction: z.enum(["outbound", "inbound"]).optional(),
  outcome: z.union([z.enum(CALL_OUTCOMES), z.enum(["replied", "no_reply", "sent"])]).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(), source: z.enum(["user", "voice"]).optional(),
});
const STATUSES: IslandStatus[] = ["all", "open", "ready", "interested", "rejected", "won"];

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;
  try {
    if (p === "/api/health") return ok({ standalone: true });

    if (p === "/api/voice/stt" && m === "POST") {
      const provider = getVoiceProvider();
      const useGroq = !provider.isConfigured() && groqSttAvailable();
      if (!provider.isConfigured() && !useGroq) return fail("Speech recognition needs ELEVENLABS_API_KEY or GROQ_API_KEY in .env.local.", 503);
      const file = (await req.formData()).get("audio");
      if (!(file instanceof Blob) || !file.size) return fail("No audio.", 400);
      const r = useGroq ? await groqTranscribe(file) : await provider.transcribe(file, file.type || "audio/webm");
      return ok({ text: r.text, language: r.language ?? null });
    }

    const user = await currentUser();

    if (p === "/api/voice/tts" && m === "POST") {
      const provider = getVoiceProvider();
      if (!provider.isConfigured()) return fail("No ELEVENLABS_API_KEY — RUBEN uses the computer's voice.", 503);
      const { text } = z.object({ text: z.string().min(1).max(1000) }).parse(await req.json());
      const voiceId = await robinVoiceFor(user.id);
      const audio = await provider.streamTts(text, { voiceId, speakingRate: 1.04 });
      return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }

    if (p === "/api/robin/island" && m === "GET") {
      const s = Number(url.searchParams.get("since"));
      const since = new Date(Number.isFinite(s) && s > 0 ? s : Date.now() - 60_000);
      return ok({ notices: await islandNotices(user.id, since), now: Date.now() });
    }
    if (p === "/api/robin/island" && m === "POST") return ok(await runIslandCommand(user.id, commandSchema.parse(await req.json()), { ask }));

    if (p === "/api/robin/island/dashboard" && m === "GET") {
      const lead = url.searchParams.get("lead");
      if (lead) return ok({ lead: await islandLeadFull(user.id, lead) });
      const st = url.searchParams.get("status") as IslandStatus | null;
      return ok(await islandDashboard(user.id, { status: st && STATUSES.includes(st) ? st : "open", q: (url.searchParams.get("q") ?? "").slice(0, 80) }));
    }

    let mm: RegExpMatchArray | null;
    if ((mm = p.match(/^\/api\/robin\/leads\/([\w-]{1,40})$/)) && m === "PATCH") {
      const b = stageSchema.parse(await req.json());
      const r = await moveStage(user.id, mm[1], b.stage, { source: b.source ?? "user", note: b.note, confirm: b.confirm });
      return ok({ moved: { changed: r.changed, from: r.from } });
    }
    if ((mm = p.match(/^\/api\/robin\/leads\/([\w-]{1,40})\/interactions$/)) && m === "POST") {
      const b = interactionSchema.parse(await req.json());
      return ok(await logInteraction(user.id, mm[1], { ...b, status: b.direction === "inbound" ? "received" : "logged" }, b.source ?? "user"));
    }
    if ((mm = p.match(/^\/api\/robin\/leads\/([\w-]{1,40})\/notes$/)) && m === "POST") {
      const b = z.object({ text: z.string().trim().min(1).max(1000) }).parse(await req.json());
      return ok(await addFollowUpNote(user.id, { leadId: mm[1], text: b.text }, "user"));
    }
    if ((mm = p.match(/^\/api\/robin\/followups\/([\w-]{1,40})$/)) && m === "PATCH") {
      const b = followSchema.parse(await req.json());
      if (b.action === "note") return ok(await addFollowUpNote(user.id, { followUpId: mm[1], text: b.notes ?? "" }, b.source ?? "user"));
      const row = b.action === "complete" ? await completeFollowUp(user.id, mm[1], { notes: b.notes }, b.source ?? "user") : await cancelFollowUp(user.id, mm[1], b.source ?? "user");
      return ok({ followUp: row });
    }
    return fail("Not found.", 404);
  } catch (err) {
    if (err instanceof RobinError) return fail(err.message, err.status, { code: err.code ?? null });
    if (err instanceof z.ZodError) return fail("That request wasn't valid.", 400);
    const msg = String((err as Error)?.message || err);
    // the database is unreachable: the island shows "CRM offline" and retries
    if (/Can't reach database|P1001|P1002|ECONNREFUSED|ENOTFOUND|timed out|DATABASE_URL/i.test(msg)) return fail("Can't reach the CRM database — check your internet / DATABASE_URL.", 503);
    console.error("RUBEN server:", err);
    return fail("Something went wrong — nothing was changed.", 500);
  }
}

/** Close the database connection when RUBEN quits. */
export async function shutdown() {
  try { await getDb().$disconnect(); } catch { /* already closed */ }
}
