import "server-only";
import { z } from "zod";
import type { IntelItem, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { extractJson } from "@/lib/aston/build";
import { BUSINESS, CATEGORIES } from "./topics";

/**
 * JARVIS's reading of each item for Infinity Web & Apps. The model sees only
 * the headline, summary, publisher and date — never the full article — and the
 * analysis says so. Source confidence is computed, not asked of the model:
 * how many independent publishers carry the same story, and how much text we
 * actually had.
 */

export type Ask = (system: string, user: string) => Promise<string>;
const db = () => getDb();

export const analysisSchema = z.object({
  id: z.string(),
  category: z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]]).optional(),
  importance: z.coerce.number().int().min(1).max(5),
  relevance: z.coerce.number().int().min(1).max(5),
  whatHappened: z.string().min(5).max(500),
  whyItMatters: z.string().max(500),
  businessImpact: z.string().max(500),
  opportunity: z.string().max(500),
  risk: z.string().max(500),
  recommendedAction: z.string().max(400),
});
export type ItemAnalysis = z.infer<typeof analysisSchema> & { confidence: Confidence; basis: string; analyzedBy: string };
export interface Confidence { level: "high" | "medium" | "low"; publishers: string[]; reason: string }

const STOP = new Set("the a an and or of to in on for with from by at as is are was be its it this that new how why what will after into over about says say has have more than up out".split(" "));
export const keyWords = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
export function similar(a: string, b: string): boolean {
  const A = keyWords(a), B = keyWords(b);
  if (A.size < 3 || B.size < 3) return false;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size) >= 0.6;
}

/** Corroboration: distinct publishers carrying a similar headline in the last few days. */
export function confidenceFor(item: Pick<IntelItem, "title" | "summary" | "publisher" | "via">, pool: Pick<IntelItem, "title" | "publisher">[]): Confidence {
  const pubs = new Set<string>([item.publisher ?? "unknown publisher"]);
  for (const p of pool) if (p.publisher && similar(item.title, p.title)) pubs.add(p.publisher);
  const publishers = [...pubs];
  const thin = !item.summary || item.summary.length < 60;
  if (item.via === "youtube") return { level: "high", publishers, reason: "Published on the company's official YouTube channel." };
  if (publishers.length >= 3) return { level: "high", publishers, reason: `Reported by ${publishers.length} independent publishers.` };
  if (publishers.length === 2) return { level: "medium", publishers, reason: "Reported by 2 publishers." };
  return { level: thin ? "low" : "medium", publishers, reason: thin ? "Single source, headline only." : "Single source; not yet corroborated." };
}

export const SYSTEM = `You are JARVIS's business-environment analyst for ${BUSINESS.name}, ${BUSINESS.what}.
For each news item you are given ONLY its headline, a short summary, publisher and date — not the article. Rules:
- Use only what the headline and summary say. Do not add facts, numbers, names, quotes, dates or prices that are not in them. If the summary is thin, say what is unknown.
- Be concrete about ${BUSINESS.name}: services it could sell, tools it could adopt, client segments, pricing pressure, skills to learn.
- importance 1–5 (how significant the development is); relevance 1–5 (how much it matters to ${BUSINESS.name} specifically).
- categories: ${CATEGORIES.map((c) => c.id).join(", ")}.
Reply with ONE JSON object: {"items":[{"id","category","importance","relevance","whatHappened","whyItMatters","businessImpact","opportunity","risk","recommendedAction"}]} — one entry per input id.`;

/** Analyse the newest items that haven't been analysed yet (bounded per run). */
export async function analyzePending(userId: string, ask: Ask, o: { limit?: number; batch?: number; provider?: string } = {}): Promise<{ analyzed: number; failed: number; error?: string }> {
  const pending = await db().intelItem.findMany({ where: { userId, analyzedAt: null }, orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }], take: o.limit ?? 36 });
  if (!pending.length) return { analyzed: 0, failed: 0 };
  const pool = await db().intelItem.findMany({ where: { userId, fetchedAt: { gte: new Date(Date.now() - 5 * 86_400_000) } }, select: { title: true, publisher: true } });
  let analyzed = 0, failed = 0, error: string | undefined;
  const size = o.batch ?? 12;
  for (let i = 0; i < pending.length; i += size) {
    const chunk = pending.slice(i, i + size);
    const input = chunk.map((it, k) => ({ id: `n${k + 1}`, headline: it.title, summary: it.summary?.slice(0, 500) ?? null, publisher: it.publisher, date: it.publishedAt?.toISOString().slice(0, 10) ?? null, source: it.via === "youtube" ? "official YouTube video" : "news" }));
    try {
      const raw = extractJson(await ask(SYSTEM, `ITEMS:\n${JSON.stringify(input)}`)) as { items?: unknown[] };
      for (const r of raw.items ?? []) {
        const p = analysisSchema.safeParse(r);
        if (!p.success) continue;
        const k = Number(p.data.id.replace(/\D/g, "")) - 1;
        const it = chunk[k];
        if (!it) continue;
        const analysis: ItemAnalysis = { ...p.data, confidence: confidenceFor(it, pool), basis: it.summary ? "Headline and publisher summary only — not the full article." : "Headline only — no summary was available.", analyzedBy: o.provider ?? "ai" };
        await db().intelItem.update({ where: { id: it.id }, data: { analysis: analysis as unknown as Prisma.InputJsonValue, importance: p.data.importance, relevance: p.data.relevance, category: p.data.category ?? it.category, analyzedAt: new Date() } });
        analyzed++;
      }
      failed += chunk.length - (raw.items?.length ?? 0);
    } catch (e) {
      failed += chunk.length;
      error = (e as Error).message.slice(0, 200);
      break; // the brain is down — try again next refresh
    }
  }
  return { analyzed, failed, error };
}
