import "server-only";
import { getDb } from "@/lib/db";

/**
 * The user's long-term memory, shared by EVERY agent (JARVIS, EV, DARWIN, and
 * ULTRON via the dashboard) and every brain (cloud or the Ollama PC brain) —
 * it lives in the database and is written into each prompt, so switching the
 * model never loses what the user has told JARVIS.
 */

export const SENSITIVE = /(password|passcode|api[\s_-]?key|secret|token|ssn|credit\s?card|cvv|\bpin\b|\botp\b)/i;

export interface MemoryRow { id?: string; key: string | null; content: string }

export async function loadMemories(userId: string, take = 60): Promise<MemoryRow[]> {
  return getDb().memory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, key: true, content: true },
  });
}

/** Prompt section listing what's known about the user (empty string if nothing). */
export function memoryPromptBlock(mems: MemoryRow[], heading: string): string {
  if (!mems.length) return "";
  return `\n\n${heading}\n` + mems.map((m) => `- ${m.key ? `${m.key}: ` : ""}${m.content}`).join("\n");
}

/** Normalised form for duplicate detection ("I prefer tea." ≈ "i prefer tea"). */
export function normalizeFact(s: string): string {
  return s.toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Is `fact` already covered by one of `existing` (same, or contained in a longer one)? */
export function isKnown(fact: string, existing: string[]): boolean {
  const f = normalizeFact(fact);
  if (!f) return true;
  return existing.some((e) => {
    const n = normalizeFact(e);
    return n === f || (f.length >= 12 && n.includes(f));
  });
}

/**
 * Save a memory unless it's a secret or already known. Returns the saved row,
 * or a reason it wasn't saved.
 */
export async function saveMemory(
  userId: string,
  content: string,
  opts: { key?: string | null; source?: string } = {},
): Promise<{ saved: true; id: string } | { saved: false; reason: "secret" | "duplicate" | "empty" }> {
  const text = content.trim().replace(/\s+/g, " ").slice(0, 1000);
  if (!text) return { saved: false, reason: "empty" };
  if (SENSITIVE.test(text)) return { saved: false, reason: "secret" };
  const db = getDb();
  const existing = await db.memory.findMany({ where: { userId }, select: { content: true, key: true } });
  if (isKnown(text, existing.map((m) => (m.key ? `${m.key}: ${m.content}` : m.content)).concat(existing.map((m) => m.content)))) {
    return { saved: false, reason: "duplicate" };
  }
  const row = await db.memory.create({
    data: { userId, key: opts.key?.trim().slice(0, 80) || null, content: text, source: opts.source ?? "user" },
    select: { id: true },
  });
  return { saved: true, id: row.id };
}

/**
 * "Remember that I take my coffee black" / "from now on, keep answers short" —
 * explicit instructions are saved directly, so they're kept even when a small
 * local model forgets to call the memory tool. Returns the fact to store, or null.
 */
export function explicitMemory(message: string): string | null {
  const s = message.trim().replace(/^(hey |ok |okay )?jarvis[,!.\s]+/i, "");
  if (/\?\s*$/.test(s)) return null; // "do you remember …?" is a question
  let m = s.match(/^(?:please\s+)?(?:remember|don'?t forget|do not forget|keep in mind|make a note)(?:\s+(?:that|this))?[,:\s]+(.{3,600})$/i);
  // "remember to call mom at 5" is a reminder (a task), not a fact about the user.
  if (m && !/^(to|what|when|where|who|how|why|which|if|whether)\b/i.test(m[1].trim())) return tidy(m[1]);
  if (m) return null;
  m = s.match(/^from now on[,:\s]+(.{3,600})$/i);
  if (m) return `From now on: ${tidy(m[1])}`;
  return null;
}

function tidy(s: string): string {
  const t = s.trim().replace(/[.!\s]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}
