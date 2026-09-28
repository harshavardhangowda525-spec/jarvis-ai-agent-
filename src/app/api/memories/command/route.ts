import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { getDb } from "@/lib/db";
import { forgetMemories, saveMemory } from "@/lib/ai/user-memory";
import { inSecondPerson, parseMemoryCommand } from "@/lib/memory/intent";
import { recordActivity } from "@/lib/activity/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Remember that …" / "Forget …" / "What do you remember?" — handled right here,
 * without the AI, so JARVIS keeps what you tell it even when its brain is off.
 * Memories live in the database and are shared by every agent and every brain.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`memory-cmd:${user.id}`, 30, 60_000);
    if (!rl.allowed) return fail("Too many requests — wait a moment.", 429);
    const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(await req.json());
    const cmd = parseMemoryCommand(text);
    if (!cmd) return ok({ handled: false });

    if (cmd.kind === "remember") {
      const r = await saveMemory(user.id, cmd.fact, { source: "user", replace: true });
      const said = inSecondPerson(cmd.fact);
      if (!r.saved) {
        const message = r.reason === "secret"
          ? "I won't store passwords, PINs, keys or other secrets — keep those in a password manager."
          : r.reason === "duplicate" ? `I already know that — ${said}.` : "I didn't catch what to remember.";
        return ok({ handled: true, kind: "remember", saved: false, reason: r.reason, message });
      }
      await recordActivity(user.id, { category: "decision", agent: "JARVIS", source: "chat", action: r.updated ? `Updated memory: ${cmd.fact}` : `Remembered: ${cmd.fact}`, status: "success", importance: 2 });
      const message = r.updated
        ? `Updated — ${said}. I've replaced what I had before ("${inSecondPerson(r.previous ?? "")}").`
        : `Got it. I'll remember that ${said}.`;
      return ok({ handled: true, kind: "remember", saved: true, updated: !!r.updated, id: r.id, fact: cmd.fact, message });
    }

    if (cmd.kind === "forget") {
      const r = await forgetMemories(user.id, cmd.query);
      if (r.ambiguous.length) {
        return ok({ handled: true, kind: "forget", removed: [], message: `That matches ${r.ambiguous.length}+ things I remember — say which one exactly, or remove it on the Memory page.`, candidates: r.ambiguous });
      }
      if (!r.removed.length) return ok({ handled: true, kind: "forget", removed: [], message: `I don't have anything about "${cmd.query}" in memory.` });
      await recordActivity(user.id, { category: "decision", agent: "JARVIS", source: "chat", action: `Forgot ${r.removed.length} memor${r.removed.length === 1 ? "y" : "ies"}`, status: "success", importance: 1 });
      return ok({ handled: true, kind: "forget", removed: r.removed, message: r.removed.length === 1 ? `Done — I've forgotten that ${inSecondPerson(r.removed[0])}.` : `Done — I've forgotten ${r.removed.length} things about that.` });
    }

    const all = await getDb().memory.findMany({ where: { userId: user.id }, orderBy: [{ source: "desc" }, { updatedAt: "desc" }], take: 100, select: { content: true, source: true } });
    const mine = all.filter((m) => m.source === "user");
    const order = [...mine, ...all.filter((m) => m.source !== "user")];
    if (!order.length) return ok({ handled: true, kind: "list", memories: [], message: "I don't have anything saved about you yet. Say \"remember that …\" and I'll keep it." });
    const joined = order.slice(0, 5).map((m) => inSecondPerson(m.content)).join("; ");
    const spoken = joined.charAt(0).toUpperCase() + joined.slice(1);
    return ok({
      handled: true, kind: "list", memories: order.map((m) => m.content),
      message: `I remember ${order.length} thing${order.length === 1 ? "" : "s"} about you${mine.length ? ` (${mine.length} you asked me to keep)` : ""}. ${order.length > 5 ? "Most recent: " : ""}${spoken}.`,
    });
  } catch (err) {
    return handleError(err);
  }
}
