import "server-only";
import { getDb } from "@/lib/db";
import { isKnown, saveMemory, SENSITIVE } from "./user-memory";

/**
 * "Learn from my past chats": reads what the user has told JARVIS in earlier
 * conversations and saves the lasting facts and preferences as memories, so
 * every agent and every brain (including the Ollama PC brain) knows them.
 * Only the user's own messages are read; secrets are never stored; facts that
 * are already remembered are skipped.
 */

export type Complete = (system: string, user: string) => Promise<string>;

export interface LearnResult {
  scanned: number;
  batches: number;
  added: string[];
  alreadyKnown: number;
  stoppedEarly: boolean;
}

const BATCH_CHARS = 5500;
const MAX_BATCHES = 6;
const MAX_MESSAGES = 600;

const SYSTEM = `You extract LASTING facts and preferences about a user from messages they sent to their personal assistant.

Keep only things that stay true and would help the assistant personalise future answers:
- who they are (name, role, city, languages), their business/company, products, clients, goals
- preferences for how the assistant should talk or work (tone, length, format, tools, stack)
- recurring routines, likes and dislikes they state about themselves

Never include:
- one-off requests or questions ("what's the weather", "open darwin", "find cafes")
- anything temporary or already done
- passwords, API keys, tokens, codes or any other secret
- guesses — only what the user clearly said about themselves

Write each fact as a short standalone sentence in the third person ("Runs a web-design agency called Infinity Web & Apps.", "Prefers short spoken answers."). Give each a 1–3 word label.

Return ONLY JSON: {"facts":[{"key":"label","content":"fact"}]} — an empty list if there is nothing lasting. At most 15 facts.`;

/** Pull {"facts":[…]} out of a model reply (tolerates code fences / extra text). */
export function parseFacts(reply: string): { key: string | null; content: string }[] {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const obj = JSON.parse(reply.slice(start, end + 1));
    const list = Array.isArray(obj?.facts) ? obj.facts : [];
    return list
      .map((f: any) => ({
        key: typeof f?.key === "string" && f.key.trim() ? f.key.trim().slice(0, 80) : null,
        content: typeof f?.content === "string" ? f.content.trim().replace(/\s+/g, " ").slice(0, 500) : "",
      }))
      .filter((f: { content: string }) => f.content.length >= 6 && !SENSITIVE.test(f.content));
  } catch {
    return [];
  }
}

/** Group messages (oldest first) into prompt-sized batches. */
export function batchMessages(texts: string[], maxChars = BATCH_CHARS, maxBatches = MAX_BATCHES): string[] {
  const batches: string[] = [];
  let cur = "";
  for (const t of texts) {
    const line = `- ${t.replace(/\s+/g, " ").slice(0, 600)}\n`;
    if (cur.length + line.length > maxChars && cur) { batches.push(cur); cur = ""; }
    cur += line;
  }
  if (cur) batches.push(cur);
  // Most recent conversations matter most when there's more than we can read.
  return batches.slice(-maxBatches);
}

export async function learnFromChats(userId: string, complete: Complete, deadlineMs = 240_000): Promise<LearnResult> {
  const started = Date.now();
  const db = getDb();
  const rows = await db.message.findMany({
    where: { userId, role: "user" },
    orderBy: { createdAt: "desc" },
    take: MAX_MESSAGES,
    select: { content: true },
  });
  // Oldest first; drop short commands, exact repeats and anything secret-looking.
  const seen = new Set<string>();
  const texts = rows.reverse().map((r) => r.content.trim()).filter((t) => {
    const k = t.toLowerCase();
    if (t.length < 12 || seen.has(k) || SENSITIVE.test(t)) return false;
    seen.add(k);
    return true;
  });
  const batches = batchMessages(texts);

  const existing = (await db.memory.findMany({ where: { userId }, select: { content: true } })).map((m) => m.content);
  const added: string[] = [];
  let alreadyKnown = 0;
  let done = 0;
  for (const batch of batches) {
    if (Date.now() - started > deadlineMs) break;
    const known = existing.concat(added).slice(-80).map((c) => `- ${c}`).join("\n");
    const reply = await complete(
      SYSTEM,
      `Already remembered (don't repeat these):\n${known || "- (nothing yet)"}\n\nMessages the user sent:\n${batch}`,
    );
    done++;
    for (const f of parseFacts(reply)) {
      if (isKnown(f.content, existing.concat(added))) { alreadyKnown++; continue; }
      const res = await saveMemory(userId, f.content, { key: f.key, source: "learned" });
      if (res.saved) added.push(f.content);
      else if (res.reason === "duplicate") alreadyKnown++;
    }
  }
  return { scanned: texts.length, batches: done, added, alreadyKnown, stoppedEarly: done < batches.length };
}
