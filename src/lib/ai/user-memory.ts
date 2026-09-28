import "server-only";
import { getDb } from "@/lib/db";
import { parseMemoryCommand, subjectKey } from "@/lib/memory/intent";

/**
 * The user's long-term memory, shared by EVERY agent (JARVIS, EV, DARWIN, and
 * ULTRON via the dashboard) and every brain (cloud or the Ollama PC brain) —
 * it lives in the database and is written into each prompt, so switching the
 * model never loses what the user has told JARVIS.
 */

export const SENSITIVE = /(password|passcode|api[\s_-]?key|secret|token|ssn|credit\s?card|cvv|\bpin\b|\botp\b)/i;

export interface MemoryRow { id?: string; key: string | null; content: string }

/**
 * Memories for the prompt: everything YOU asked JARVIS to remember comes first
 * (never pushed out by auto-learned facts), then the most recent learned ones,
 * within a size budget.
 */
export async function loadMemories(userId: string, take = 60): Promise<MemoryRow[]> {
  const db = getDb();
  const [mine, learned] = await Promise.all([
    db.memory.findMany({ where: { userId, source: "user" }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, key: true, content: true } }),
    db.memory.findMany({ where: { userId, NOT: { source: "user" } }, orderBy: { updatedAt: "desc" }, take, select: { id: true, key: true, content: true } }),
  ]);
  const out: MemoryRow[] = [];
  let chars = 0;
  for (const m of [...mine, ...learned]) {
    const len = m.content.length + (m.key?.length ?? 0) + 4;
    if (out.length >= Math.max(take, mine.length) || (chars + len > 8000 && out.length >= mine.length)) break;
    out.push(m); chars += len;
  }
  return out;
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
  opts: { key?: string | null; source?: string; replace?: boolean } = {},
): Promise<{ saved: true; id: string; updated?: boolean; previous?: string } | { saved: false; reason: "secret" | "duplicate" | "empty" }> {
  const text = content.trim().replace(/\s+/g, " ").slice(0, 1000);
  if (!text) return { saved: false, reason: "empty" };
  if (SENSITIVE.test(text)) return { saved: false, reason: "secret" };
  const db = getDb();
  const existing = await db.memory.findMany({ where: { userId }, select: { id: true, content: true, key: true } });
  // A correction ("my favourite colour is green" after "…blue") replaces the old fact.
  if (opts.replace) {
    const subject = subjectKey(text);
    if (subject) {
      const old = existing.find((m) => (m.key && m.key.toLowerCase() === subject) || subjectKey(m.content) === subject);
      if (old) {
        if (normalizeFact(old.content) === normalizeFact(text)) return { saved: false, reason: "duplicate" };
        await db.memory.update({ where: { id: old.id }, data: { content: text, key: opts.key?.trim().slice(0, 80) || old.key, source: opts.source ?? "user" } });
        return { saved: true, id: old.id, updated: true, previous: old.content };
      }
    }
  }
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
  const c = parseMemoryCommand(message);
  return c?.kind === "remember" ? c.fact : null;
}

/** Remove memories matching what you named ("my favourite colour", "the gym"). */
export async function forgetMemories(userId: string, query: string): Promise<{ removed: string[]; ambiguous: string[] }> {
  const db = getDb();
  const mems = await db.memory.findMany({ where: { userId }, select: { id: true, key: true, content: true } });
  const q = normalizeFact(query.replace(/^(?:that|about|the fact that)\s+/i, ""));
  const qKey = subjectKey(query.replace(/[.!?]+$/, "") + (/\bis\b/.test(query) ? "" : " is x"));
  const words = q.split(" ").filter((w) => w.length > 2 && !/^(the|and|that|this|about|what|told|you|your|was|are|is)$/.test(w));
  const scored = mems.map((m) => {
    const text = normalizeFact(`${m.key ?? ""} ${m.content}`);
    if (normalizeFact(m.content) === q || text.includes(q)) return { m, s: 1 };
    if (qKey && ((m.key && m.key.toLowerCase() === qKey) || subjectKey(m.content) === qKey)) return { m, s: 0.95 };
    if (!words.length) return { m, s: 0 };
    const hit = words.filter((w) => text.includes(w)).length / words.length;
    return { m, s: hit };
  }).filter((x) => x.s >= 0.99 || x.s >= 0.75).sort((a, b) => b.s - a.s);
  if (scored.length > 3) return { removed: [], ambiguous: scored.slice(0, 6).map((x) => x.m.content) };
  if (scored.length) await db.memory.deleteMany({ where: { userId, id: { in: scored.map((x) => x.m.id) } } });
  return { removed: scored.map((x) => x.m.content), ambiguous: [] };
}
