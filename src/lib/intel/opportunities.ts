import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { extractJson } from "@/lib/aston/build";
import type { Ask, ItemAnalysis } from "./analyze";
import { BUSINESS } from "./topics";

/**
 * Opportunity detector: the model proposes business opportunities, each tied
 * to the real items that support it; the SCORE is computed here from those
 * items (relevance, corroboration, recency, how many), never by the model.
 * An opportunity without real evidence is dropped.
 */

const db = () => getDb();

const oppSchema = z.object({
  title: z.string().min(5).max(140),
  whatHappened: z.string().max(500),
  whoBenefits: z.string().max(300),
  howWeCouldUseIt: z.string().max(600),
  difficulty: z.enum(["low", "medium", "high"]),
  evidence: z.array(z.string()).min(1).max(8),
  whyItMatters: z.string().max(500).optional(),
  nextAction: z.string().max(300).optional(),
});

export const SYSTEM = `You find business opportunities for ${BUSINESS.name}, ${BUSINESS.what}, from analysed news items.
Rules: use only the items given; each opportunity must cite the ids of the items that support it in "evidence"; no invented facts, numbers or companies; be specific (a service to offer, a niche to target, a tool to adopt).
Reply with ONE JSON object: {"opportunities":[{"title","whatHappened","whyItMatters","whoBenefits","howWeCouldUseIt","nextAction","difficulty":"low"|"medium"|"high","evidence":["id",...]}]} — at most 6, best first. "whoBenefits" names the target customers; "nextAction" is one concrete first step.`;

const CONF = { high: 1, medium: 0.6, low: 0.25 } as const;

export function scoreOpportunity(items: { relevance: number | null; publishedAt: Date | null; analysis: ItemAnalysis | null }[], difficulty: "low" | "medium" | "high", now = Date.now()) {
  const rel = items.reduce((a, i) => a + (i.relevance ?? 1), 0) / items.length; // 1..5
  const conf = Math.max(...items.map((i) => CONF[i.analysis?.confidence.level ?? "low"]));
  const ages = items.map((i) => (i.publishedAt ? (now - i.publishedAt.getTime()) / 86_400_000 : 7));
  const recency = Math.max(0, 1 - Math.min(...ages) / 10);
  const breadth = Math.min(items.length, 4) / 4;
  const ease = { low: 1, medium: 0.6, high: 0.25 }[difficulty];
  const score = Math.round(((rel - 1) / 4) * 40 + conf * 20 + recency * 15 + breadth * 15 + ease * 10);
  return { score, parts: { relevance: Math.round(rel * 10) / 10, confidence: conf, recency: Math.round(recency * 100) / 100, evidence: items.length, ease } };
}

export const SCORE_RULE = "Score 0–100 = relevance to Infinity Web & Apps (40) + source confidence (20) + recency (15) + number of supporting items (15) + ease of doing it (10). Computed from the cited items, not by the AI.";

export async function detectOpportunities(userId: string, ask: Ask, o: { days?: number; now?: Date } = {}) {
  const now = o.now ?? new Date();
  const items = await db().intelItem.findMany({
    where: { userId, analyzedAt: { not: null }, relevance: { gte: 3 }, OR: [{ publishedAt: { gte: new Date(now.getTime() - (o.days ?? 7) * 86_400_000) } }, { publishedAt: null, fetchedAt: { gte: new Date(now.getTime() - (o.days ?? 7) * 86_400_000) } }] },
    orderBy: [{ relevance: "desc" }, { importance: "desc" }], take: 30,
  });
  if (items.length < 2) return { created: 0, note: "Not enough relevant, analysed items yet." };
  const ids = new Map(items.map((it, k) => [`i${k + 1}`, it]));
  const input = [...ids.entries()].map(([id, it]) => {
    const a = it.analysis as unknown as ItemAnalysis;
    return { id, headline: it.title, publisher: it.publisher, date: it.publishedAt?.toISOString().slice(0, 10), whatHappened: a.whatHappened, opportunity: a.opportunity, relevance: it.relevance };
  });
  const raw = extractJson(await ask(SYSTEM, `ITEMS:\n${JSON.stringify(input)}`)) as { opportunities?: unknown[] };
  let created = 0;
  for (const r of raw.opportunities ?? []) {
    const p = oppSchema.safeParse(r);
    if (!p.success) continue;
    const ev = [...new Set(p.data.evidence)].map((id) => ids.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    if (!ev.length) continue; // no real evidence → dropped
    const { score, parts } = scoreOpportunity(ev.map((e) => ({ relevance: e.relevance, publishedAt: e.publishedAt, analysis: e.analysis as unknown as ItemAnalysis })), p.data.difficulty, now.getTime());
    const key = p.data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    const detail = { whatHappened: p.data.whatHappened, whyItMatters: p.data.whyItMatters ?? null, whoBenefits: p.data.whoBenefits, howWeCouldUseIt: p.data.howWeCouldUseIt, nextAction: p.data.nextAction ?? null, difficulty: p.data.difficulty, scoreParts: parts, rule: SCORE_RULE };
    const evidence = ev.map((e) => ({ itemId: e.id, title: e.title, publisher: e.publisher, url: e.url, publishedAt: e.publishedAt?.toISOString() ?? null, confidence: (e.analysis as unknown as ItemAnalysis).confidence.level }));
    await db().intelOpportunity.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, title: p.data.title, detail: detail as Prisma.InputJsonValue, score, evidence: evidence as Prisma.InputJsonValue },
      update: { title: p.data.title, detail: detail as Prisma.InputJsonValue, score, evidence: evidence as Prisma.InputJsonValue },
    });
    created++;
  }
  return { created };
}
