/**
 * De-duplication for EV content. EV must never repeat content, so every idea /
 * caption / post is reduced to a normalized fingerprint and compared (both
 * exactly and fuzzily) against everything EV has produced before.
 */
import { createHash } from "node:crypto";

/** Words too common to carry meaning for similarity. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "your",
  "our", "you", "we", "is", "are", "it", "this", "that", "at", "by", "from",
  "as", "be", "will", "can", "get", "new", "best", "top", "how", "why", "what",
]);

/** Normalize text → lowercase, strip punctuation/emoji, collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@]\w+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Content-defining token set (normalized, stop-words removed). */
export function tokenSet(input: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalizeText(input).split(" ")) {
    if (w.length > 2 && !STOP.has(w)) out.add(w);
  }
  return out;
}

/**
 * Stable fingerprint for exact-duplicate detection: the sorted content tokens
 * hashed. Two texts with the same meaningful words (any order) collide.
 */
export function fingerprint(input: string): string {
  const tokens = [...tokenSet(input)].sort();
  const basis = tokens.length ? tokens.join(" ") : normalizeText(input);
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

/** Jaccard similarity of two token sets, 0..1. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface SimilarHit {
  id: string;
  title: string;
  similarity: number;
}

/**
 * Compare a candidate against prior items. Returns the closest matches at/above
 * `threshold` (default 0.72 — "substantially similar"), most-similar first.
 */
export function findSimilar(
  candidate: string,
  priors: { id: string; title: string; text: string }[],
  threshold = 0.72,
): SimilarHit[] {
  const cand = tokenSet(candidate);
  const hits: SimilarHit[] = [];
  for (const p of priors) {
    const sim = jaccard(cand, tokenSet(p.text));
    if (sim >= threshold) hits.push({ id: p.id, title: p.title, similarity: Math.round(sim * 100) / 100 });
  }
  return hits.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}
