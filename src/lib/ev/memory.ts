import "server-only";
import { getDb } from "@/lib/db";
import { fingerprint, findSimilar } from "./dedup";
import type { EvContentKind, EvStatus } from "./config";

/**
 * EV's persistent memory layer over the EvContent table. Every store goes
 * through here so the fingerprint + dedup guarantee holds in one place.
 */

export interface EvItemInput {
  kind: EvContentKind;
  status?: EvStatus;
  niche?: string | null;
  theme?: string | null;
  title?: string;
  caption?: string | null;
  hook?: string | null;
  cta?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  scheduledAt?: Date | null;
}

/** Combine the text-bearing fields into one blob for fingerprint / similarity. */
export function itemText(i: {
  title?: string | null; caption?: string | null; hook?: string | null;
  cta?: string | null; body?: string | null; theme?: string | null;
}): string {
  return [i.title, i.hook, i.caption, i.cta, i.body, i.theme]
    .filter(Boolean)
    .join(" \n ")
    .trim();
}

/** Recent items (any kind) for dedup comparison + prompt context. */
export async function recentItems(userId: string, limit = 120) {
  return getDb().evContent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, kind: true, status: true, niche: true, theme: true,
      title: true, caption: true, hook: true, cta: true, body: true, createdAt: true,
    },
  });
}

/**
 * Check a candidate against EV's history. Returns duplicate/similar matches so
 * the tool can reject substantially-similar content BEFORE storing it.
 */
export async function checkDuplicate(
  userId: string,
  candidateText: string,
  opts: { niche?: string | null; threshold?: number } = {},
) {
  const fp = fingerprint(candidateText);
  const priors = await recentItems(userId, 200);

  const exact = priors.find((p) => fingerprint(itemText(p)) === fp);
  const scope = opts.niche
    ? priors.filter((p) => (p.niche ?? "").toLowerCase() === opts.niche!.toLowerCase())
    : priors;
  const similar = findSimilar(
    candidateText,
    scope.map((p) => ({ id: p.id, title: p.title || p.kind, text: itemText(p) })),
    opts.threshold ?? 0.72,
  );

  return {
    fingerprint: fp,
    isDuplicate: !!exact || similar.length > 0,
    exact: exact ? { id: exact.id, title: exact.title || exact.kind } : null,
    similar,
  };
}

/** Persist a new EV item with its computed fingerprint. */
export async function storeItem(userId: string, input: EvItemInput) {
  const text = itemText(input);
  const fp = fingerprint(text);
  return getDb().evContent.create({
    data: {
      userId,
      kind: input.kind,
      status: input.status ?? "draft",
      niche: input.niche ?? null,
      theme: input.theme ?? null,
      title: input.title ?? "",
      caption: input.caption ?? null,
      hook: input.hook ?? null,
      cta: input.cta ?? null,
      body: input.body ?? null,
      fingerprint: fp,
      metadata: (input.metadata ?? undefined) as object | undefined,
      scheduledAt: input.scheduledAt ?? null,
    },
  });
}

/** A compact, human-readable summary of EV's recent memory for the system prompt. */
export async function memorySummary(userId: string): Promise<string> {
  const items = await recentItems(userId, 40);
  if (items.length === 0) return "EV has no stored content yet — this is a fresh start.";

  const byStatus: Record<string, number> = {};
  const niches = new Set<string>();
  for (const i of items) {
    byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    if (i.niche) niches.add(i.niche);
  }
  const recentTitles = items
    .slice(0, 15)
    .map((i) => `- [${i.kind}${i.niche ? "/" + i.niche : ""}] ${i.title || (i.caption ?? "").slice(0, 60) || i.theme || "(untitled)"} (${i.status})`)
    .join("\n");

  const counts = Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(", ");
  const nicheList = [...niches].slice(0, 12).join(", ") || "none yet";

  return [
    `EV memory: ${items.length} recent items (${counts}). Niches covered: ${nicheList}.`,
    "Most recent items (do NOT repeat these — vary angle, hook and niche):",
    recentTitles,
  ].join("\n");
}
