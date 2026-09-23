import "server-only";
import { getDb } from "@/lib/db";
import type { BrainEndpoint } from "@/lib/env";

/**
 * The Ollama "brain" on the user's PC. Vercel can't reach localhost, so the
 * brain gateway (`npm run brain` in edith/) opens a tunnel and registers its
 * current public URL here every couple of minutes. We treat a registration as
 * live only while those heartbeats keep arriving — a PC that's off or asleep is
 * skipped instantly (cloud providers take over) instead of timing out.
 */
export const BRAIN_PROVIDER = "ollama";
const STALE_MS = 5 * 60_000; // heartbeat every 2 min → stale after 5

interface BrainMeta { baseUrl?: string; model?: string; lastSeen?: string }

/** The live brain for this user, or null when the PC isn't online. */
export async function getLiveBrain(userId: string): Promise<BrainEndpoint | null> {
  const row = await getDb().integration.findUnique({
    where: { userId_provider: { userId, provider: BRAIN_PROVIDER } },
    select: { status: true, metadata: true },
  });
  const meta = (row?.metadata ?? {}) as BrainMeta;
  if (row?.status !== "connected" || !meta.baseUrl || !meta.lastSeen) return null;
  if (Date.now() - new Date(meta.lastSeen).getTime() > STALE_MS) return null;
  return { baseUrl: meta.baseUrl, model: meta.model };
}

/**
 * Record (or clear) the gateway's URL. JARVIS is a personal, single-owner app,
 * so the brain is attached to every account on this deployment.
 */
export async function registerBrain(input: { url: string | null; model?: string }): Promise<number> {
  const db = getDb();
  const users = await db.user.findMany({ select: { id: true } });
  const online = !!input.url;
  const metadata = online
    ? { baseUrl: input.url, model: input.model ?? null, lastSeen: new Date().toISOString() }
    : { lastSeen: new Date().toISOString() };
  for (const u of users) {
    await db.integration.upsert({
      where: { userId_provider: { userId: u.id, provider: BRAIN_PROVIDER } },
      create: { userId: u.id, provider: BRAIN_PROVIDER, status: online ? "connected" : "disconnected", metadata },
      update: { status: online ? "connected" : "disconnected", metadata },
    });
  }
  return users.length;
}
